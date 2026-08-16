// =============================================================================
// ui/views/Dashboard.jsx — نسخة React من js/components/dashboard.js — Phase 3
// -----------------------------------------------------------------------------
// لوحة الرصد: 7 بطاقات KPI + إيراد الشحن + فواتير قيد الانتظار + إجراءات سريعة
// + أحدث الفواتير. الحسابات من الدومين النقي، والبيانات الخام عبر الجسر
// (window) بنفس قرّاءات النسخة القديمة. يتحدث تلقائياً مع bms-data-synced.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp,
  Package,
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  ShoppingBag,
  AlertTriangle,
  Truck,
  Clock,
  PlusCircle,
  ShoppingCart,
  Wallet,
  CreditCard,
  History,
  ArrowLeft,
} from 'lucide-react'
import Badge from '../components/Badge.jsx'
import { useUiStore } from '../state/uiStore.js'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { canSeeDashboard } from '@/services/permissions'
import { calculateNetProfit, getOrderStatusLabel, getOrderRemainingAmount } from '@/domain/accounting/accounting'
import { getTotalCustomerReceivables, getTotalSupplierPayables, getTotalPaymentsCollected } from '@/domain/accounting/payments'
import { getOpenOrdersCount } from '@/domain/orders/orderRepository'
import { getLowStockProducts } from '@/domain/inventory/products'
import { formatCurrency, formatCompactCurrency, formatCurrencyEn, formatPhonePair, formatDate, toNumber } from '@/utils/formatters'

function readOrders() {
  return window.getOrders ? window.getOrders() : []
}

// HDI — الصف التشغيلي: المقبوضات النقدية الكلية من كل الإيصالات المسجلة.
function computeOps() {
  const payments = window.getPayments ? window.getPayments() : []
  return { totalCollected: getTotalPaymentsCollected(payments) }
}

function computeStats() {
  const orders = readOrders()
  const products = window.getProducts ? window.getProducts() : []
  const suppliers = window.getCollection && window.STORAGE_KEYS ? window.getCollection(window.STORAGE_KEYS.SUPPLIERS) : []
  const calc = calculateNetProfit(orders, {
    getExpenses: () => (window.getExpenses ? window.getExpenses() : []),
    ...(window.getCurrentOperatingExpenses
      ? { getCurrentOperatingExpenses: () => window.getCurrentOperatingExpenses() }
      : {}),
    getSupplierReturns: () => (window.getSupplierReturns ? window.getSupplierReturns() : []),
  })

  const inventoryValuation = products.reduce((sum, p) => {
    const stock = Math.max(0, toNumber(p.stock))
    const buyPrice = toNumber(p.purchasePrice)
    return sum + stock * buyPrice
  }, 0)

  const pendingOrders = orders.filter(o => o.status === 'new')
  const pendingCollectedDeposits = pendingOrders.reduce((s, o) => s + toNumber(o.downPayment), 0)

  return {
    orders,
    grossSales: calc.grossSales,
    netProfit: calc.netProfit,
    shippingRevenueIncome: calc.shippingRevenueIncome || 0,
    inventoryValuation,
    customerReceivables: getTotalCustomerReceivables(orders),
    supplierPayables: getTotalSupplierPayables(suppliers),
    openOrdersCount: getOpenOrdersCount(orders),
    lowStockCount: getLowStockProducts(products).length,
    pendingCount: pendingOrders.length,
    pendingCollectedDeposits,
    recentOrders: orders.slice(0, 5),
  }
}

function KpiCard({ label, value, icon: Icon, valueClass, hint, onClick, fullValue }) {
  return (
    <button
      onClick={onClick}
      title={fullValue || undefined}
      className={[
        'dashboard-kpi bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-lg relative overflow-hidden text-right v7-kpi',
        'hover:border-slate-700 transition-all',
        onClick ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-400">{label}</span>
        <div className="p-2 rounded-xl border bg-brand-500/10 text-brand-400 border-brand-500/20">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={`text-2xl font-extrabold num-font mb-1 ${valueClass || 'text-white'}`}>{value}</div>
      {hint ? <span className="text-[10px] text-slate-400">{hint}</span> : null}
    </button>
  )
}

// HDI — عنوان قسم الداشبورد: شريط accent قصير + عنوان هادئ (أساسي/تشغيلي/تحليلي).
function SectionTitle({ title, subtitle }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 v7-section-title">
      <span className="w-1 h-4 rounded-full bg-brand-500" />
      <h2 className="text-sm font-bold text-slate-200">{title}</h2>
      {subtitle ? <span className="text-[11px] text-slate-500 font-normal">{subtitle}</span> : null}
    </div>
  )
}

// HDI — رسم مبيعات SVG يدوي (بدون مكتبة): خط accent + تعبئة شفافة + شبكة خفيفة.
// الرسم يُرسم مرة واحدة عند الفتح فقط (600-900ms) بلا حركة مستمرة.
function SalesTrendChart({ orders }) {
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 40)
    return () => clearTimeout(t)
  }, [])

  const days = useMemo(() => {
    const map = new Map()
    const now = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      map.set(key, { date: key, total: 0 })
    }
    for (const o of orders || []) {
      const key = String(o.createdAt || '').slice(0, 10)
      if (map.has(key)) {
        map.set(key, { date: key, total: map.get(key).total + (toNumber(o.totalAmount) || 0) })
      }
    }
    return Array.from(map.values())
  }, [orders])

  const W = 640
  const H = 200
  const PADX = 14
  const PADY = 22
  const max = Math.max(1, ...days.map(d => d.total))
  const x = i => PADX + (i / Math.max(1, days.length - 1)) * (W - PADX * 2)
  const y = v => H - PADY - (v / max) * (H - PADY * 2)
  const pts = days.map((d, i) => `${x(i)},${y(d.total)}`).join(' ')
  const area = `${PADX},${H - PADY} ${pts} ${x(days.length - 1)},${H - PADY}`
  const ticks = days.filter((_, i) => i === 0 || i === 4 || i === 9 || i === 13)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto v7-chart-svg"
      role="img"
      aria-label="منحنى مبيعات آخر 14 يوماً"
    >
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={PADX} x2={W - PADX} y1={y(max * f)} y2={y(max * f)} className="v7-chart-grid" />
      ))}
      {ticks.map(d => (
        <text key={d.date} x={x(days.indexOf(d))} y={H - 5} className="v7-chart-label" textAnchor="middle">
          {d.date.slice(5)}
        </text>
      ))}
      <polygon points={area} className={`v7-chart-fill${drawn ? ' v7-chart-fill--on' : ''}`} />
      <polyline points={pts} pathLength={1} className={`v7-chart-line${drawn ? ' v7-chart-line--on' : ''}`} fill="none" />
    </svg>
  )
}

function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(() => computeStats())
  const [ops, setOps] = useState(() => computeOps())

  // V3.61 — «وضع الاختصار» (K/M): مفتاح واحد مشترك مع التقارير، يُقرأ من الإعدادات.
  const compact = useSettingsStore(s => s.compactNumbers)
  const fmt = n => compact ? formatCompactCurrency(n) : formatCurrencyEn(n)

  useEffect(() => {
    const handler = () => {
      setStats(computeStats())
      setOps(computeOps())
    }
    window.addEventListener('bms-data-synced', handler)
    return () => window.removeEventListener('bms-data-synced', handler)
  }, [])

  // 🔒 V3.43 — لوحة التحكم مالية: لا تصلح للكاشير/أمين المخزن ولو فُتحت مباشرة.
  const role = useAuthStore(s => s.role)
  if (role && !canSeeDashboard(role)) {
    return (
      <div className="grid place-items-center min-h-[60vh] animate-fadeIn">
        <div className="text-center bg-slate-900/60 p-8 rounded-2xl border border-slate-800 max-w-md">
          <h2 className="text-lg font-bold text-white mb-2">لوحة التحكم غير متاحة لهذا الحساب</h2>
          <p className="text-sm text-slate-400">الأرقام المالية (المبيعات، التكلفة، الأرباح، المصروفات، الديون) متاحة لمدير المتجر والمحاسب فقط.</p>
        </div>
      </div>
    )
  }

  const s = stats
  const openNewOrder = () => useUiStore.getState().openOrderModal()
  const openPayment = () => useUiStore.getState().openPaymentModal()

  return (
    <div className="dashboard-view space-y-8 animate-fadeIn v7-dashboard">
      {/* Welcome header */}
      <div className="dashboard-hero flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 shadow-sm v7-dashboard-hero">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <span>لوحة التحكم والرصد اليومي</span>
          </h1>
          <p className="text-sm text-slate-400">متابعة المبيعات الحية، تكلفة المخزون، الأرباح، المصروفات، والديون الآجلة</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/80">
          <Clock className="w-4 h-4 text-brand-400" />
          <span>التحديث الآلي: مباشر</span>
        </div>
      </div>

      {/* HDI — الصف 1: أساسيات الأداء */}
      <div className="v7-dash-row">
        <SectionTitle title="أساسيات الأداء" subtitle="المبيعات والطلبات والتحصيل والتكلفة لحظياً" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 v7-kpi-grid">
          <KpiCard
            label="إجمالي المبيعات"
            icon={TrendingUp}
            value={fmt(s.grossSales)}
            fullValue={formatCurrencyEn(s.grossSales)}
            hint="إجمالي الفواتير المؤكدة (شامل شحن ومصاريف العميل)"
          />
          <KpiCard
            label="الطلبات الفعالة"
            icon={ShoppingBag}
            value={`${s.openOrdersCount} طلبات`}
            hint="قيد التنفيذ"
            onClick={() => onNavigate && onNavigate('orders')}
          />
          <KpiCard
            label="ديون على العملاء (آجل)"
            icon={ArrowDownLeft}
            value={fmt(s.customerReceivables)}
            fullValue={formatCurrencyEn(s.customerReceivables)}
            hint="أموال متبقية للتحصيل"
            onClick={() => onNavigate && onNavigate('customers')}
          />
          <KpiCard
            label="إجمالي التكلفة بالمخزن"
            icon={Package}
            value={fmt(s.inventoryValuation)}
            fullValue={formatCurrencyEn(s.inventoryValuation)}
            hint="محسوبة بسعر الشراء من المورد"
            onClick={() => onNavigate && onNavigate('products')}
          />
        </div>
      </div>

      {/* HDI — الصف 2: التشغيل والتنبيهات */}
      <div className="v7-dash-row">
        <SectionTitle title="التشغيل والتنبيهات" subtitle="الربح والمستحقات والمقبوضات ونواقص المخزون" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 v7-kpi-grid">
          <KpiCard
            label="صافي الربح"
            icon={Coins}
            value={fmt(s.netProfit)}
            fullValue={formatCurrencyEn(s.netProfit)}
            valueClass={s.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            hint="ربح البضاعة فقط بعد التكلفة ومصاريف التاجر"
            onClick={() => onNavigate && onNavigate('reports')}
          />
          <KpiCard
            label="ديون للموردين (مستحقة)"
            icon={ArrowUpRight}
            value={fmt(s.supplierPayables)}
            fullValue={formatCurrencyEn(s.supplierPayables)}
            hint="مبالغ واجبة السداد للمصانع"
            onClick={() => onNavigate && onNavigate('suppliers')}
          />
          <KpiCard
            label="إجمالي المقبوضات"
            icon={Wallet}
            value={fmt(ops.totalCollected)}
            fullValue={formatCurrencyEn(ops.totalCollected)}
            hint="إجمالي الإيصالات النقدية المسجلة"
            onClick={() => onNavigate && onNavigate('payments')}
          />
          <KpiCard
            label="نواقص المخزون"
            icon={AlertTriangle}
            value={`${s.lowStockCount} أصناف`}
            valueClass={s.lowStockCount > 0 ? 'text-rose-400' : 'text-slate-200'}
            hint="تحتاج توريد"
            onClick={() => onNavigate && onNavigate('products')}
          />
        </div>
      </div>

      {/* HDI — الصف 3: التحليل */}
      <div className="v7-dash-row">
        <SectionTitle title="تحليل المبيعات" subtitle="إجمالي فواتير البضاعة المؤكدة يومياً خلال آخر 14 يوماً" />
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg v7-chart-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-200">اتجاه المبيعات اليومية</h3>
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-brand-500" />
              مبيعات مؤكدة
            </span>
          </div>
          <SalesTrendChart orders={s.orders} />
        </div>
      </div>

      {/* حالة التشغيل المكثفة: الشحن + قيد الانتظار جنباً إلى جنب */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="dashboard-info-card dashboard-info-card--sky bg-sky-950/30 border border-sky-800/40 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-sky-300 block">إيراد خدمات شحن ونقل</span>
              <span className="text-[11px] text-slate-500">عربون الشحن/التغليف المحصَّل بجميع الحالات — لا يُحتسب ضمن مبيعات البضاعة ولا صافي ربح المنتجات</span>
            </div>
          </div>
          <span className="text-xl font-extrabold text-sky-400 num-font" title={formatCurrencyEn(s.shippingRevenueIncome)}>{fmt(s.shippingRevenueIncome)}</span>
        </div>

        <div className="dashboard-info-card dashboard-info-card--amber bg-amber-950/25 border border-amber-800/40 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-amber-300 block">فواتير قيد الانتظار (غير مؤكدة البيع)</span>
              <span className="text-[11px] text-slate-500">لم تُشحن بعد — لا تدخل في مبيعات البضاعة المؤكدة، والعربون المحصَّل منها يظهر فوراً في وارد الخزينة</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-left">
              <span className="text-[11px] text-slate-400 block">عدد الفواتير</span>
              <span className="text-lg font-extrabold text-amber-300 num-font">{s.pendingCount}</span>
            </div>
            <div className="text-left">
              <span className="text-[11px] text-slate-400 block">العربون المحصَّل</span>
              <span className="text-lg font-extrabold text-emerald-400 num-font" title={formatCurrencyEn(s.pendingCollectedDeposits)}>{fmt(s.pendingCollectedDeposits)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="dashboard-actions grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="dashboard-action-card dashboard-action-card--primary bg-slate-900 border border-brand-500/30 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 bg-brand-600/20 text-brand-400 rounded-xl border border-brand-500/30">
                <PlusCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">إنشاء طلب جديد / فاتورة بيع</h3>
                <p className="text-xs text-slate-400">إضافة طلب للعميل وتخصيم المخزون وحساب الآجل آلياً</p>
              </div>
            </div>
          </div>
          <button onClick={openNewOrder} className="mt-4 w-full py-3 px-4 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            <span>فتح نافذة فاتورة البيع</span>
          </button>
        </div>

        <div className="dashboard-action-card dashboard-action-card--success bg-slate-900 border border-emerald-500/30 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 bg-emerald-600/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">تسديد / تحصيل دفعة مالية</h3>
                <p className="text-xs text-slate-400">تسجيل مقبوضات نقدية من عميل أو دفعات صادرة لمورد</p>
              </div>
            </div>
          </div>
          <button onClick={openPayment} className="mt-4 w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
            <CreditCard className="w-5 h-5" />
            <span>تسجيل إيصال جديد</span>
          </button>
        </div>
      </div>

      {/* Recent orders */}
      <div className="dashboard-recent bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4 v7-recent">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-brand-400" />
            <span>أحدث الطلبات والفواتير المسجلة</span>
          </h3>
          <button onClick={() => onNavigate && onNavigate('orders')} className="text-xs text-brand-400 hover:text-brand-300 font-bold flex items-center gap-1">
            <span>عرض كافة الفواتير</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>اسم العميل</th>
                <th>رقم الهاتف</th>
                <th>إجمالي الفاتورة</th>
                <th>المقدم</th>
                <th>المتبقي</th>
                <th>الحالة</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {s.recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-slate-500">لا توجد طلبات مسجلة حتى الآن</td>
                </tr>
              ) : (
                s.recentOrders.map(o => {
                  const remaining = getOrderRemainingAmount(o)
                  return (
                    <tr key={o.id}>
                      <td className="font-bold text-brand-400 num-font">{o.id}</td>
                      <td className="font-bold text-white">{o.customerName}</td>
                      <td className="num-font text-slate-300">{formatPhonePair(o.customerPhone, o.customerSecondaryPhone)}</td>
                      <td className="num-font font-bold text-white">{formatCurrency(o.totalAmount)}</td>
                      <td className="num-font text-emerald-400">{formatCurrency(o.downPayment)}</td>
                      <td className={`num-font font-bold ${remaining > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{formatCurrency(remaining)}</td>
                      <td><Badge variant={o.status === 'delivered' || o.status === 'completed' ? 'success' : o.status === 'returned' ? 'error' : o.status === 'cancelled' ? 'neutral' : 'warning'}>{getOrderStatusLabel(o.status)}</Badge></td>
                      <td className="text-xs text-slate-400 num-font">{formatDate(o.createdAt)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
