// =============================================================================
// اختبارات نافذتي تعديل قيد الدفعة وتعديل المديونية — V3.63
// =============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import PaymentEditModal from '@/ui/modals/PaymentEditModal'
import DebtEditModal from '@/ui/modals/DebtEditModal'
import { useUiStore } from '@/ui/state/uiStore'
import { usePaymentsStore } from '@/state/paymentsStore'
import { useToastStore } from '@/ui/components/toastStore'

const PAYMENT = { id: 'PAY-001', entityType: 'supplier', entityId: 'SUP-1', entityName: 'مصنع النور للأقمشة', amount: 400, paymentMethod: 'transfer', notes: 'دفعة مورد', date: '2026-08-02', createdAt: '2026-08-02T10:00:00' }
const CUSTOMER = { id: 'CUST-1', name: 'أحمد محمد', phone: '01012345678', totalPurchases: 1000, paid: 400, remainingBalance: 600 }
const SUPPLIER = { id: 'SUP-1', name: 'مصنع النور للأقمشة', totalPurchases: 1000, paid: 400, remainingBalance: 600 }

function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(node) })
  return {
    host,
    unmount() {
      act(() => { root.unmount() })
      host.remove()
    },
  }
}

function click(el) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function getInput(labelText, root = document) {
  const labels = Array.from(root.querySelectorAll('label'))
  const label = labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function modalButtons() {
  return Array.from(document.body.querySelectorAll('button'))
}

const RESET_UI = {
  paymentEditModal: { open: false, paymentId: null, onDone: null },
  debtEditModal: { open: false, entityType: null, entityId: null, onDone: null },
}

beforeEach(() => {
  useUiStore.setState(RESET_UI)
  usePaymentsStore.setState({ payments: [], ready: false, search: '' })
  useToastStore.setState({ toasts: [] })
  window.getPayments = vi.fn(() => [PAYMENT])
  window.getCustomerById = vi.fn(() => CUSTOMER)
  window.getSupplierById = vi.fn(() => SUPPLIER)
  window.updatePaymentRecord = vi.fn(() => ({ id: 'PAY-001' }))
  window.adjustCustomerDebt = vi.fn(() => CUSTOMER)
  window.adjustSupplierDebt = vi.fn(() => SUPPLIER)
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
  usePaymentsStore.setState({ payments: [], ready: false, search: '' })
  useToastStore.setState({ toasts: [] })
})

describe('PaymentEditModal', () => {
  it('يعرض بيانات القيد الحالية ويملأ المبلغ', () => {
    useUiStore.setState({ paymentEditModal: { open: true, paymentId: 'PAY-001', onDone: null } })
    const { unmount } = mount(<PaymentEditModal />)
    expect(document.body.textContent).toContain('PAY-001')
    expect(document.body.textContent).toContain('مصنع النور للأقمشة')
    expect(getInput('المبلغ').value).toBe('400')
    unmount()
  })

  it('الحفظ يستدعي updatePaymentRecord ويغلق النافذة', async () => {
    useUiStore.setState({ paymentEditModal: { open: true, paymentId: 'PAY-001', onDone: null } })
    const { unmount } = mount(<PaymentEditModal />)
    setInputValue(getInput('المبلغ'), '550')
    await act(async () => {
      modalButtons().find(b => b.textContent.includes('حفظ التعديل')).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(window.updatePaymentRecord).toHaveBeenCalledWith('PAY-001', expect.objectContaining({ amount: 550 }))
    expect(useUiStore.getState().paymentEditModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم تعديل قيد الدفعة')
    unmount()
  })

  it('يحجب الدفعة المرتبطة بفاتورة ويعرض تنبيهاً', () => {
    window.getPayments = vi.fn(() => [{ ...PAYMENT, id: 'PAY-ORD', refOrderId: 'ORD-1' }])
    useUiStore.setState({ paymentEditModal: { open: true, paymentId: 'PAY-ORD', onDone: null } })
    const { unmount } = mount(<PaymentEditModal />)
    expect(document.body.textContent).toContain('مرتبطة بفاتورة')
    expect(modalButtons().find(b => b.textContent.includes('حفظ التعديل'))).toBeUndefined()
    unmount()
  })
})

describe('DebtEditModal', () => {
  it('عميل: يملأ الرصيدين ويحفظ عبر adjustCustomerDebt', () => {
    useUiStore.setState({ debtEditModal: { open: true, entityType: 'customer', entityId: 'CUST-1', onDone: null } })
    const { unmount } = mount(<DebtEditModal />)
    expect(getInput('المسدد').value).toBe('400')
    expect(getInput('الرصيد المتبقي على العميل').value).toBe('600')
    setInputValue(getInput('المسدد'), '250')
    setInputValue(getInput('الرصيد المتبقي على العميل'), '750')
    click(modalButtons().find(b => b.textContent.includes('حفظ تعديل المديونية')))
    expect(window.adjustCustomerDebt).toHaveBeenCalledWith('CUST-1', { paid: 250, remainingBalance: 750 })
    expect(useUiStore.getState().debtEditModal.open).toBe(false)
    unmount()
  })

  it('مورد: يحفظ عبر adjustSupplierDebt', () => {
    useUiStore.setState({ debtEditModal: { open: true, entityType: 'supplier', entityId: 'SUP-1', onDone: null } })
    const { unmount } = mount(<DebtEditModal />)
    setInputValue(getInput('الرصيد المستحق للمورد'), '300')
    click(modalButtons().find(b => b.textContent.includes('حفظ تعديل المديونية')))
    expect(window.adjustSupplierDebt).toHaveBeenCalledWith('SUP-1', { paid: 400, remainingBalance: 300 })
    unmount()
  })

  it('عميل: يرفض الرصيد السالب', () => {
    useUiStore.setState({ debtEditModal: { open: true, entityType: 'customer', entityId: 'CUST-1', onDone: null } })
    const { unmount } = mount(<DebtEditModal />)
    setInputValue(getInput('الرصيد المتبقي على العميل'), '-5')
    click(modalButtons().find(b => b.textContent.includes('حفظ تعديل المديونية')))
    expect(window.adjustCustomerDebt).not.toHaveBeenCalled()
    unmount()
  })
})
