import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AddSupplierModal from '@/ui/modals/AddSupplierModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'

const SUPPLIER = {
  id: 'SUP-1',
  name: 'مصنع النور',
  phone: '01012345678',
  secondaryPhone: '01111111111',
  address: 'القاهرة - مدينة نصر - المنطقة الصناعية',
  notes: 'مورد أقمشة',
}

function body() {
  return document.body
}

function mountModal({ supplierId = null, onDone = null } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    if (supplierId) useUiStore.getState().openAddSupplierModal(supplierId, onDone)
    else useUiStore.getState().openAddSupplierModal(null, onDone)
    root.render(<AddSupplierModal />)
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
  supplierModal: { open: false, supplierId: null, onDone: null },
  supplierReturnModal: { open: false, supplierId: null, onDone: null },
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getSupplierById = vi.fn(() => SUPPLIER)
  window.createSupplier = vi.fn(() => ({ id: 'SUP-NEW' }))
  window.updateSupplier = vi.fn(() => SUPPLIER)
  window.isAdmin = vi.fn(() => true)
})

afterEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
})

describe('AddSupplierModal (ui/modals/AddSupplierModal.jsx)', () => {
  it('يعرض نافذة إضافة مورد جديد بالحقول والمحافظة الافتراضية', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('إضافة مورد جديد')
    expect(getInput('اسم المورد / المصنع').value).toBe('')
    expect(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)').value).toBe('')
    expect(getSelect('المحافظة').value).toBe('القاهرة')
    expect(getSelect('المدينة / المركز').value).toBe('')
    unmount()
  })

  it('يرفض رقم الهاتف غير الصحيح ويعرض رسالة دون حفظ', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع الأمل')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '123')
    submitForm()
    expect(lastToastMessage()).toContain('يرجى إدخال رقم هاتف صحيح')
    expect(window.createSupplier).not.toHaveBeenCalled()
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    unmount()
  })

  it('إرسال ناجح يستدعي createSupplier ببيانات مجمعة ويغلق النافذة', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal({ onDone })
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع النور')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    setSelectValue(getSelect('المدينة / المركز'), 'مدينة نصر')
    setInputValue(getInput('تفاصيل العنوان'), 'المنطقة الصناعية')
    setInputValue(getInput('ملاحظات عن التعامل'), 'مورد نسيج')
    submitForm()
    expect(window.createSupplier).toHaveBeenCalledWith({
      name: 'مصنع النور',
      phone: '01012345678',
      secondaryPhone: '',
      address: 'القاهرة - مدينة نصر - المنطقة الصناعية',
      notes: 'مورد نسيج',
    })
    expect(lastToastMessage()).toContain('تم إضافة المورد الجديد بنجاح')
    expect(useUiStore.getState().supplierModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('المدينة اليدوية (أخرى) تظهر حقل الإدخال وتُدمج في العنوان', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع النور')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    setSelectValue(getSelect('المدينة / المركز'), '__other__')
    const manualInput = body().querySelector('input[placeholder*="يدوياً"]')
    expect(manualInput).toBeTruthy()
    setInputValue(manualInput, 'بلدة خاصة')
    submitForm()
    expect(window.createSupplier).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'القاهرة - بلدة خاصة' })
    )
    unmount()
  })

  it('تعديل مورد يحمّل بياناته ويستدعي updateSupplier بالمعرف', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal({ supplierId: 'SUP-1', onDone })
    expect(body().textContent).toContain('تعديل بيانات المورد: مصنع النور')
    expect(getInput('اسم المورد / المصنع').value).toBe('مصنع النور')
    expect(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)').value).toBe('01012345678')
    expect(getInput('رقم هاتف ثانوي (اختياري)').value).toBe('01111111111')
    expect(getSelect('المدينة / المركز').value).toBe('مدينة نصر')
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع النور الجديد')
    submitForm()
    expect(window.updateSupplier).toHaveBeenCalledWith(
      'SUP-1',
      expect.objectContaining({ name: 'مصنع النور الجديد', address: 'القاهرة - مدينة نصر - المنطقة الصناعية' })
    )
    expect(lastToastMessage()).toContain('تم تحديث بيانات المورد بنجاح')
    expect(useUiStore.getState().supplierModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('عند فشل createSupplier يعرض رسالة الخطأ وتبقى النافذة مفتوحة', () => {
    window.createSupplier = vi.fn(() => {
      throw new Error('رقم الهاتف هذا مسجل بالفعل لمورد آخر (مورد قديم)')
    })
    const { unmount } = mountModal()
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع النور')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    submitForm()
    expect(lastToastMessage()).toContain('مسجل بالفعل لمورد آخر')
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    unmount()
  })
})
