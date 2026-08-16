// =============================================================================
// ui/views/ReportsView.jsx — نسخة React من js/components/reports-view.js — Phase 8
// -----------------------------------------------------------------------------
// 4 تبويبات: «الأرباح والمبيعات» (بطاقات P&L + ملخص الخزينة + فواتير قيد
// الانتظار + جدول فواتير المبيعات بأزرار التفاصيل/تحديث الحالة) ثم «مصاريف
// التشغيل» (يعيد استخدام ExpensesView المبنية في المرحلة 7) ثم «كشف حساب
// عميل»/«كشف حساب مورد» (BankStatementTable المشترك مع StatementModal).
// الهيدر: إعادة احتساب الأرباح (recalculateTotals من الدومين) + مسح القواعد
// (WipeDatabaseModal) + تصدير كافة البيانات إلى Excel (من utils/excel).
// =============================================================================
import { useEffect, useMemo } from 'react'
import { BarChart3, RotateCcw, Trash2, Database, Filter, History, Wallet } from 'lucide-react'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import BankStatementTable from '../components/BankStatementTable.jsx'
import ExpensesView from './ExpensesView.jsx'
import { useReportsStore, filterOrdersSmart, computeTreasury, REPORT_TABS } from '@/state/reportsStore'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { useUiStore } from '../state/uiStore.js'
import { canRecalcOrWipe, canUpdateOrderStatus, canAdjustTreasury } from '@/services/permissions'
import { calculateNetProfit, getOrderRemainingAmount, getOrderShippingRevenue } from '@/domain/accounting/accounting'
import { recalculateTotals } from '@/domain/inventory/supplierReturns'
import { getTotalCustomerReceivables } from '@/domain/accounting/payments'
import { exportFullDatabaseToExcel } from '@/utils/excel'
import { resolveStatement } from '@/utils/statements'
import { formatCurrency, formatCompactCurrency, formatCurrencyEn, formatPhonePair, formatDate, round2 } from '@/utils/formatters'
import { showToast } from '../components/toastStore.js'

function StatCard({ label, value, hint, valueClass = 'text-white', className = '', fullValue }) {
  return (
    <div className={`p-4 rounded-xl border ${className || 'bg-slate-900/70 border-slate-800'}`}>
      <span className="text-xs text-slate-400 font-bold block mb-1">{label}</span>
      <span className={`text-lg font-extrabold num-font ${valueClass}`} title={fullValue || undefined}>{value}</span>
      {hint ? <span className="text-[10px] text-slate-500 block mt-1">{hint}</span> : null}
    </div>
  )
}

function OrderStatusBadge({ order }) {
  const remaining = getOrderRemainingAmount(order)
  if (order.status === 'returned') return <Badge variant="error">مرتجع (تم إرجاع المخزون)</Badge>
  if (order.status === 'cancelled') return <Badge variant="neutral">ملغي</Badge>
  if (order.status === 'new') return <Badge variant="warning">قيد الانتظار</Badge>
  if (remaining > 0) return <Badge variant="warning">آجل غير مسدد</Badge>
  return <Badge variant="success">مكتمل ومسدد</Badge>
}

function SalesOrderRow({ order, canUpdate }) {
  const remaining = getOrderRemainingAmount(order)
  return (
    <tr>
      <td className="font-bold text-brand-400 num-font">{order.id}</td>
      <td className="font-bold text-white">{order.customerName}</td>
      <td className="num-font text-slate-300 font-mono">{formatPhonePair(order.customerPhone, order.customerSecondaryPhone)}</td>
      <td className="num-font font-bold text-white">{formatCurrency(order.totalAmount)}</td>
      <td className="num-font text-emerald-400">{formatCurrency(order.downPayment)}</td>
      <td className={`num-font font-bold ${remaining > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{formatCurrency(remaining)}</td>
      <td><OrderStatusBadge order={order} /></td>
      <td className="text-xs text-slate-400 num-font">{formatDate(order.createdAt)}</td>
      <td>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => useUiStore.getState().openOrderDetailsModal(order.id)}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-all"
          >
            تفاصيل 📄
          </button>
          {canUpdate ? (
            <button
              onClick={() => useUiStore.getState().openOrderStatusModal(order.id, order.status, () => useReportsStore.getState().refresh())}
              className="px-2.5 py-1 bg-brand-600/20 hover:bg-brand-600/40 text-brand-300 text-xs font-bold rounded-lg border border-brand-500/30 transition-all"
            >
              تحديث 🔄
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function SalesReportBody({ data, canUpdate }) {
  const { filtered, calc, treasury, totalRemainingReceivables, pendingOrders, pendingTotalValue, pendingCollectedDeposits, pendingShippingDeposits } = data

  // V3.61 — «وضع الاختصار» (K/M): مفتاح واحد مشترك مع الداشبورد.
  const compact = useSettingsStore(s => s.compactNumbers)
  const fmt = n => compact ? formatCompactCurrency(n) : formatCurrencyEn(n)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
        <StatCard label="إجمالي مبيعات البضاعة" value={fmt(calc.itemsSales)} fullValue={formatCurrencyEn(calc.itemsSales)} hint="قيمة البضاعة فقط (بدون شحن/مصاريف العميل)" />
        <StatCard label="إجمالي الفواتير (شامل شحن العميل)" value={fmt(calc.grossSales)} fullValue={formatCurrencyEn(calc.grossSales)} hint="شحن/مصاريف العميل تُحصَّل لشركات الشحن ولا تدخل في الربح" />
        <StatCard label="تكلفة البضاعة المباعة (COGS)" value={fmt(calc.cogs)} fullValue={formatCurrencyEn(calc.cogs)} valueClass="text-amber-400" />
        <StatCard label="مصاريف الشحن والتشغيل للتاجر" value={fmt(calc.merchantExpenses)} fullValue={formatCurrencyEn(calc.merchantExpenses)} valueClass="text-purple-400" hint="شحن + مصروفات تحملها التاجر فقط (0 إذا دفعها العميل)" />
        <StatCard label="مصاريف التشغيل والإيجار" value={fmt(calc.totalOpExpenses)} fullValue={formatCurrencyEn(calc.totalOpExpenses)} valueClass="text-rose-400" />
        <StatCard
          label="صافي الربح الحقيقي 🎉"
          value={fmt(calc.netProfit)}
          fullValue={formatCurrencyEn(calc.netProfit)}
          valueClass={calc.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          className="bg-slate-900 rounded-xl border border-emerald-500/40"
        />
        <StatCard label="الديون والآجل لدى العملاء" value={fmt(totalRemainingReceivables)} fullValue={formatCurrencyEn(totalRemainingReceivables)} valueClass="text-rose-400" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
        <StatCard label="إجمالي المقبوضات (وارد الخزينة)" value={fmt(treasury.totalInflow)} fullValue={formatCurrencyEn(treasury.totalInflow)} valueClass="text-emerald-400" hint="محصَّل فعلي: عربون/تحصيل الفواتير (مقيَّد بسقف إجمالي الفاتورة فلا يتضاعف) + دفعات العملاء المستقلة + مردودات نقدية من الموردين" />
        <StatCard label="إجمالي المردودات والاستردادات (صادر)" value={fmt(treasury.totalRefunds)} fullValue={formatCurrencyEn(treasury.totalRefunds)} valueClass="text-rose-400" hint="مرتجعات + رد عربون الطلبات الملغاة (بدون استردادات الموردين فهي وارد)" />
        <StatCard label="مدفوعات الموردين (صادر)" value={fmt(treasury.totalSupplierPayments)} fullValue={formatCurrencyEn(treasury.totalSupplierPayments)} valueClass="text-orange-400" hint="تسديد دفعات/تحويلات للموردين — تخرج من صافي الخزينة ولا تُحتسب وارداً" />
        <StatCard label="صافي الخزينة النقدية" value={fmt(treasury.netTreasury)} fullValue={formatCurrencyEn(treasury.netTreasury)} />
        <StatCard label="عربون محتفظ به (إيراد تشغيلي)" value={fmt(calc.retainedDepositIncome)} fullValue={formatCurrencyEn(calc.retainedDepositIncome)} valueClass="text-amber-400" hint="عربون الملغي/المرتجع المحتفظ به عدا جزء الشحن المحجوز منفصلاً" />
        <StatCard label="إيراد خدمات شحن ونقل 🚚" value={fmt(calc.shippingRevenueIncome)} fullValue={formatCurrencyEn(calc.shippingRevenueIncome)} valueClass="text-sky-400" className="bg-sky-950/30 rounded-xl border border-sky-800/40" hint="عربون الشحن/التغليف المحصَّل بجميع الحالات (شامل قيد الانتظار) — بند منفصل لا يدخل في صافي ربح المنتجات" />
        <StatCard label="مردودات نقدية مستردة من الموردين 💸" value={fmt(calc.supplierCashRefunds)} fullValue={formatCurrencyEn(calc.supplierCashRefunds)} valueClass="text-teal-400" className="bg-teal-950/30 rounded-xl border border-teal-800/40" hint="كاش استُلم فعلياً من المورد مقابل مرتجع مشتريات — واردُ خزينة فقط ولا يدخل في صافي الربح (إرجاع بضاعة لا يولّد دخلاً)" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="فواتير قيد الانتظار (غير مؤكدة البيع)" value={`${pendingOrders.length} فاتورة`} valueClass="text-amber-400" className="bg-amber-950/20 rounded-xl border border-amber-800/40" hint="لم تُشحن بعد — لا تدخل في مبيعات البضاعة المؤكدة ولا صافي الربح" />
        <StatCard label="إجمالي قيمة فواتير قيد الانتظار" value={fmt(pendingTotalValue)} fullValue={formatCurrencyEn(pendingTotalValue)} className="bg-amber-950/20 rounded-xl border border-amber-800/40" hint="إجمالي الفاتورة (بضاعة + شحن/مصاريف العميل)" />
        <StatCard label="عربون محصَّل من قيد الانتظار (نقداً بالخزينة)" value={fmt(pendingCollectedDeposits)} fullValue={formatCurrencyEn(pendingCollectedDeposits)} valueClass="text-emerald-400" className="bg-amber-950/20 rounded-xl border border-amber-800/40" hint={`مقبوضات فعلية تظهر فوراً في وارد الخزينة — و${formatCurrencyEn(pendingShippingDeposits)} منها ضمن إيراد الشحن`} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-brand-400" />
            <span>جدول فواتير المبيعات والحالات</span>
          </h4>
          <span className="text-xs text-brand-400 font-bold bg-brand-500/10 px-2.5 py-1 rounded-lg border border-brand-500/20">
            عدد المعاملات: {filtered.length}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>رقم الفاتورة</th>
                <th>اسم العميل</th>
                <th>رقم الهاتف</th>
                <th>إجمالي الفاتورة</th>
                <th>المقدم</th>
                <th>المتبقي</th>
                <th>حالة الفاتورة</th>
                <th>التاريخ</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-slate-500">لا توجد مبيعات في النطاق المحدد</td>
                </tr>
              ) : (
                filtered.map(o => <SalesOrderRow key={o.id} order={o} canUpdate={canUpdate} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TreasuryMovementRow({ payment }) {
  const amount = Number(payment.amount) || 0
  const isInflow = amount >= 0
  const typeLabel =
    payment.type === 'supplierCashRefund'
      ? 'مردودات نقدية مستردة من مورد 💸'
      : payment.type === 'treasuryAdjustment'
        ? 'تسوية رصيد الخزينة ✏️'
        : 'حركة خزينة'
  return (
    <tr>
      <td className="text-xs text-slate-400 num-font whitespace-nowrap">{formatDate(payment.createdAt || payment.date)}</td>
      <td>
        <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${
          payment.type === 'treasuryAdjustment'
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            : 'bg-teal-500/20 text-teal-300 border-teal-500/30'
        }`}>
          {typeLabel}
        </span>
      </td>
      <td className="text-xs text-slate-300 max-w-[260px] whitespace-normal break-words">{payment.notes || '—'}</td>
      <td className={`num-font font-extrabold ${isInflow ? 'text-emerald-400' : 'text-slate-600'}`}>
        {isInflow ? formatCurrency(amount) : '—'}
      </td>
      <td className={`num-font font-extrabold ${isInflow ? 'text-slate-600' : 'text-rose-400'}`}>
        {isInflow ? '—' : formatCurrency(Math.abs(amount))}
      </td>
    </tr>
  )
}

function TreasuryPanel({ treasury, calc, canAdjust, payments }) {
  // V3.61 — «وضع الاختصار» (K/M): مفتاح واحد مشترك مع الداشبورد.
  const compact = useSettingsStore(s => s.compactNumbers)
  const fmt = n => compact ? formatCompactCurrency(n) : formatCurrencyEn(n)
  const movements = (payments || [])
    .filter(p => p.entityType === 'treasury')
    .slice()
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
  const totalInflow = round2((Number(treasury.totalInflow) || 0) + (Number(treasury.treasuryInflow) || 0))
  const totalOutflow = round2(
    (Number(treasury.totalRefunds) || 0) + (Number(treasury.totalSupplierPayments) || 0) + (Number(treasury.treasuryOutflow) || 0)
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>ملخص الخزينة النقدية ورصيد الصندوق</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-1">الرصيد الدفتري يُحسب من المقبوضات والمصروفات والمدفوعات وحركات الخزينة تلقائياً</p>
        </div>
        {canAdjust ? (
          <button
            onClick={() => useUiStore.getState().openTreasuryAdjustModal(() => useReportsStore.getState().refresh())}
            title="إدخال الجرد الفعلي للنقدية وتسجيل قيد تسوية يصحح رصيد الصندوق ليطابق الواقع"
            className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 text-xs font-bold rounded-xl border border-emerald-500/40 transition-all flex items-center gap-1.5"
          >
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>تسوية / ضبط رصيد الخزينة ✏️</span>
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard
          label="صافي رصيد الخزينة الحالي"
          value={fmt(treasury.netTreasury)}
          fullValue={formatCurrencyEn(treasury.netTreasury)}
          valueClass={treasury.netTreasury >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          className="bg-slate-900 rounded-xl border border-emerald-500/40"
        />
        <StatCard label="إجمالي الوارد (محصلات + مردودات + تسويات)" value={fmt(totalInflow)} fullValue={formatCurrencyEn(totalInflow)} valueClass="text-emerald-400" />
        <StatCard label="إجمالي الصادر (استردادات + مدفوعات + تسويات)" value={fmt(totalOutflow)} fullValue={formatCurrencyEn(totalOutflow)} valueClass="text-rose-400" />
        <StatCard label="مردودات نقدية مستردة من الموردين" value={fmt(calc.supplierCashRefunds)} fullValue={formatCurrencyEn(calc.supplierCashRefunds)} valueClass="text-teal-400" />
        <StatCard label="مدفوعات الموردين" value={fmt(treasury.totalSupplierPayments)} fullValue={formatCurrencyEn(treasury.totalSupplierPayments)} valueClass="text-orange-400" />
        <StatCard label="استردادات العملاء (صادر)" value={fmt(treasury.totalRefunds)} fullValue={formatCurrencyEn(treasury.totalRefunds)} valueClass="text-rose-400" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-brand-400" />
            <span>حركات الخزينة المسجلة (مردودات مستردة + تسويات)</span>
          </h4>
          <span className="text-xs text-brand-400 font-bold bg-brand-500/10 px-2.5 py-1 rounded-lg border border-brand-500/20">
            عدد الحركات: {movements.length}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>نوع الحركة</th>
                <th>البيان</th>
                <th>وارد</th>
                <th>صادر</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-slate-500">
                    لا توجد حركات خزينة مباشرة مسجلة — تُضاف هنا مردودات الموردين النقدية وقيد التسوية اليدوية
                  </td>
                </tr>
              ) : (
                movements.map(p => <TreasuryMovementRow key={p.id} payment={p} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ReportsView() {
  const tab = useReportsStore(s => s.tab)
  const dateFrom = useReportsStore(s => s.dateFrom)
  const dateTo = useReportsStore(s => s.dateTo)
  const customerId = useReportsStore(s => s.customerId)
  const supplierId = useReportsStore(s => s.supplierId)
  const orders = useReportsStore(s => s.orders)
  const payments = useReportsStore(s => s.payments)
  const expenses = useReportsStore(s => s.expenses)
  const customers = useReportsStore(s => s.customers)
  const suppliers = useReportsStore(s => s.suppliers)
  const refresh = useReportsStore(s => s.refresh)
  const setTab = useReportsStore(s => s.setTab)
  const setDateFrom = useReportsStore(s => s.setDateFrom)
  const setDateTo = useReportsStore(s => s.setDateTo)
  const resetDateFilter = useReportsStore(s => s.resetDateFilter)
  const setCustomerId = useReportsStore(s => s.setCustomerId)
  const setSupplierId = useReportsStore(s => s.setSupplierId)

  // 🔒 V3.43 — المحاسب يقرأ التقارير ويصدّرها، لكن «إعادة الاحتساب» و«تصفير
  // القواعد» (كتابة تدميرية) للمدير فقط.
  const role = useAuthStore(s => s.role)
  const canUpdate = canUpdateOrderStatus(role)
  const canWipe = canRecalcOrWipe(role)
  const canAdjust = canAdjustTreasury(role)

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (tab === 'customer' && customers.length && !customerId) setCustomerId(customers[0].id)
  }, [tab, customers, customerId, setCustomerId])

  useEffect(() => {
    if (tab === 'supplier' && suppliers.length && !supplierId) setSupplierId(suppliers[0].id)
  }, [tab, suppliers, supplierId, setSupplierId])

  const salesData = useMemo(() => {
    const filtered = filterOrdersSmart(orders, dateFrom, dateTo)
    const calc = calculateNetProfit(filtered, {
      getExpenses: () => expenses,
      ...(window.getCurrentOperatingExpenses
        ? { getCurrentOperatingExpenses: () => window.getCurrentOperatingExpenses() }
        : {}),
      getSupplierReturns: () => (window.getSupplierReturns ? window.getSupplierReturns() : []),
    })
    const treasury = computeTreasury(payments, orders)
    const pendingOrders = filtered.filter(o => o.status === 'new')
    const pendingTotalValue = pendingOrders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)
    const pendingCollectedDeposits = pendingOrders.reduce((s, o) => s + (Number(o.downPayment) || 0), 0)
    const pendingShippingDeposits = pendingOrders.reduce((s, o) => s + getOrderShippingRevenue(o), 0)
    return {
      filtered,
      calc,
      treasury,
      totalRemainingReceivables: getTotalCustomerReceivables(orders),
      pendingOrders,
      pendingTotalValue,
      pendingCollectedDeposits,
      pendingShippingDeposits,
    }
  }, [orders, payments, expenses, dateFrom, dateTo])

  const customerOptions = customers.map(c => ({ value: c.id, label: `${c.name} (${c.phone})` }))
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }))

  const recalcTotalsAction = () => {
    try {
      const repo = {
        getSupplierReturns: () => window.getCollection(window.STORAGE_KEYS.SUPPLIER_RETURNS),
        getPayments: () => window.getCollection(window.STORAGE_KEYS.PAYMENTS),
        getSuppliers: () => window.getCollection(window.STORAGE_KEYS.SUPPLIERS),
        getSupplierTransactions: () => window.getCollection(window.STORAGE_KEYS.SUPPLIER_TRANSACTIONS),
        createPaymentRecord: input => window.createPaymentRecord(input),
        logSupplierTransaction: txn => window.logSupplierTransaction(txn),
        updateSupplier: (id, fields) => window.updateSupplier(id, fields),
      }
      const restated = recalculateTotals(repo)
      showToast('تمت إعادة احتساب الأرباح والتقارير بنجاح' + (restated > 0 ? ` — تم ترميم ${restated} قيد` : ''), 'success')
      useReportsStore.getState().refresh()
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    }
  }

  const exportFullDb = () => {
    exportFullDatabaseToExcel()
  }

  const openWipe = () => useUiStore.getState().openWipeDatabaseModal()

  const applyDateFilter = () => {
    showToast(`تم تطبيق فلتر التاريخ من (${dateFrom || 'البداية'}) إلى (${dateTo || 'الآن'})`, 'info')
  }

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 v7-page-hero">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-teal-400" />
            <span>التقارير اليومية، صافي الأرباح ومصاريف التشغيل</span>
          </h1>
          <p className="text-sm text-slate-400">حساب صافي الأرباح الحقيقي، تتبع المصروفات الإدارية، وإدارة حالات الفواتير والمرتجعات</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canWipe ? (
            <button
              onClick={recalcTotalsAction}
              title="إعادة بناء سجل مرتجعات الموردين وإعادة احتساب الأرصدة والأرباح والتقارير من المصادر الأصلية"
              className="px-3.5 py-2 bg-brand-600/20 hover:bg-brand-600/40 text-brand-300 text-xs font-bold rounded-xl border border-brand-500/40 transition-all flex items-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4 text-brand-400" />
              <span>إعادة احتساب الأرباح والتقارير</span>
            </button>
          ) : null}

          {canWipe ? (
            <button
              onClick={openWipe}
              title="حذف مسودات البيانات التجريبية نهائياً من القواعد السحابية"
              className="px-3.5 py-2 bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs font-bold rounded-xl border border-rose-800 transition-all flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>تصفير ومسح القواعد السحابية 🔒</span>
            </button>
          ) : null}

          <button
            onClick={exportFullDb}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-2"
          >
            <Database className="w-4 h-4" />
            <span>تصدير كافة بيانات النظام إلى Excel موحد</span>
          </button>
        </div>
      </div>

      {/* Date Filter Bar & Report Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-2 bg-slate-800/80 p-1.5 rounded-xl border border-slate-700 w-fit">
          {REPORT_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'report-tab-btn px-4 py-2 rounded-lg text-xs font-bold transition-all',
                tab === t.id ? 'text-white bg-brand-600 shadow-sm' : 'text-slate-400 hover:text-white',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Input label="من:" type="date" value={dateFrom} onChange={setDateFrom} className="num-font" />
          </div>
          <div className="w-40">
            <Input label="إلى:" type="date" value={dateTo} onChange={setDateTo} className="num-font" />
          </div>
          <Button variant="primary" icon={Filter} onClick={applyDateFilter} className="text-xs">تطبيق التاريخ</Button>
          <Button variant="secondary" onClick={resetDateFilter} className="text-xs">إعادة ضبط</Button>
        </div>
      </div>

      {/* Dynamic Report Body */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-6">
        {tab === 'sales' ? <SalesReportBody data={salesData} canUpdate={canUpdate} /> : null}
        {tab === 'expenses' ? <ExpensesView /> : null}
        {tab === 'customer' ? (
          <div className="space-y-4">
            <div className="w-full sm:w-80">
              <Select label="اختر العميل:" value={customerId} onChange={setCustomerId} options={customerOptions} placeholder={customers.length ? undefined : 'لا يوجد عملاء مسجلين'} />
            </div>
            <div className="pt-2">
              {customerId ? (
                <BankStatementTable {...resolveStatement('customer', customerId)} />
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">لا توجد بيانات عميل متاحة</p>
              )}
            </div>
          </div>
        ) : null}
        {tab === 'supplier' ? (
          <div className="space-y-4">
            <div className="w-full sm:w-80">
              <Select label="اختر المورد / المصنع:" value={supplierId} onChange={setSupplierId} options={supplierOptions} placeholder={suppliers.length ? undefined : 'لا يوجد موردين مسجلين'} />
            </div>
            <div className="pt-2">
              {supplierId ? (
                <BankStatementTable {...resolveStatement('supplier', supplierId)} />
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">لا توجد بيانات مورد متاحة</p>
              )}
            </div>
          </div>
        ) : null}
        {tab === 'treasury' ? <TreasuryPanel treasury={salesData.treasury} calc={salesData.calc} canAdjust={canAdjust} payments={payments} /> : null}
      </div>
    </div>
  )
}

export default ReportsView
