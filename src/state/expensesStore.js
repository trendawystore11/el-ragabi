// =============================================================================
// state/expensesStore.js — طبقة بيانات شاشة المصروفات — Phase 7
// -----------------------------------------------------------------------------
// يحمل قائمة المصروفات + مرشّحات (الفئة + نطاق تاريخ). المصدر الخام من
// window.getExpenses (الجسر) أو يُحقن عبر setExpenses. التصفية والإجماليات
// دوال نقية تعتمد على دوال domain/accounting/expenses. يُحدِّث المخزن نفسه
// عند أحداث bms-data-synced (حقيقة لحظية مثل القديم).
// =============================================================================
import { create } from 'zustand'
import { round2 } from '@/utils/formatters'
import { CLIENT } from '@/client/config'

export const EXPENSE_CATEGORIES = CLIENT.expenseCategories

export const useExpensesStore = create((set, get) => ({
  expenses: [],
  ready: false,
  category: '',
  dateFrom: '',
  dateTo: '',

  refresh() {
    const src = typeof window !== 'undefined' && window.getExpenses ? window.getExpenses() : get().expenses
    set({ expenses: Array.isArray(src) ? [...src] : [], ready: true })
    return get().expenses
  },

  setExpenses(list) {
    if (!Array.isArray(list)) return
    set({ expenses: [...list], ready: true })
  },

  setCategory(c) {
    set({ category: c || '' })
  },

  setDateFrom(d) {
    set({ dateFrom: d || '' })
  },

  setDateTo(d) {
    set({ dateTo: d || '' })
  },

  resetFilters() {
    set({ category: '', dateFrom: '', dateTo: '' })
  },
}))

/**
 * خط التصفية الوحيد: فئة المصروف + نطاق تاريخ (YYYY-MM-DD) — مقارنة نصية آمنة
 * لأن التواريخ المخزنة كلها بهذا الصيغة.
 */
export function applyExpenseFilters(expenses, category, dateFrom, dateTo) {
  let list = Array.isArray(expenses) ? expenses : []
  if (category) list = list.filter(e => e.category === category)
  if (dateFrom) list = list.filter(e => String(e.date || '').slice(0, 10) >= dateFrom)
  if (dateTo) list = list.filter(e => String(e.date || '').slice(0, 10) <= dateTo)
  return list
}

/** إجمالي المصروفات المسجلة في يوم معيّن (YYYY-MM-DD). */
export function getExpensesTotalByDate(expenses, dateStr) {
  return round2(
    (Array.isArray(expenses) ? expenses : [])
      .filter(e => String(e.date || '').slice(0, 10) === dateStr)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  )
}

/** إجمالي المصروفات المسجلة في شهر معيّن (YYYY-MM). */
export function getExpensesTotalByMonth(expenses, monthStr) {
  return round2(
    (Array.isArray(expenses) ? expenses : [])
      .filter(e => String(e.date || '').slice(0, 7) === monthStr)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  )
}

// حقيقة لحظية: عند وصول لقطة مخزن المصروفات (STORAGE_KEYS.EXPENSES = 'expenses')
// أو تحديث يدوي شامل → إعادة القراءة.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (!key || key === '*' || key === 'expenses') useExpensesStore.getState().refresh()
  })
}
