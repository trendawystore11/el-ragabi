import { describe, it, expect, beforeEach } from 'vitest'
import '@/legacy/compat'
import { useProductsStore } from '@/state/productsStore'
import { useOrdersStore } from '@/state/ordersStore'
import { useCustomersStore } from '@/state/customersStore'
import { useExpensesStore } from '@/state/expensesStore'

// =============================================================================
// store-auto-refresh — التحديث التلقائي للمخازن بعد الكتابة المحلية
// -----------------------------------------------------------------------------
// كل كتابة محلية ناجحة (إضافة/تعديل/حذف عبر db.js) تُطلق حدث bms-data-synced
// بمفتاح المجموعة المتأثرة، فتقرأ المخازن مصدرها الخام فوراً — دون أي إعادة
// تحميل يدوية للصفحة (وهو نفس سلوك لقطات Firestore الحية).
// =============================================================================

function resetStores() {
  useProductsStore.setState({ products: [], ready: false })
  useOrdersStore.setState({ orders: [], ready: false })
  useCustomersStore.setState({ customers: [], ready: false })
  useExpensesStore.setState({ expenses: [], ready: false })
}

beforeEach(() => {
  window.firestoreCache = {}
  window.localStorage.clear()
  window.sessionStorage && window.sessionStorage.clear()
  resetStores()
})

describe('التحديث التلقائي للمخازن بعد الكتابة المحلية (لا إعادة تحميل)', () => {
  it('createProduct يُحدّث productsStore تلقائياً دون استدعاء refresh يدوي', () => {
    const p = window.createProduct({ name: 'قماش قطني جديد', code: 'FAB-9', sellingPrice: 150, stock: 20, minStock: 5 })
    expect(p.id).toMatch(/^PRD-/)
    const products = useProductsStore.getState().products
    expect(useProductsStore.getState().ready).toBe(true)
    expect(products.some(x => x.id === p.id && x.name === 'قماش قطني جديد')).toBe(true)
  })

  it('updateProduct يُحدّث السجل الحالي داخل productsStore تلقائياً', () => {
    const p = window.createProduct({ name: 'قماش', code: 'FAB-A', sellingPrice: 100 })
    window.updateProduct(p.id, { name: 'قماش محدّث', sellingPrice: 140 })
    const row = useProductsStore.getState().products.find(x => x.id === p.id)
    expect(row.name).toBe('قماش محدّث')
    expect(row.sellingPrice).toBe(140)
  })

  it('deleteProduct يُزيل السجل من productsStore تلقائياً', async () => {
    const p = window.createProduct({ name: 'قماش للحذف', code: 'FAB-DEL', sellingPrice: 10 })
    expect(useProductsStore.getState().products.some(x => x.id === p.id)).toBe(true)
    await window.deleteProduct(p.id)
    expect(useProductsStore.getState().products.some(x => x.id === p.id)).toBe(false)
  })

  it('createCustomer يُحدّث customersStore تلقائياً', () => {
    window.createCustomer({ name: 'عميل تلقائي', phone: '01012345678', category: 'تجزئة' })
    const customers = useCustomersStore.getState().customers
    expect(useCustomersStore.getState().ready).toBe(true)
    expect(customers.some(c => c.name === 'عميل تلقائي')).toBe(true)
  })

  it('createExpense يُحدّث expensesStore تلقائياً', () => {
    window.createExpense({ title: 'إيجار جديد', amount: 500, date: '2026-08-05', category: 'عمومية' })
    const expenses = useExpensesStore.getState().expenses
    expect(useExpensesStore.getState().ready).toBe(true)
    expect(expenses.some(e => e.title === 'إيجار جديد' && Number(e.amount) === 500)).toBe(true)
  })

  it('deleteExpense يُزيل البند من expensesStore تلقائياً', async () => {
    const e = window.createExpense({ title: 'مصروف للحذف', amount: 50, date: '2026-08-05' })
    expect(useExpensesStore.getState().expenses.some(x => x.id === e.id)).toBe(true)
    await window.deleteExpense(e.id)
    expect(useExpensesStore.getState().expenses.some(x => x.id === e.id)).toBe(false)
  })

  it('createOrder يُحدّث ordersStore ويخصم مخزون المنتج في productsStore تلقائياً', async () => {
    const p = window.createProduct({ name: 'بطانية مورا', code: 'BLANKET-1', purchasePrice: 1000, sellingPrice: 1400, stock: 10, minStock: 2 })
    const order = await window.createOrder({
      customerInfo: { name: 'مشتري بالكاش', phone: '01112345678' },
      items: [{ productId: p.id, productName: 'بطانية مورا', sellingPrice: 1400, purchasePrice: 1000, quantity: 2 }],
      downPayment: 0,
      status: 'completed',
    })
    expect(order.id).toMatch(/^ORD-/)
    const orders = useOrdersStore.getState().orders
    expect(orders.some(o => o.id === order.id)).toBe(true)
    const productRow = useProductsStore.getState().products.find(x => x.id === p.id)
    expect(Number(productRow.stock)).toBe(8)
    expect(useCustomersStore.getState().customers.some(c => c.name === 'مشتري بالكاش')).toBe(true)
  })

  it('كل كتابة تُطلق تحديثاً بمرجع قائمة جديد — المكونات ترسم لحظياً دون Refresh', async () => {
    const p = window.createProduct({ name: 'قماش تفاعلي', code: 'FAB-R1', sellingPrice: 100, stock: 5, minStock: 1 })
    // مرجع قائمة المنتجات يتغير بعد الإضافة
    expect(useProductsStore.getState().products).not.toBe([])
    const productsRefAfterCreate = useProductsStore.getState().products

    const order = await window.createOrder({
      customerInfo: { name: 'عميل لحظي', phone: '01155556666' },
      items: [{ productId: p.id, productName: 'قماش تفاعلي', sellingPrice: 100, purchasePrice: 80, quantity: 1 }],
      downPayment: 0,
      status: 'completed',
    })

    // قائمة الطلبات صارت مرجعاً جديداً بعد الإضافة (ضمان إعادة رسم OrdersView)
    expect(useOrdersStore.getState().orders).not.toBe([])
    expect(useOrdersStore.getState().orders.some(o => o.id === order.id)).toBe(true)

    // قائمة العملاء صارت مرجعاً جديداً بعد إنشاء العميل ضمن الطلب
    expect(useCustomersStore.getState().customers.some(c => c.name === 'عميل لحظي')).toBe(true)

    // تعديل مخزون المنتج (الخصم) غيّر مرجع قائمة المنتجات أيضاً
    expect(useProductsStore.getState().products).not.toBe(productsRefAfterCreate)
    expect(Number(useProductsStore.getState().products.find(x => x.id === p.id).stock)).toBe(4)
  })

  it('updateCustomer يُحدّث customersStore بمرجع جديد فوراً (تعديل عميل)', () => {
    const c = window.createCustomer({ name: 'عميل للتعديل', phone: '01012340000', category: 'تجزئة' })
    const before = useCustomersStore.getState().customers
    window.updateCustomer(c.id, { name: 'عميل معدّل' })
    const after = useCustomersStore.getState().customers
    expect(after).not.toBe(before)
    expect(after.find(x => x.id === c.id).name).toBe('عميل معدّل')
  })

  it('addCustomerAddress (Auto-Update العنوان) يُحدّث customersStore بمرجع جديد', () => {
    const c = window.createCustomer({ name: 'عميل بعنوان', phone: '01012341111', category: 'تجزئة' })
    const before = useCustomersStore.getState().customers
    window.addCustomerAddress(c.id, { label: 'المخزن', address: 'القاهرة - مدينة نصر - شارع النصر' })
    const after = useCustomersStore.getState().customers
    expect(after).not.toBe(before)
    const row = after.find(x => x.id === c.id)
    expect(row.addresses.some(a => a.address === 'القاهرة - مدينة نصر - شارع النصر')).toBe(true)
    expect(row.address).toBe('القاهرة - مدينة نصر - شارع النصر')
  })
})
