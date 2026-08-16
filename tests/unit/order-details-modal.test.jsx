import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import OrderDetailsModal from '@/ui/modals/OrderDetailsModal'
import { useUiStore } from '@/ui/state/uiStore'
import { formatCurrency } from '@/utils/formatters'

const ORDER = {
  id: 'ORD-001',
  customerName: 'أحمد محمد',
  customerPhone: '01012345678',
  customerSecondaryPhone: '01198765432',
  status: 'delivered',
  items: [
    { productName: 'منتج أ', quantity: 2, purchasePrice: 100, sellingPrice: 150, subtotal: 300 },
    { productName: 'منتج ب', quantity: 1, purchasePrice: 200, sellingPrice: 300, subtotal: 300 },
  ],
  itemsSubtotal: 600,
  shippingCost: 100,
  shippingPayer: 'merchant',
  extraExpenses: 50,
  extraExpensesPayer: 'merchant',
  downPayment: 300,
  depositType: 'custom',
  totalAmount: 600,
  createdAt: '2026-01-01T10:00:00',
  supplierDeficits: [{ supplierName: 'مورد أ', productName: 'منتج أ', units: 1, amount: 100 }],
  supplierShipments: [{ supplierName: 'مورد ب', productName: 'منتج ب', units: 1, amount: 200 }],
}

const originalOpen = window.open

function body() {
  return document.body
}

function mountModal(orderId = 'ORD-001') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    useUiStore.getState().openOrderDetailsModal(orderId)
    root.render(<OrderDetailsModal />)
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

beforeEach(() => {
  useUiStore.setState({ orderDetailsModal: { open: false, orderId: null } })
  window.getOrderById = vi.fn(() => ({ ...ORDER }))
})

afterEach(() => {
  window.open = originalOpen
  useUiStore.setState({ orderDetailsModal: { open: false, orderId: null } })
})

describe('OrderDetailsModal (ui/modals/OrderDetailsModal.jsx)', () => {
  it('يعرض العنوان وبيانات العميل والمنتجات والمجموع والمتبقي', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('تفاصيل فاتورة رقم: ORD-001')
    expect(body().textContent).toContain('أحمد محمد')
    expect(body().textContent).toContain('01012345678')
    expect(body().textContent).toContain('01198765432')
    expect(body().textContent).toContain('تم التوصيل')
    expect(body().textContent).toContain('منتج أ')
    expect(body().textContent).toContain('منتج ب')
    expect(body().textContent).toContain(formatCurrency(300))
    expect(body().textContent).toContain(formatCurrency(600))
    expect(body().textContent).toContain(formatCurrency(100))
    unmount()
  })

  it('يحسب التحليل المالي: صافي الربح 50 ج.م وتكلفة البضاعة 400 ج.م', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('صافي الربح')
    expect(body().textContent).toContain(formatCurrency(50))
    expect(body().textContent).toContain(formatCurrency(400))
    expect(body().textContent).toContain(formatCurrency(150))
    unmount()
  })

  it('يعرض مديونية عجز المخزون وشحنات التوريد المباشر المسجلة على المورد', () => {
    const { unmount } = mountModal()
    expect(body().textContent).toContain('مديونية للمورد')
    expect(body().textContent).toContain('مورد أ - منتج أ (1 قطعة)')
    expect(body().textContent).toContain('شحنات توريد مباشر مسجلة على المورد')
    expect(body().textContent).toContain('مورد ب - منتج ب (1 قطعة)')
    unmount()
  })

  it('زر طباعة الفاتورة يفتح نافذة طباعة بمحتوى الفاتورة ويستدعي print', () => {
    const fakeWin = {
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    }
    window.open = vi.fn(() => fakeWin)
    const { unmount } = mountModal()
    const printBtn = Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes('طباعة الفاتورة'))
    click(printBtn)
    expect(window.open).toHaveBeenCalledWith('', '_blank', 'width=800,height=600')
    expect(fakeWin.document.write).toHaveBeenCalled()
    expect(fakeWin.print).toHaveBeenCalled()
    const written = fakeWin.document.write.mock.calls[0][0]
    expect(written).toContain('فاتورة بيع')
    expect(written).toContain('ORD-001')
    unmount()
  })

  it('زر إغلاق يغلق النافذة', () => {
    const { unmount } = mountModal()
    const closeBtn = Array.from(body().querySelectorAll('button')).find(b => b.textContent === 'إغلاق')
    click(closeBtn)
    expect(useUiStore.getState().orderDetailsModal.open).toBe(false)
    unmount()
  })

  it('عند عدم العثور على الطلب يظهر تنبيه', () => {
    window.getOrderById = vi.fn(() => null)
    const { unmount } = mountModal()
    expect(body().textContent).toContain('لم يتم العثور على الطلب المطلوب')
    unmount()
  })
})
