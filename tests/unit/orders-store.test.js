import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useOrdersStore, applyOrderFilters } from '@/state/ordersStore'

const SEED = [
  { id: 'ORD-001', customerName: 'أحمد محمد', customerPhone: '01012345678', totalAmount: 1000, downPayment: 400, shippingCost: 50, status: 'new', depositType: 'shipping', createdAt: '2026-01-01T10:00:00' },
  { id: 'ORD-002', customerName: 'سارة علي', customerPhone: '01198765432', totalAmount: 2500, downPayment: 2500, shippingCost: 100, status: 'completed', depositType: 'cash', createdAt: '2026-01-02T10:00:00' },
  { id: 'ORD-003', customerName: 'محمود حسن', customerPhone: '0125554433', totalAmount: 800, downPayment: 0, shippingCost: 60, status: 'returned', depositType: 'shipping_extra', createdAt: '2026-01-03T10:00:00' },
]

describe('ordersStore (state/ordersStore.js)', () => {
  const originalGetOrders = window.getOrders

  beforeEach(() => {
    useOrdersStore.setState({ orders: [], ready: false, search: '', status: '' })
  })

  afterEach(() => {
    window.getOrders = originalGetOrders
  })

  it('refresh() يقرأ اللقطة من window.getOrders ويرفع ready', () => {
    window.getOrders = vi.fn(() => SEED)
    const returned = useOrdersStore.getState().refresh()
    expect(window.getOrders).toHaveBeenCalledTimes(1)
    expect(returned).toHaveLength(3)
    const s = useOrdersStore.getState()
    expect(s.orders).toEqual(SEED)
    expect(s.ready).toBe(true)
  })

  it('refresh() آمن بدون جسر — يبقي القائمة الحالية ويعلم ready', () => {
    window.getOrders = undefined
    useOrdersStore.setState({ orders: SEED, ready: false })
    const s = useOrdersStore.getState()
    s.refresh()
    expect(useOrdersStore.getState().ready).toBe(true)
    expect(useOrdersStore.getState().orders).toEqual(SEED)
  })

  it('setOrders() يحقن قائمة مباشرة (للتزامن والاختبار)', () => {
    useOrdersStore.getState().setOrders(SEED)
    expect(useOrdersStore.getState().orders).toHaveLength(3)
    expect(useOrdersStore.getState().ready).toBe(true)
  })

  it('setOrders() يتجاهل القيم غير الصفائف', () => {
    useOrdersStore.setState({ orders: SEED })
    useOrdersStore.getState().setOrders(null)
    expect(useOrdersStore.getState().orders).toEqual(SEED)
  })

  it('setSearch/setStatus/resetFilters يتحكمون في المرشحات مع فراغ عند null', () => {
    const s = useOrdersStore.getState()
    s.setSearch('أحمد')
    s.setStatus('new')
    expect(useOrdersStore.getState().search).toBe('أحمد')
    expect(useOrdersStore.getState().status).toBe('new')

    s.setSearch('')
    s.setStatus(null)
    expect(useOrdersStore.getState().search).toBe('')
    expect(useOrdersStore.getState().status).toBe('')

    s.setSearch('سارة')
    s.setStatus('completed')
    useOrdersStore.getState().resetFilters()
    expect(useOrdersStore.getState().search).toBe('')
    expect(useOrdersStore.getState().status).toBe('')
  })

  it('applyOrderFilters يعيد الكل بدون بحث أو حالة', () => {
    expect(applyOrderFilters(SEED, '', '')).toHaveLength(3)
  })

  it('applyOrderFilters يطابق بحث حر بالرقم والاسم والهاتف', () => {
    expect(applyOrderFilters(SEED, 'ORD-002', '')).toHaveLength(1)
    expect(applyOrderFilters(SEED, 'سارة', '')).toHaveLength(1)
    expect(applyOrderFilters(SEED, '01012345678', '')).toHaveLength(1)
    expect(applyOrderFilters(SEED, 'بدون نتائج', '')).toHaveLength(0)
  })

  it('applyOrderFilters يفلتر بالحالة ثم يطبق البحث', () => {
    expect(applyOrderFilters(SEED, '', 'completed')).toHaveLength(1)
    expect(applyOrderFilters(SEED, 'سارة', 'completed')).toHaveLength(1)
    expect(applyOrderFilters(SEED, 'أحمد', 'completed')).toHaveLength(0)
  })

  it('applyOrderFilters يتجاهل القيم غير الصفائف', () => {
    expect(applyOrderFilters(null, '', '')).toEqual([])
  })

  it('يستمع bms-data-synced لإعادة القراءة عند لقطة الطلبات', () => {
    window.getOrders = vi.fn(() => SEED)
    useOrdersStore.setState({ orders: [], ready: false })
    window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key: 'orders', items: SEED } }))
    expect(useOrdersStore.getState().orders).toEqual(SEED)
    expect(useOrdersStore.getState().ready).toBe(true)
  })

  it('يستمع bms-data-synced للـ manual refresh الشامل', () => {
    window.getOrders = vi.fn(() => SEED)
    window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key: '*', manual: true } }))
    expect(useOrdersStore.getState().orders).toEqual(SEED)
  })
})
