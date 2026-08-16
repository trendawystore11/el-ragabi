import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import StatementModal from '@/ui/modals/StatementModal'
import { useUiStore } from '@/ui/state/uiStore'
import { formatCurrency } from '@/utils/formatters'

const CUSTOMER = { id: 'CUST-001', name: 'أحمد محمد', phone: '01012345678', secondaryPhone: '', address: 'القاهرة - مدينة نصر', remainingBalance: 600 }

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

function openStatement(entityType, entityId) {
  act(() => {
    useUiStore.setState({ statementModal: { open: true, entityType, entityId } })
  })
}

beforeEach(() => {
  useUiStore.setState({ statementModal: { open: false, entityType: null, entityId: null } })
  window.round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100
  window.getCustomerById = vi.fn(() => null)
  window.getSupplierById = vi.fn(() => null)
  window.getOrders = vi.fn(() => [])
  window.getPaymentsByEntity = vi.fn(() => [])
  window.getSupplierTransactionsBySupplier = vi.fn(() => [])
})

afterEach(() => {
  useUiStore.setState({ statementModal: { open: false, entityType: null, entityId: null } })
})

describe('StatementModal (ui/modals/StatementModal.jsx)', () => {
  it('كشف حساب عميل يعرض الرأس والجدول والرصيد الختامي المطابق للرصيد المخزن', () => {
    window.getCustomerById = vi.fn(() => CUSTOMER)
    window.getOrders = vi.fn(() => [
      { id: 'ORD-1', customerId: 'CUST-001', status: 'delivered', createdAt: '2024-01-01 10:00:00', totalAmount: 1000, items: [{ productName: 'بطانية', quantity: 2 }] },
    ])
    window.getPaymentsByEntity = vi.fn((type, id) => [
      { id: 'PAY-1', amount: 400, createdAt: '2024-01-02 11:00:00', isDownPayment: false, notes: 'دفعة نقدية' },
    ])

    const { unmount } = mount(<StatementModal />)
    openStatement('customer', 'CUST-001')
    expect(document.body.textContent).toContain('كشف حساب مصرفي: أحمد محمد')
    expect(document.body.textContent).toContain('أحمد محمد')
    expect(document.body.textContent).toContain('01012345678')
    expect(document.body.textContent).toContain('الرصيد المتبقي على العميل')
    expect(document.body.textContent).toContain(formatCurrency(600))
    expect(document.body.textContent).toContain(`مستحق على العميل (${formatCurrency(600)})`)

    expect(document.body.textContent).toContain('فاتورة')
    expect(document.body.textContent).toContain('ORD-1')
    expect(document.body.textContent).toContain('بطانية x2')
    expect(document.body.textContent).toContain('تحصيل دفعة')
    expect(document.body.textContent).toContain('PAY-1')
    expect(document.body.textContent).toContain('الإجمالي الختامي')
    unmount()
  })

  it('صف التسوية الافتتاحية يمتص الفرق حتى يطابق الرصيد الختامي الرصيد المخزن', () => {
    window.getCustomerById = vi.fn(() => ({ ...CUSTOMER, remainingBalance: 900 }))
    window.getOrders = vi.fn(() => [
      { id: 'ORD-1', customerId: 'CUST-001', status: 'delivered', createdAt: '2024-01-01 10:00:00', totalAmount: 1000, items: [] },
    ])
    window.getPaymentsByEntity = vi.fn(() => [
      { id: 'PAY-1', amount: 400, createdAt: '2024-01-02 11:00:00', isDownPayment: false, notes: '' },
    ])

    const { unmount } = mount(<StatementModal />)
    openStatement('customer', 'CUST-001')
    expect(document.body.textContent).toContain('تسوية افتتاحية')
    const balances = Array.from(document.body.querySelectorAll('tbody tr td:last-child')).map(td => td.textContent)
    expect(balances[balances.length - 1]).toContain(formatCurrency(900))
    unmount()
  })

  it('كشف حساب مورد يعرض الرصيد المستحق للمورد مع حركات السجل التفصيلي', () => {
    window.getSupplierById = vi.fn(() => ({ id: 'SUP-1', name: 'مصنع النور', phone: '01234567890', secondaryPhone: '', address: 'المنصورة', remainingBalance: 500 }))
    window.getSupplierTransactionsBySupplier = vi.fn(() => [
      { id: 'T-1', createdAt: '2024-02-01 09:00:00', type: 'شحنة توريد', refId: 'SHIP-1', note: 'توريد قماش', debit: 800, credit: 0 },
      { id: 'T-2', createdAt: '2024-02-02 10:00:00', type: 'تسديد دفعة', refId: 'PAY-S-1', note: '', debit: 0, credit: 300 },
    ])

    const { unmount } = mount(<StatementModal />)
    openStatement('supplier', 'SUP-1')
    expect(document.body.textContent).toContain('كشف حساب مورد: مصنع النور')
    expect(document.body.textContent).toContain('الرصيد المستحق للمورد')
    expect(document.body.textContent).toContain(`مستحق للمورد (${formatCurrency(500)})`)
    expect(document.body.textContent).toContain('شحنة توريد')
    expect(document.body.textContent).toContain('SHIP-1')
    expect(document.body.textContent).toContain('تسديد دفعة')
    const balances = Array.from(document.body.querySelectorAll('tbody tr td:last-child')).map(td => td.textContent)
    expect(balances[balances.length - 1]).toContain(formatCurrency(500))
    unmount()
  })

  it('المبالغ المستردة تظهر بعلامة سالب بنمط المرتجع', () => {
    window.getCustomerById = vi.fn(() => CUSTOMER)
    window.getPaymentsByEntity = vi.fn(() => [
      { id: 'REF-1', amount: -50, createdAt: '2024-01-03 12:00:00', isDownPayment: false, notes: '' },
    ])
    const { unmount } = mount(<StatementModal />)
    openStatement('customer', 'CUST-001')
    expect(document.body.textContent).toContain('استرداد / رد مبلغ')
    expect(document.body.textContent).toContain(`−${formatCurrency(50)}`)
    unmount()
  })

  it('كشف بلا حركات يعرض رسالة فارغة', () => {
    window.getCustomerById = vi.fn(() => ({ ...CUSTOMER, remainingBalance: 0 }))
    const { unmount } = mount(<StatementModal />)
    openStatement('customer', 'CUST-001')
    expect(document.body.textContent).toContain('لا توجد فواتير أو دفعات مسجلة لهذا العميل')
    unmount()
  })

  it('زر إغلاق يغلق النافذة', () => {
    window.getCustomerById = vi.fn(() => CUSTOMER)
    const { unmount } = mount(<StatementModal />)
    openStatement('customer', 'CUST-001')
    expect(useUiStore.getState().statementModal.open).toBe(true)
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('إغلاق')))
    expect(useUiStore.getState().statementModal.open).toBe(false)
    unmount()
  })

  it('لا يعرض شيئاً عند إغلاق النافذة', () => {
    const { unmount } = mount(<StatementModal />)
    expect(document.querySelectorAll('.modal-animate')).toHaveLength(0)
    unmount()
  })
})
