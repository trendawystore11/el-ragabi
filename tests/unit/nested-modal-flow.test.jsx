import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AddProductModal from '@/ui/modals/AddProductModal'
import AddSupplierModal from '@/ui/modals/AddSupplierModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'

const SUPPLIERS = [
  { id: 'SUP-1', name: 'مصنع النور', phone: '01012345678' },
  { id: 'SUP-2', name: 'شركة الأمل', phone: '01198765432' },
]

function body() {
  return document.body
}

function mountModals() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <>
        <AddProductModal />
        <AddSupplierModal />
      </>
    )
  })
  return {
    root,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
      document.getElementById('modal-container')?.remove()
    },
  }
}

function click(el) {
  act(() => {
    el.click()
  })
}

function openProductModal(onDone = null) {
  act(() => {
    useUiStore.getState().openAddProductModal(null, onDone)
  })
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
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

function lastForm() {
  const forms = body().querySelectorAll('form')
  return forms[forms.length - 1]
}

const RESET_UI = {
  productModal: { open: false, productId: null, onDone: null },
  supplierModal: { open: false, supplierId: null, onDone: null },
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getProductById = vi.fn(() => null)
  window.getSupplierById = vi.fn(() => null)
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.createSupplier = vi.fn(data => {
    window.getSuppliers = vi.fn(() => [...SUPPLIERS, { id: 'SUP-NEW', name: data.name, phone: data.phone }])
    return { id: 'SUP-NEW' }
  })
  window.createProduct = vi.fn(() => ({ id: 'PRD-NEW' }))
  window.isAdmin = vi.fn(() => true)
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
})

describe('التدفق المتداخل: + مورد جديد داخل نموذج المنتج (nested modal flow)', () => {
  it('يفتح نافذة المورد فوق نموذج المنتج دون إغلاقه ويحافظ على البيانات المدخلة', () => {
    const { unmount } = mountModals()
    openProductModal(vi.fn())

    setInputValue(getInput('اسم المنتج'), 'بطانية سوبر')

    const quickAdd = Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('مورد جديد'))
    click(quickAdd)

    expect(useUiStore.getState().supplierModal.open).toBe(true)
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(body().textContent).toContain('إضافة مورد جديد')
    expect(body().textContent).toContain('إضافة منتج جديد للمخزن')
    expect(getInput('اسم المنتج').value).toBe('بطانية سوبر')
    unmount()
  })

  it('بعد حفظ المورد الجديد تُحدَّث القائمة ويُختار المورد تلقائياً دون إغلاق نموذج المنتج', () => {
    const { unmount } = mountModals()
    openProductModal(vi.fn())

    setInputValue(getInput('اسم المنتج'), 'بطانية سوبر')

    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('مورد جديد')))
    expect(body().querySelectorAll('form')).toHaveLength(2)

    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع المصرية الجديدة')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    act(() => {
      lastForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(window.createSupplier).toHaveBeenCalled()
    expect(useUiStore.getState().supplierModal.open).toBe(false)
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(body().querySelectorAll('form')).toHaveLength(1)
    expect(body().textContent).toContain('إضافة منتج جديد للمخزن')
    expect(getInput('اسم المنتج').value).toBe('بطانية سوبر')
    expect(getSelect('المورد المصنع').value).toBe('SUP-NEW')
    unmount()
  })

  it('الحفظ اللاحق للمنتج يُنشئه بالمورد الجديد المختار', () => {
    const onDone = vi.fn()
    const { unmount } = mountModals()
    openProductModal(onDone)

    setInputValue(getInput('اسم المنتج'), 'بطانية سوبر')

    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('مورد جديد')))
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع المصرية الجديدة')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    act(() => {
      lastForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(getSelect('المورد المصنع').value).toBe('SUP-NEW')

    act(() => {
      body().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(window.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'بطانية سوبر',
        supplierId: 'SUP-NEW',
        supplierName: 'مصنع المصرية الجديدة',
      })
    )
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })
})
