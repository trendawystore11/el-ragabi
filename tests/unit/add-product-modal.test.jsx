import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AddProductModal from '@/ui/modals/AddProductModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'

const PRODUCT = {
  id: 'PRD-1',
  code: 'SKU-1',
  name: 'بطانية مورا إسباني',
  supplierId: 'SUP-1',
  supplierName: 'مصنع النور',
  stock: 7,
  minStock: 3,
  purchasePrice: 1200,
  sellingPrice: 1800,
  notes: 'قطن مصري 6 كيلو',
}

const SUPPLIERS = [
  { id: 'SUP-1', name: 'مصنع النور', phone: '01012345678' },
  { id: 'SUP-2', name: 'شركة الأمل', phone: '01198765432' },
]

function body() {
  return document.body
}

function mountModal(productId = null, onDone = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openAddProductModal(productId, onDone)
    root.render(<AddProductModal />)
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

function mountPrefillModal(initialData) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openAddProductModal(null, null, initialData)
    root.render(<AddProductModal />)
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
  productModal: { open: false, productId: null, onDone: null },
  shipmentModal: { open: false, productId: null, onDone: null },
  supplierModal: { open: false, supplierId: null, onDone: null },
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getProductById = vi.fn(() => null)
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.createProduct = vi.fn(() => ({ id: 'PRD-NEW' }))
  window.updateProduct = vi.fn()
  window.isAdmin = vi.fn(() => true)
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
})

describe('AddProductModal (ui/modals/AddProductModal.jsx) — وضع الإضافة', () => {
  it('يعرض النافذة بحقول المنتج والقيم الافتراضية للمخزون والأسعار', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('إضافة منتج جديد للمخزن')
    expect(getInput('اسم المنتج')).toBeTruthy()
    expect(getInput('المخزون الحالي').value).toBe('10')
    expect(getInput('سعر الشراء').value).toBe('1000')
    expect(getInput('سعر البيع').value).toBe('1400')
    expect(getInput('الحد الأدنى للمخزون').value).toBe('5')
    unmount()
  })

  it('الحفظ بدون اختيار مورد يعرض رسالة خطأ ولا ينشئ المنتج', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم المنتج'), 'بطانية')
    submitForm()
    expect(lastToastMessage()).toContain('يرجى اختيار المورد المصنع للمنتج')
    expect(window.createProduct).not.toHaveBeenCalled()
    unmount()
  })

  it('الإضافة الناجحة تُنشئ المنتج ببيانات المورد وتغلق النافذة', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal(null, onDone)
    setInputValue(getInput('اسم المنتج'), 'بطانية مورا')
    setSelectValue(getSelect('المورد المصنع'), 'SUP-1')
    setInputValue(getInput('المخزون الحالي'), '25')
    setInputValue(getInput('سعر الشراء'), '950')
    setInputValue(getInput('سعر البيع'), '1500')
    setInputValue(getInput('الحد الأدنى للمخزون'), '8')
    setInputValue(getInput('ملاحظات وصفية'), 'خامة إسباني')
    submitForm()
    expect(window.createProduct).toHaveBeenCalledWith({
      name: 'بطانية مورا',
      stock: 25,
      purchasePrice: 950,
      sellingPrice: 1500,
      minStock: 8,
      supplierId: 'SUP-1',
      supplierName: 'مصنع النور',
      notes: 'خامة إسباني',
    })
    expect(lastToastMessage()).toContain('تم إضافة المنتج الجديد للمخزون')
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('زر + مورد جديد يفتح AddSupplierModal عبر uiStore ثم يختار المورد المنشأ حديثاً', () => {
    const { unmount } = mountModal()
    const btn = Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('مورد جديد'))
    click(btn)
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    expect(useUiStore.getState().productModal.open).toBe(true)

    window.getSuppliers = vi.fn(() => [...SUPPLIERS, { id: 'SUP-NEW', name: 'مورد جديد', phone: '' }])
    const pendingOnDone = useUiStore.getState().supplierModal.onDone
    act(() => {
      useUiStore.getState().closeAddSupplierModal()
      pendingOnDone()
    })

    expect(useUiStore.getState().supplierModal.open).toBe(false)
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(getSelect('المورد المصنع').value).toBe('SUP-NEW')
    unmount()
  })

  it('V3.42 — لغير المدير: قائمة الموردين بلا أرقام هواتف ويختفي زر + مورد جديد', () => {
    window.isAdmin = vi.fn(() => false)
    const { unmount } = mountModal()
    const select = getSelect('المورد المصنع')
    const optionTexts = Array.from(select.querySelectorAll('option')).map(o => o.textContent)
    expect(optionTexts.some(t => t.includes('01012345678'))).toBe(false)
    expect(optionTexts.some(t => t.includes('مصنع النور'))).toBe(true)
    expect(Array.from(body().querySelectorAll('button')).some(b => b.textContent.includes('مورد جديد'))).toBe(false)
    unmount()
  })

  it('زر + مورد جديد يحافظ على بيانات المنتج المدخلة دون فقدانها', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم المنتج'), 'بطانية سوبر')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('مورد جديد')))
    expect(getInput('اسم المنتج').value).toBe('بطانية سوبر')
    window.getSuppliers = vi.fn(() => [...SUPPLIERS, { id: 'SUP-NEW', name: 'مورد جديد', phone: '' }])
    const pendingOnDone = useUiStore.getState().supplierModal.onDone
    act(() => {
      useUiStore.getState().closeAddSupplierModal()
      pendingOnDone()
    })
    expect(getInput('اسم المنتج').value).toBe('بطانية سوبر')
    expect(getSelect('المورد المصنع').value).toBe('SUP-NEW')
    unmount()
  })
})

describe('AddProductModal — التعبئة الذكية من المساعد (V3.37)', () => {
  it('التعبئة الذكية لا تختلق قيماً افتراضية: المخزون وسعر الشراء والحد الأدنى تبقى فارغة', () => {
    const { unmount } = mountPrefillModal({ name: 'وسادة', price: 120, supplierId: 'SUP-1', supplierName: 'مصنع النور' })
    expect(getInput('اسم المنتج').value).toBe('وسادة')
    expect(getSelect('المورد المصنع').value).toBe('SUP-1')
    expect(getInput('سعر البيع').value).toBe('120')
    expect(getInput('المخزون الحالي').value).toBe('')
    expect(getInput('سعر الشراء').value).toBe('')
    expect(getInput('الحد الأدنى للمخزون').value).toBe('')
    unmount()
  })

  it('الحفظ ببيانات ناقصة يُمنع بأول خطأ (المخزون) ولا يُنشئ المنتج ولا يغلق النافذة', () => {
    const { unmount } = mountPrefillModal({ name: 'وسادة', price: 120, supplierId: 'SUP-1', supplierName: 'مصنع النور' })
    submitForm()
    expect(window.createProduct).not.toHaveBeenCalled()
    expect(lastToastMessage()).toContain('يرجى إدخال كمية مخزون صحيحة (0 أو أكثر)')
    expect(useUiStore.getState().productModal.open).toBe(true)
    unmount()
  })

  it('إكمال البيانات الناقصة (مخزون وسعر شراء وحد أدنى) يسمح بالحفظ بقيم حقيقية', () => {
    const { unmount } = mountPrefillModal({ name: 'وسادة', price: 120, supplierId: 'SUP-1', supplierName: 'مصنع النور' })
    setInputValue(getInput('المخزون الحالي'), '15')
    setInputValue(getInput('سعر الشراء'), '80')
    setInputValue(getInput('الحد الأدنى للمخزون'), '2')
    submitForm()
    expect(window.createProduct).toHaveBeenCalledWith(expect.objectContaining({
      name: 'وسادة',
      stock: 15,
      purchasePrice: 80,
      sellingPrice: 120,
      minStock: 2,
      supplierId: 'SUP-1',
      supplierName: 'مصنع النور',
    }))
    expect(lastToastMessage()).toContain('تم إضافة المنتج الجديد للمخزون')
    expect(useUiStore.getState().productModal.open).toBe(false)
    unmount()
  })

  it('سعر شراء يتجاوز سعر البيع يُمنع الحفظ برسالة واضحة', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم المنتج'), 'بطانية')
    setSelectValue(getSelect('المورد المصنع'), 'SUP-1')
    setInputValue(getInput('سعر الشراء'), '2000')
    setInputValue(getInput('سعر البيع'), '1500')
    submitForm()
    expect(window.createProduct).not.toHaveBeenCalled()
    expect(lastToastMessage()).toContain('سعر الشراء لا يمكن أن يتجاوز سعر البيع')
    unmount()
  })
})

describe('AddProductModal — وضع التعديل', () => {
  it('يعرض بيانات المنتج الحالية في الحقول', () => {
    window.getProductById = vi.fn(() => PRODUCT)
    const { unmount } = mountModal('PRD-1')
    expect(body().textContent).toContain('تعديل بيانات المنتج')
    expect(getInput('اسم المنتج').value).toBe('بطانية مورا إسباني')
    expect(getSelect('المورد المصنع').value).toBe('SUP-1')
    expect(getInput('المخزون الحالي').value).toBe('7')
    expect(getInput('سعر الشراء').value).toBe('1200')
    expect(getInput('سعر البيع').value).toBe('1800')
    expect(getInput('الحد الأدنى للمخزون').value).toBe('3')
    unmount()
  })

  it('حفظ التعديلات يستدعي updateProduct ويغلق النافذة', () => {
    window.getProductById = vi.fn(() => PRODUCT)
    const onDone = vi.fn()
    const { unmount } = mountModal('PRD-1', onDone)
    setInputValue(getInput('اسم المنتج'), 'بطانية مورا سوبر')
    setInputValue(getInput('سعر البيع'), '2000')
    submitForm()
    expect(window.updateProduct).toHaveBeenCalledWith(
      'PRD-1',
      expect.objectContaining({
        name: 'بطانية مورا سوبر',
        sellingPrice: 2000,
        stock: 7,
        purchasePrice: 1200,
        minStock: 3,
        supplierId: 'SUP-1',
        supplierName: 'مصنع النور',
      })
    )
    expect(lastToastMessage()).toContain('تم تحديث بيانات المنتج والمورد بنجاح')
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })
})
