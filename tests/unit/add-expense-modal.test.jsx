import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AddExpenseModal from '@/ui/modals/AddExpenseModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { getCairoFormattedDate } from '@/utils/formatters'

const TODAY = getCairoFormattedDate().slice(0, 10)

const EXPENSES = [
  { id: 'EXP-1', title: 'إيجار المحل', amount: 5000, category: 'إيجارات', date: '2026-08-01', notes: 'شهر أغسطس', recurring: false, dueDay: null },
]

function body() {
  return document.body
}

function mountModal({ expenseId = null, onDone = null } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    if (expenseId) useUiStore.getState().openAddExpenseModal(expenseId, onDone)
    else useUiStore.getState().openAddExpenseModal(null, onDone)
    root.render(<AddExpenseModal />)
  })
  return {
    root,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
      document.getElementById('modal-container')?.replaceChildren()
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
    setter.call(input, String(value))
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
  const labels = Array.from(body().querySelectorAll('label'))
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

function submitForm() {
  act(() => {
    body().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function lastToastMessage() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1].message : ''
}

const RESET_UI = {
  expenseModal: { open: false, expenseId: null, onDone: null },
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getExpenses = vi.fn(() => EXPENSES)
  window.createExpense = vi.fn(() => ({ id: 'EXP-NEW' }))
  window.updateExpense = vi.fn(() => EXPENSES[0])
})

afterEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
})

describe('AddExpenseModal (ui/modals/AddExpenseModal.jsx)', () => {
  it('يعرض نافذة تسجيل مصروف جديد بالحقول والتاريخ الافتراضي اليوم', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('💸 تسجيل مصروف جديد')
    expect(getInput('بيان المصروف').value).toBe('')
    expect(getInput('قيمة المصروف (ج.م)').value).toBe('')
    expect(getSelect('فئة المصروف').value).toBe('عمومية')
    expect(getInput('التاريخ').value).toBe(TODAY)
    unmount()
  })

  it('يرفض المبلغ غير الصالح ويعرض رسالة دون حفظ', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('بيان المصروف'), 'فاتورة كهرباء')
    setInputValue(getInput('قيمة المصروف (ج.م)'), '0')
    submitForm()
    expect(lastToastMessage()).toContain('يرجى إدخال قيمة مصروف صحيحة أكبر من الصفر')
    expect(window.createExpense).not.toHaveBeenCalled()
    expect(useUiStore.getState().expenseModal.open).toBe(true)
    unmount()
  })

  it('إرسال ناجح يستدعي createExpense ببيانات المصروف ويغلق النافذة', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal({ onDone })
    setInputValue(getInput('بيان المصروف'), 'فاتورة كهرباء')
    setInputValue(getInput('قيمة المصروف (ج.م)'), '800')
    setSelectValue(getSelect('فئة المصروف'), 'كهرباء ومرافق')
    setInputValue(getInput('التاريخ'), '2026-08-05')
    setInputValue(getInput('ملاحظات إضافية'), 'عداد المحل')
    submitForm()
    expect(window.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'فاتورة كهرباء',
        amount: '800',
        category: 'كهرباء ومرافق',
        date: '2026-08-05',
        notes: 'عداد المحل',
        recurring: false,
        dueDay: null,
      })
    )
    expect(lastToastMessage()).toContain('تم قيد المصروف بنجاح')
    expect(useUiStore.getState().expenseModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('تفعيل المصروف المتكرر يظهر يوم الاستحقاق ويُرسل dueDay مع الحفظ', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('بيان المصروف'), 'إيجار المحل')
    setInputValue(getInput('قيمة المصروف (ج.م)'), '5000')
    const checkbox = body().querySelector('input[type="checkbox"]')
    click(checkbox)
    const dueInput = getInput('يوم الاستحقاق الشهري')
    expect(dueInput).toBeTruthy()
    setInputValue(dueInput, '5')
    submitForm()
    expect(window.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ recurring: true, dueDay: '5' })
    )
    expect(lastToastMessage()).toContain('تم قيد المصروف الشهري')
    unmount()
  })

  it('تعديل مصروف يحمّل بياناته ويستدعي updateExpense بالمعرف', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal({ expenseId: 'EXP-1', onDone })
    expect(body().textContent).toContain('✏️ تعديل المصروف')
    expect(getInput('بيان المصروف').value).toBe('إيجار المحل')
    expect(getInput('قيمة المصروف (ج.م)').value).toBe('5000')
    expect(getSelect('فئة المصروف').value).toBe('إيجارات')
    setInputValue(getInput('بيان المصروف'), 'إيجار المحل (شهر سبتمبر)')
    submitForm()
    expect(window.updateExpense).toHaveBeenCalledWith(
      'EXP-1',
      expect.objectContaining({ title: 'إيجار المحل (شهر سبتمبر)' })
    )
    expect(lastToastMessage()).toContain('تم تعديل المصروف بنجاح')
    expect(useUiStore.getState().expenseModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('عند فشل createExpense يعرض رسالة الخطأ وتبقى النافذة مفتوحة', () => {
    window.createExpense = vi.fn(() => {
      throw new Error('تعذر حفظ المصروف في قاعدة البيانات')
    })
    const { unmount } = mountModal()
    setInputValue(getInput('بيان المصروف'), 'مصروف')
    setInputValue(getInput('قيمة المصروف (ج.م)'), '100')
    submitForm()
    expect(lastToastMessage()).toContain('تعذر حفظ المصروف')
    expect(useUiStore.getState().expenseModal.open).toBe(true)
    unmount()
  })
})
