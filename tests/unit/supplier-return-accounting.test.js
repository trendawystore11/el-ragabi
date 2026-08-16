import { describe, it, expect, afterEach } from 'vitest'
import { createProduct } from '@/domain/inventory/products'
import { createSupplierReturn, recalculateTotals } from '@/domain/inventory/supplierReturns'
import { createPaymentRecord } from '@/domain/accounting/payments'
import { freshSystem, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'
import { buildSupplierStatementEntries } from '@/utils/statements'

describe('مرتجع مشتريات يتجاوز المديونية (نوع: تخفيض الدين)', () => {
  it('الرصيد يصبح دائناً -15,000 لصالحنا ولا يُحرق الفائض على صفر', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 15000, date: '2024-01-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'debt' }, repo)

    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.totalPurchases).toBe(0)
    expect(supplier.paid).toBe(15000)
    expect(supplier.remainingBalance).toBe(-15000)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'تسجيل منتج ومخزون' && t.debit === 30000)).toBe(true)
    expect(txns.some(t => t.type === 'تسديد دفعة' && t.credit === 15000)).toBe(true)
    expect(txns.some(t => t.type === 'مرتجع مشتريات' && t.credit === 30000)).toBe(true)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(1)
  })
})

describe('Smart Refund Routing V3.54 — مرتجع كاش يتجاوز المديونية', () => {
  const seedSupplierWithPayment = (repo) => {
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 300, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 15000, date: '2024-01-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    return prod.id
  }

  it('cash: تُصفّر المديونية تلقائياً ويُستلم الفائض كاشاً كوارد خزينة موجب (لا قيد سالب legacy)', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const productId = seedSupplierWithPayment(repo)
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId, quantity: 300, unitCost: 100 }], refundType: 'cash' }, repo)

    expect(rec.debtOffset).toBe(15000)
    expect(rec.cashRefund).toBe(15000)
    expect(rec.excessAsCredit).toBe(0)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(0)

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.entityType === 'treasury' && p.amount === 15000 && p.type === 'supplierCashRefund')).toBe(true)
    expect(payments.some(p => p.entityType === 'supplier' && p.amount < 0)).toBe(false)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'مرتجع مشتريات' && t.credit === 30000)).toBe(true)
    expect(txns.some(t => t.type === 'مرتجع نقدي' && t.debit === 15000)).toBe(true)
  })

  it('debt: الفائض يبقى رصيداً دائناً سالباً ولا يُسجل أي قيد خزينة', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const productId = seedSupplierWithPayment(repo)
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId, quantity: 300, unitCost: 100 }], refundType: 'debt' }, repo)

    expect(rec.debtOffset).toBe(15000)
    expect(rec.cashRefund).toBe(0)
    expect(rec.excessAsCredit).toBe(15000)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(-15000)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).some(p => p.entityType === 'treasury')).toBe(false)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns.some(t => t.type === 'مرتجع مشتريات' && t.credit === 30000)).toBe(true)
    expect(txns.some(t => t.type === 'مرتجع نقدي')).toBe(false)
  })

  it('كاش ضمن المديونية: لا كاش فعلي → لا قيد خزينة ويُخصم كامل المرتجع من الرصيد', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const productId = seedSupplierWithPayment(repo)
    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId, quantity: 100, unitCost: 100 }], refundType: 'cash' }, repo)

    expect(rec.debtOffset).toBe(10000)
    expect(rec.cashRefund).toBe(0)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(5000)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).some(p => p.entityType === 'treasury')).toBe(false)
  })

  it('الدفتر يغلق على صافي الحركات الفعلية بلا بند افتتاحي وهمي', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const productId = seedSupplierWithPayment(repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId, quantity: 300, unitCost: 100 }], refundType: 'cash' }, repo)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    const netLedger = txns.reduce((s, t) => s + (Number(t.debit) || 0) - (Number(t.credit) || 0), 0)
    expect(netLedger).toBe(0)
  })
})

describe('recalculateTotals V3.54 — التوافق القديم والجديد بلا تضاعف', () => {
  const seedReturnEnv = () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [{ id: 'PRD1', name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 100, supplierId: 'SUP1', supplierName: 'مورد أ' }],
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ', totalPurchases: 100000, paid: 100000 })],
    })
    return { db, repo }
  }

  it('legacy سجل بلا cashRefund يُستعاد بإيصال سالب واحد كامل + قيد دفتر دائن واحد', () => {
    const { db, repo } = seedReturnEnv()
    db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS).push({ id: 'SR-LEGACY', supplierId: 'SUP1', refundType: 'cash', totalValue: 5000, createdAt: '2024-01-03 12:00:00' })
    recalculateTotals(repo)

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    const legacy = payments.filter(p => (p.notes || '').includes('(SR-LEGACY)'))
    expect(legacy).toHaveLength(1)
    expect(legacy[0].entityType).toBe('supplier')
    expect(legacy[0].amount).toBe(-5000)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS).filter(t => t.refId === 'SR-LEGACY')
    expect(txns).toHaveLength(1)
    expect(txns[0].type).toBe('مرتجع نقدي')
    expect(txns[0].credit).toBe(5000)
    expect(txns[0].debit).toBe(0)
  })

  it('جديد بفائض كاش يُستعاد بوارد خزينة موجب + قيدَي دفتر، وبدون مضاعفة عند تكرار الاستدعاء', () => {
    const { db, repo } = seedReturnEnv()
    db.getCollection(STORAGE_KEYS.SUPPLIER_RETURNS).push({
      id: 'SR-NEW', supplierId: 'SUP1', refundType: 'cash', totalValue: 5000,
      debtOffset: 0, cashRefund: 5000, excessAsCredit: 0, createdAt: '2024-01-03 12:00:00',
    })
    recalculateTotals(repo)
    recalculateTotals(repo)

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    const treasuryEntries = payments.filter(p => p.entityType === 'treasury' && p.type === 'supplierCashRefund' && (p.notes || '').includes('(SR-NEW)'))
    expect(treasuryEntries).toHaveLength(1)
    expect(treasuryEntries[0].amount).toBe(5000)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS).filter(t => t.refId === 'SR-NEW')
    expect(txns.filter(t => t.type === 'مرتجع مشتريات')).toHaveLength(1)
    expect(txns.filter(t => t.type === 'مرتجع نقدي')).toHaveLength(1)
  })
})

describe('V3.62 — مرتجع كاش على مورد مدين لنا (رصيد سالب): لا يُصفَّر الرصيد ولا يُحرق المبلغ المستحق', () => {
  it('يبقى الرصيد سالباً كما هو ويطابق صافي الدفتر، ويُستلم الفائض كاشاً بوارد خزينة', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 600, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 20000, date: '2024-01-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    // ثلاث مرتجعات «تخفيض دين» تصنع رصيداً سالباً: المورد مدين لنا بـ 10,000
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'debt' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 100, unitCost: 100 }], refundType: 'debt' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 100, unitCost: 100 }], refundType: 'debt' }, repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(-10000)

    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 100, unitCost: 100 }], refundType: 'cash' }, repo)

    // كل قيمة المرتجع فائض فوق المديونية (الرصيد سالب فلا مديونية علينا)
    expect(rec.debtOffset).toBe(0)
    expect(rec.cashRefund).toBe(10000)
    expect(rec.excessAsCredit).toBe(0)

    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    // V3.62 — الرصيد يبقى -10,000 (المورد ما زال مديناً لنا) ولا يُصفَّر خطأً
    expect(supplier.remainingBalance).toBe(-10000)
    expect(supplier.totalPurchases).toBe(0)
    expect(supplier.paid).toBe(10000)

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments.some(p => p.entityType === 'treasury' && p.amount === 10000 && p.type === 'supplierCashRefund')).toBe(true)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    const netLedger = txns.reduce((s, t) => s + (Number(t.debit) || 0) - (Number(t.credit) || 0), 0)
    expect(netLedger).toBe(-10000)
  })

  it('مرتجع «تخفيض دين» على رصيد سالب يضيف الفائض للمبلغ المستحق لنا', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد أ' })] })
    const prod = createProduct({ name: 'قماش', code: 'FAB-001', purchasePrice: 100, sellingPrice: 150, stock: 500, supplierId: 'SUP1', supplierName: 'مورد أ' }, repo)
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 20000, date: '2024-01-02', paymentMethod: 'cash', notes: 'تسديد جزئي' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 300, unitCost: 100 }], refundType: 'debt' }, repo)
    await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 100, unitCost: 100 }], refundType: 'debt' }, repo)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(-10000)

    const rec = await createSupplierReturn({ supplierId: 'SUP1', items: [{ productId: prod.id, quantity: 100, unitCost: 100 }], refundType: 'debt' }, repo)

    expect(rec.excessAsCredit).toBe(10000)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(-20000)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).some(p => p.entityType === 'treasury')).toBe(false)
  })
})

describe('V3.62 — تحصيل نقدية من مورد مدين لنا (createPaymentRecord isCollection)', () => {
  const seedNegativeSupplier = () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [{ id: 'SUP1', name: 'مورد أ', totalPurchases: 20000, paid: 35000, remainingBalance: -15000 }],
    })
    return { db, repo }
  }

  it('يُخزَّن قيد قبض سالب، يرتفع الرصيد نحو الصفر، ويُسجَّل في دفتر المورد', () => {
    const { db, repo } = seedNegativeSupplier()
    const rec = createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 7000, date: '2024-01-05', paymentMethod: 'cash', notes: 'تحصيل جزء من المبلغ المستحق لنا', isCollection: true }, repo)

    expect(rec.amount).toBe(-7000)
    expect(rec.type).toBe('supplierCollection')

    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(-8000)
    expect(supplier.paid).toBe(28000)

    const payments = db.getCollection(STORAGE_KEYS.PAYMENTS)
    expect(payments).toHaveLength(1)
    expect(payments[0].amount).toBe(-7000)

    const txns = db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)
    expect(txns).toHaveLength(1)
    expect(txns[0].type).toBe('تحصيل نقدية من المورد')
    expect(txns[0].debit).toBe(7000)
    expect(txns[0].credit).toBe(0)
  })

  it('تحصيل كامل المبلغ المستحق يجعل الرصيد صفراً ولا يتجاوزه', () => {
    const { db, repo } = seedNegativeSupplier()
    createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 15000, date: '2024-01-05', paymentMethod: 'cash', notes: 'تحصيل كامل المبلغ المستحق', isCollection: true }, repo)
    const supplier = db.getCollection(STORAGE_KEYS.SUPPLIERS)[0]
    expect(supplier.remainingBalance).toBe(0)
    expect(supplier.paid).toBe(20000)
  })

  it('يمنع التحصيل من مورد رصيده غير سالب', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [{ id: 'SUP1', name: 'مورد أ', totalPurchases: 35000, paid: 20000, remainingBalance: 15000 }],
    })
    expect(() => createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 5000, isCollection: true }, repo))
      .toThrow('لا يوجد مبلغ مستحق لنا من هذا المورد')
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(15000)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
  })

  it('يمنع تحصيل مبلغ أكبر من إجمالي المبلغ المستحق لنا', () => {
    const { db, repo } = seedNegativeSupplier()
    expect(() => createPaymentRecord({ entityType: 'supplier', entityId: 'SUP1', entityName: 'مورد أ', amount: 16000, isCollection: true }, repo))
      .toThrow('أكبر من إجمالي المبلغ المستحق لنا من المورد')
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)[0].remainingBalance).toBe(-15000)
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS)).toHaveLength(0)
  })
})

describe('كشف حساب المورد — محرك buildSupplierStatementEntries', () => {
  const txns = [
    { id: 'L1', createdAt: '2024-01-01 10:00:00', type: 'تسجيل منتج ومخزون', refId: 'PRD-1', note: '', debit: 30000, credit: 0 },
    { id: 'L2', createdAt: '2024-01-02 11:00:00', type: 'تسديد دفعة', refId: 'PAY-1', note: '', debit: 0, credit: 15000 },
    { id: 'L3', createdAt: '2024-01-03 12:00:00', type: 'مرتجع مشتريات', refId: 'SRET-1', note: '', debit: 0, credit: 30000 },
  ]

  afterEach(() => {
    delete window.getSupplierById
    delete window.getSupplierTransactionsBySupplier
    delete window.round2
  })

  it('يعكس القطبية للمورد، لا يختلق صف افتتاحي، ويغلق على -15,000', () => {
    window.getSupplierById = () => ({ id: 'SUP1', name: 'مورد أ', remainingBalance: -15000 })
    window.getSupplierTransactionsBySupplier = () => txns
    window.round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100

    const rows = buildSupplierStatementEntries('SUP1')
    expect(rows.some(r => r.type === 'رصيد افتتاحي')).toBe(false)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ type: 'تسجيل منتج ومخزون', debit: 0, credit: 30000, balance: 30000 })
    expect(rows[1]).toMatchObject({ type: 'تسديد دفعة', debit: 15000, credit: 0, balance: 15000 })
    expect(rows[2]).toMatchObject({ type: 'مرتجع مشتريات', debit: 30000, credit: 0, balance: -15000 })
  })

  it('V3.54 لا يُختلق بند افتتاحي «أرصدة وحركات سابقة» لكشف المورد مهما اختلف الرصيد المخزَّن', () => {
    window.getSupplierById = () => ({ id: 'SUP1', name: 'مورد أ', remainingBalance: 400 })
    window.getSupplierTransactionsBySupplier = () => [
      { id: 'L1', createdAt: '2024-01-01 10:00:00', type: 'تسديد دفعة', refId: 'PAY-1', note: '', debit: 0, credit: 100 },
    ]
    window.round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100

    const rows = buildSupplierStatementEntries('SUP1')
    expect(rows.some(r => r.type === 'رصيد افتتاحي' || r.type === 'أرصدة وحركات سابقة')).toBe(false)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'تسديد دفعة', debit: 100, credit: 0, balance: -100 })
  })
})
