import { describe, it, expect, beforeEach } from 'vitest'
import '@/legacy/compat'
import { isExpenseDueForPosting, getExpensePeriodKey } from '@/domain/accounting/expenses'
import { computeTreasury } from '@/state/reportsStore'

const NOW = new Date('2026-08-10T12:00:00') // day 10

beforeEach(() => {
  window.firestoreCache.expenses = []
  window.firestoreCache.payments = []
})

describe('getExpensePeriodKey', () => {
  it('extracts YYYY-MM from a date string', () => {
    expect(getExpensePeriodKey('2026-08-10')).toBe('2026-08')
    expect(getExpensePeriodKey('')).toBe('')
    expect(getExpensePeriodKey(null)).toBe('')
  })
})

describe('isExpenseDueForPosting (pure)', () => {
  it('never posts non-recurring expenses', () => {
    expect(isExpenseDueForPosting({ recurring: false, dueDay: 5 }, NOW)).toBe(false)
  })

  it('rejects invalid dueDay values', () => {
    expect(isExpenseDueForPosting({ recurring: true, dueDay: 0 }, NOW)).toBe(false)
    expect(isExpenseDueForPosting({ recurring: true, dueDay: 32 }, NOW)).toBe(false)
    expect(isExpenseDueForPosting({ recurring: true, dueDay: null }, NOW)).toBe(false)
  })

  it('waits until the due day of the current month', () => {
    const expense = { recurring: true, dueDay: 15, date: '2026-07-01' }
    expect(isExpenseDueForPosting(expense, NOW)).toBe(false)
  })

  it('posts once the due day has arrived (overdue catch-up)', () => {
    const expense = { recurring: true, dueDay: 5, date: '2026-07-01' }
    expect(isExpenseDueForPosting(expense, NOW)).toBe(true)
  })

  it('does not post when the current period is already posted', () => {
    const expense = { recurring: true, dueDay: 5, date: '2026-07-01', lastPostedPeriod: '2026-08' }
    expect(isExpenseDueForPosting(expense, NOW)).toBe(false)
  })

  it('defers a recurring expense created after its due day this month to next period', () => {
    const expense = { recurring: true, dueDay: 10, date: '2026-08-12' }
    expect(isExpenseDueForPosting(expense, NOW)).toBe(false)
  })

  it('posts a recurring expense created this month on/before its due day', () => {
    const expense = { recurring: true, dueDay: 10, date: '2026-08-05' }
    expect(isExpenseDueForPosting(expense, NOW)).toBe(true)
  })
})

describe('postDueRecurringExpenses (treasury posting, atomic + idempotent)', () => {
  it('posts a due recurring expense to treasury exactly once', async () => {
    window.firestoreCache.expenses = [{
      id: 'EXP-1',
      title: 'إيجار المحل',
      amount: 5000,
      category: 'إيجارات',
      date: '2026-01-05',
      recurring: true,
      dueDay: 5,
      createdBy: 'المدير العام'
    }]

    const count = await window.postDueRecurringExpenses(new Date('2026-08-10T12:00:00'))
    expect(count).toBe(1)

    const payments = window.firestoreCache.payments
    expect(payments).toHaveLength(1)
    const p = payments[0]
    expect(p.entityType).toBe('treasury')
    expect(p.entityId).toBe('EXP-1')
    expect(p.entityName).toBe('إيجار المحل')
    expect(p.amount).toBe(-5000)
    expect(p.type).toBe('expense')
    expect(p.refOrderId).toBe('EXP-1')
    expect(p.cycleKey).toBe('expense-2026-08')
    expect(p.date).toBe('2026-08-05')

    expect(window.firestoreCache.expenses[0].lastPostedPeriod).toBe('2026-08')

    // The posting is a treasury outflow for the ledger
    const t = computeTreasury(payments, [])
    expect(t.treasuryOutflow).toBe(5000)
    expect(t.netTreasury).toBe(-5000)

    // Second run — duplicate prevention: nothing new is written
    const count2 = await window.postDueRecurringExpenses(new Date('2026-08-15T12:00:00'))
    expect(count2).toBe(0)
    expect(window.firestoreCache.payments).toHaveLength(1)
  })

  it('posts each due recurring expense with its own period key', async () => {
    window.firestoreCache.expenses = [
      { id: 'EXP-1', title: 'إيجار', amount: 1000, category: 'إيجارات', date: '2026-01-05', recurring: true, dueDay: 5 },
      { id: 'EXP-2', title: 'رواتب', amount: 2000, category: 'أجور', date: '2026-01-20', recurring: true, dueDay: 20 },
    ]

    const count = await window.postDueRecurringExpenses(new Date('2026-08-22T12:00:00'))
    expect(count).toBe(2)
    expect(window.firestoreCache.payments).toHaveLength(2)
    const keys = window.firestoreCache.payments.map(p => p.cycleKey)
    expect(keys).toEqual(['expense-2026-08', 'expense-2026-08'])
  })

  it('does not post a recurring expense created after its due day this month', async () => {
    window.firestoreCache.expenses = [{
      id: 'EXP-3',
      title: 'اشتراك إنترنت',
      amount: 400,
      category: 'عمومية',
      date: '2026-08-12',
      recurring: true,
      dueDay: 10
    }]

    const count = await window.postDueRecurringExpenses(new Date('2026-08-10T12:00:00'))
    expect(count).toBe(0)
    expect(window.firestoreCache.payments).toHaveLength(0)
  })

  it('ignores recurring expenses with non-positive amounts', async () => {
    window.firestoreCache.expenses = [{
      id: 'EXP-4',
      title: 'صفر',
      amount: 0,
      category: 'عمومية',
      date: '2026-01-05',
      recurring: true,
      dueDay: 5
    }]

    const count = await window.postDueRecurringExpenses(new Date('2026-08-10T12:00:00'))
    expect(count).toBe(0)
    expect(window.firestoreCache.payments).toHaveLength(0)
  })
})
