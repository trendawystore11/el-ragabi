import { describe, it, expect } from 'vitest'
import {
  getProducts, getProductById, searchProducts, getLowStockProducts,
  createProduct, updateProduct, decrementProductStock, incrementProductStock, addStockShipment,
} from '@/domain/inventory/products'
import {
  getSupplierReturns, getSupplierReturnsBySupplier, getSupplierTransactions,
  getSupplierTransactionsBySupplier, logSupplierTransaction, createSupplierReturn,
  getTotalSupplierReturnsValue, recalculateTotals,
} from '@/domain/inventory/supplierReturns'
import { freshSystem, seedProduct, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'

describe('products: createProduct — parity with js/services/products.js', () => {
  it('creates a product; code falls back to the generated id', () => {
    const { db, repo } = freshSystem()
    const p = createProduct({ name: 'قماش قطني', category: 'أقمشة', purchasePrice: 80, sellingPrice: 150, stock: 20, minStock: 5 }, repo)
    expect(p.id).toMatch(/^PRD-/)
    expect(p.code).toBe(p.id)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)).toHaveLength(1)
  })

  it('rejects a duplicate name or duplicate code (SKU)', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', name: 'قماش', code: 'SKU-1' })] })
    expect(() => createProduct({ name: 'قماش', code: 'NEW', sellingPrice: 10 }, repo)).toThrow(/يوجد منتج مسجل بالفعل/)
    expect(() => createProduct({ name: 'شيء آخر', code: 'SKU-1', sellingPrice: 10 }, repo)).toThrow(/يوجد منتج مسجل بالفعل/)
  })

  it('with supplier + stock > 0 accumulates supplier debt and logs a ledger debit', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    createProduct({ name: 'منتج مورد', code: 'S1', purchasePrice: 100, sellingPrice: 200, stock: 5, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.totalPurchases).toBe(500)
    expect(supplier.remainingBalance).toBe(500)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'تسجيل منتج ومخزون' && t.debit === 500)).toBe(true)
  })

  it('no supplier debt without a supplier or without stock', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    createProduct({ name: 'بدون مورد', sellingPrice: 10, stock: 5 }, repo)
    createProduct({ name: 'بدون مخزون', sellingPrice: 10, supplierId: 'SUP1', stock: 0 }, repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(0)
  })
})

describe('products: stock mutation — parity', () => {
  it('decrementProductStock clamps at 0 and reports the deficit', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 3 })] })
    expect(decrementProductStock('PRD1', 10, repo)).toEqual({ consumedQty: 3, deficitQty: 7 })
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(0)
  })

  it('decrement on a missing product returns full deficit, no crash', () => {
    const { repo } = freshSystem()
    expect(decrementProductStock('NOPE', 4, repo)).toEqual({ consumedQty: 0, deficitQty: 4 })
  })

  it('incrementProductStock adds back units', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 5 })] })
    incrementProductStock('PRD1', 3, repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(8)
  })

  it('getProductById resolves by code too; getLowStockProducts uses minStock (default 5)', () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [
        seedProduct({ id: 'PRD1', code: 'SKU-1', stock: 1 }),
        seedProduct({ id: 'PRD2', code: 'SKU-2', stock: 10 }),
        seedProduct({ id: 'PRD3', code: 'SKU-3', stock: 4, minStock: 2 }),
      ],
    })
    expect(getProductById(repo.getProducts(), 'SKU-2').id).toBe('PRD2')
    expect(getLowStockProducts(repo.getProducts()).map(p => p.id)).toEqual(['PRD1']) // 1 ≤ default 5; 4 > minStock 2
  })
})

describe('products: addStockShipment — F3 weighted COGS + supplier debt', () => {
  it('raises weighted-average cost incl. logistics; supplier debt on goods value only', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', purchasePrice: 100, stock: 10 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
    })

    addStockShipment('PRD1', 10, 'SUP1', 200, '', { shippingCost: 50, suppliesCost: 30 }, repo)

    const p = db.getCollection(STORAGE_KEYS.PRODUCTS)[0]
    expect(p.stock).toBe(20)
    // (10×100 + 10×200 + 80) / 20 = 154
    expect(p.purchasePrice).toBe(154)
    expect(p.shipmentExtrasTotal).toBe(80)
    // supplier debt = goods only = 10 × 200
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(2000)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'شحنة توريد' && t.debit === 2000)).toBe(true)
  })

  it('rejects zero/negative quantity and negative extras', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct()] })
    expect(() => addStockShipment('PRD1', 0, '', 0, '', {}, repo)).toThrow(/كمية شحنة صحيحة/)
    expect(() => addStockShipment('PRD1', 5, '', 0, '', { shippingCost: -10 }, repo)).toThrow(/غير صالحة/)
  })
})

describe('products: updateProduct & query helpers', () => {
  it('updateProduct rejects duplicate + applies fields', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [
        seedProduct({ id: 'PRD1', name: 'أ', code: 'A' }),
        seedProduct({ id: 'PRD2', name: 'ب', code: 'B' }),
      ],
    })
    expect(() => updateProduct('PRD2', { name: 'أ', code: 'B' }, repo)).toThrow(/يوجد منتج/)
    updateProduct('PRD2', { name: 'ب جديد' }, repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[1].name).toBe('ب جديد')
  })

  it('searchProducts matches name/code/id/category/supplierName', () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [
        seedProduct({ id: 'PRD1', name: 'قماش قطني', code: 'K-1', category: 'أقمشة', supplierName: 'مورد أ' }),
        seedProduct({ id: 'PRD2', name: 'زر', code: 'Z-1', category: 'مستلزمات' }),
      ],
    })
    const all = repo.getProducts()
    expect(searchProducts(all, 'قطني')).toHaveLength(1)
    expect(searchProducts(all, 'Z-1')).toHaveLength(1)
    expect(searchProducts(all, 'مورد أ')).toHaveLength(1)
    expect(getProducts(all)).toBe(all)
    expect(getProductById(all, 'PRD2').id).toBe('PRD2')
  })
})

describe('supplier returns — parity with js/services/supplier-returns.js', () => {
  function seedReturnEnv() {
    return freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', name: 'قماش', purchasePrice: 100, stock: 10 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ', totalPurchases: 1000, paid: 200 })],
    })
  }

  it('debt refund type: stock deducted, supplier debt settled, credit ledger logged', async () => {
    const { db, repo } = seedReturnEnv()
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: 'PRD1', quantity: 2, unitCost: 100 }] }, repo)

    expect(rec.id).toMatch(/^SRET-/)
    expect(rec.totalValue).toBe(200)
    expect(rec.refundType).toBe('debt')
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)[0].stock).toBe(8)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.totalPurchases).toBe(800)
    expect(supplier.remainingBalance).toBe(600)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS)).toHaveLength(1)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'مرتجع مشتريات' && t.credit === 200)).toBe(true)
    // no treasury receipt for a debt refund
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
  })

  it('cash refund within debt: no cash actually received → no treasury receipt, balance reduced by full return', async () => {
    // المورد مدين لنا بـ 800 (مشتريات 1000 − تسديد 200)، مرتجع 100 «استرداد نقدي»
    // → المديونية تغطي كامل المرتجع، فلا يُصرف كاش ولا يُسجل أي قيد خزينة.
    const { db, repo } = seedReturnEnv()
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: 'PRD1', quantity: 1, unitCost: 100 }], refundType: 'cash' }, repo)
    expect(rec.cashRefund).toBe(0)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(700)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'مرتجع مشتريات' && t.credit === 100)).toBe(true)
    expect(txns.some(t => t.type === 'مرتجع نقدي')).toBe(false)
  })

  it('cash refund beyond debt: full excess received as positive treasury inflow, balance settles to 0', async () => {
    // مورد مُسدَّد بالكامل (مشتريات 1000 − تسديد 1000 → رصيد 0): مرتجع 100 كاش
    // → استلام 100 كامل كوارد خزينة موجب، والرصيد يبقى 0 (لا يتحول سالباً).
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', name: 'قماش', purchasePrice: 100, stock: 10 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ', totalPurchases: 1000, paid: 1000 })],
    })
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: 'PRD1', quantity: 1, unitCost: 100 }], refundType: 'cash' }, repo)
    expect(rec.cashRefund).toBe(100)
    expect(rec.debtOffset).toBe(0)
    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments).toHaveLength(1)
    expect(payments[0].entityType).toBe('treasury')
    expect(payments[0].amount).toBe(100)
    expect(payments[0].type).toBe('supplierCashRefund')
    // لا يُسجل أي قيد مدفوعات سالب للمورد
    expect(payments.some(p => p.entityType === 'supplier' && p.amount < 0)).toBe(false)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(0)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'مرتجع مشتريات' && t.credit === 100)).toBe(true)
    expect(txns.some(t => t.type === 'مرتجع نقدي' && t.debit === 100)).toBe(true)
  })

  it('validation: no items, qty beyond stock, non-positive total', async () => {
    const { db, repo } = seedReturnEnv()
    await expect(createSupplierReturn({ supplierId: 'SUP1', items: [] }, repo)).rejects.toThrow(/منتج واحد على الأقل/)
    await expect(createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: 'PRD1', quantity: 99, unitCost: 100 }] }, repo)).rejects.toThrow(/لا يمكن إرجاع 99/)
    await expect(createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: 'PRD1', quantity: 1, unitCost: 0 }] }, repo)).rejects.toThrow(/أكبر من الصفر/)
    await expect(createSupplierReturn({ supplierId: 'NOPE', items: [{ productId: 'PRD1', quantity: 1, unitCost: 10 }] }, repo)).rejects.toThrow(/غير موجود/)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS)).toHaveLength(0)
  })

  it('getSupplierReturns / BySupplier / getTotalSupplierReturnsValue / logSupplierTransaction', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ stock: 10 })],
      [STORAGE_KEYS.SUPPLIERS]: [
        seedSupplier({ id: 'SUP1', name: 'مورد أ' }),
        seedSupplier({ id: 'SUP2', name: 'مورد ب', phone: '01099999999' }),
      ],
    })
    logSupplierTransaction({ supplierId: 'SUP1', supplierName: 'أ', type: 'شحنة توريد', debit: 300 }, repo)
    const r1 = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: 'PRD1', quantity: 1, unitCost: 50 }] }, repo)
    const r2 = await createSupplierReturn({ supplierId: 'SUP2', items: [{ productId: 'PRD1', quantity: 1, unitCost: 70 }] }, repo)

    const returns = db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS)
    expect(getSupplierReturns(returns)).toBe(returns)
    expect(getSupplierReturnsBySupplier(returns, 'SUP1')).toHaveLength(1)
    expect(getTotalSupplierReturnsValue(returns)).toBe(120)
    expect(getSupplierTransactions(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)).length).toBe(3)
    expect(getSupplierTransactionsBySupplier(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS), 'SUP1').length).toBe(2)
    expect(r1.id !== r2.id).toBe(true)
  })
})

describe('recalculateTotals (V3.19) — non-destructive reconciliation', () => {
  it('recreates missing cash payment + ledger txn, then idempotent on re-run', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', name: 'قماش', stock: 5 })],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })],
      [STORAGE_KEYS.SUPPLIER_RETURNS]: [
        { id: 'SRET-1', supplierId: 'SUP1', supplierName: 'مورد أ', totalValue: 150, refundType: 'cash', createdAt: '2026-08-01 10:00', items: [] },
      ],
    })

    const restated = recalculateTotals(repo)
    expect(restated).toBe(2) // 1 payment + 1 txn

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.entityType === 'supplier' && p.amount === -150)).toBe(true)
    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.refId === 'SRET-1' && t.type === 'مرتجع نقدي' && t.credit === 150)).toBe(true)

    expect(recalculateTotals(repo)).toBe(0)
  })
})
