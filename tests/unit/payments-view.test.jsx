import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import PaymentsView from '@/ui/views/PaymentsView'
import PaymentModal from '@/ui/modals/PaymentModal'
import { usePaymentsStore } from '@/state/paymentsStore'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency, getCairoFormattedDate } from '@/utils/formatters'

const TODAY = getCairoFormattedDate().slice(0, 10)
const ADMIN = { id: 'USR-1001', email: 'admin@store.com', role: 'admin' }

const PAYMENTS = [
  { id: 'PAY-001', entityType: 'customer', entityId: 'CUST-1', entityName: 'أحمد محمد', amount: 1100, paymentMethod: 'cash', notes: 'سداد كامل الحساب', createdBy: 'المدير العام', createdAt: '2026-08-01T10:00:00' },
  { id: 'PAY-002', entityType: 'supplier', entityId: 'SUP-1', entityName: 'مصنع النور للأقمشة', amount: 400, paymentMethod: 'transfer', notes: 'دفعة مورد', createdAt: '2026-08-02T10:00:00' },
  { id: 'PAY-003', entityType: 'customer', entityId: 'CUST-2', entityName: 'سارة علي', amount: -120, paymentMethod: 'cash', notes: 'استرداد عربون', createdAt: '2026-08-03T10:00:00' },
]

const CUSTOMERS = [
  { id: 'CUST-1', name: 'أحمد محمد', phone: '01012345678', remainingBalance: 600 },
  { id: 'CUST-2', name: 'سارة علي', phone: '01198765432', remainingBalance: 300 },
]

const SUPPLIERS = [
  { id: 'SUP-1', name: 'مصنع النور للأقمشة', remainingBalance: 1000 },
  { id: 'SUP-2', name: 'مصنع الراجحي للمنسوجات', remainingBalance: -800 },
]

function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
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
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

function getInput(labelText, root = document) {
  const labels = Array.from(root.querySelectorAll('label'))
  const label =
    labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText)) ||
    labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function getSelect(labelText, root = document) {
  const el = getInput(labelText, root)
  if (el.tagName !== 'SELECT') throw new Error(`expected select for: ${labelText}`)
  return el
}

const RESET_PAYMENTS = { payments: [], ready: false, search: '' }

const RESET_UI = {
  orderModal: { open: false, onSuccess: null },
  orderDetailsModal: { open: false, orderId: null },
  orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null },
  customerModal: { open: false, customerId: null, onDone: null },
  productModal: { open: false, productId: null, onDone: null },
  shipmentModal: { open: false, productId: null, onDone: null },
  supplierModal: { open: false, supplierId: null, onDone: null },
  supplierReturnModal: { open: false, supplierId: null, onDone: null },
  expenseModal: { open: false, expenseId: null, onDone: null },
  wipeDatabaseModal: { open: false },
  paymentModal: { open: false, defaults: null, onDone: null },
}

beforeEach(() => {
  usePaymentsStore.setState(RESET_PAYMENTS)
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
  window.getPayments = vi.fn(() => PAYMENTS)
  window.getCustomers = vi.fn(() => CUSTOMERS)
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.getCurrentUser = vi.fn(() => ADMIN)
  window.createPaymentRecord = vi.fn(() => ({ id: 'PAY-NEW' }))
})

afterEach(() => {
  usePaymentsStore.setState(RESET_PAYMENTS)
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
})

describe('PaymentsView (ui/views/PaymentsView.jsx)', () => {
  it('يعرض الهيدر والجدول بكل الدفعات والشارات والألوان', () => {
    const { host, unmount } = mount(<PaymentsView />)
    expect(host.textContent).toContain('إدارة التحصيلات والمدفوعات')
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)

    expect(rows[0].textContent).toContain('PAY-003')
    expect(rows[0].textContent).toContain('استرداد / رد عربون (صادر)')
    expect(rows[0].textContent).toContain('سارة علي')
    expect(rows[0].textContent).toContain(formatCurrency(-120))
    const amountCell = Array.from(rows[0].querySelectorAll('td')).find(td =>
      td.classList.contains('text-rose-400')
    )
    expect(amountCell).toBeTruthy()
    expect(rows[0].textContent).toContain('2026-08-03')

    expect(rows[1].textContent).toContain('PAY-002')
    expect(rows[1].textContent).toContain('تسديد لمورد')
    expect(rows[1].textContent).toContain('مصنع النور للأقمشة')
    expect(rows[1].textContent).toContain(formatCurrency(400))
    expect(rows[1].textContent).toContain('تحويل بنكي / فودافون كاش')

    expect(rows[2].textContent).toContain('PAY-001')
    expect(rows[2].textContent).toContain('تحصيل من عميل')
    expect(rows[2].textContent).toContain('أحمد محمد')
    expect(rows[2].textContent).toContain(formatCurrency(1100))
    expect(rows[2].textContent).toContain('نقدي (كاش)')
    expect(rows[2].textContent).toContain('سداد كامل الحساب')
    expect(rows[2].textContent).toContain('2026-08-01')
    expect(rows[2].textContent).toContain('المدير العام')
    unmount()
  })

  it('البحث بالاسم يفلتر الصفوف فوراً ويعرض حالة عدم التطابق', () => {
    const { host, unmount } = mount(<PaymentsView />)
    const searchInput = host.querySelector('input')
    setInputValue(searchInput, 'مصنع النور')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('مصنع النور للأقمشة')
    expect(host.textContent).not.toContain('أحمد محمد')

    setInputValue(searchInput, 'لا شيء')
    expect(host.textContent).toContain('لا توجد مدفوعات مسجلة مطابقة للبحث')
    unmount()
  })

  it('زر تسجيل دفعة جديدة يفتح نافذة تسجيل الدفعة للمدير', () => {
    const { host, unmount } = mount(<PaymentsView />)
    const recordBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تسجيل دفعة جديدة'))
    click(recordBtn)
    expect(useUiStore.getState().paymentModal.open).toBe(true)
    expect(useUiStore.getState().paymentModal.defaults).toMatchObject({ entityType: 'customer', entityId: null })
    unmount()
  })

  it('غير المدير يُمنع من فتح النافذة مع تنبيه الحظر', () => {
    window.getCurrentUser = vi.fn(() => ({ id: 'USR-2', email: 'emp@store.com', role: 'employee' }))
    const { host, unmount } = mount(<PaymentsView />)
    const recordBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تسجيل دفعة جديدة'))
    click(recordBtn)
    expect(useUiStore.getState().paymentModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تسجيل الدفعات متاح للمدير والمحاسب فقط')
    unmount()
  })

  it('يعرض رسالة فارغة عند عدم وجود دفعات', () => {
    window.getPayments = vi.fn(() => [])
    const { host, unmount } = mount(<PaymentsView />)
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('لا توجد مدفوعات مسجلة مطابقة للبحث')
    unmount()
  })
})

describe('PaymentModal (ui/modals/PaymentModal.jsx)', () => {
  function openModal(defaults = { entityType: 'customer', entityId: null }) {
    useUiStore.setState({ paymentModal: { open: true, defaults, onDone: null } })
  }

  // النافذة تُعرض عبر createPortal في #modal-container (داخل document.body)
  function modalButtons() {
    return Array.from(document.body.querySelectorAll('button'))
  }

  it('يعرض النموذج بخيارات العملاء ورصيدهم المتبقي وزر تعبئة كامل المديونية يملأ المبلغ', () => {
    openModal()
    const { host, unmount } = mount(<PaymentModal />)
    expect(document.body.textContent).toContain('تسجيل دفعة / إيصال قبض أو دفع')
    expect(document.body.textContent).toContain('أحمد محمد (01012345678)')
    expect(document.body.textContent).toContain(`الرصيد المتبقي عليه: ${formatCurrency(600)}`)
    expect(document.body.textContent).toContain('سداد كامل المديونية المتبقية ⚡')

    click(modalButtons().find(b => b.textContent.includes('سداد كامل المديونية المتبقية')))
    expect(getInput('المبلغ', document).value).toBe('600')
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم تعبئة المبلغ بالكامل تلقائياً')
    unmount()
  })

  it('إدخال مبلغ زائد عن المديونية يعرض تحذيراً ويملأ تلقائياً بالمبلغ المتبقي', () => {
    openModal()
    const { host, unmount } = mount(<PaymentModal />)
    setInputValue(getInput('المبلغ', document), '9999')
    expect(getInput('المبلغ', document).value).toBe('600')
    expect(document.body.textContent).toContain('تم تعبئة الخانة تلقائياً بالمبلغ المتبقي')
    unmount()
  })

  it('الحفظ يستدعي createPaymentRecord بالبيانات الصحيحة ويغلق النافذة ويحدّث المخزن', () => {
    openModal()
    const { host, unmount } = mount(<PaymentModal />)
    click(modalButtons().find(b => b.textContent.includes('سداد كامل المديونية المتبقية')))
    click(modalButtons().find(b => b.textContent.includes('تسجيل الدفعة وتحديث الرصيد')))

    expect(window.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'customer',
        entityId: 'CUST-1',
        entityName: 'أحمد محمد',
        amount: 600,
        paymentMethod: 'cash',
      })
    )
    expect(useUiStore.getState().paymentModal.open).toBe(false)
    expect(usePaymentsStore.getState().ready).toBe(true)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم تسجيل الدفعة وتحديث رصيد الحساب بنجاح')
    unmount()
  })

  it('تبديل نوع العملية إلى مورد يعرض الموردين ويحفظ كتسديد لمورد', () => {
    openModal()
    const { host, unmount } = mount(<PaymentModal />)
    setSelectValue(getSelect('نوع العملية', document), 'supplier')
    expect(document.body.textContent).toContain('مصنع النور للأقمشة')
    expect(document.body.textContent).toContain(`الرصيد المستحق له: ${formatCurrency(1000)}`)
    expect(getSelect('المورد / المصنع', document).value).toBe('SUP-1')

    click(modalButtons().find(b => b.textContent.includes('سداد كامل المديونية المتبقية')))
    expect(getInput('المبلغ', document).value).toBe('1000')
    click(modalButtons().find(b => b.textContent.includes('تسجيل الدفعة وتحديث الرصيد')))

    expect(window.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'supplier',
        entityId: 'SUP-1',
        entityName: 'مصنع النور للأقمشة',
        amount: 1000,
      })
    )
    unmount()
  })

  it('وضع تحصيل نقدية من مورد مدين لنا (supplier_collect) يعرض أصحاب الرصيد السالب فقط ويحفظ كقبض', () => {
    openModal({ entityType: 'supplier_collect', entityId: null })
    const { host, unmount } = mount(<PaymentModal />)
    expect(document.body.textContent).toContain('تحصيل نقدية من مورد / مصنع مدين لنا (قبض)')
    expect(document.body.textContent).toContain('مصنع الراجحي للمنسوجات')
    expect(document.body.textContent).toContain(`المبلغ المستحق لنا منه: ${formatCurrency(800)}`)
    expect(document.body.textContent).not.toContain('مصنع النور للأقمشة')

    click(modalButtons().find(b => b.textContent.includes('تحصيل كامل المبلغ المستحق لنا')))
    expect(getInput('المبلغ', document).value).toBe('800')
    click(modalButtons().find(b => b.textContent.includes('تحصيل المبلغ وتحديث الرصيد')))

    expect(window.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'supplier',
        entityId: 'SUP-2',
        entityName: 'مصنع الراجحي للمنسوجات',
        amount: 800,
        isCollection: true,
      })
    )
    unmount()
  })

  it('مورد بلا رصيد سالب يستبعد تماماً من وضع التحصيل', () => {
    openModal({ entityType: 'supplier_collect', entityId: null })
    const { host, unmount } = mount(<PaymentModal />)
    expect(getSelect('المورد / المصنع', document).value).toBe('SUP-2')
    unmount()
  })

  it('يعرض تاريخ اليوم (القاهرة) كافتراضي في حقل التاريخ', () => {
    openModal()
    const { host, unmount } = mount(<PaymentModal />)
    expect(getInput('التاريخ', document).value).toBe(TODAY)
    unmount()
  })
})
