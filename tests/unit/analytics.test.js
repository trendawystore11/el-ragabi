import { describe, it, expect } from 'vitest'
import {
  getOrderExecType,
  applyAnalyticsFilters,
  buildDateBuckets,
  granularityForRange,
  resolveRange,
  previousPeriodRange,
  computeAnalyticsKPIs,
  computeSalesTrend,
  computePeriodGrowth,
  computeTopProducts,
  computeTopCustomers,
  computeTopDebtors,
  computeCategoryMix,
  collectFilterOptions,
} from '@/domain/analytics/analytics'
import { canSeeAnalytics, visibleNavItems } from '@/services/permissions'

// V4 — محرك تحليل البيانات: اختبارات حسابية صرفة على دومين analytics.
// لا تمس window إطلاقاً، لذا تعمل دون أي جسر/مخزن.

function mkOrder(overrides) {
  return {
    id: 'ORD',
    customerId: 'C1',
    customerName: 'عميل 1',
    customerCategory: 'بالتجزئة',
    items: [{ productName: 'منتج أ', quantity: 2, sellingPrice: 100, purchasePrice: 60, isDirectShip: false }],
    itemsSubtotal: 200,
    shippingCost: 20,
    shippingPayer: 'customer',
    extraExpenses: 0,
    extraExpensesPayer: 'customer',
    totalAmount: 220,
    downPayment: 0,
    remainingBalance: 220,
    paidInFull: false,
    status: 'delivered',
    createdBy: 'المدير العام',
    createdAt: '2026-08-10T10:00:00',
    ...overrides,
  }
}

const ORDER_A = mkOrder({}) // delivered, items 2×100/60, customer shipping 20 → total 220
const ORDER_B = mkOrder({
  id: 'ORD-B',
  customerId: 'C2',
  customerName: 'عميل 2',
  customerCategory: 'جملة',
  items: [{ productName: 'منتج ب', quantity: 1, sellingPrice: 50, purchasePrice: 20, isDirectShip: false }],
  itemsSubtotal: 50,
  shippingCost: 10,
  shippingPayer: 'merchant',
  totalAmount: 60,
  status: 'completed',
  createdBy: 'كاشير',
  createdAt: '2026-08-11T09:00:00',
})
const ORDER_C = mkOrder({
  id: 'ORD-C',
  customerId: 'C3',
  customerName: 'عميل 3',
  customerCategory: 'بالتجزئة',
  items: [{ productName: 'منتج ج', quantity: 1, sellingPrice: 100, purchasePrice: 80, isDirectShip: true }],
  itemsSubtotal: 100,
  shippingCost: 0,
  shippingPayer: 'customer',
  totalAmount: 100,
  downPayment: 40,
  remainingBalance: 60,
  status: 'new', // active لكنها غير مؤكدة (لا تدخل مبيعات/ربح المنتجات)
  createdAt: '2026-08-12T08:00:00',
})
const ORDER_D = mkOrder({
  id: 'ORD-D',
  customerId: 'C1',
  customerName: 'عميل 1',
  items: [{ productName: 'منتج أ', quantity: 1, sellingPrice: 100, purchasePrice: 60, isDirectShip: false }],
  itemsSubtotal: 100,
  shippingCost: 0,
  shippingPayer: 'customer',
  totalAmount: 100,
  status: 'delivered',
  createdAt: '2026-08-09T10:00:00',
})
const ORDERS = [ORDER_A, ORDER_B, ORDER_C, ORDER_D]

describe('getOrderExecType', () => {
  it('يصنّف الشحن المباشر والمنتجات من المخزون والمختلط', () => {
    expect(getOrderExecType(ORDER_A)).toBe('stock')
    expect(getOrderExecType(ORDER_C)).toBe('direct')
    expect(getOrderExecType(mkOrder({
      items: [
        { quantity: 1, isDirectShip: true },
        { quantity: 1, isDirectShip: false },
      ],
    }))).toBe('mixed')
    expect(getOrderExecType({})).toBe('stock')
  })
})

describe('applyAnalyticsFilters', () => {
  it('يرشّح بالنطاق الزمني', () => {
    const out = applyAnalyticsFilters(ORDERS, { from: '2026-08-10', to: '2026-08-11' })
    expect(out.map(o => o.id)).toEqual(['ORD', 'ORD-B'])
  })
  it('يرشّح بالعميل والتصنيف والكاشير', () => {
    expect(applyAnalyticsFilters(ORDERS, { customerId: 'C1' }).length).toBe(2)
    expect(applyAnalyticsFilters(ORDERS, { category: 'جملة' }).map(o => o.id)).toEqual(['ORD-B'])
    expect(applyAnalyticsFilters(ORDERS, { cashier: 'كاشير' }).map(o => o.id)).toEqual(['ORD-B'])
  })
  it('يرشّح بنوع التنفيذ والحالة', () => {
    expect(applyAnalyticsFilters(ORDERS, { execution: 'direct' }).map(o => o.id)).toEqual(['ORD-C'])
    expect(applyAnalyticsFilters(ORDERS, { status: 'new' }).map(o => o.id)).toEqual(['ORD-C'])
  })
})

describe('buildDateBuckets', () => {
  it('يبني سلسلة أيام متصلة', () => {
    expect(buildDateBuckets('2026-01-30', '2026-02-02', 'day')).toEqual([
      '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02',
    ])
  })
  it('يبني أشهر عبر حدود السنة', () => {
    expect(buildDateBuckets('2026-01-30', '2026-02-02', 'month')).toEqual(['2026-01', '2026-02'])
  })
  it('يرجع [] لفترات غير صالحة', () => {
    expect(buildDateBuckets('2026-05-05', '2026-05-04')).toEqual([])
    expect(buildDateBuckets(null, '2026-05-04')).toEqual([])
  })
})

describe('granularityForRange & resolveRange', () => {
  it('يومي حتى 45 يوماً وشهري بعدها', () => {
    expect(granularityForRange('2026-08-01', '2026-08-02')).toBe('day')
    expect(granularityForRange('2026-08-01', '2026-10-01')).toBe('month')
  })
  it('presets صحيحة الشكل', () => {
    const today = resolveRange('today')
    const d = new Date()
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(today).toEqual({ from: todayKey, to: todayKey })
    expect(resolveRange('30d').from <= resolveRange('30d').to).toBe(true)
    expect(resolveRange('month').from.endsWith('-01')).toBe(true)
  })
  it('previousPeriodRange يعطي نافذة مساوية فوراً قبل النطاق', () => {
    expect(previousPeriodRange('2026-08-10', '2026-08-12')).toEqual({ from: '2026-08-07', to: '2026-08-09' })
    expect(previousPeriodRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' })
    expect(previousPeriodRange('2026-05-05', '2026-05-04')).toBeNull()
  })
})

describe('computeAnalyticsKPIs', () => {
  it('يحسب المبيعات والربح والهامش والمتوسط والديون بدقة', () => {
    // النطاق 10–12 أغسطس يعزل أ+ب+ج (د خارج النطاق): قيد الانتظار خارج مبيعات/ربح المنتجات.
    const k = computeAnalyticsKPIs(ORDERS, { from: '2026-08-10', to: '2026-08-12' })
    expect(k.totalSales).toBe(280)       // 220 + 60 (المؤكدة فقط؛ قيد الانتظار 100 خارج المبيعات)
    expect(k.orderCount).toBe(2)
    expect(k.avgOrderValue).toBe(140)
    expect(k.grossProfit).toBe(100)      // (200-120) + (50-20-10)
    expect(k.profitMargin).toBe(35.71)   // 100/280*100 → round2
    expect(k.receivables).toBe(340)      // المتبقي على الفعالة: 220 (أ) + 60 (ب) + 60 (ج)
  })
  it('يصفّر النتائج عند غياب الطلبات', () => {
    const k = computeAnalyticsKPIs([], {})
    expect(k).toEqual({ totalSales: 0, orderCount: 0, avgOrderValue: 0, grossProfit: 0, profitMargin: 0, receivables: 0, uncollected: 0 })
  })
})

describe('computeSalesTrend', () => {
  it('يرتّب القيم على دلاء الفترة مع تصفير الأيام الفارغة', () => {
    const trend = computeSalesTrend(ORDERS, { from: '2026-08-10', to: '2026-08-12' }, 'day')
    expect(trend.map(t => t.key)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
    expect(trend[0].sales).toBe(220)   // أ
    expect(trend[1].sales).toBe(60)    // ب
    expect(trend[2].sales).toBe(100)   // ج (قيد الانتظار تُحسب في ترند الفواتير)
    expect(trend[2].profit).toBe(0)    // غير مؤكدة → بلا ربح
    expect(trend[1].profit).toBe(20)
    expect(trend[0].orders).toBe(1)
  })
  it('يدعم التجميع الشهري', () => {
    const trend = computeSalesTrend(ORDERS, { from: '2026-08-01', to: '2026-08-31' }, 'month')
    expect(trend).toHaveLength(1)
    expect(trend[0].key).toBe('2026-08')
    expect(trend[0].sales).toBe(480)   // 220+60+100+100
  })
})

describe('computePeriodGrowth', () => {
  it('يقارن الفترة الحالية بالفترة السابقة المتساوية', () => {
    const g = computePeriodGrowth(ORDERS, { from: '2026-08-10', to: '2026-08-12' })
    expect(g.current).toBe(380)    // أ+ب+ج
    expect(g.previous).toBe(100)   // د في 2026-08-09
    expect(g.growthPct).toBe(280)
  })
  it('يرجع null عند غياب النطاق', () => {
    expect(computePeriodGrowth(ORDERS, {})).toBeNull()
  })
})

describe('computeTopProducts', () => {
  it('يصنّف المنتجات بالإيراد والربح من المؤكدة فقط', () => {
    const top = computeTopProducts(ORDERS, {})
    expect(top).toHaveLength(2)
    expect(top[0].name).toBe('منتج أ')
    expect(top[0].revenue).toBe(300) // 2×100 + 1×100 (د)
    expect(top[0].profit).toBe(120)
    expect(top[0].qty).toBe(3)
    expect(top[1].name).toBe('منتج ب')
    expect(top[1].revenue).toBe(50)
    expect(top[1].profit).toBe(30)
  })
})

describe('computeTopCustomers & computeTopDebtors', () => {
  it('العميل الأكبر بالمبيعات المؤكدة', () => {
    const top = computeTopCustomers(ORDERS, {})
    expect(top[0].name).toBe('عميل 1')
    expect(top[0].sales).toBe(320) // 220 + 100 (د)
    expect(top[0].orders).toBe(2)
    expect(top[0].profit).toBe(120) // 80 + 40
  })
  it('أكبر المدينين بالمتبقي على الفعالة فقط', () => {
    const top = computeTopDebtors(ORDERS, {})
    expect(top.map(d => d.name)).toEqual(['عميل 1', 'عميل 2', 'عميل 3'])
    expect(top[0].remaining).toBe(320)   // أ 220 + د 100
    expect(top[1].remaining).toBe(60)    // ب مكتملة (فعالة) — 60
    expect(top[2].remaining).toBe(60)    // ج قيد الانتظار (فعالة) — 60
  })
})

describe('computeCategoryMix & collectFilterOptions', () => {
  it('توزيع المبيعات المؤكدة حسب التصنيف', () => {
    const mix = computeCategoryMix(ORDERS, {})
    expect(mix.map(m => m.name)).toEqual(['بالتجزئة', 'جملة'])
    expect(mix[0].value).toBe(320) // أ 220 + د 100
    expect(mix[1].value).toBe(60)
  })
  it('خيارات الفلاتر المميزة من كل الطلبات', () => {
    const opts = collectFilterOptions(ORDERS)
    expect(opts.customers).toHaveLength(3)
    expect(opts.categories).toEqual(['بالتجزئة', 'جملة'])
    expect(opts.cashiers).toEqual(['المدير العام', 'كاشير'])
  })
})

describe('permissions — canSeeAnalytics', () => {
  it('متاحة للمدير والمحاسب فقط وتظهر في قائمتهما', () => {
    expect(canSeeAnalytics('admin')).toBe(true)
    expect(canSeeAnalytics('accountant')).toBe(true)
    expect(canSeeAnalytics('employee')).toBe(false)
    expect(canSeeAnalytics('storekeeper')).toBe(false)
    expect(visibleNavItems('admin')).toContain('analytics')
    expect(visibleNavItems('accountant')).toContain('analytics')
    expect(visibleNavItems('employee')).not.toContain('analytics')
  })
})
