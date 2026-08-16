import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import ExpensesView from '@/ui/views/ExpensesView'
import { useExpensesStore } from '@/state/expensesStore'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency, getCairoFormattedDate } from '@/utils/formatters'

const TODAY = getCairoFormattedDate().slice(0, 10)

const EXPENSES = [
  { id: 'EXP-1', title: 'إيجار المحل', amount: 5000, category: 'إيجارات', date: TODAY, notes: '', recurring: false, dueDay: null },
  { id: 'EXP-2', title: 'فاتورة كهرباء', amount: 800, category: 'كهرباء ومرافق', date: TODAY, notes: 'عداد المحل', recurring: true, dueDay: 1 },
  { id: 'EXP-3', title: 'أكياس تغليف', amount: 120, category: 'تغليف ومطبوعات', date: '2026-01-10', notes: '', recurring: false, dueDay: null },
]

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<ExpensesView />)
  })
  return {
    host,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function click(el) {
  act(() => {
    el.click()
  })
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function getInput(labelText) {
  const labels = Array.from(document.body.querySelectorAll('label'))
  const label =
    labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText)) ||
    labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function getSelect(labelText) {
  const el = getInput(labelText)
  if (el.tagName !== 'SELECT') throw new Error(`expected select for: ${labelText}`)
  return el
}

const RESET_UI = {
  expenseModal: { open: false, expenseId: null, onDone: null },
}

beforeEach(() => {
  useExpensesStore.setState({ expenses: [], ready: false, category: '', dateFrom: '', dateTo: '' })
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
  window.getExpenses = vi.fn(() => EXPENSES)
  window.deleteExpense = vi.fn(() => Promise.resolve(true))
})

afterEach(() => {
  useExpensesStore.setState({ expenses: [], ready: false, category: '', dateFrom: '', dateTo: '' })
  useUiStore.setState(RESET_UI)
})

describe('ExpensesView (ui/views/ExpensesView.jsx)', () => {
  it('يعرض الملخصات المالية والجدول الكامل للمصروفات', () => {
    const { host, unmount } = mount()
    expect(host.textContent).toContain('دليل مصاريف التشغيل والمصروفات الإدارية')
    // إجمالي مستحق حالياً = لمرة واحدة (5000+120) + دورية مستحقة (800) = 5920
    expect(host.textContent).toContain(formatCurrency(5920))
    expect(host.textContent).toContain(formatCurrency(5800))
    expect(host.textContent).toContain(formatCurrency(800))
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(host.textContent).toContain('إيجار المحل')
    expect(host.textContent).toContain('فاتورة كهرباء')
    expect(host.textContent).toContain('استحقاق يوم 1')
    unmount()
  })

  it('الفلترة حسب الفئة تعرض المصروفات المطابقة فقط', () => {
    const { host, unmount } = mount()
    setSelectValue(getSelect('الفئة'), 'إيجارات')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('إيجار المحل')
    expect(host.textContent).not.toContain('فاتورة كهرباء')
    unmount()
  })

  it('الفلترة حسب نطاق التاريخ تُصفي المصروفات السابقة', () => {
    const { host, unmount } = mount()
    setInputValue(getInput('من تاريخ'), TODAY)
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(host.textContent).not.toContain('أكياس تغليف')
    unmount()
  })

  it('زر إعادة ضبط الفلتر يعيد كل الصفوف', () => {
    const { host, unmount } = mount()
    setSelectValue(getSelect('الفئة'), 'إيجارات')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    const resetBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إعادة ضبط الفلتر'))
    click(resetBtn)
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3)
    unmount()
  })

  it('يعرض رسالة فارغة عند عدم وجود مصروفات', () => {
    window.getExpenses = vi.fn(() => [])
    const { host, unmount } = mount()
    expect(host.textContent).toContain('لا توجد مصروفات مسجلة تطابق الفلتر')
    unmount()
  })

  it('زر إضافة مصروف جديد يفتح نافذة تسجيل المصروف', () => {
    const { host, unmount } = mount()
    const addBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إضافة مصروف جديد'))
    click(addBtn)
    expect(useUiStore.getState().expenseModal.open).toBe(true)
    expect(useUiStore.getState().expenseModal.expenseId).toBeNull()
    unmount()
  })

  it('زر تعديل يفتح نافذة المصروف بالمعرف', () => {
    const { host, unmount } = mount()
    const editBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))
    click(editBtn)
    expect(useUiStore.getState().expenseModal.open).toBe(true)
    expect(useUiStore.getState().expenseModal.expenseId).toBe('EXP-1')
    unmount()
  })

  it('زر حذف يستدعي deleteExpense بعد التأكيد ويعرض رسالة النجاح', async () => {
    const { host, unmount } = mount()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('حذف'))
    click(deleteBtn)
    expect(window.deleteExpense).toHaveBeenCalledWith('EXP-1')
    await act(async () => {})
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم حذف المصروف بنجاح')
    unmount()
  })
})
