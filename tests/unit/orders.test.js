import { describe, it, expect } from 'vitest'
import { ORDER_STATUS_TRANSITIONS, canTransition, getAllowedTransitions, isFulfilledOrderStatus, isActiveOrderStatus, getOrderStatusLabel, getDirectShipSummary } from '@/domain/orders/orderMachine'
import { processItems, computeItemsSubtotal, computeTotalAmount, computePaymentSplit } from '@/domain/orders/invoice'
import {
  createOrder, updateOrderStatus, getOrders, getOrderById, searchOrders,
  getOpenOrdersCount, getTotalSalesAmount,
} from '@/domain/orders/orderRepository'
import { freshSystem, seedProduct, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'

function baseCustomerInfo(over = {}) {
  return { name: 'أحمد محمد', phone: '01012345678', ...over }
}

function baseItem(over = {}) {
  return { productId: 'PRD1', productName: 'منتج أ', quantity: 2, sellingPrice: 250, purchasePrice: 100, supplierId: 'SUP1', supplierName: 'مورد أ', ...over }
}

describe('orderMachine (مصفوفة الحالات) — parity with legacy', () => {
  it('transition matrix matches legacy ORDER_STATUS_TRANSITIONS', () => {
    expect(ORDER_STATUS_TRANSITIONS).toEqual({
      new: ['delivered', 'completed', 'cancelled'],
      delivered: ['completed', 'returned'],
      completed: ['returned'],
      returned: ['new', 'delivered'],
      cancelled: ['new'],
    })
  })

  it('canTransition allows only matrix edges', () => {
    expect(canTransition('new', 'delivered')).toBe(true)
    expect(canTransition('new', 'cancelled')).toBe(true)
    expect(canTransition('delivered', 'completed')).toBe(true)
    expect(canTransition('completed', 'returned')).toBe(true)
    expect(canTransition('returned', 'new')).toBe(true)
    expect(canTransition('cancelled', 'new')).toBe(true)
    expect(canTransition('new', 'returned')).toBe(false)
    expect(canTransition('delivered', 'new')).toBe(false)
    expect(canTransition('completed', 'cancelled')).toBe(false)
    expect(canTransition('returned', 'cancelled')).toBe(false)
  })

  it('getAllowedTransitions / status predicates / labels', () => {
    expect(getAllowedTransitions('completed')).toEqual(['returned'])
    expect(getAllowedTransitions('cancelled')).toEqual(['new'])
    expect(isFulfilledOrderStatus('delivered')).toBe(true)
    expect(isFulfilledOrderStatus('completed')).toBe(true)
    expect(isFulfilledOrderStatus('new')).toBe(false)
    expect(isActiveOrderStatus('new')).toBe(true)
    expect(isActiveOrderStatus('cancelled')).toBe(false)
    expect(getOrderStatusLabel('completed')).toBe('مكتمل')
    expect(getOrderStatusLabel('new')).toBe('قيد الانتظار')
  })
})

describe('invoice math — parity with js/services/orders.js', () => {
  it('processItems: subtotal = round2(qty × sellPrice)', () => {
    const processed = processItems([{ productId: 'P1', sellingPrice: 250.5, quantity: 3 }])
    expect(processed[0]).toMatchObject({ productId: 'P1', quantity: 3, subtotal: 751.5 })
  })

  it('processItems: rejects quantity <= 0 instead of defaulting to 1 (V3.58)', () => {
    expect(() => processItems([{ productId: 'P2', sellingPrice: 100, quantity: 0 }])).toThrow(/أكبر من الصفر/)
    expect(() => processItems([{ productId: 'P2', sellingPrice: 100, quantity: -2 }])).toThrow(/أكبر من الصفر/)
    expect(() => processItems([{ productId: 'P2', sellingPrice: 100 }])).toThrow(/أكبر من الصفر/)
  })

  it('processItems: preserves per-line isDirectShip flag (undefined when absent)', () => {
    const processed = processItems([{ productId: 'P1', sellingPrice: 100, quantity: 1, isDirectShip: true }])
    expect(processed[0].isDirectShip).toBe(true)
    expect(processItems([{ productId: 'P1', sellingPrice: 100, quantity: 1 }])[0].isDirectShip).toBeUndefined()
  })

  it('getDirectShipSummary distinguishes all/mixed/none, with legacy order-level fallback', () => {
    expect(getDirectShipSummary({ items: [{ isDirectShip: true }, { isDirectShip: false }] })).toEqual({ directCount: 1, total: 2, all: false, none: false, mixed: true })
    expect(getDirectShipSummary({ items: [{ isDirectShip: true }, { isDirectShip: true }] })).toMatchObject({ all: true, mixed: false, directCount: 2 })
    expect(getDirectShipSummary({ items: [{ isDirectShip: false }, { isDirectShip: false }] })).toMatchObject({ none: true, mixed: false })
    expect(getDirectShipSummary({ directShipping: true, items: [{ productId: 'x' }, { productId: 'y' }] })).toMatchObject({ all: true })
    expect(getDirectShipSummary({ directShipping: false, items: [{ productId: 'x' }] })).toMatchObject({ none: true })
  })

  it('computeItemsSubtotal sums processed subtotals', () => {
    expect(computeItemsSubtotal([{ subtotal: 500 }, { subtotal: 30.5 }])).toBe(530.5)
  })

  it('computeTotalAmount: customer pays shipping/extra, merchant does not', () => {
    expect(computeTotalAmount({ itemsSubtotal: 500, shippingCost: 40, shippingPayer: 'customer', extraExpenses: 30, extraExpensesPayer: 'customer' })).toBe(570)
    expect(computeTotalAmount({ itemsSubtotal: 500, shippingCost: 40, shippingPayer: 'merchant', extraExpenses: 30, extraExpensesPayer: 'merchant' })).toBe(500)
  })

  it('computePaymentSplit: completed auto-settles; cancelled/returned always 0 remaining', () => {
    expect(computePaymentSplit({ status: 'completed', totalAmount: 500, downPayment: 0 })).toEqual({ dp: 500, remainingBalance: 0, paidInFull: true })
    expect(computePaymentSplit({ status: 'delivered', totalAmount: 500, downPayment: 100 })).toEqual({ dp: 100, remainingBalance: 400, paidInFull: false })
    expect(computePaymentSplit({ status: 'cancelled', totalAmount: 500, downPayment: 100 })).toEqual({ dp: 100, remainingBalance: 0, paidInFull: false })
  })
})

describe('createOrder orchestration — parity with legacy', () => {
  it('delivered order with deposit: order persisted, stock decremented, treasury deposit logged', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct()],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()],
    })
    const order = await createOrder({
      customerInfo: baseCustomerInfo(),
      items: [baseItem()],
      downPayment: 100,
      status: 'delivered',
    }, repo)

    expect(order.id).toMatch(/^ORD-/)
    expect(order.totalAmount).toBe(500)
    expect(order.downPayment).toBe(100)
    expect(order.remainingBalance).toBe(400)
    expect(order.paidInFull).toBe(false)
    expect(order.status).toBe('delivered')

    // Order persisted (unshift) + fulfillment payload (items with consumed)
    const orders = db.getCollection(STORAGE_KEYS.ORDERS)
    expect(orders).toHaveLength(1)
    expect(orders[0].items[0].consumed).toBe(2)
    expect(orders[0].remainingBalance).toBe(400)

    // Stock decremented
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(8)

    // Customer auto-created with normalized phone + ledger updated
    const customers = db.getCollection(STORAGE_KEYS.CUSTOMERS)
    expect(customers).toHaveLength(1)
    expect(customers[0].phone).toBe('01012345678')
    expect(customers[0].ordersCount).toBe(1)
    expect(customers[0].totalPurchases).toBe(500)
    expect(customers[0].remainingBalance).toBe(400)
    expect(customers[0].paid).toBe(100)

    // Treasury receipt for the deposit
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments).toHaveLength(1)
    expect(payments[0].amount).toBe(100)
    expect(payments[0].isDownPayment).toBe(true)
    expect(payments[0].type).toBe('deposit')
    expect(payments[0].refOrderId).toBe(order.id)
  })

  it('cashier mode: status completed, walk-in customer, full settlement', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()] })
    const order = await createOrder({
      customerInfo: { name: '', phone: '' },
      items: [baseItem()],
      status: 'delivered',
      cashierMode: true,
    }, repo)

    expect(order.status).toBe('completed')
    expect(order.downPayment).toBe(500)
    expect(order.remainingBalance).toBe(0)
    expect(order.paidInFull).toBe(true)
    const customers = db.getCollection(STORAGE_KEYS.CUSTOMERS)
    expect(customers).toHaveLength(1)
    expect(customers[0].name).toBe('عميل معرض')
    expect(customers[0].phone).toBe('')
    expect(customers[0].paid).toBe(500)
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments[0].amount).toBe(500)
  })

  it('POS partial sale: entered paid portion is kept as deposit (not dropped), remainder becomes debt', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct()],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()],
    })
    // ما يرسله PosModal بعد الإصلاح للدفع الجزئي: downPayment = المبلغ المدخل، status 'new'
    const order = await createOrder({
      customerInfo: baseCustomerInfo(),
      items: [baseItem()],
      downPayment: 200,
      status: 'new',
      cashierMode: false,
    }, repo)

    expect(order.totalAmount).toBe(500)
    expect(order.status).toBe('new')
    expect(order.downPayment).toBe(200)
    expect(order.remainingBalance).toBe(300)
    expect(order.paidInFull).toBe(false)

    // Pending invoice: no stock decrement yet
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(10)

    // Treasury receipt for the entered paid portion (not silently dropped)
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments).toHaveLength(1)
    expect(payments[0].amount).toBe(200)
    expect(payments[0].isDownPayment).toBe(true)
    expect(payments[0].type).toBe('deposit')
    expect(payments[0].refOrderId).toBe(order.id)

    // Customer ledger: the paid portion is credited immediately; the debt books on fulfillment
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)[0].paid).toBe(200)

    await updateOrderStatus(order.id, 'delivered', 0, 0, repo)

    const deliveredCustomer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(deliveredCustomer.paid).toBe(200)
    expect(deliveredCustomer.totalPurchases).toBe(500)
    expect(deliveredCustomer.remainingBalance).toBe(300)
  })

  it('V3.58 — invalid items reject BEFORE any write (no ghost customers)', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct()],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()],
    })

    // Negative selling price must fail at processItems (pre-write)
    await expect(createOrder({
      customerInfo: baseCustomerInfo(),
      items: [baseItem({ sellingPrice: -10 })],
      status: 'delivered',
    }, repo)).rejects.toThrow(/سالب/)

    // Quantity 0 must fail at processItems (pre-write)
    await expect(createOrder({
      customerInfo: baseCustomerInfo(),
      items: [baseItem({ quantity: 0 })],
      status: 'delivered',
    }, repo)).rejects.toThrow(/أكبر من الصفر/)

    // Nothing was written: no customer, order, payment or stock change
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)).toHaveLength(0)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)).toHaveLength(0)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(10)
  })

  it('stock deficit becomes a pending supplier payable + ledger debit', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD2', stock: 2, purchasePrice: 150 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })
    await createOrder({
      customerInfo: baseCustomerInfo(),
      items: [baseItem({ productId: 'PRD2', productName: 'منتج ب', quantity: 5, purchasePrice: 150 })],
      downPayment: 0,
      status: 'delivered',
    }, repo)

    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(0)
    const persisted = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(persisted.supplierDeficits).toHaveLength(1)
    expect(persisted.supplierDeficits[0]).toMatchObject({ units: 3, amount: 450 })
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(450)
    expect(supplier.totalPurchases).toBe(450)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'مديونية عجز مخزون' && t.debit === 450)).toBe(true)
  })

  it('direct shipping: supplier shipment recorded, warehouse stock untouched', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ stock: 10 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })
    const order = await createOrder({
      customerInfo: baseCustomerInfo(),
      items: [baseItem({ quantity: 3, purchasePrice: 100 })],
      downPayment: 0,
      status: 'delivered',
      directShipping: true,
    }, repo)

    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(10)
    expect(order.items[0].consumed).toBe(0)
    const persisted = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(persisted.supplierShipments).toHaveLength(1)
    expect(persisted.supplierShipments[0]).toMatchObject({ units: 3, amount: 300 })
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(300)
  })

  it('V3.59 — mixed order: direct-ship lines record supplier shipments, stock lines decrement + deficit payable', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [
        seedProduct({ id: 'PRD1', name: 'منتج أ', stock: 10, purchasePrice: 100, sellingPrice: 250 }),
        seedProduct({ id: 'PRD2', name: 'منتج ب', stock: 2, purchasePrice: 150, sellingPrice: 300 }),
      ],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })
    await createOrder({
      customerInfo: baseCustomerInfo(),
      items: [
        baseItem({ productId: 'PRD1', productName: 'منتج أ', quantity: 3, purchasePrice: 100, isDirectShip: true }),
        baseItem({ productId: 'PRD2', productName: 'منتج ب', quantity: 5, purchasePrice: 150, isDirectShip: false }),
      ],
      downPayment: 0,
      status: 'delivered',
    }, repo)

    // Stock: direct line untouched; stock line consumed down to 0
    const products = db.getCollection(STORAGE_KEYS.PRODUCTS)
    expect(products.find(p => p.id === 'PRD1').stock).toBe(10)
    expect(products.find(p => p.id === 'PRD2').stock).toBe(0)

    // Order carries per-line shipping flags + both shipment & deficit arrays
    const persisted = db.getCollection(STORAGE_KEYS.ORDERS)[0]
    expect(persisted.directShipping).toBe(false)
    expect(persisted.supplierShipments).toHaveLength(1)
    expect(persisted.supplierShipments[0]).toMatchObject({ productId: 'PRD1', units: 3, amount: 300 })
    expect(persisted.supplierDeficits).toHaveLength(1)
    expect(persisted.supplierDeficits[0]).toMatchObject({ productId: 'PRD2', units: 3, amount: 450 })

    const line1 = persisted.items.find(i => i.productId === 'PRD1')
    const line2 = persisted.items.find(i => i.productId === 'PRD2')
    expect(line1.isDirectShip).toBe(true)
    expect(line1.consumed).toBe(0)
    expect(line2.isDirectShip).toBe(false)
    expect(line2.consumed).toBe(2)

    // Supplier ledger = direct shipment (300) + deficit payable (450)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(750)
    expect(supplier.totalPurchases).toBe(750)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'شحنة توريد' && t.debit === 300)).toBe(true)
    expect(txns.some(t => t.type === 'مديونية عجز مخزون' && t.debit === 450)).toBe(true)
  })

  it('V3.59 — returned mixed order: direct units restock full qty (become inventory), stock units restore consumed, deficit reversed', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [
        seedProduct({ id: 'PRD1', name: 'منتج أ', stock: 10, purchasePrice: 100, sellingPrice: 250 }),
        seedProduct({ id: 'PRD2', name: 'منتج ب', stock: 2, purchasePrice: 150, sellingPrice: 300 }),
      ],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })
    const order = await createOrder({
      customerInfo: baseCustomerInfo(),
      items: [
        baseItem({ productId: 'PRD1', quantity: 3, isDirectShip: true }),
        baseItem({ productId: 'PRD2', quantity: 5, purchasePrice: 150, isDirectShip: false }),
      ],
      downPayment: 0,
      status: 'delivered',
    }, repo)

    await updateOrderStatus(order.id, 'returned', 0, 0, repo)

    // Returned direct goods become store stock (10 + 3); stock line restores its consumed 2
    const products = db.getCollection(STORAGE_KEYS.PRODUCTS)
    expect(products.find(p => p.id === 'PRD1').stock).toBe(13)
    expect(products.find(p => p.id === 'PRD2').stock).toBe(2)

    // Deficit payable reversed; direct shipment stays on the supplier (returned goods keep the debt)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(300)
    expect(supplier.totalPurchases).toBe(300)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'إلغاء مديونية عجز' && t.credit === 450)).toBe(true)
    expect(txns.some(t => t.type === 'إلغاء شحنة توريد مباشر')).toBe(false)
  })

  it('existing customer is reused; secondary phone is synced on the record', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()] })
    const first = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 0 }, repo)
    const second = await createOrder({ customerInfo: baseCustomerInfo({ secondaryPhone: '01123456789' }), items: [baseItem()], downPayment: 0 }, repo)

    const customers = db.getCollection(STORAGE_KEYS.CUSTOMERS)
    expect(customers).toHaveLength(1)
    expect(first.customerId).toBe(second.customerId)
    expect(customers[0].secondaryPhone).toBe('01123456789')
    expect(second.customerSecondaryPhone).toBe('01123456789')
    expect(db.getCollection(STORAGE_KEYS.ORDERS)).toHaveLength(2)
  })
})

describe('updateOrderStatus — parity with legacy', () => {
  it('rejects an illegal transition BEFORE any write', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.ORDERS]: [{
        id: 'ORD-1', status: 'new', customerId: 'CUST1', customerName: 'أ', totalAmount: 500, downPayment: 0, remainingBalance: 500, paidInFull: false,
        items: [], itemsSubtotal: 500, createdAt: '2026-08-04 10:00', updatedAt: '2026-08-04 10:00',
      }],
      [STORAGE_KEYS.PAYMENTS]: [],
    })
    await expect(updateOrderStatus('ORD-1', 'returned', 0, 0, repo)).rejects.toThrow(/انتقال حالة غير مسموح/)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0].status).toBe('new')
  })

  it('new → delivered: fulfills the order (stock + ledger), keeps deposit receipt', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct()],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()],
    })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 100, status: 'new' }, repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(10)

    await updateOrderStatus(order.id, 'delivered', 0, 0, repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(8)
    const orders = db.getCollection(STORAGE_KEYS.ORDERS)
    expect(orders[0].status).toBe('delivered')
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer.ordersCount).toBe(1)
    expect(customer.remainingBalance).toBe(400)
  })

  it('delivered → completed: auto-settles the remaining balance + settle receipt', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()], [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()] })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 100, status: 'delivered' }, repo)

    await updateOrderStatus(order.id, 'completed', 0, 0, repo)

    const orders = db.getCollection(STORAGE_KEYS.ORDERS)
    expect(orders[0].status).toBe('completed')
    expect(orders[0].remainingBalance).toBe(0)
    expect(orders[0].paidInFull).toBe(true)
    expect(orders[0].downPayment).toBe(500)

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.type === 'settle' && p.amount === 400)).toBe(true)
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer.paid).toBe(500)
    expect(customer.remainingBalance).toBe(0)
  })

  it('delivered → returned: restocks consumed units, zeroes balance, auto-refunds overpayment', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()], [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()] })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 200, status: 'delivered' }, repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(8)

    await updateOrderStatus(order.id, 'returned', 0, 0, repo)

    // Stock restored to full order qty (consumed units come back)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(10)
    const orders = db.getCollection(STORAGE_KEYS.ORDERS)
    expect(orders[0].status).toBe('returned')
    expect(orders[0].remainingBalance).toBe(0)
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer.totalPurchases).toBe(0)
    expect(customer.remainingBalance).toBe(0)
    // autoRefund = paid(200) − newOwed(0) = 200 → negative treasury receipt
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.type === 'refund' && p.amount === -200)).toBe(true)
    expect(customer.paid).toBe(0)
  })

  it('new → cancelled: retained deposit persisted, refund record for the confirmed amount', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()], [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()] })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 100, status: 'new' }, repo)

    await updateOrderStatus(order.id, 'cancelled', 60, 0, repo)

    const orders = db.getCollection(STORAGE_KEYS.ORDERS)
    expect(orders[0].status).toBe('cancelled')
    expect(orders[0].remainingBalance).toBe(0)
    expect(orders[0].refundedAmount).toBe(60)
    expect(orders[0].retainedDeposit).toBe(40)
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.type === 'refund' && p.amount === -60)).toBe(true)
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer.paid).toBe(0) // retained (40) + refunded (60) both deducted
  })

  it('cancelled → new: re-credits the RETAINED deposit (downPayment − refundedAmount)', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()], [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()] })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 100, status: 'new' }, repo)
    await updateOrderStatus(order.id, 'cancelled', 60, 0, repo)

    await updateOrderStatus(order.id, 'new', 0, 0, repo)

    const orders = db.getCollection(STORAGE_KEYS.ORDERS)
    expect(orders[0].status).toBe('new')
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.cycleKey === 'recredit-40' && p.amount === 40)).toBe(true)
  })

  it('completed → returned: full refund of everything the customer paid', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()], [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()] })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], status: 'completed' }, repo)
    expect(order.downPayment).toBe(500)

    await updateOrderStatus(order.id, 'returned', 0, 0, repo)

    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(10)
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.type === 'refund' && p.amount === -500)).toBe(true)
    const customer = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(customer.paid).toBe(0)
  })

  it('rejects non-admin/non-employee actors even on valid transitions', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()], [STORAGE_KEYS.SUPPLIERS]: [seedSupplier()] })
    const order = await createOrder({ customerInfo: baseCustomerInfo(), items: [baseItem()], downPayment: 100, status: 'delivered' }, repo)

    await expect(updateOrderStatus(order.id, 'completed', 0, 0, repo, 'storekeeper')).rejects.toThrow(/غير مسموح لك/)
    await expect(updateOrderStatus(order.id, 'completed', 0, 0, repo, 'accountant')).rejects.toThrow(/غير مسموح لك/)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)[0].status).toBe('delivered')

    const updated = await updateOrderStatus(order.id, 'completed', 0, 0, repo, 'admin')
    expect(updated.status).toBe('completed')
  })
})

describe('order query helpers — parity', () => {
  it('getOrders / getOrderById / searchOrders / counts', () => {
    const orders = [
      { id: 'ORD-1', status: 'delivered', totalAmount: 100, customerName: 'أحمد', customerPhone: '01012345678', customerSecondaryPhone: '' },
      { id: 'ORD-2', status: 'new', totalAmount: 200, customerName: 'محمود', customerPhone: '01000000000', customerSecondaryPhone: '' },
      { id: 'ORD-3', status: 'completed', totalAmount: 300, customerName: 'سارة', customerPhone: '01111111111', customerSecondaryPhone: '' },
    ]
    expect(getOrders(orders)).toBe(orders)
    expect(getOrderById(orders, 'ORD-2').customerName).toBe('محمود')
    expect(getOrderById(orders, 'MISSING')).toBeNull()
    expect(searchOrders(orders, 'أحم')).toHaveLength(1)
    expect(searchOrders(orders, '011111')).toHaveLength(1)
    expect(searchOrders(orders, '')).toHaveLength(3)
    expect(getOpenOrdersCount(orders)).toBe(2) // delivered + new
    expect(getTotalSalesAmount(orders)).toBe(400) // delivered + completed
  })
})
