// =============================================================================
// سيناريو المصروف الدوري — مختبر سيناريوهات المحاسبة
// -----------------------------------------------------------------------------
// المصروف الشهري يقلّص صافي الربح (عبر getCurrentOperatingExpenses) ويقترض من
// الخزينة بقيد واحد لا يتضاعف — لا يكسر أيٌّ من التأثيرين الآخر.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { createOrder } from '@/domain/orders/orderRepository'
import { createExpense, postDueRecurringExpenses } from '@/domain/accounting/expenses'
import {
  seedStore, item, customerInfo, STORAGE_KEYS, treasuryReport, profitReport,
} from './helpers'

describe('سيناريو مصروف 1 — مصروف شهري يُقيد في الخزينة ويقلّص الربح', () => {
  it('قيد واحد -300، الربح 300 − 300 = 0، والدفتر مغلق على الإقفال', async () => {
    const { db, repo } = seedStore({ productOver: { id: 'PRD1', stock: 10, purchasePrice: 100, sellingPrice: 250 } })
    repo.getExpenses = () => db.getCollection(STORAGE_KEYS.EXPENSES)

    // بيع 2 × 250 بتكلفة 200 → هامش 300
    await createOrder({ customerInfo: customerInfo({ phone: '01012345011' }), items: [item({ quantity: 2 })], downPayment: 500, status: 'delivered' }, repo)
    // مصروف شهري 300 مستحق الخامس من الشهر
    createExpense({ title: 'إيجار شهري', amount: 300, category: 'إيجار', date: '2026-08-01', recurring: true, dueDay: 5, createdBy: 'المدير العام' }, repo)

    expect(await postDueRecurringExpenses(repo, '2026-08-10')).toBe(1)
    expect(await postDueRecurringExpenses(repo, '2026-08-12')).toBe(0)

    // الربح: هامش 300 − مصروف 300 = 0
    const p = profitReport(db)
    expect(p).toMatchObject({ itemsSales: 500, cogs: 200, totalOpExpenses: 300, netProfit: 0 })

    // الخزينة: وارد بيع 500 − صادر مصروف 300 = 200
    const t = treasuryReport(db)
    expect(t).toMatchObject({ totalInflow: 500, treasuryOutflow: 300, netTreasury: 200 })
    expect(db.getCollection(STORAGE_KEYS.PAYMENTS).filter(x => x.type === 'expense')).toHaveLength(1)
  })
})
