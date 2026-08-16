import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import CustomersView from '@/ui/views/CustomersView'
import { useCustomersStore } from '@/state/customersStore'
import { useUiStore } from '@/ui/state/uiStore'
import { formatCurrency } from '@/utils/formatters'

const SEED = [
  { id: 'CUST-001', name: 'أحمد محمد', phone: '01012345678', secondaryPhone: '', category: 'تاجر جملة', address: 'القاهرة - مدينة نصر - شارع الميرغني', ordersCount: 2, totalPurchases: 1000, paid: 400, remainingBalance: 600 },
  { id: 'CUST-002', name: 'سارة علي', phone: '01198765432', secondaryPhone: '01234567890', category: 'عميل قطاعي / فردي', address: 'الجيزة - الدقي', ordersCount: 0, totalPurchases: 0, paid: 0, remainingBalance: 0 },
  { id: 'CUST-003', name: 'محمود حسن', phone: '0125554433', secondaryPhone: '', category: 'معرض / وكيل', address: '', ordersCount: 1, totalPurchases: 500, paid: 200, remainingBalance: 300 },
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
  useCustomersStore.setState({ customers: [], ready: false, search: '', category: '' })
  useUiStore.setState({
    customerModal: { open: false, customerId: null, onDone: null },
    paymentModal: { open: false, defaults: null, onDone: null },
    statementModal: { open: false, entityType: null, entityId: null },
  })
  window.getCustomers = vi.fn(() => SEED)
  window.openPaymentModal = vi.fn()
  window.getCurrentUser = vi.fn(() => ({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' }))
})

describe('CustomersView (ui/views/CustomersView.jsx)', () => {
  it('يعرض الهيدر والجدول بكل العملاء والتصنيفات والمديونيات', () => {
    const { host, unmount } = mount(<CustomersView />)
    expect(host.textContent).toContain('دليل العملاء وحسابات الديون')
    expect(host.textContent).toContain('إضافة عميل جديد')

    const rows = rowsOf(host)
    expect(rows).toHaveLength(3)

    expect(rows[0].textContent).toContain('CUST-001')
    expect(rows[0].textContent).toContain('أحمد محمد')
    expect(rows[0].textContent).toContain('تاجر جملة')
    expect(rows[0].textContent).toContain('01012345678')
    expect(rows[0].textContent).toContain('شارع الميرغني')
    expect(rows[0].textContent).toContain(formatCurrency(1000))
    expect(rows[0].textContent).toContain(formatCurrency(600))

    expect(rows[1].textContent).toContain('سارة علي')
    expect(rows[1].textContent).toContain('01234567890')
    expect(rows[1].textContent).toContain('عميل قطاعي / فردي')

    expect(rows[2].textContent).toContain('معرض / وكيل')
    unmount()
  })

  it('يبين الرصيد المتبقي باللون الأحمر للمديونين فقط', () => {
    const { host, unmount } = mount(<CustomersView />)
    const roseCells = Array.from(host.querySelectorAll('td')).filter(td => td.classList.contains('text-rose-400'))
    expect(roseCells).toHaveLength(2)
    expect(roseCells[0].textContent).toContain(formatCurrency(600))
    expect(roseCells[1].textContent).toContain(formatCurrency(300))
    unmount()
  })

  it('البحث بالاسم يفلتر الصفوف فوراً', () => {
    const { host, unmount } = mount(<CustomersView />)
    type(host.querySelector('input'), 'سارة')
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('سارة علي')
    unmount()
  })

  it('البحث برقم الهاتف الثانوي يعمل', () => {
    const { host, unmount } = mount(<CustomersView />)
    type(host.querySelector('input'), '01234567890')
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('سارة علي')
    unmount()
  })

  it('فلتر التصنيف يعزل العملاء ويتجمع مع البحث', () => {
    const { host, unmount } = mount(<CustomersView />)
    const select = host.querySelector('select')
    selectChange(select, 'تاجر جملة')
    let rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('أحمد محمد')

    type(host.querySelector('input'), 'محمود')
    rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(host.textContent).toContain('لا يوجد عملاء مسجلين')
    unmount()
  })

  it('يظهر رسالة فارغة عند عدم وجود نتائج', () => {
    window.getCustomers = vi.fn(() => [])
    const { host, unmount } = mount(<CustomersView />)
    expect(rowsOf(host)).toHaveLength(1)
    expect(host.textContent).toContain('لا يوجد عملاء مسجلين')
    unmount()
  })

  it('زر إضافة عميل جديد يفتح نافذة الإضافة عبر uiStore', () => {
    const { host, unmount } = mount(<CustomersView />)
    const addBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إضافة عميل جديد'))
    click(addBtn)
    expect(useUiStore.getState().customerModal.open).toBe(true)
    expect(useUiStore.getState().customerModal.customerId).toBeNull()
    useUiStore.setState({ customerModal: { open: false, customerId: null, onDone: null } })
    unmount()
  })

  it('زر تعديل يفتح نافذة الإضافة بوضع التعديل بمعرّف العميل', () => {
    const { host, unmount } = mount(<CustomersView />)
    const rows = rowsOf(host)
    const editBtn = Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))
    click(editBtn)
    expect(useUiStore.getState().customerModal).toMatchObject({ open: true, customerId: 'CUST-001' })
    useUiStore.setState({ customerModal: { open: false, customerId: null, onDone: null } })
    unmount()
  })

  it('أزرار تحصيل دفعة وكشف حساب تستدعي نوافذها بمعرّف العميل', () => {
    const { host, unmount } = mount(<CustomersView />)
    const rows = rowsOf(host)
    const collect = Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('تحصيل دفعة'))
    const statement = Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('كشف حساب'))
    click(collect)
    expect(useUiStore.getState().paymentModal).toMatchObject({ open: true, defaults: { entityType: 'customer', entityId: 'CUST-001' } })
    click(statement)
    expect(useUiStore.getState().statementModal).toMatchObject({ open: true, entityType: 'customer', entityId: 'CUST-001' })
    useUiStore.setState({ statementModal: { open: false, entityType: null, entityId: null } })
    unmount()
  })
})
