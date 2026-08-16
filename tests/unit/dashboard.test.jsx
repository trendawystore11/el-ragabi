import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import Dashboard from '@/ui/views/Dashboard'
import { useUiStore } from '@/ui/state/uiStore'
import { useSettingsStore } from '@/state/settingsStore'
import { formatCurrency, formatCompactCurrency, formatCurrencyEn } from '@/utils/formatters'

const ORDERS = [
  {
    id: 'ORD-001',
    customerName: 'أحمد محمد',
    customerPhone: '01012345678',
    items: [{ sellingPrice: 500, purchasePrice: 300, quantity: 2 }],
    shippingCost: 100,
    shippingPayer: 'customer',
    totalAmount: 1100,
    downPayment: 1100,
    status: 'delivered',
    createdAt: '2026-01-01T10:00:00',
  },
  {
    id: 'ORD-002',
    customerName: 'سارة علي',
    customerPhone: '01198765432',
    items: [],
    totalAmount: 900,
    downPayment: 200,
    status: 'new',
    createdAt: '2026-01-02T10:00:00',
  },
  {
    id: 'ORD-003',
    customerName: 'محمود حسن',
    customerPhone: '0125554433',
    items: [],
    shippingCost: 60,
    shippingPayer: 'merchant',
    totalAmount: 600,
    downPayment: 600,
    status: 'returned',
    createdAt: '2026-01-03T10:00:00',
  },
  {
    id: 'ORD-004',
    customerName: 'ليلى إبراهيم',
    customerPhone: '01000000000',
    items: [{ sellingPrice: 300, purchasePrice: 180, quantity: 1 }],
    totalAmount: 300,
    downPayment: 300,
    status: 'completed',
    createdAt: '2026-01-04T10:00:00',
  },
]

const PRODUCTS = [
  { id: 'P1', name: 'منتج أ', stock: 5, purchasePrice: 100 },
  { id: 'P2', name: 'منتج ب', stock: 2, purchasePrice: 50 },
]

const SUPPLIERS = [
  { id: 'S1', name: 'مورد أ', remainingBalance: 250 },
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

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  window.getOrders = vi.fn(() => ORDERS)
  window.getProducts = vi.fn(() => PRODUCTS)
  window.STORAGE_KEYS = { SUPPLIERS: 'suppliers' }
  window.getCollection = vi.fn(() => SUPPLIERS)
  window.openPaymentModal = vi.fn()
  window.getCurrentUser = vi.fn(() => ({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' }))
})

afterEach(() => {
  useUiStore.setState({ orderModal: { open: false, onSuccess: null }, paymentModal: { open: false, defaults: null, onDone: null } })
})

describe('Dashboard (ui/views/Dashboard.jsx)', () => {
  beforeEach(() => { useSettingsStore.setState({ compactNumbers: true }) })
  afterEach(() => { useSettingsStore.setState({ compactNumbers: false }) })

  it('يعرض الهيدر وكل بطاقات KPI', () => {
    const { host, unmount } = mount(<Dashboard />)
    expect(host.textContent).toContain('لوحة التحكم والرصد اليومي')
    expect(host.textContent).toContain('التحديث الآلي: مباشر')
    for (const label of ['إجمالي المبيعات', 'إجمالي التكلفة بالمخزن', 'صافي الربح', 'ديون على العملاء', 'ديون للموردين', 'الطلبات الفعالة', 'نواقص المخزون']) {
      expect(host.textContent).toContain(label)
    }
    unmount()
  })

  it('يحسب إجمالي المبيعات = مبيعات البضائع المؤكدة + شحن العميل', () => {
    const { host, unmount } = mount(<Dashboard />)
    expect(host.textContent).toContain(formatCompactCurrency(1400))
    unmount()
  })

  it('الوضع الافتراضي (رقم كامل): عند إيقاف الاختصار تُعرض 1,400 ج.م كاملة', () => {
    useSettingsStore.setState({ compactNumbers: false })
    const { host, unmount } = mount(<Dashboard />)
    expect(host.textContent).toContain(formatCurrencyEn(1400))
    unmount()
  })

  it('يحسب تكلفة المخزون = رصيد × سعر الشراء', () => {
    const { host, unmount } = mount(<Dashboard />)
    expect(host.textContent).toContain(formatCurrency(5 * 100 + 2 * 50))
    unmount()
  })

  it('يعرض ديون العملاء (آجل) ودين الموردين وقيد الانتظار', () => {
    const { host, unmount } = mount(<Dashboard />)
    expect(host.textContent).toContain('إيراد خدمات شحن ونقل')
    expect(host.textContent).toContain('فواتير قيد الانتظار')
    expect(host.textContent).toContain(formatCurrency(700))
    expect(host.textContent).toContain(formatCompactCurrency(250))
    unmount()
  })

  it('يعرض أحدث 5 فواتير بكل بياناتها', () => {
    const { host, unmount } = mount(<Dashboard />)
    const rows = host.querySelectorAll('tbody tr')
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows[0].textContent).toContain('ORD-001')
    expect(rows[0].textContent).toContain('أحمد محمد')
    expect(rows[0].textContent).toContain('تم التوصيل')
    unmount()
  })

  it('زر إنشاء طلب يفتح نافذة فاتورة البيع وزر تحصيل يفتح نافذة الإيصال', () => {
    const { host, unmount } = mount(<Dashboard />)
    const buttons = Array.from(host.querySelectorAll('button'))
    click(buttons.find(b => b.textContent.includes('فتح نافذة فاتورة البيع')))
    expect(useUiStore.getState().orderModal.open).toBe(true)
    click(buttons.find(b => b.textContent.includes('تسجيل إيصال جديد')))
    expect(useUiStore.getState().paymentModal.open).toBe(true)
    unmount()
  })

  it('بطاقات KPI التنقّل تُطلق onNavigate بالوجهة', () => {
    const onNavigate = vi.fn()
    const { host, unmount } = mount(<Dashboard onNavigate={onNavigate} />)
    const buttons = Array.from(host.querySelectorAll('button'))
    click(buttons.find(b => b.textContent.includes('أصناف')))
    expect(onNavigate).toHaveBeenCalledWith('products')
    click(buttons.find(b => b.textContent.includes('عرض كافة الفواتير')))
    expect(onNavigate).toHaveBeenCalledWith('orders')
    unmount()
  })
})
