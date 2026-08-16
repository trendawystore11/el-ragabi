// =============================================================================
// ui/views/PaymentsView.jsx — نسخة React من renderPaymentsView (payments-view.js) — Phase 9
// -----------------------------------------------------------------------------
// سجل التحصيلات والمدفوعات: بحث + جدول الدفعات (رقم الإيصال / الجهة / الاسم /
// المبلغ / طريقة الدفع / الملاحظات / التاريخ / المسجل) + زر «تسجيل دفعة جديدة»
// (للمدير فقط عبر uiStore.openPaymentModal → PaymentModal). البيانات من
// paymentsStore (لقطة من window.getPayments) والترتيب/البحث من
// domain/accounting/payments.searchPayments (نفس window.searchPayments القديم).
// =============================================================================
import { useMemo, useEffect } from 'react'
import { HandCoins, Plus, Search } from 'lucide-react'
import Button from '../components/Button.jsx'
import { usePaymentsStore } from '@/state/paymentsStore'
import { searchPayments } from '@/domain/accounting/payments'
import { useUiStore } from '../state/uiStore.js'
import { formatCurrency, formatDate } from '@/utils/formatters'

function paymentMethodLabel(method) {
  if (method === 'cash') return 'نقدي (كاش)'
  if (method === 'transfer') return 'تحويل بنكي / فودافون كاش'
  if (method === 'check') return 'شيك بنكي'
  return 'أخرى'
}

function paymentBadge(payment) {
  const isRefund = (Number(payment.amount) || 0) < 0
  if (payment.entityType === 'treasury') {
    if (payment.type === 'supplierCashRefund') {
      return { label: 'مردودات نقدية مستردة (وارد خزينة)', cls: 'bg-teal-500/20 text-teal-300 border border-teal-500/30' }
    }
    if (payment.type === 'treasuryAdjustment') {
      return { label: 'تسوية رصيد الخزينة', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' }
    }
    return { label: 'حركة خزينة', cls: 'bg-slate-500/20 text-slate-300 border border-slate-500/30' }
  }
  if (payment.entityType === 'supplier' && payment.type === 'supplierCollection') {
    return { label: 'تحصيل نقدية من مورد (قبض)', cls: 'bg-teal-500/20 text-teal-300 border border-teal-500/30' }
  }
  if (isRefund) {
    return { label: 'استرداد / رد عربون (صادر)', cls: 'bg-rose-500/20 text-rose-300 border border-rose-500/30' }
  }
  if (payment.entityType === 'customer') {
    return { label: 'تحصيل من عميل', cls: 'bg-sky-500/20 text-sky-300 border border-sky-500/30' }
  }
  return { label: 'تسديد لمورد', cls: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' }
}

function PaymentRow({ payment }) {
  const isRefund = (Number(payment.amount) || 0) < 0
  const isSupplierCollection = payment.entityType === 'supplier' && payment.type === 'supplierCollection'
  const isTreasuryInflow = payment.entityType === 'treasury' && !isRefund
  const { label: typeBadge, cls: badgeClass } = paymentBadge(payment)

  // V3.62 — قيد التحصيل من المورد مخزَّن بقيمة سالبة (مثل convention استرداد
  // كاش legacy) لكنه قبض وارد لصالح الخزينة → نعرضه موجَباً بأخضر/سماوي.
  const displayAmount = isSupplierCollection ? Math.abs(Number(payment.amount)) : Number(payment.amount)

  return (
    <tr>
      <td className="font-bold text-slate-400 font-mono num-font">{payment.id}</td>
      <td>
        <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${badgeClass}`}>{typeBadge}</span>
      </td>
      <td className="font-bold text-white">{payment.entityName}</td>
      <td className={`num-font font-extrabold ${isRefund && !isSupplierCollection ? 'text-rose-400' : isTreasuryInflow || isSupplierCollection ? 'text-teal-400' : 'text-emerald-400'} text-base`}>
        {formatCurrency(displayAmount)}
      </td>
      <td className="text-xs text-slate-300">{paymentMethodLabel(payment.paymentMethod)}</td>
      <td className="text-slate-400 text-xs whitespace-normal break-words">{payment.notes || '—'}</td>
      <td className="text-xs text-slate-400 num-font whitespace-nowrap">
        {formatDate(payment.createdAt || payment.date)}
      </td>
      <td className="text-xs text-slate-400">{payment.createdBy || 'المدير العام'}</td>
    </tr>
  )
}

function PaymentsView() {
  const payments = usePaymentsStore(s => s.payments)
  const search = usePaymentsStore(s => s.search)
  const setSearch = usePaymentsStore(s => s.setSearch)
  const refresh = usePaymentsStore(s => s.refresh)

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(() => searchPayments(payments, search), [payments, search])

  const openRecordModal = () =>
    useUiStore.getState().openPaymentModal({}, () => usePaymentsStore.getState().refresh())

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 v7-page-hero">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <HandCoins className="w-6 h-6 text-emerald-400" />
            <span>إدارة التحصيلات والمدفوعات</span>
          </h1>
          <p className="text-sm text-slate-400">تسجيل المقبوضات النقدية من العملاء والمصروفة للموردين مع تحديث الأرصدة آلياً</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالمبلغ، الاسم، الملاحظات..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-all"
            />
          </div>
          <Button variant="success" icon={Plus} onClick={openRecordModal}>
            تسجيل دفعة جديدة
          </Button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>رقم الإيصال</th>
                <th>الجهة (عميل / مورد)</th>
                <th>الاسم</th>
                <th>المبلغ</th>
                <th>طريقة الدفع</th>
                <th>الملاحظات</th>
                <th>التاريخ</th>
                <th>المسجل</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-500">
                    لا توجد مدفوعات مسجلة مطابقة للبحث
                  </td>
                </tr>
              ) : (
                rows.map(p => <PaymentRow key={p.id} payment={p} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default PaymentsView
