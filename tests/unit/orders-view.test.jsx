import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import OrdersView from '@/ui/views/OrdersView'
import { useOrdersStore } from '@/state/ordersStore'
import { useUiStore } from '@/ui/state/uiStore'
import { useAuthStore } from '@/state/authStore'
import { getCairoFormattedDate } from '@/utils/formatters'

const SEED = [
  { id: 'ORD-001', customerName: 'أحمد محمد', customerPhone: '01012345678', customerSecondaryPhone: '', address: 'القاهرة', totalAmount: 1000, downPayment: 400, shippingCost: 50, status: 'new', depositType: 'shipping', createdAt: '2026-01-01T10:00:00' },
  { id: 'ORD-002', customerName: 'سارة علي', customerPhone: '01198765432', totalAmount: 2500, downPayment: 2500, shippingCost: 100, status: 'completed', depositType: 'cash', createdAt: '2026-01-02T10:00:00' },
  { id: 'ORD-003', customerName: 'محمود حسن', customerPhone: '0125554433', totalAmount: 800, downPayment: 0, shippingCost: 60, status: 'returned', depositType: 'shipping_extra', createdAt: '2026-01-03T10:00:00' },
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
    root,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function selectChange(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function rowsOf(host) {
  return Array.from(host.querySelectorAll('tbody tr'))
}

beforeEach(() => {
  useOrdersStore.setState({ orders: [], ready: false, search: '', status: '' })
  useAuthStore.setState({ user: { id: 'USR-1', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }, authed: true, role: 'admin' })
  useUiStore.setState({
    orderModal: { open: false, onSuccess: null },
    orderDetailsModal: { open: false, orderId: null },
    orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null },
  })
  window.getOrders = vi.fn(() => SEED)
})

describe('OrdersView (ui/views/OrdersView.jsx)', () => {
  it('يعرض الهيدر والجدول بكل الصفوف والحالات والعربونات', () => {
    const { host, unmount } = mount(<OrdersView />)
    expect(host.textContent).toContain('سجل الطلبات والفواتير')
    expect(host.textContent).toContain('إنشاء طلب جديد')

    const rows = rowsOf(host)
    expect(rows).toHaveLength(3)

    expect(rows[0].textContent).toContain('ORD-001')
    expect(rows[0].textContent).toContain('أحمد محمد')
    expect(rows[0].textContent).toContain('قيد الانتظار')
    expect(rows[0].textContent).toContain('عربون الشحن')
    expect(rows[1].textContent).toContain('مكتمل')
    expect(rows[1].textContent).toContain('عربون عادي')
    expect(rows[2].textContent).toContain('مرتجع')
    expect(rows[2].textContent).toContain('عربون شحن + مصروفات')
    unmount()
  })

  it('يظهر رسالة فارغة عند عدم وجود نتائج', () => {
    window.getOrders = vi.fn(() => [])
    const { host, unmount } = mount(<OrdersView />)
    expect(rowsOf(host)).toHaveLength(1)
    expect(host.textContent).toContain('لا توجد طلبات مطابقة للبحث الحالي')
    unmount()
  })

  it('البحث الحر يفلتر الصفوف فوراً', () => {
    const { host, unmount } = mount(<OrdersView />)
    const input = host.querySelector('input')
    type(input, 'سارة')
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('سارة علي')
    unmount()
  })

  it('البحث برقم الطلب يعمل', () => {
    const { host, unmount } = mount(<OrdersView />)
    type(host.querySelector('input'), 'ORD-002')
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('ORD-002')
    unmount()
  })

  it('فلتر الحالة يعزل الحالات ويجتمع مع البحث', () => {
    const { host, unmount } = mount(<OrdersView />)
    const select = host.querySelector('select')
    selectChange(select, 'completed')
    let rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('سارة علي')

    type(host.querySelector('input'), 'محمود')
    rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(host.textContent).toContain('لا توجد طلبات مطابقة')
    unmount()
  })

  it('أزرار الإجراءات تفتح نوافذ التفاصيل وتحديث الحالة الجديدة بمعرّف الطلب', () => {
    const { host, unmount } = mount(<OrdersView />)
    const buttons = Array.from(host.querySelectorAll('button'))
    const details = buttons.find(b => b.textContent.includes('تفاصيل'))
    const update = buttons.find(b => b.textContent.includes('تحديث'))

    click(details)
    expect(useUiStore.getState().orderDetailsModal).toMatchObject({ open: true, orderId: 'ORD-001' })

    click(update)
    expect(useUiStore.getState().orderStatusModal).toMatchObject({ open: true, orderId: 'ORD-001', currentStatus: 'new' })

    const create = buttons.find(b => b.textContent.includes('إنشاء طلب جديد'))
    click(create)
    expect(useUiStore.getState().orderModal.open).toBe(true)
    useUiStore.setState({
      orderModal: { open: false, onSuccess: null },
      orderDetailsModal: { open: false, orderId: null },
      orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null },
    })
    unmount()
  })

  it('إجمالي المتبقي يظهر باللون الغامق للأوامر المتبقية فقط', () => {
    const { host, unmount } = mount(<OrdersView />)
    const roseCells = Array.from(host.querySelectorAll('td')).filter(td => td.classList.contains('text-rose-400'))
    expect(roseCells).toHaveLength(1)
    expect(roseCells[0].textContent).toContain('ج.م')
    unmount()
  })

  it('الكاشير يرى فواتير اليوم التي أنشأها هو فقط (فلترة createdBy + تاريخ القاهرة)', () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'كاشير المعرض', email: 'e@x.com', role: 'employee' }, authed: true, role: 'employee' })
    const today = getCairoFormattedDate().slice(0, 10)
    window.getOrders = vi.fn(() => [
      { id: 'ORD-A', customerName: 'عميل اليوم', customerPhone: '01000000001', totalAmount: 100, downPayment: 0, shippingCost: 0, status: 'new', createdBy: 'كاشير المعرض', createdAt: `${today}T10:00:00` },
      { id: 'ORD-B', customerName: 'عميل زميل', customerPhone: '01000000002', totalAmount: 200, downPayment: 0, shippingCost: 0, status: 'new', createdBy: 'موظف آخر', createdAt: `${today}T10:00:00` },
      { id: 'ORD-C', customerName: 'عميل قديم لي', customerPhone: '01000000003', totalAmount: 300, downPayment: 0, shippingCost: 0, status: 'new', createdBy: 'كاشير المعرض', createdAt: '2020-01-01T10:00:00' },
    ])
    const { host, unmount } = mount(<OrdersView />)
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('ORD-A')
    expect(rows[0].textContent).toContain('عميل اليوم')
    expect(host.textContent).not.toContain('ORD-B')
    expect(host.textContent).not.toContain('ORD-C')
    unmount()
  })

  it('المدير والمحاسب يريان كل الفواتير مع زر تحديث الحالة للمدير فقط', () => {
    const today = getCairoFormattedDate().slice(0, 10)
    window.getOrders = vi.fn(() => [
      { id: 'ORD-X', customerName: 'عميل', customerPhone: '01000000009', totalAmount: 100, downPayment: 0, shippingCost: 0, status: 'new', createdBy: 'موظف آخر', createdAt: `${today}T10:00:00` },
    ])
    const adminHost = mount(<OrdersView />)
    const adminButtons = Array.from(adminHost.host.querySelectorAll('button'))
    expect(adminButtons.find(b => b.textContent.includes('تحديث'))).toBeTruthy()
    adminHost.unmount()

    useAuthStore.setState({ user: { id: 'USR-3', name: 'المحاسب', email: 'acc@x.com', role: 'accountant' }, authed: true, role: 'accountant' })
    const accHost = mount(<OrdersView />)
    expect(rowsOf(accHost.host)).toHaveLength(1)
    const accButtons = Array.from(accHost.host.querySelectorAll('button'))
    expect(accButtons.find(b => b.textContent.includes('تحديث'))).toBeUndefined()
    expect(accButtons.find(b => b.textContent.includes('إنشاء طلب جديد'))).toBeUndefined()
    accHost.unmount()
  })
})
