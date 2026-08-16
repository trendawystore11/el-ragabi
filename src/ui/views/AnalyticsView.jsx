// =============================================================================
// ui/views/AnalyticsView.jsx — لوحة تحليل البيانات (V4)
// -----------------------------------------------------------------------------
// محاور v1: مبيعات + ربحية + عملاء/ديون، مع شريط فلاتر ديناميكي
// (الفترة / العميل / التصنيف / الكاشير / نوع التنفيذ / الحالة).
// كل الحسابات من دومين التحليل النقي (domain/analytics) والمكتبة Recharts
// للرسوم، ويتحدّث تلقائياً مع bms-data-synced. متاحة للمدير والمحاسب فقط.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import {
  BarChart3,
  TrendingUp,
  ShoppingBag,
  Receipt,
  Coins,
  Percent,
  WalletCards,
  UsersRound,
  RotateCcw,
  CalendarDays,
  Filter,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { canSeeDashboard } from '@/services/permissions'
import { getOrderStatusLabel } from '@/domain/accounting/accounting'
import {
  computeAnalyticsKPIs,
  computeSalesTrend,
  computePeriodGrowth,
  computeTopProducts,
  computeTopCustomers,
  computeTopDebtors,
  computeCategoryMix,
  collectFilterOptions,
  granularityForRange,
  resolveRange,
} from '@/domain/analytics/analytics'
import { formatCurrencyEn, formatCompactCurrency } from '@/utils/formatters'
import {
  CHART_GRID_DASH,
  PROFIT_COLOR,
  brandAccent,
  brandPiePalette,
  chartGridColor,
  chartAxisColor,
  tooltipSurface,
} from '../charts/themeColors.js'

const PERIODS = [
  { id: 'today', label: 'اليوم' },
  { id: '7d', label: '7 أيام' },
  { id: '30d', label: '30 يوم' },
  { id: 'month', label: 'الشهر' },
  { id: 'custom', label: 'مخصص' },
]

const EXEC_OPTIONS = [
  { value: 'direct', label: 'شحن مباشر' },
  { value: 'stock', label: 'من المخزون' },
  { value: 'mixed', label: 'مختلط' },
]

const STATUS_OPTIONS = ['new', 'delivered', 'completed', 'returned', 'cancelled']

function readOrders() {
  return window.getOrders ? window.getOrders() : []
}

// HDI — بطاقة KPI بنفس نمط لوحة التحكم.
function KpiCard({ label, icon: Icon, value, valueClass, hint, fullValue }) {
  return (
    <div
      title={fullValue || undefined}
      className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-lg relative overflow-hidden text-right v7-kpi"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-400">{label}</span>
        <div className="p-2 rounded-xl border bg-brand-500/10 text-brand-400 border-brand-500/20">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={`text-2xl font-extrabold num-font mb-1 ${valueClass || 'text-white'}`}>{value}</div>
      {hint ? <span className="text-[10px] text-slate-400">{hint}</span> : null}
    </div>
  )
}

// HDI — عنوان قسم.
function SectionTitle({ title, subtitle }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 v7-section-title">
      <span className="w-1 h-4 rounded-full bg-brand-500" />
      <h2 className="text-sm font-bold text-slate-200">{title}</h2>
      {subtitle ? <span className="text-[11px] text-slate-500 font-normal">{subtitle}</span> : null}
    </div>
  )
}

// HDI — تلميح أدوات موحّد بالعملة الكاملة وألوان أسطح الثيم نفسها.
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const surface = tooltipSurface()
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs shadow-xl"
      style={{ background: surface.bg, border: `1px solid ${surface.border}` }}
    >
      <div className="font-bold mb-1" style={{ color: surface.text }}>{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2" style={{ color: surface.dim }}>
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span>{p.name}:</span>
          <span className="font-bold num-font" dir="ltr" style={{ color: surface.text }}>{formatCurrencyEn(Number(p.value) || 0)}</span>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsView() {
  const role = useAuthStore(s => s.role)
  const compact = useSettingsStore(s => s.compactNumbers)
  const theme = useSettingsStore(s => s.theme)
  const primaryColor = useSettingsStore(s => s.primaryColor)
  const fmt = n => compact ? formatCompactCurrency(n) : formatCurrencyEn(n)

  // V4 — ألوان الرسوم مربوطة بثيم النظام: تُعاد قراءة CSS vars فور تغيير
  // اللون الأساسي/الظاهر، فلا ألوان نيون عشوائية منفصلة عن هوية التطبيق.
  const chart = useMemo(() => ({
    accent: brandAccent(),        // المبيعات/الإيراد ← لون الهوية (نفس خط v7-chart-line)
    profit: PROFIT_COLOR,         // الربح ← emerald-500
    pie: brandPiePalette(),       // الرسم الدائري ← تدرج أحادي العائلة
    grid: chartGridColor(),       // الشبكة ← نص الثيم بشفافية 9%
    axis: chartAxisColor(),       // المحاور ← نص ثانوي من الثيم
  // eslint-disable-next-line react-hooks/exhaustive-deps -- القيمتان عنصر إعادة حساب لازم
  }), [theme, primaryColor])

  const [orders, setOrders] = useState([])
  const [period, setPeriod] = useState('30d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [category, setCategory] = useState('')
  const [cashier, setCashier] = useState('')
  const [execution, setExecution] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    const initial = resolveRange('30d')
    setFrom(initial.from)
    setTo(initial.to)
    const refresh = () => setOrders(readOrders())
    refresh()
    window.addEventListener('bms-data-synced', refresh)
    return () => window.removeEventListener('bms-data-synced', refresh)
  }, [])

  const filters = useMemo(() => ({ from, to, customerId, category, cashier, execution, status }),
    [from, to, customerId, category, cashier, execution, status])

  const options = useMemo(() => collectFilterOptions(orders), [orders])
  const kpis = useMemo(() => computeAnalyticsKPIs(orders, filters), [orders, filters])
  const growth = useMemo(() => computePeriodGrowth(orders, filters), [orders, filters])
  const granularity = granularityForRange(from, to)
  const trend = useMemo(() => computeSalesTrend(orders, filters, granularity), [orders, filters, granularity])
  const topProducts = useMemo(() => computeTopProducts(orders, filters, 8), [orders, filters])
  const topCustomers = useMemo(() => computeTopCustomers(orders, filters, 8), [orders, filters])
  const topDebtors = useMemo(() => computeTopDebtors(orders, filters, 8), [orders, filters])
  const categoryMix = useMemo(() => computeCategoryMix(orders, filters), [orders, filters])

  const applyPeriod = (p) => {
    if (p === 'custom') { setPeriod('custom'); return }
    const r = resolveRange(p)
    setPeriod(p)
    setFrom(r.from)
    setTo(r.to)
  }
  const resetFilters = () => {
    setCustomerId(''); setCategory(''); setCashier(''); setExecution(''); setStatus('')
    applyPeriod('30d')
  }

  // 🔒 V4 — لوحة التحليل مالية: متاحة للمدير والمحاسب فقط.
  if (role && !canSeeDashboard(role)) {
    return (
      <div className="grid place-items-center min-h-[60vh] animate-fadeIn">
        <div className="text-center bg-slate-900/60 p-8 rounded-2xl border border-slate-800 max-w-md">
          <ShieldAlert className="w-12 h-12 text-rose-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">لوحة التحليل غير متاحة لهذا الحساب</h2>
          <p className="text-sm text-slate-400">تحليل المبيعات والربحية والديون متاح لمدير المتجر والمحاسب فقط.</p>
        </div>
      </div>
    )
  }

  const selectCls = 'bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:border-brand-500 outline-none transition-colors'
  const noData = !orders.length

  return (
    <div className="analytics-view space-y-6 animate-fadeIn v7-view">
      {/* Hero */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 shadow-sm v7-page-hero">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-400" />
            <span>لوحة تحليل البيانات</span>
          </h1>
          <p className="text-sm text-slate-400">مبيعات، ربحية، عملاء وديون — بفلاتر ديناميكية وتحليل مقارن للفترات</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {growth ? (
            <div className="flex items-center gap-2 text-xs font-semibold bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/80">
              {growth.growthPct >= 0
                ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                : <ArrowDownRight className="w-4 h-4 text-rose-400" />}
              <span className="text-slate-300">نمو المبيعات</span>
              <span className={`font-extrabold num-font ${growth.growthPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {growth.growthPct >= 0 ? '+' : ''}{growth.growthPct}%
              </span>
              <span className="text-slate-500">مقارنة بالفترة السابقة</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/80">
            <CalendarDays className="w-4 h-4 text-brand-400" />
            <span className="num-font" dir="ltr">{from} ← {to}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg v7-filter-bar">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5" /> الفترة
          </span>
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => applyPeriod(p.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                period === p.id
                  ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                  : 'bg-slate-800/70 text-slate-300 border-slate-700/80 hover:border-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPeriod('custom') }}
              className={`${selectCls} num-font [color-scheme:dark]`}
              aria-label="من تاريخ"
            />
            <span className="text-slate-500 text-xs">إلى</span>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPeriod('custom') }}
              className={`${selectCls} num-font [color-scheme:dark]`}
              aria-label="إلى تاريخ"
            />
          </div>
          <button
            onClick={resetFilters}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-700/80 text-slate-400 hover:text-white hover:border-slate-600 transition-all flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> إعادة الضبط
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={selectCls} aria-label="العميل">
            <option value="">كل العملاء</option>
            {options.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls} aria-label="تصنيف العميل">
            <option value="">كل التصنيفات</option>
            {options.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={cashier} onChange={(e) => setCashier(e.target.value)} className={selectCls} aria-label="الكاشير">
            <option value="">كل الكاشير</option>
            {options.cashiers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={execution} onChange={(e) => setExecution(e.target.value)} className={selectCls} aria-label="نوع التنفيذ">
            <option value="">كل أنواع التنفيذ</option>
            {EXEC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="حالة الطلب">
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{getOrderStatusLabel(s)}</option>)}
          </select>
        </div>
      </div>

      {noData ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-16 text-center shadow-lg">
          <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-300 mb-1">لا توجد بيانات بعد</h3>
          <p className="text-sm text-slate-500">ستظهر التحليلات والرسوم البيانية فور تسجيل أول فواتير.</p>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="v7-dash-row">
            <SectionTitle title="ملخص الأداء" subtitle="ضمن الفترة والفلاتر الحالية" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 v7-kpi-grid">
              <KpiCard label="إجمالي المبيعات" icon={TrendingUp} value={fmt(kpis.totalSales)} fullValue={formatCurrencyEn(kpis.totalSales)} hint="إجمالي الفواتير المؤكدة" />
              <KpiCard label="عدد الفواتير" icon={Receipt} value={`${kpis.orderCount} فواتير`} hint="المؤكدة فقط" />
              <KpiCard label="متوسط الفاتورة" icon={ShoppingBag} value={fmt(kpis.avgOrderValue)} fullValue={formatCurrencyEn(kpis.avgOrderValue)} hint="مبيعات ÷ عدد الفواتير" />
              <KpiCard label="صافي الربح" icon={Coins} value={fmt(kpis.grossProfit)} fullValue={formatCurrencyEn(kpis.grossProfit)} valueClass={kpis.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'} hint="بعد التكلفة ومصاريف التاجر" />
              <KpiCard label="هامش الربح" icon={Percent} value={`${kpis.profitMargin}%`} fullValue={`${formatCurrencyEn(kpis.grossProfit)} من ${formatCurrencyEn(kpis.totalSales)}`} valueClass={kpis.profitMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'} hint="ربح ÷ مبيعات" />
              <KpiCard label="ديون العملاء" icon={WalletCards} value={fmt(kpis.receivables)} fullValue={formatCurrencyEn(kpis.receivables)} valueClass={kpis.receivables > 0 ? 'text-amber-400' : 'text-slate-200'} hint="المتبقي على الفواتير الفعالة" />
            </div>
          </div>

          {/* Trend */}
          <div className="v7-dash-row">
            <SectionTitle title="اتجاه المبيعات والربح" subtitle={`${granularity === 'month' ? 'شهرياً' : 'يومياً'} ضمن الفترة المحددة`} />
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg v7-chart-card">
              <div dir="ltr" className="w-full">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.accent} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={chart.accent} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.profit} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={chart.profit} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={chart.grid} />
                    <XAxis dataKey="label" stroke={chart.axis} fontSize={11} tickMargin={8} />
                    <YAxis stroke={chart.axis} fontSize={11} tickFormatter={(v) => formatCompactCurrency(Number(v) || 0)} width={64} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="sales" name="المبيعات" stroke={chart.accent} strokeWidth={2} fill="url(#gradSales)" />
                    <Area type="monotone" dataKey="profit" name="الربح" stroke={chart.profit} strokeWidth={2} fill="url(#gradProfit)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Products + categories */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="v7-dash-row">
              <SectionTitle title="المنتجات الأكثر مبيعاً" subtitle="الأعلى إيراداً بين الفواتير المؤكدة" />
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg v7-chart-card">
                <div dir="ltr" className="w-full">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={topProducts} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={chart.grid} horizontal={false} />
                      <XAxis type="number" stroke={chart.axis} fontSize={11} tickFormatter={(v) => formatCompactCurrency(Number(v) || 0)} />
                      <YAxis type="category" dataKey="name" width={130} stroke={chart.axis} fontSize={11} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="revenue" name="الإيراد" fill={chart.accent} radius={[0, 6, 6, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="v7-dash-row">
              <SectionTitle title="توزيع المبيعات حسب تصنيف العملاء" subtitle="الحصة من إجمالي المبيعات المؤكدة" />
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg v7-chart-card">
                {categoryMix.length ? (
                  <div dir="ltr" className="w-full">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={categoryMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={3} strokeWidth={0}>
                          {categoryMix.map((_, i) => <Cell key={i} fill={chart.pie[i % chart.pie.length]} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="py-20 text-center text-sm text-slate-500">لا توجد بيانات تصنيف ضمن الفلاتر الحالية</div>
                )}
              </div>
            </div>
          </div>

          {/* Customers + debtors */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="v7-dash-row">
              <SectionTitle title="أعلى العملاء شراءً" subtitle="بإجمالي فواتيرهم المؤكدة" />
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg v7-chart-card">
                <div dir="ltr" className="w-full">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={topCustomers} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={chart.grid} horizontal={false} />
                      <XAxis type="number" stroke={chart.axis} fontSize={11} tickFormatter={(v) => formatCompactCurrency(Number(v) || 0)} />
                      <YAxis type="category" dataKey="name" width={130} stroke={chart.axis} fontSize={11} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="sales" name="المبيعات" fill={chart.accent} radius={[0, 6, 6, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="v7-dash-row">
              <SectionTitle title="أكبر المدينين" subtitle="أعلى رصيد متبقٍ على الفواتير الفعالة" />
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-right">العميل</th>
                        <th className="px-4 py-3 text-right">الطلبات</th>
                        <th className="px-4 py-3 text-right">المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topDebtors.length ? topDebtors.map(d => (
                        <tr key={d.name} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-bold text-slate-200 flex items-center gap-2">
                            <UsersRound className="w-4 h-4 text-amber-400" /> {d.name}
                          </td>
                          <td className="px-4 py-3 num-font text-slate-300">{d.orders}</td>
                          <td className="px-4 py-3 num-font font-extrabold text-amber-400">{fmt(d.remaining)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan="3" className="px-4 py-10 text-center text-slate-500">لا توجد ديون ضمن الفلاتر الحالية</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
