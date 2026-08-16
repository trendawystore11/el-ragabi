// =============================================================================
// سيناريو التسويات اليدوية — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// قيود الخزينة اليدوية (entityType treasury) تُسجَّل دون لمس دفتر عميل أو
// مورد، وتظهر في تقرير الخزينة بجانب قيود الدفع/الاسترداد.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createPaymentRecord } from '@/domain/accounting/payments'
import { seedStore, STORAGE_KEYS, treasuryReport } from './helpers'

describe('سيناريو تسوية 1 — إيداع وسحب يدوي في الخزينة', () => {
  it('لا يمسان دفتر عميل/مورد ويُحصَيان في التقرير', () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })

    createPaymentRecord({ entityType: 'treasury', entityId: '', entityName: 'الخزينة', amount: 850, date: '2026-08-01', paymentMethod: 'cash', notes: 'إيداع يدوي رأس مال' }, repo)
    createPaymentRecord({ entityType: 'treasury', entityId: '', entityName: 'الخزينة', amount: -120, date: '2026-08-03', paymentMethod: 'cash', notes: 'سحب يدوي مصاريف شخصية' }, repo)

    expect(treasuryReport(db)).toMatchObject({ treasuryInflow: 850, treasuryOutflow: 120, netTreasury: 730 })
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).filter(p => p.entityType === 'treasury')).toHaveLength(2)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)).toHaveLength(0)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)).toHaveLength(1) // البذرة فقط بلا أي حركة
    expect(db.getCollection(STORAGE_KEYS.SUPPLIER_TRANSACTIONS)).toHaveLength(0)
    expect(db.getCollection(STORAGE_KEYS.ORDERS)).toHaveLength(0)
  })
})
