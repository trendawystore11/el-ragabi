import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import OrderModal from '@/ui/modals/OrderModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency } from '@/utils/formatters'

const PRODUCTS = [
  { id: 'P1', name: 'منتج أ', stock: 5, purchasePrice: 100, sellingPrice: 150, supplierId: 'S1', supplierName: 'مورد أ' },
  { id: 'P2', name: 'منتج ب', stock: 2, purchasePrice: 200, sellingPrice: 300 },
]

const SUPPLIERS = [
  { id: 'S1', name: 'مورد أ' },
  { id: 'S2', name: 'مورد ب' },
]

const CUSTOMER = {
  id: 'CUS-1',
  name: 'أحمد محمد',
  phone: '01012345678',
  secondaryPhone: '01198765432',
  category: 'تاجر جملة',
  notes: 'ملاحظة تسليم خاصة',
  address: 'القاهرة - مدينة نصر - شارع الميرغني',
}

const ADDRESSES = [
  { id: 'ADDR-1', label: 'المنزل', address: 'القاهرة - مدينة نصر - شارع الميرغني', isDefault: true },
]

function body() {
  return document.body
}

function mountModal() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openOrderModal()
    root.render(<OrderModal />)
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

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState({ orderModal: { open: false, onSuccess: null } })
  window.getProducts = vi.fn(() => PRODUCTS)
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.findCustomerByPhone = vi.fn(() => null)
  window.getCustomerAddresses = vi.fn(() => [])
  window.addCustomerAddress = vi.fn(() => ({ id: 'ADDR-NEW', label: '', address: '' }))
  window.createOrder = vi.fn(() => ({ id: 'ORD-NEW' }))
})

afterEach(() => {
  useUiStore.setState({ orderModal: { open: false, onSuccess: null } })
})

describe('OrderModal (ui/modals/OrderModal.jsx)', () => {
  it('يعرض النافذة بمنتج افتراضي وحساب تلقائي للمجموع والإجمالي', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('إنشاء طلب جديد / فاتورة بيع')
    expect(getSelect('المنتج *').value).toBe('P1')
    expect(body().textContent).toContain(formatCurrency(150))
    expect(body().textContent).toContain('حفظ وتأكيد الطلب')
    unmount()
  })

  it('حقل اسم العميل يظهر قبل رقم الهاتف في بيانات العميل', () => {
    const { unmount } = mountModal()
    const labels = Array.from(body().querySelectorAll('label'))
    const nameIdx = labels.findIndex(l => l.textContent.includes('اسم العميل *'))
    const phoneIdx = labels.findIndex(l => l.textContent.includes('رقم الهاتف *'))
    expect(nameIdx).toBeGreaterThan(-1)
    expect(phoneIdx).toBeGreaterThan(-1)
    expect(nameIdx).toBeLessThan(phoneIdx)
    unmount()
  })

  it('التعرف التلقائي على العميل من رقم الهاتف يعبئ البيانات ويقفل الاسم', () => {
    window.findCustomerByPhone = vi.fn(() => CUSTOMER)
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    expect(getInput('اسم العميل *').value).toBe('أحمد محمد')
    expect(getInput('رقم هاتف ثانوي').value).toBe('01198765432')
    expect(getSelect('تصنيف العميل *').value).toBe('تاجر جملة')
    expect(getInput('ملاحظات العميل').value).toBe('ملاحظة تسليم خاصة')
    expect(getSelect('المحافظة *').value).toBe('القاهرة')
    expect(getSelect('المدينة / المركز *').value).toBe('مدينة نصر')
    expect(getInput('تفاصيل العنوان / العلامة المميزة').value).toBe('شارع الميرغني')
    expect(getInput('اسم العميل *').disabled).toBe(true)
    expect(body().textContent).toContain('عميل مسجل حالياً')
    expect(lastToastMessage()).toContain('تم التعرف على العميل')
    unmount()
  })

  it('الرقم غير المسجل لا يمسح البيانات المكتوبة يدوياً لعميل جديد', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('اسم العميل *'), 'عميل جديد')
    setInputValue(getInput('رقم الهاتف *'), '01111111111')
    expect(getInput('اسم العميل *').value).toBe('عميل جديد')
    unmount()
  })

  it('عميل مسجل لديه عناوين: تعرض قائمة العناوين المحفوظة بدل الإدخال اليدوي', () => {
    window.findCustomerByPhone = vi.fn(() => CUSTOMER)
    window.getCustomerAddresses = vi.fn(() => ADDRESSES)
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    const addrSelect = getSelect('عنوان التوصيل')
    expect(addrSelect.value).toBe('ADDR-1')
    expect(body().textContent).toContain('المنزل — القاهرة - مدينة نصر - شارع الميرغني (الافتراضي)')
    expect(body().textContent).toContain('+ إضافة عنوان جديد')
    unmount()
  })

  it('إضافة عنوان جديد لعميل مسجل تُسجل وتظهر في القائمة', () => {
    let addresses = [...ADDRESSES]
    window.findCustomerByPhone = vi.fn(() => CUSTOMER)
    window.getCustomerAddresses = vi.fn(() => addresses)
    window.addCustomerAddress = vi.fn((id, data) => {
      const added = { id: 'ADDR-2', ...data }
      addresses = addresses.concat([added])
      return added
    })
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('+ إضافة عنوان جديد')))
    setInputValue(getInput('اسم العنوان'), 'المخزن')
    setSelectValue(getSelect('المدينة / المركز *'), 'المعادي')
    setInputValue(getInput('تفاصيل العنوان / العلامة المميزة'), 'شارع النصر')
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent === 'حفظ العنوان'))
    expect(window.addCustomerAddress).toHaveBeenCalledWith('CUS-1', {
      label: 'المخزن',
      address: 'القاهرة - المعادي - شارع النصر',
    })
    expect(getSelect('عنوان التوصيل').value).toBe('ADDR-2')
    expect(lastToastMessage()).toContain('تم حفظ العنوان الجديد')
    unmount()
  })

  it('عنوان يدوي جديد لعميل مسجل يُحفظ تلقائياً في ملفه (Auto-Update) مع الطلب', () => {
    window.findCustomerByPhone = vi.fn(() => CUSTOMER)
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    setSelectValue(getSelect('المدينة / المركز *'), 'المعادي')
    setInputValue(getInput('تفاصيل العنوان / العلامة المميزة'), 'شارع النصر')
    submitForm()
    expect(window.addCustomerAddress).toHaveBeenCalledWith('CUS-1', {
      label: 'عنوان الطلب',
      address: 'القاهرة - المعادي - شارع النصر',
    })
    expect(window.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerInfo: expect.objectContaining({
          address: 'القاهرة - المعادي - شارع النصر',
          addressId: 'ADDR-NEW',
        }),
      })
    )
    expect(useToastStore.getState().toasts.some(t => t.message.includes('تم حفظ العنوان الجديد في ملف العميل'))).toBe(true)
    unmount()
  })

  it('عنوان مطابق لما هو مسجل للعميل لا يُضاف مرة أخرى (لا تكرار)', () => {
    window.findCustomerByPhone = vi.fn(() => CUSTOMER)
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    submitForm()
    expect(window.addCustomerAddress).not.toHaveBeenCalled()
    expect(window.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerInfo: expect.objectContaining({ address: 'القاهرة - مدينة نصر - شارع الميرغني' }),
      })
    )
    unmount()
  })

  it('نوع العربون بقيمة الشحن يملأ الدفعة المقدمة تلقائياً ويقفلها', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('تكلفة الشحن (ج.م)'), '100')
    setSelectValue(getSelect('نوع العربون'), 'shipping')
    const dp = getInput('الدفعة المقدمة (اختياري)')
    expect(dp.value).toBe('100')
    expect(dp.disabled).toBe(true)
    expect(body().textContent).toContain('يُسجَّل الجزء الخاص بالشحن في حساب «إيراد خدمات شحن ونقل»')
    unmount()
  })

  it('لا تحتوي نافذة الطلب على مربع «وضع البيع الفوري» ويُمرَّر cashierMode false دائماً', async () => {
    const { unmount } = mountModal()
    expect(body().querySelector('input[aria-label="وضع البيع الفوري"]')).toBeNull()
    expect(body().textContent).not.toContain('وضع البيع الفوري (كاشير المعرض)')
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    setInputValue(getInput('اسم العميل *'), 'عميل معرض')
    submitForm()
    await act(async () => {})
    expect(window.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        cashierMode: false,
        status: 'new',
        downPayment: 0,
        customerInfo: expect.objectContaining({ name: 'عميل معرض' }),
      })
    )
    expect(useUiStore.getState().orderModal.open).toBe(false)
    unmount()
  })

  it('أقسام الشحن والعربون والدفعة تظهر دائماً (لا تُخفى بوضع كاشير محذوف)', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('تكاليف الشحن والمصروفات الإضافية')
    expect(body().textContent).toContain('نوع العربون (الدفعة المقدمة)')
    expect(body().textContent).toContain('حالة الطلب الإبتدائية')
    unmount()
  })

  it('مؤشر عجز المخزون ومديونية المورد تظهران عند كمية أكبر من الرصيد', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('الكمية *'), '10')
    expect(body().textContent).toContain('عجز 5 قطعة')
    expect(body().textContent).toContain('مورد أ (5 قطعة بسعر الشراء)')
    expect(body().textContent).toContain(formatCurrency(500))
    unmount()
  })

  it('الشحن المباشر يمنع الحفظ ما لم يُحدد مورد لكل سطر', () => {
    const { unmount } = mountModal()
    setSelectValue(getSelect('المنتج *'), 'P2')
    click(body().querySelector('input[aria-label="شحن مباشر من المورد"]'))
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    setInputValue(getInput('اسم العميل *'), 'اختبار')
    submitForm()
    expect(lastToastMessage()).toContain('للشحن المباشر من المورد يجب اختيار المورد المصنع لكل منتج')
    expect(window.createOrder).not.toHaveBeenCalled()
    unmount()
  })

  it('التحقق الصارم: دفعة مقدمة أكبر من إجمالي الفاتورة تمنع الحفظ', () => {
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    setInputValue(getInput('اسم العميل *'), 'اختبار')
    setInputValue(getInput('الدفعة المقدمة (اختياري)'), '9999')
    submitForm()
    expect(lastToastMessage()).toContain('لا يمكن أن تتجاوز إجمالي الفاتورة')
    expect(window.createOrder).not.toHaveBeenCalled()
    expect(useUiStore.getState().orderModal.open).toBe(true)
    unmount()
  })

  it('الحفظ الناجح يستدعي createOrder بالبيانات ويغلق النافذة', async () => {
    const { unmount } = mountModal()
    setInputValue(getInput('رقم الهاتف *'), '01012345678')
    setInputValue(getInput('اسم العميل *'), 'عبد الله')
    submitForm()
    await act(async () => {})
    expect(window.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'new',
        downPayment: 0,
        customerInfo: expect.objectContaining({ name: 'عبد الله', phone: '01012345678' }),
      })
    )
    expect(lastToastMessage()).toContain('تم حفظ وتأكيد الطلب رقم ORD-NEW')
    expect(useUiStore.getState().orderModal.open).toBe(false)
    unmount()
  })

  it('إضافة منتج آخر ثم حذفه يضيف/يزيل أسطراً ويُعيد الحساب', () => {
    const { unmount } = mountModal()
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج آخر')))
    expect(body().querySelectorAll('.product-item-row')).toHaveLength(2)
    const removeButtons = Array.from(body().querySelectorAll('.product-item-row button')).filter(b =>
      b.textContent.includes('حذف')
    )
    click(removeButtons[1])
    expect(body().querySelectorAll('.product-item-row')).toHaveLength(1)
    unmount()
  })

  it('اختيار منتج في سطر يخفيه فوراً من قائمة السطر الجديد (V3.56)', () => {
    const { unmount } = mountModal()
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج آخر')))
    const rows = body().querySelectorAll('.product-item-row')
    expect(rows).toHaveLength(2)
    const firstSelect = rows[0].querySelector('select')
    const secondSelect = rows[1].querySelector('select')
    expect(firstSelect.value).toBe('P1')
    expect(secondSelect.value).toBe('P2')
    const secondOpts = Array.from(secondSelect.querySelectorAll('option')).map(o => o.textContent).join(' ')
    expect(secondOpts).not.toContain('منتج أ')
    expect(secondOpts).toContain('منتج ب')
    const firstOpts = Array.from(firstSelect.querySelectorAll('option')).map(o => o.textContent).join(' ')
    expect(firstOpts).toContain('منتج أ')
    unmount()
  })

  it('حذف سطر يعيد منتجه لقائمة الاختيار عند إضافة سطر جديد (V3.56)', () => {
    const { unmount } = mountModal()
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج آخر')))
    let rows = body().querySelectorAll('.product-item-row')
    const removeBtn = Array.from(rows[1].querySelectorAll('button')).find(b => b.textContent.includes('حذف'))
    click(removeBtn)
    rows = body().querySelectorAll('.product-item-row')
    expect(rows).toHaveLength(1)
    click(Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج آخر')))
    rows = body().querySelectorAll('.product-item-row')
    const newSecond = rows[1].querySelector('select')
    expect(newSecond.value).toBe('P2')
    const newSecondOpts = Array.from(newSecond.querySelectorAll('option')).map(o => o.textContent).join(' ')
    expect(newSecondOpts).toContain('منتج ب')
    expect(newSecondOpts).not.toContain('منتج أ')
    unmount()
  })

  it('عند عدم وجود منتجات تظهر تنبيه', () => {
    window.getProducts = vi.fn(() => [])
    const { unmount } = mountModal()
    expect(useToastStore.getState().toasts.some(t => t.message.includes('يرجى إدخال منتج واحد على الأقل'))).toBe(true)
    unmount()
  })
})
