import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AddCustomerModal from '@/ui/modals/AddCustomerModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { DEFAULT_CUSTOMER_CATEGORY } from '@/domain/customers/customerRules'

const CUSTOMER = {
  id: 'CUST-1',
  name: 'أحمد محمد',
  phone: '01012345678',
  secondaryPhone: '01198765432',
  category: 'تاجر جملة',
  notes: 'عميل جملة',
  address: 'القاهرة - مدينة نصر - شارع الميرغني',
}

function body() {
  return document.body
}

function mountModal(customerId = null, onDone = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openAddCustomerModal(customerId, onDone)
    root.render(<AddCustomerModal />)
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

function getByPlaceholder(placeholder) {
  const el = body().querySelector(`input[placeholder="${placeholder}"]`)
  if (!el) throw new Error(`input not found by placeholder: ${placeholder}`)
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

const RESET_UI = { customerModal: { open: false, customerId: null, onDone: null } }

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getCustomerById = vi.fn(() => null)
  window.getCustomerAddresses = vi.fn(() => [])
  window.addCustomerAddress = vi.fn(() => ({ id: 'ADDR-NEW' }))
  window.setDefaultCustomerAddress = vi.fn()
  window.removeCustomerAddress = vi.fn()
  window.createCustomer = vi.fn(() => ({ id: 'CUST-NEW' }))
  window.updateCustomer = vi.fn(() => ({ id: 'CUST-1' }))
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
})

describe('AddCustomerModal (ui/modals/AddCustomerModal.jsx) — وضع الإضافة', () => {
  it('يعرض النافذة بحقول العميل والعنوان الثلاثي والتصنيف الافتراضي', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('إضافة عميل جديد')
    expect(getInput('اسم العميل')).toBeTruthy()
    expect(getSelect('المحافظة *').value).toBe('القاهرة')
    expect(getSelect('المدينة / المركز *').value).toBe('مدينة نصر')
    expect(getSelect('تصنيف العميل (Category) *').value).toBe(DEFAULT_CUSTOMER_CATEGORY)
    unmount()
  })

  it('رقم هاتف غير صالح يمنع الحفظ مع رسالة خطأ', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم العميل'), 'عبد الله')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '010123')
    submitForm()
    expect(lastToastMessage()).toContain('يرجى إدخال رقم هاتف صحيح')
    expect(window.createCustomer).not.toHaveBeenCalled()
    unmount()
  })

  it('هاتف ثانوي غير صالح يمنع الحفظ مع رسالة خطأ', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم العميل'), 'عبد الله')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    setInputValue(getInput('رقم هاتف ثانوي (اختياري)'), '011')
    submitForm()
    expect(lastToastMessage()).toContain('يرجى إدخال رقم هاتف صحيح')
    expect(window.createCustomer).not.toHaveBeenCalled()
    unmount()
  })

  it('الإضافة الناجحة تُنشئ العميل بالعنوان الثلاثي المجمع وتغلق النافذة', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal(null, onDone)
    setInputValue(getInput('اسم العميل'), 'عبد الله')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    setInputValue(getInput('ملاحظات العميل'), 'عميل جملة')
    setInputValue(getInput('تفاصيل العنوان / العلامة المميزة'), 'شارع الميرغني')
    submitForm()
    expect(window.createCustomer).toHaveBeenCalledWith({
      name: 'عبد الله',
      phone: '01012345678',
      secondaryPhone: '',
      category: DEFAULT_CUSTOMER_CATEGORY,
      notes: 'عميل جملة',
      address: 'القاهرة - مدينة نصر - شارع الميرغني',
    })
    expect(lastToastMessage()).toContain('تم إضافة العميل الجديد بنجاح')
    expect(useUiStore.getState().customerModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('مدينة يدوية (أخرى) تُدمج في العنوان بدل الخيارات الجاهزة', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم العميل'), 'عميل جديد')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01111111111')
    setSelectValue(getSelect('المدينة / المركز *'), '__other__')
    setInputValue(getByPlaceholder('اكتب اسم المدينة / المركز يدوياً...'), 'قرية الأمل')
    submitForm()
    expect(window.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'القاهرة - قرية الأمل' })
    )
    unmount()
  })
})

describe('AddCustomerModal — وضع التعديل', () => {
  it('يعرض بيانات العميل والعناوين المسجلة مع شارة الافتراضي', () => {
    window.getCustomerById = vi.fn(() => CUSTOMER)
    window.getCustomerAddresses = vi.fn(() => [
      { id: 'ADDR-1', label: 'المنزل', address: 'القاهرة - مدينة نصر - شارع الميرغني', isDefault: true },
      { id: 'ADDR-2', label: 'المخزن', address: 'الجيزة - الدقي', isDefault: false },
    ])
    const { unmount } = mountModal('CUST-1')
    expect(body().textContent).toContain('تعديل بيانات العميل: أحمد محمد')
    expect(getInput('اسم العميل').value).toBe('أحمد محمد')
    expect(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)').value).toBe('01012345678')
    expect(getSelect('تصنيف العميل (Category) *').value).toBe('تاجر جملة')
    expect(body().textContent).toContain('المنزل')
    expect(body().textContent).toContain('الافتراضي')
    unmount()
  })

  it('حفظ التعديلات يستدعي updateCustomer دون حقل العنوان ويغلق النافذة', () => {
    window.getCustomerById = vi.fn(() => CUSTOMER)
    window.getCustomerAddresses = vi.fn(() => [
      { id: 'ADDR-1', label: 'المنزل', address: 'القاهرة - مدينة نصر - شارع الميرغني', isDefault: true },
    ])
    const onDone = vi.fn()
    const { unmount } = mountModal('CUST-1', onDone)
    setInputValue(getInput('اسم العميل'), 'أحمد محمد المصري')
    submitForm()
    const payload = window.updateCustomer.mock.calls[0][1]
    expect(payload).toEqual({
      name: 'أحمد محمد المصري',
      phone: '01012345678',
      secondaryPhone: '01198765432',
      category: 'تاجر جملة',
      notes: 'عميل جملة',
    })
    expect(payload.address).toBeUndefined()
    expect(lastToastMessage()).toContain('تم تحديث بيانات العميل بنجاح')
    expect(useUiStore.getState().customerModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('إضافة عنوان جديد تُسجل عبر addCustomerAddress وتظهر في القائمة', () => {
    let addresses = [
      { id: 'ADDR-1', label: 'المنزل', address: 'القاهرة - مدينة نصر - شارع الميرغني', isDefault: true },
    ]
    window.getCustomerById = vi.fn(() => CUSTOMER)
    window.getCustomerAddresses = vi.fn(() => addresses)
    window.addCustomerAddress = vi.fn((id, data) => {
      const added = { id: 'ADDR-2', ...data, isDefault: false }
      addresses = addresses.concat([added])
      return added
    })
    const { unmount } = mountModal('CUST-1')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('+ إضافة عنوان جديد')))
    setInputValue(getInput('اسم العنوان'), 'المخزن')
    setSelectValue(getSelect('المدينة / المركز *'), 'المعادي')
    setInputValue(getInput('تفاصيل العنوان / العلامة المميزة'), 'شارع النصر')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent === 'حفظ العنوان'))
    expect(window.addCustomerAddress).toHaveBeenCalledWith('CUST-1', {
      label: 'المخزن',
      address: 'القاهرة - المعادي - شارع النصر',
    })
    expect(body().textContent).toContain('شارع النصر')
    expect(lastToastMessage()).toContain('تم حفظ العنوان الجديد')
    unmount()
  })

  it('تعيين عنوان افتراضي وحذفه يستدعيان الواجهات المناسبة', () => {
    window.confirm = vi.fn(() => true)
    window.getCustomerById = vi.fn(() => CUSTOMER)
    window.getCustomerAddresses = vi.fn(() => [
      { id: 'ADDR-1', label: 'المنزل', address: 'القاهرة - مدينة نصر - شارع الميرغني', isDefault: true },
      { id: 'ADDR-2', label: 'المخزن', address: 'الجيزة - الدقي', isDefault: false },
    ])
    const { unmount } = mountModal('CUST-1')
    const defaultBtn = Array.from(body().querySelectorAll('button')).find(b =>
      b.textContent.includes('تعيين افتراضي')
    )
    const removeButtons = Array.from(body().querySelectorAll('button')).filter(b => b.textContent === 'حذف')
    click(defaultBtn)
    expect(window.setDefaultCustomerAddress).toHaveBeenCalledWith('CUST-1', 'ADDR-2')
    click(removeButtons[1])
    expect(window.removeCustomerAddress).toHaveBeenCalledWith('CUST-1', 'ADDR-2')
    unmount()
  })

  it('عند عدم العثور على العميل تعمل النافذة بوضع الإضافة', () => {
    window.getCustomerById = vi.fn(() => null)
    const { unmount } = mountModal('CUST-999')
    expect(body().textContent).toContain('إضافة عميل جديد')
    expect(body().textContent).toContain('المحافظة *')
    unmount()
  })
})
