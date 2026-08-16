import { describe, it, expect, beforeEach } from 'vitest'
import '@/legacy/compat'

// Regression for the "إضافة مصروف جديد لا يظهر" bug: the bridge never
// registered STORAGE_KEYS.EXPENSES nor window.getExpenses (the legacy
// js/services/expenses.js did that at load time). So createExpense wrote into
// firestoreCache[undefined] and the ExpensesView could never reload the list.
// These tests pin the wiring on the LIVE db module — no stubs masking the gap.

beforeEach(() => {
  window.firestoreCache.expenses = []
})

describe('expenses compat wiring (expense add/refresh path)', () => {
  it('registers STORAGE_KEYS.EXPENSES on the live storage keys', () => {
    expect(window.STORAGE_KEYS.EXPENSES).toBe('expenses')
  })

  it('wires window.getExpenses to read the expenses collection', () => {
    expect(typeof window.getExpenses).toBe('function')
    window.firestoreCache.expenses = [{ id: 'EXP-1', title: 'إيجار' }]
    expect(window.getExpenses()).toEqual([{ id: 'EXP-1', title: 'إيجار' }])
  })

  it('createExpense writes a retrievable expense — never an undefined-key write', () => {
    const exp = window.createExpense({
      title: 'فاتورة كهرباء المحل',
      amount: 500,
      category: 'كهرباء ومرافق',
      date: '2026-08-05',
    })
    expect(exp.id).toMatch(/^EXP-/)
    expect(window.firestoreCache.expenses).toHaveLength(1)
    expect(window.firestoreCache.expenses[0].title).toBe('فاتورة كهرباء المحل')
    expect(window.firestoreCache.expenses[0].amount).toBe(500)
    // The exact bug: writes used to land under the undefined key and vanish.
    expect(window.firestoreCache[undefined]).toBeUndefined()
    expect(window.getExpenses()).toHaveLength(1)
  })

  it('updateExpense keeps the record in the expenses collection', () => {
    const exp = window.createExpense({ title: 'شحن', amount: 50, category: 'شحن ونقل', date: '2026-08-05' })
    const updated = window.updateExpense(exp.id, { amount: 120 })
    expect(updated.amount).toBe(120)
    expect(window.getExpenses()).toHaveLength(1)
    expect(window.getExpenses()[0].amount).toBe(120)
  })
})
