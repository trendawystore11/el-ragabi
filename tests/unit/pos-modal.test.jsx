import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import PosModal from '@/ui/modals/PosModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency } from '@/utils/formatters'

const PRODUCTS = [
  {
    id: 'P1',
    name: 'بطانية مورا',
    code: 'SKU-1',
    barcode: '6220000000011',
    stock: 5,
    minStock: 5,
    purchasePrice: 1000,
    sellingPrice: 1400,
    supplierId: 'S1',
    supplierName: 'مصنع النور',
  },
  { id: 'P2', name: 'مفرش سرير', code: 'SKU-2', stock: 2, minStock: 0, purchasePrice: 200, sellingPrice: 300 },
]

function body() {
  return document.body
}

function mountPos() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openPosModal()
    root.render(<PosModal />)
  })
  return {
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

function getInput(labelText) {
  const labels = Array.from(body().querySelectorAll('label'))
  const label = labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  return document.getElementById(label.getAttribute('for'))
}

function addProduct(name) {
  const card = Array.from(body().querySelectorAll('button')).find(b =>
    b.textContent.includes(name) && b.textContent.includes('مخزون:')
  )
  if (!card) throw new Error(`product card not found: ${name}`)
  click(card)
}

function lastToastMessage() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1].message : ''
}

function lastCreateOrderCall() {
  const calls = window.createOrder.mock.calls
  return calls.length ? calls[calls.length - 1][0] : null
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState({ posModal: { open: false, onSuccess: null } })
  window.getProducts = vi.fn(() => PRODUCTS)
  window.createOrder = vi.fn(() => ({ id: 'ORD-NEW' }))
  window.findCustomerByPhone = vi.fn(() => null)
})

afterEach(() => {
  useUiStore.setState({ posModal: { open: false, onSuccess: null } })
})

describe('PosModal (ui/modals/PosModal.jsx) — وضع الكاشير', () => {
  it('يعرض شبكة المنتجات ويضيف المنتج بلمسة واحدة ويحسب الإجمالي', () => {
    const { unmount } = mountPos()
    expect(body().textContent).toContain('كاشير سريع (بيع فوري)')
    expect(body().textContent).toContain('بطانية مورا')
    addProduct('بطانية مورا')
    expect(body().textContent).toContain(formatCurrency(1400))
    unmount()
  })

  it('البحث السريع بالاسم والباركود يفلتر شبكة المنتجات', () => {
    const { unmount } = mountPos()
    const search = body().querySelector('input[placeholder*="بحث سريع"]')
    setInputValue(search, '6220000000011')
    const visibleCards = Array.from(body().querySelectorAll('button')).filter(b => b.textContent.includes('مخزون:'))
    expect(visibleCards).toHaveLength(1)
    expect(visibleCards[0].textContent).toContain('بطانية مورا')
    setInputValue(search, 'مفرش')
    const visibleCards2 = Array.from(body().querySelectorAll('button')).filter(b => b.textContent.includes('مخزون:'))
    expect(visibleCards2).toHaveLength(1)
    expect(visibleCards2[0].textContent).toContain('مفرش سرير')
    unmount()
  })

  it('زر «دفعة كاملة» يعبّئ المدفوع بقيمة الإجمالي فوراً', () => {
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('دفعة كاملة')))
    expect(getInput('المدفوع (ج.م)').value).toBe('1400')
    expect(getInput('المدفوع (ج.م)')).toBeTruthy()
    unmount()
  })

  it('الخصم يخفض الإجمالي ويُطبَّق على أسعار بيع البنود عند الحفظ', () => {
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    setInputValue(getInput('الخصم (ج.م)'), '200')
    expect(body().textContent).toContain(formatCurrency(1200))
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('نقداً')))
    const call = lastCreateOrderCall()
    expect(call.items).toEqual([
      expect.objectContaining({ productId: 'P1', productName: 'بطانية مورا', quantity: 1, sellingPrice: 1200 }),
    ])
    expect(call.downPayment).toBe(1200)
    unmount()
  })

  it('زر «نقداً» يحفظ طلباً مكتملاً بنفس صيغة createOrder (توافق Schema)', async () => {
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('نقداً')))
    await act(async () => {})
    expect(window.createOrder).toHaveBeenCalledTimes(1)
    expect(lastCreateOrderCall()).toEqual(
      expect.objectContaining({
        cashierMode: true,
        status: 'completed',
        downPayment: 1400,
        depositType: 'custom',
        directShipping: false,
        shippingCost: 0,
        shippingPayer: 'customer',
        extraExpenses: 0,
        extraExpensesPayer: 'customer',
        customerInfo: expect.objectContaining({
          name: 'عميل معرض',
          phone: '',
          notes: 'بيع فوري من الكاشير',
        }),
      })
    )
    expect(lastCreateOrderCall().items).toEqual([
      {
        productId: 'P1',
        productName: 'بطانية مورا',
        quantity: 1,
        purchasePrice: 1000,
        sellingPrice: 1400,
        supplierId: 'S1',
        supplierName: 'مصنع النور',
      },
    ])
    expect(useUiStore.getState().posModal.open).toBe(false)
    unmount()
  })

  it('البيع الآجل بدون رقم هاتف يمنع الحفظ ويعرض تنبيهاً', () => {
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('آجل')))
    expect(lastToastMessage()).toContain('للبيع الآجل أو الجزئي يجب إدخال رقم هاتف عميل صحيح')
    expect(window.createOrder).not.toHaveBeenCalled()
    unmount()
  })

  it('البيع الآجل بهاتف يحفظ طلباً جديداً (status new, downPayment 0) بنفس الصيغة', async () => {
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('آجل')))
    await act(async () => {})
    expect(lastCreateOrderCall()).toEqual(
      expect.objectContaining({
        cashierMode: false,
        status: 'new',
        downPayment: 0,
        customerInfo: expect.objectContaining({
          name: 'عميل معرض',
          phone: '01012345678',
          notes: 'بيع آجل من الكاشير',
        }),
      })
    )
    expect(useUiStore.getState().posModal.open).toBe(false)
    unmount()
  })

  it('عدم اختيار أي منتج يمنع الحفظ', () => {
    const { unmount } = mountPos()
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إتمام البيع')))
    expect(lastToastMessage()).toContain('يرجى اختيار منتج واحد على الأقل للبيع')
    expect(window.createOrder).not.toHaveBeenCalled()
    unmount()
  })

  it('إتمام البيع بدفعة جزئية بهاتف يحفظ طلباً آجلاً بالمبلغ المدفوع والباقي ديناً', () => {
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    setInputValue(getInput('المدفوع (ج.م)'), '500')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إتمام البيع')))
    expect(lastCreateOrderCall()).toEqual(
      expect.objectContaining({
        cashierMode: false,
        status: 'new',
        downPayment: 500,
        customerInfo: expect.objectContaining({
          notes: 'بيع جزئي من الكاشير',
        }),
      })
    )
    unmount()
  })

  it('إدخال رقم هاتف مسجل يعبئ اسم العميل تلقائياً من قاعدة العملاء', () => {
    window.findCustomerByPhone = vi.fn(() => ({ id: 'CUS-1', name: 'أحمد محمد', phone: '01012345678' }))
    const { unmount } = mountPos()
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    expect(getInput('اسم العميل').value).toBe('أحمد محمد')
    expect(lastToastMessage()).toContain('تم التعرف على العميل')
    unmount()
  })

  it('تعارض: اسم مكتوب يدوياً يختلف عن العميل المسجل للرقم يبقى كما هو مع تنبيه', () => {
    window.findCustomerByPhone = vi.fn(() => ({ id: 'CUS-1', name: 'أحمد محمد', phone: '01012345678' }))
    const { unmount } = mountPos()
    setInputValue(getInput('اسم العميل'), 'عميل نقدي')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    expect(getInput('اسم العميل').value).toBe('عميل نقدي')
    expect(lastToastMessage()).toContain('الاسم المكتوب مختلف ويبقى كما هو')
    unmount()
  })

  it('رقم غير مسجل في قاعدة العملاء يعرض تنبيهاً معلوماتياً', () => {
    const { unmount } = mountPos()
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    expect(getInput('اسم العميل').value).toBe('')
    expect(lastToastMessage()).toContain('سيُسجل كعميل جديد')
    unmount()
  })

  it('اسم مطابق للعميل المسجل (نفس الكتابة) يُكمل التعرف دون تغيير', () => {
    window.findCustomerByPhone = vi.fn(() => ({ id: 'CUS-1', name: 'أحمد محمد', phone: '01012345678' }))
    const { unmount } = mountPos()
    setInputValue(getInput('اسم العميل'), 'أحمد محمد')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    expect(getInput('اسم العميل').value).toBe('أحمد محمد')
    expect(lastToastMessage()).toContain('تم التعرف على العميل')
    unmount()
  })

  it('عميل مسجل له عنوان: يُعبَّأ العنوان تلقائياً ويُرفق في الفاتورة', () => {
    window.findCustomerByPhone = vi.fn(() => ({ id: 'CUS-1', name: 'أحمد محمد', phone: '01012345678', address: 'القاهرة - مدينة نصر - شارع الميرغني' }))
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    expect(getInput('اسم العميل').value).toBe('أحمد محمد')
    expect(getInput('عنوان العميل (اختياري)').value).toBe('القاهرة - مدينة نصر - شارع الميرغني')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('آجل')))
    expect(lastCreateOrderCall().customerInfo).toEqual(
      expect.objectContaining({
        name: 'أحمد محمد',
        phone: '01012345678',
        address: 'القاهرة - مدينة نصر - شارع الميرغني',
      })
    )
    unmount()
  })

  it('عميل بدون حقل address: يُؤخذ العنوان الافتراضي من قائمة العناوين إن وُجدت', () => {
    window.findCustomerByPhone = vi.fn(() => ({ id: 'CUS-1', name: 'أحمد محمد', phone: '01012345678' }))
    window.getCustomerAddresses = vi.fn(() => [
      { id: 'ADDR-1', label: 'المنزل', address: 'الجيزة - الدقي - شارع سليمان أباظة', isDefault: true },
    ])
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('آجل')))
    expect(lastCreateOrderCall().customerInfo).toEqual(
      expect.objectContaining({ address: 'الجيزة - الدقي - شارع سليمان أباظة' })
    )
    unmount()
  })

  it('عنوان مطابق لما هو مسجل لا يُلغي حق كتابة عنوان مختلف يدوياً', () => {
    window.findCustomerByPhone = vi.fn(() => ({ id: 'CUS-1', name: 'أحمد محمد', phone: '01012345678', address: 'القاهرة - مدينة نصر - شارع الميرغني' }))
    const { unmount } = mountPos()
    addProduct('بطانية مورا')
    setInputValue(getInput('رقم الهاتف'), '01012345678')
    setInputValue(getInput('عنوان العميل (اختياري)'), 'العنوان الجديد - ش ١')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('آجل')))
    expect(lastCreateOrderCall().customerInfo.address).toBe('العنوان الجديد - ش ١')
    unmount()
  })
})
