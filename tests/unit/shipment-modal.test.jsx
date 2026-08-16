import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import ShipmentModal from '@/ui/modals/ShipmentModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency } from '@/utils/formatters'

const PRODUCT = {
  id: 'PRD-1',
  code: 'SKU-1',
  name: 'بطانية مورا إسباني',
  supplierId: 'SUP-1',
  supplierName: 'مصنع النور',
  stock: 5,
  minStock: 3,
  purchasePrice: 1000,
  sellingPrice: 1400,
}

const SUPPLIERS = [
  { id: 'SUP-1', name: 'مصنع النور' },
  { id: 'SUP-2', name: 'شركة الأمل' },
]

function body() {
  return document.body
}

function mountModal(productId = 'PRD-1', onDone = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openShipmentModal(productId, onDone)
    root.render(<ShipmentModal />)
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
  productModal: { open: false, productId: null, onDone: null },
  shipmentModal: { open: false, productId: null, onDone: null },
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getProductById = vi.fn(() => PRODUCT)
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.addStockShipment = vi.fn()
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
})

describe('ShipmentModal (ui/modals/ShipmentModal.jsx)', () => {
  it('يعرض معلومات المنتج والمخزون الحالي والحقول الافتراضية', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('توريد شحنة جديدة: بطانية مورا إسباني')
    expect(body().textContent).toContain('SKU-1')
    expect(body().textContent).toContain('5 قطعة')
    expect(getInput('الكمية المضافة').value).toBe('10')
    expect(getInput('سعر الشراء / التكلفة للقطعة').value).toBe('1000')
    unmount()
  })

  it('يعرض حسابات التكلفة والـ COGS حية عند تغيير الكمية والمصاريف', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain(formatCurrency(10000))
    expect(body().textContent).toContain(formatCurrency(1000))

    setInputValue(getInput('الكمية المضافة'), '20')
    setInputValue(getInput('مصاريف الشحن'), '50')
    setInputValue(getInput('نسريات / مستلزمات الشحنة'), '30')
    expect(body().textContent).toContain(formatCurrency(20000))
    expect(body().textContent).toContain(formatCurrency(80))
    expect(body().textContent).toContain(formatCurrency(1003.2))
    unmount()
  })

  it('إرسال النموذج يستدعي addStockShipment بالبيانات والمصاريف ويغلق النافذة', () => {
    const onDone = vi.fn()
    const { unmount } = mountModal('PRD-1', onDone)
    setSelectValue(getSelect('المورد / المصنع المورد لهذه الشحنة'), 'SUP-1')
    setInputValue(getInput('الكمية المضافة'), '15')
    setInputValue(getInput('سعر الشراء / التكلفة للقطعة'), '1100')
    setInputValue(getInput('مصاريف الشحن'), '100')
    setInputValue(getInput('نسريات / مستلزمات الشحنة'), '50')
    setInputValue(getInput('بيانات وملاحظات الشحنة / رقم الفاتورة'), 'فاتورة 804')
    submitForm()
    expect(window.addStockShipment).toHaveBeenCalledWith(
      'PRD-1',
      '15',
      'SUP-1',
      '1100',
      'فاتورة 804',
      { shippingCost: '100', suppliesCost: '50' }
    )
    expect(lastToastMessage()).toContain('تمت إضافة 15 قطعة للمخزون')
    expect(useUiStore.getState().shipmentModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('عند فشل addStockShipment يعرض رسالة الخطأ وتبقى النافذة مفتوحة', () => {
    window.addStockShipment = vi.fn(() => {
      throw new Error('قيمة مصاريف الشحن/النسريات غير صالحة')
    })
    const { unmount } = mountModal()
    setInputValue(getInput('الكمية المضافة'), '10')
    submitForm()
    expect(lastToastMessage()).toContain('قيمة مصاريف الشحن/النسريات غير صالحة')
    expect(useUiStore.getState().shipmentModal.open).toBe(true)
    unmount()
  })
})
