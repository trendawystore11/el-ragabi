// =============================================================================
// مختبر سيناريوهات المحاسبة — أدوات مشتركة (helpers)
// -----------------------------------------------------------------------------
// سلسلة اختبارات «سيناريوهات» تحاكي حركة مستخدم كاملة عبر طبقة الدومين الحقيقية
// (fakeRepo يفوّض لكل الوحدات النقية — لا يوجد أي mock للحسابات)، وتتحقق بعد كل
// سيناريو من تماسك كل لوحة الأرقام: رصيد المورد = صافي دفتره = مشترياته − مدفوعه،
// رصيد العميل يطابق فواتيره المحقَّقة، والدفتر/الخزينة/الربح لا يتركون فروقاً.
// =============================================================================
import { expect } from 'vitest'
import { round2, toNumber } from '@/utils/formatters'
import { isActiveOrderStatus } from '@/domain/orders/orderMachine'
import { getOrderRemainingAmount } from '@/domain/accounting/accounting'
import { computeTreasury } from '@/state/reportsStore'
import { calculateNetProfit } from '@/domain/accounting/accounting'
import { getCurrentOperatingExpenses } from '@/domain/accounting/expenses'
import { freshSystem, seedProduct, seedSupplier, STORAGE_KEYS } from '../../helpers/fakeRepo'

/* ===================== بناء البيئة ===================== */

export { freshSystem, seedProduct, seedSupplier, STORAGE_KEYS }

/** بيئة مشتركة: منتج في المخزن + مورد جاهز للتوريد. */
export function seedStore({ productOver = {}, supplierOver = {} } = {}) {
  const { db, repo } = freshSystem({
    [STORAGE_KEYS.PRODUCTS]: [seedProduct(productOver)],
    [STORAGE_KEYS.SUPPLIERS]: [seedSupplier(supplierOver)],
  })
  return { db, repo }
}

/** بند فاتورة نموذجي. */
export function item({ productId = 'PRD1', productName = 'منتج أ', quantity = 2, sellingPrice = 250, purchasePrice = 100, supplierId = 'SUP1', supplierName = 'مورد أ', ...over } = {}) {
  return { productId, productName, quantity, sellingPrice, purchasePrice, supplierId, supplierName, ...over }
}

export function customerInfo({ name = 'أحمد محمد', phone = '01012345678', ...over } = {}) {
  return { name, phone, ...over }
}

/** مبلغ الاسترداد الكلي لعميل من سجل الدفعات (مجموع القيم المطلقة للسالبة). */
export function totalCustomerRefunds(payments, customerId) {
  return round2((payments || [])
    .filter(p => p.entityType === 'customer' && p.entityId === customerId && Number(p.amount) < 0)
    .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0))
}

/* ===================== الكشّافات الدلالية ===================== */

export function supplierLedgerNet(txns, supplierId) {
  return round2((txns || [])
    .filter(t => t.supplierId === supplierId)
    .reduce((s, t) => s + (Number(t.debit) || 0) - (Number(t.credit) || 0), 0))
}

export function activeOrderList(orders, customerId) {
  return (orders || []).filter(o => o.customerId === customerId && isActiveOrderStatus(o.status))
}

export function fulfilledOrderList(orders, customerId) {
  return (orders || []).filter(o => o.customerId === customerId && (o.status === 'delivered' || o.status === 'completed'))
}

/* ===================== الثوابت (المتحقق منها في كل سيناريو) ===================== */

/**
 * أقوى ثابت في النظام كله: رصيد المورد المخزَّن يجب أن يطابق صافي دفتره
 * (مدين − دائن) ويطابق مشترياته − مدفوعه في كل لحظة.
 */
export function expectSupplierConsistent(supplier, txns) {
  expect(round2(Number(supplier.remainingBalance) || 0)).toBe(supplierLedgerNet(txns, supplier.id))
  expect(round2((Number(supplier.totalPurchases) || 0) - (Number(supplier.paid) || 0)))
    .toBe(round2(Number(supplier.remainingBalance) || 0))
}

/** ثابت مالية الطلب: الطلبات النشطة «دفعة + متبقي = إجمالي»، والمنتهية صفر متبقٍّ. */
export function expectOrderMoneyConsistent(order) {
  if (!isActiveOrderStatus(order.status)) {
    expect(Number(order.remainingBalance) || 0).toBe(0)
    return
  }
  expect(round2((Number(order.downPayment) || 0) + (Number(order.remainingBalance) || 0)))
    .toBe(round2(Number(order.totalAmount) || 0))
  expect(round2(getOrderRemainingAmount(order))).toBe(round2(Number(order.remainingBalance) || 0))
}

/**
 * ثابت دفاتر العميل — يعيد بناء رصيد العميل من مصادر الحقيقة بالضبط كما يفعل
 * recalculateCustomerBalance (طلبات نشطة − عربونات − تحصيلات مباشرة)، ثم يقارن
 * الحقول المخزَّنة بها. البعدان المتينان دائماً: totalPurchases وremainingBalance
 * (حقل paid يُحدَّث تراكمياً ويتأثر بالمرتجعات/إعادة الاعتماد، فيُتحقق منه يدوياً
 * في كل سيناريو بالقيمة المتوقعة الصريحة).
 */
export function expectCustomerLedgerTies(customer, orders, payments) {
  const active = (orders || []).filter(o => o.customerId === customer.id && o.status !== 'returned' && o.status !== 'cancelled')
  const totalPurchases = round2(active.reduce((s, o) => s + toNumber(o.totalAmount), 0))
  const totalDownPayments = round2(active.reduce((s, o) => s + toNumber(o.downPayment), 0))
  const direct = round2((payments || [])
    .filter(p => p.entityType === 'customer' && p.entityId === customer.id && !p.isDownPayment && !p.allocatedToOrders && toNumber(p.amount) > 0)
    .reduce((s, p) => s + toNumber(p.amount), 0))
  const totalPaid = round2(totalDownPayments + direct)

  expect(round2(Number(customer.totalPurchases) || 0)).toBe(totalPurchases)
  expect(round2(Number(customer.remainingBalance) || 0)).toBe(round2(Math.max(0, totalPurchases - totalPaid)))
}

/** ثابت المخزون: الطلبات المحقَّقة خصمت فقط وحدات المخزن (consumed)، والمرتجعات
 *  أعادت نفس الوحدات بالضبط — لا يُخلق مخزون ولا يُحرق. */
export function expectStockTies(product, expectedStock) {
  expect(Number(product.stock) || 0).toBe(expectedStock)
}

/* ===================== التقارير (تحقّق ختامي لكل سيناريو) ===================== */

export function treasuryReport(db) {
  return computeTreasury(db.getCollection(STORAGE_KEYS.PAYMENTS), db.getCollection(STORAGE_KEYS.ORDERS))
}

export function profitReport(db) {
  const expenses = () => db.getCollection(STORAGE_KEYS.EXPENSES)
  return calculateNetProfit(db.getCollection(STORAGE_KEYS.ORDERS), {
    getExpenses: expenses,
    getCurrentOperatingExpenses: () => getCurrentOperatingExpenses(expenses()),
    getSupplierReturns: () => db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS),
  })
}
