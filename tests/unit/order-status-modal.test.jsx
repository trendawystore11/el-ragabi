import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import OrderStatusModal from '@/ui/modals/OrderStatusModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatCurrency } from '@/utils/formatters'

const ORDER_NEW = { id: 'ORD-001', status: 'new', downPayment: 100, refundedAmount: 0 }
const ORDER_DELIVERED = { id: 'ORD-002', status: 'delivered', downPayment: 100, refundedAmount: 0 }
const ORDER_CANCELLED = { id: 'ORD-003', status: 'cancelled', downPayment: 100, refundedAmount: 40 }

function body() {
  return document.body
}

function mountModal(orderId, currentStatus, onDone = null) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openOrderStatusModal(orderId, currentStatus, onDone)
    root.render(<OrderStatusModal />)
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
  orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null },
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  window.getOrderById = vi.fn(() => ({ ...ORDER_NEW }))
  window.updateOrderStatus = vi.fn(() => ({ ...ORDER_NEW }))
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
})

describe('OrderStatusModal (ui/modals/OrderStatusModal.jsx)', () => {
  it('يعرض خيارات الحالات المسموحة من آلة الحالات فقط (new → delivered/completed/cancelled)', () => {
    const { unmount } = mountModal('ORD-001', 'new')
    expect(body().textContent).toContain('تحديث حالة الطلب رقم: ORD-001')
    const select = getSelect('اختر الحالة الجديدة *')
    const values = Array.from(select.querySelectorAll('option')).map(o => o.value)
    expect(values).toEqual(['delivered', 'completed', 'cancelled'])
    expect(select.value).toBe('delivered')
    unmount()
  })

  it('إلغاء طلب مع استرداد كامل العربون يستدعي updateOrderStatus وينفّذ onDone ويغلق', async () => {
    const onDone = vi.fn()
    const { unmount } = mountModal('ORD-001', 'new', onDone)
    setSelectValue(getSelect('اختر الحالة الجديدة *'), 'cancelled')
    click(body().querySelector('input[aria-label="استرداد مبلغ من العربون للعميل"]'))
    submitForm()
    await act(async () => {})
    expect(window.updateOrderStatus).toHaveBeenCalledWith('ORD-001', 'cancelled', 100, 0)
    expect(lastToastMessage()).toContain('تم إلغاء الطلب ORD-001 واسترداد')
    expect(onDone).toHaveBeenCalled()
    expect(useUiStore.getState().orderStatusModal.open).toBe(false)
    unmount()
  })

  it('مبلغ استرداد خارج المدى (1..العربون) يمنع التحديث مع رسالة خطأ', () => {
    window.getOrderById = vi.fn(() => ({ ...ORDER_DELIVERED }))
    const onDone = vi.fn()
    const { unmount } = mountModal('ORD-002', 'delivered', onDone)
    setSelectValue(getSelect('اختر الحالة الجديدة *'), 'returned')
    click(body().querySelector('input[aria-label="استرداد مبلغ من العربون للعميل"]'))
    setInputValue(getInput('المبلغ المسترد'), '999')
    submitForm()
    expect(lastToastMessage()).toContain(`المبلغ المسترد يجب أن يكون من 1 حتى ${formatCurrency(100)}`)
    expect(window.updateOrderStatus).not.toHaveBeenCalled()
    expect(useUiStore.getState().orderStatusModal.open).toBe(true)
    unmount()
  })

  it('إعادة تفعيل طلب ملغي تُسجّل العربون المستلم الفعلي', async () => {
    window.getOrderById = vi.fn(() => ({ ...ORDER_CANCELLED }))
    const onDone = vi.fn()
    const { unmount } = mountModal('ORD-003', 'cancelled', onDone)
    const select = getSelect('اختر الحالة الجديدة *')
    const values = Array.from(select.querySelectorAll('option')).map(o => o.value)
    expect(values).toEqual(['new'])
    expect(body().textContent).toContain('جديد (إعادة تفعيل)')
    const reActInput = getInput('مبلغ العربون المستلم عند إعادة التفعيل')
    expect(reActInput.value).toBe('60')
    setInputValue(reActInput, '75')
    submitForm()
    await act(async () => {})
    expect(window.updateOrderStatus).toHaveBeenCalledWith('ORD-003', 'new', 0, 75)
    expect(lastToastMessage()).toContain('تم تحديث حالة الفاتورة رقم ORD-003 إلى (new) بنجاح')
    expect(onDone).toHaveBeenCalled()
    unmount()
  })

  it('عند عدم العثور على الطلب يظهر تنبيه', () => {
    window.getOrderById = vi.fn(() => null)
    const { unmount } = mountModal('ORD-999', 'new')
    expect(body().textContent).toContain('لم يتم العثور على الطلب المطلوب')
    unmount()
  })
})
