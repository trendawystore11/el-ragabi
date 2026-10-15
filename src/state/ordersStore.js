// =============================================================================
// state/ordersStore.js — طبقة بيانات شاشة الطلبات — Phase 3
// -----------------------------------------------------------------------------
// يحمل قائمة الطلبات + مرشّحات البحث/الحالة، ويقرأ المصدر الخام من التخزين
// عبر window.getOrders (الجسر) أو يُحقن مباشرة عبر setOrders (لاختبارات الدومين
// وللتزامن المستقبلي). التصفية دالة نقية تعتمد على searchOrders المنقول.
// يُحدِّث المخزن نفسه عند أحداث bms-data-synced (حقيقة لحظية مثل القديم).
// =============================================================================
import { create } from 'zustand'
import { searchOrders } from '@/domain/orders/orderRepository'

export const useOrdersStore = create((set, get) => ({
  orders: [],
  ready: false,
  search: '',
  status: '',

  // قراءة لقطة من التخزين (نفس المصدر الخام للجسر — بلا تكرار).
  // V3.28 — تُنسَخ القائمة دائماً إلى مرجع جديد: كتابات db.js تُحدِّث مصفوفة
  // الكاش نفسها في مكانها، وبدون نسخة جديدة يتجاهل React التحديث لأن المرجع
  // لم يتغيّر — النسخ يضمن تفاعل المكونات فورياً دون إعادة تحميل.
  refresh() {
    const src = typeof window !== 'undefined' && window.getOrders ? window.getOrders() : get().orders
    set({ orders: Array.isArray(src) ? [...src] : [], ready: true })
    return get().orders
  },

  setOrders(list) {
    if (!Array.isArray(list)) return
    set({ orders: [...list], ready: true })
  },

  setSearch(q) {
    set({ search: q || '' })
  },

  setStatus(s) {
    set({ status: s || '' })
  },

  resetFilters() {
    set({ search: '', status: '' })
  },
}))

/**
 * خط التصفية الوحيد (بحث حر + حالة + نطاق تاريخ) — نفس منطق V3.26 في orders-view القديم.
 */
export function applyOrderFilters(orders, search, status, dateFrom = '', dateTo = '') {
  let list = searchOrders(Array.isArray(orders) ? orders : [], search)
  if (status) list = list.filter(o => String(o.status) === status)
  if (dateFrom) {
    const from = String(dateFrom)
    list = list.filter(o => String(o.createdAt || o.date || '').slice(0, 10) >= from)
  }
  if (dateTo) {
    const to = String(dateTo)
    list = list.filter(o => String(o.createdAt || o.date || '').slice(0, 10) <= to)
  }
  // ترتيب الأحدث ← الأقدم حسب التاريخ (createdAt أو date)
  list = [...list].sort((a, b) => {
    const ta = (a && (a.createdAt || a.date)) || ''
    const tb = (b && (b.createdAt || b.date)) || ''
    return String(tb).localeCompare(String(ta), undefined, { numeric: true })
  })
  return list
}

// حقيقة لحظية: عند وصول لقطة مخزن الطلبات (STORAGE_KEYS.ORDERS = 'orders') أو
// تحديث يدوي شامل → إعادة القراءة.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (!key || key === '*' || key === 'orders') useOrdersStore.getState().refresh()
  })
}
