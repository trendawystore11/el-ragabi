// =============================================================================
// state/reportsStore.js — طبقة بيانات شاشة التقارير — Phase 8
// -----------------------------------------------------------------------------
// يحمل لقطة البيانات (الطلبات/الدفعات/المصروفات/العملاء/الموردون) + التبويب
// النشط + فلاتر التاريخ + اختيار العميل/المورد لكشف الحساب. refresh() يقرأ من
// window (الجسر) مثل بقية مخازن الشاشات، ويتحدث تلقائياً عند bms-data-synced.
// الحسابات الإضافية (فلتر 30 يوم + إعادة بناء الخزينة) دوال نقية مأخوذة
// حرفياً من js/components/reports-view.js.
// =============================================================================
import { create } from 'zustand'
import { round2, getCairoFormattedDate } from '@/utils/formatters'

export const REPORT_TABS = [
  { id: 'sales', label: 'الأرباح والمبيعات' },
  { id: 'expenses', label: 'مصاريف التشغيل' },
  { id: 'customer', label: 'كشف حساب عميل' },
  { id: 'supplier', label: 'كشف حساب مورد' },
  { id: 'treasury', label: 'إدارة وتعديل الخزينة' },
]

export const useReportsStore = create(set => ({
  tab: 'sales',
  dateFrom: '',
  dateTo: '',
  customerId: '',
  supplierId: '',
  orders: [],
  payments: [],
  expenses: [],
  customers: [],
  suppliers: [],
  ready: false,

  refresh() {
    set({
      orders: window.getOrders ? [...window.getOrders()] : [],
      payments: window.getPayments ? [...window.getPayments()] : [],
      expenses: window.getExpenses ? [...window.getExpenses()] : [],
      customers: window.getCustomers ? [...window.getCustomers()] : [],
      suppliers: window.getSuppliers ? [...window.getSuppliers()] : [],
      ready: true,
    })
  },

  setTab(t) {
    set({ tab: t })
  },

  setDateFrom(d) {
    set({ dateFrom: d || '' })
  },

  setDateTo(d) {
    set({ dateTo: d || '' })
  },

  resetDateFilter() {
    set({ dateFrom: '', dateTo: '' })
  },

  setCustomerId(id) {
    set({ customerId: id || '' })
  },

  setSupplierId(id) {
    set({ supplierId: id || '' })
  },
}))

/**
 * فلتر 30 يوم الافتراضي (نفس window.filterOrdersSmart القديم): بدون فلتر تاريخ
 * يعرض آخر 30 يوماً فقط، ومع فلتر تاريخ يعتمد المقارنة النصية YYYY-MM-DD.
 */
export function filterOrdersSmart(ordersList, dateFrom = null, dateTo = null, now = new Date()) {
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  thirtyDaysAgo.setHours(0, 0, 0, 0)

  const hasDateFilter = dateFrom || dateTo

  return (Array.isArray(ordersList) ? ordersList : []).filter(o => {
    const rawDateStr = o.createdAt || o.date || getCairoFormattedDate()
    const itemDateStr = String(rawDateStr).replace('T', ' ').split(' ')[0]
    const itemDate = new Date(itemDateStr + 'T00:00:00')
    if (isNaN(itemDate.getTime())) return true

    if (hasDateFilter) {
      const fromMatch = dateFrom ? itemDateStr >= dateFrom : true
      const toMatch = dateTo ? itemDateStr <= dateTo : true
      return fromMatch && toMatch
    }

    return itemDate >= thirtyDaysAgo
  })
}

/**
 * إعادة بناء ملخص الخزينة (وارد/صادر/صافي) — نقل حرفي لمنطق renderSalesReport:
 * المقبوضات مقيدة بسقف إجمالي الفاتورة لكل طلب فلا تتضاعف، مردودات الموردين
 * النقدية وارد فعلي، ومدفوعات الموردين تخرج من الصافي. حركات الخزينة المباشرة
 * (مردودات مستردة + تسويات يدوية) تُضاف/تُطرح من الصافي بقيمها الموقّعة.
 */
export function computeTreasury(payments, orders) {
  const list = Array.isArray(payments) ? payments : []
  const allOrders = Array.isArray(orders) ? orders : []

  const ordersById = {}
  allOrders.forEach(o => {
    ordersById[o.id] = o
  })

  const perOrderCollected = {}
  list.forEach(p => {
    if (p.entityType === 'customer' && (Number(p.amount) || 0) > 0 && p.isDownPayment && p.refOrderId) {
      perOrderCollected[p.refOrderId] = round2((perOrderCollected[p.refOrderId] || 0) + (Number(p.amount) || 0))
    }
  })

  const cappedOrderCollected = Object.keys(perOrderCollected).reduce((sum, orderId) => {
    const order = ordersById[orderId]
    const raw = perOrderCollected[orderId]
    const cap = order && (Number(order.totalAmount) || 0) > 0 ? Number(order.totalAmount) : raw
    return sum + round2(Math.min(raw, cap))
  }, 0)

  const standaloneCustomerCollected = list
    .filter(p => p.entityType === 'customer' && (Number(p.amount) || 0) > 0 && !(p.isDownPayment && p.refOrderId))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const supplierCashBack = list
    .filter(p => p.entityType === 'supplier' && (Number(p.amount) || 0) < 0)
    .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0)

  const totalInflow = round2(cappedOrderCollected + standaloneCustomerCollected + supplierCashBack)

  const customerRefunds = list
    .filter(p => p.entityType === 'customer' && (Number(p.amount) || 0) < 0)
    .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0)

  const totalSupplierPayments = list
    .filter(p => p.entityType === 'supplier' && (Number(p.amount) || 0) > 0)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const totalRefunds = customerRefunds

  // V3.54 — حركات الخزينة المباشرة (entityType === 'treasury'): مردودات نقدية
  // مستردة من الموردين (وارد) وتسويات رصيد الخزينة اليدوية (وارد موجب/صادر سالب).
  const treasuryMovements = list.filter(p => p.entityType === 'treasury')
  const treasuryInflow = treasuryMovements
    .filter(p => (Number(p.amount) || 0) > 0)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const treasuryOutflow = treasuryMovements
    .filter(p => (Number(p.amount) || 0) < 0)
    .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0)

  const netTreasury = round2(totalInflow - totalRefunds - totalSupplierPayments + treasuryInflow - treasuryOutflow)

  return { totalInflow, totalRefunds, totalSupplierPayments, treasuryInflow, treasuryOutflow, netTreasury }
}

// حقيقة لحظية: عند وصول لقطة بيانات (orders/payments/expenses/... أو تحديث يدوي
// شامل) → إعادة قراءة المصادر فيُحدث المخزن كل الأرقام في الشاشة تلقائياً.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (
      !key ||
      key === '*' ||
      key === 'orders' ||
      key === 'payments' ||
      key === 'expenses' ||
      key === 'customers' ||
      key === 'suppliers'
    ) {
      useReportsStore.getState().refresh()
    }
  })
}
