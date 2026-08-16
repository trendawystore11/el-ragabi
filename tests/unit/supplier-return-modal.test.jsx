import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import SupplierReturnModal from '@/ui/modals/SupplierReturnModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency } from '@/utils/formatters'

const SUPPLIERS = [
  { id: 'SUP-1', name: 'مصنع النور', remainingBalance: 2000 },
  { id: 'SUP-2', name: 'شركة الأمل', remainingBalance: 500 },
]

const PRODUCTS = [
  { id: 'PRD-1', name: 'بطانية مورا إسباني', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 5, purchasePrice: 1000 },
  { id: 'PRD-2', name: 'مفارش مطرزة', supplierId: 'SUP-2', supplierName: 'شركة الأمل', stock: 8, purchasePrice: 200 },
  { id: 'PRD-3', name: 'منتج بدون مورد', supplierId: '', supplierName: '', stock: 3, purchasePrice: 50 },
]

function body() {
  return document.body
}

function mountModal(supplierId = null, onDone = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openSupplierReturnModal(supplierId, onDone)
    root.render(<SupplierReturnModal />)
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
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.getProducts = vi.fn(() => PRODUCTS)
  window.createSupplierReturn = vi.fn(args => ({
    id: 'SRET-1',
    totalValue: (args.items || []).reduce((s, i) => s + Number(i.quantity) * Number(i.unitCost), 0),
    ...args,
  }))
})

afterEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
})

describe('SupplierReturnModal (ui/modals/SupplierReturnModal.jsx)', () => {
  it('يعرض نافذة المرتجع بمنتجات المورد المحدد فقط (V3.19)', () => {
    const { unmount } = mountModal('SUP-1')
    expect(body().textContent).toContain('تسجيل مرتجع مشتريات لمورد / مصنع')
    expect(getSelect('المورد / المصنع المسترجع إليه').value).toBe('SUP-1')
    const rowSelect = body().querySelector('.return-product-select')
    expect(rowSelect.value).toBe('PRD-1')
    expect(Array.from(rowSelect.querySelectorAll('option')).map(o => o.textContent).join(' ')).toContain('بطانية مورا إسباني')
    expect(Array.from(rowSelect.querySelectorAll('option')).map(o => o.textContent).join(' ')).not.toContain('مفارش مطرزة')
    expect(body().querySelector('.return-qty').value).toBe('1')
    expect(body().querySelector('.return-cost').value).toBe('1000')
    expect(body().textContent).toContain(formatCurrency(1000))
    unmount()
  })

  it('تغيير المورد يعيد تهيئة الصف الأول بمنتجات المورد الجديد', () => {
    const { unmount } = mountModal()
    setSelectValue(getSelect('المورد / المصنع المسترجع إليه'), 'SUP-2')
    const rowSelect = body().querySelector('.return-product-select')
    expect(rowSelect.value).toBe('PRD-2')
    expect(body().querySelector('.return-cost').value).toBe('200')
    expect(body().textContent).toContain(formatCurrency(200))
    unmount()
  })

  it('تحديث الكمية وسعر الوحدة يحدّث الإجمالي الحي', () => {
    const { unmount } = mountModal('SUP-1')
    setInputValue(body().querySelector('.return-qty'), '2')
    setInputValue(body().querySelector('.return-cost'), '1100')
    expect(body().textContent).toContain(formatCurrency(2200))
    unmount()
  })

  it('إرسال النموذج يستدعي createSupplierReturn بالبيانات ويغلق النافذة', async () => {
    const onDone = vi.fn()
    const { unmount } = mountModal('SUP-1', onDone)
    setInputValue(body().querySelector('.return-qty'), '2')
    setInputValue(getInput('سبب المرتجع'), 'عيوب جودة')
    submitForm()
    await act(async () => {})
    expect(window.createSupplierReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId: 'SUP-1',
        supplierName: 'مصنع النور',
        refundType: 'debt',
        notes: 'عيوب جودة',
        items: [expect.objectContaining({ productId: 'PRD-1', quantity: 2, unitCost: 1000 })],
      })
    )
    expect(lastToastMessage()).toContain('SRET-1')
    expect(lastToastMessage()).toContain('تم تسجيل المرتجع')
    expect(useUiStore.getState().supplierReturnModal.open).toBe(false)
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('يرفض الإرسال دون اختيار مورد', () => {
    const { unmount } = mountModal()
    submitForm()
    expect(lastToastMessage()).toContain('يرجى اختيار المورد / المصنع أولاً')
    expect(window.createSupplierReturn).not.toHaveBeenCalled()
    expect(useUiStore.getState().supplierReturnModal.open).toBe(true)
    unmount()
  })

  it('عند فشل createSupplierReturn يعرض الخطأ وتبقى النافذة مفتوحة', () => {
    window.createSupplierReturn = vi.fn(() => {
      throw new Error('لا يمكن إرجاع 2 قطعة من "بطانية مورا إسباني" لأن المخزون الحالي 1 قطعة فقط')
    })
    const { unmount } = mountModal('SUP-1')
    setInputValue(body().querySelector('.return-qty'), '2')
    submitForm()
    expect(lastToastMessage()).toContain('لا يمكن إرجاع 2 قطعة')
    expect(useUiStore.getState().supplierReturnModal.open).toBe(true)
    unmount()
  })

  it('اختيار منتج في صف يخفيه فوراً من قائمة الصف الجديد (V3.56)', () => {
    window.getProducts = vi.fn(() => [
      { id: 'PRD-1', name: 'بطانية مورا إسباني', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 5, purchasePrice: 1000 },
      { id: 'PRD-4', name: 'خامة قطن خام', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 4, purchasePrice: 300 },
      { id: 'PRD-3', name: 'منتج بدون مورد', supplierId: '', supplierName: '', stock: 3, purchasePrice: 50 },
    ])
    const { unmount } = mountModal('SUP-1')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج')))
    let rows = body().querySelectorAll('.return-row')
    expect(rows).toHaveLength(2)
    let firstSelect = rows[0].querySelector('.return-product-select')
    let secondSelect = rows[1].querySelector('.return-product-select')
    expect(firstSelect.value).toBe('PRD-1')
    expect(secondSelect.value).toBe('PRD-4')
    expect(Array.from(secondSelect.querySelectorAll('option')).map(o => o.textContent).join(' '))
      .not.toContain('بطانية مورا إسباني')
    expect(Array.from(secondSelect.querySelectorAll('option')).map(o => o.textContent).join(' '))
      .toContain('خامة قطن خام')
    expect(Array.from(firstSelect.querySelectorAll('option')).map(o => o.textContent).join(' '))
      .not.toContain('خامة قطن خام')
    unmount()
  })

  it('تغيير منتج الصف الأول يعيد المنتج للظهور في قائمة الصف الثاني (V3.56)', () => {
    window.getProducts = vi.fn(() => [
      { id: 'PRD-1', name: 'بطانية مورا إسباني', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 5, purchasePrice: 1000 },
      { id: 'PRD-4', name: 'خامة قطن خام', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 4, purchasePrice: 300 },
      { id: 'PRD-3', name: 'منتج بدون مورد', supplierId: '', supplierName: '', stock: 3, purchasePrice: 50 },
    ])
    const { unmount } = mountModal('SUP-1')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج')))
    let rows = body().querySelectorAll('.return-row')
    setSelectValue(rows[0].querySelector('.return-product-select'), 'PRD-4')
    rows = body().querySelectorAll('.return-row')
    const secondOpts = Array.from(rows[1].querySelector('.return-product-select').querySelectorAll('option'))
      .map(o => o.textContent)
      .join(' ')
    expect(secondOpts).toContain('بطانية مورا إسباني')
    unmount()
  })

  it('حذف صف يعيد منتجه لقائمة الاختيار عند إضافة صف جديد (V3.56)', () => {
    window.getProducts = vi.fn(() => [
      { id: 'PRD-1', name: 'بطانية مورا إسباني', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 5, purchasePrice: 1000 },
      { id: 'PRD-4', name: 'خامة قطن خام', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 4, purchasePrice: 300 },
      { id: 'PRD-3', name: 'منتج بدون مورد', supplierId: '', supplierName: '', stock: 3, purchasePrice: 50 },
    ])
    const { unmount } = mountModal('SUP-1')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج')))
    let rows = body().querySelectorAll('.return-row')
    expect(rows[1].querySelector('.return-product-select').value).toBe('PRD-4')
    click(rows[1].querySelector('.return-remove-row'))
    rows = body().querySelectorAll('.return-row')
    expect(rows).toHaveLength(1)
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج')))
    rows = body().querySelectorAll('.return-row')
    const newSecond = rows[1].querySelector('.return-product-select')
    expect(newSecond.value).toBe('PRD-4')
    const newSecondOpts = Array.from(newSecond.querySelectorAll('option')).map(o => o.textContent).join(' ')
    expect(newSecondOpts).toContain('خامة قطن خام')
    expect(newSecondOpts).not.toContain('بطانية مورا إسباني')
    unmount()
  })
})
