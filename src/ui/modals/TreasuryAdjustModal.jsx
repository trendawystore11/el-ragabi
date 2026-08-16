// =============================================================================
// ui/modals/TreasuryAdjustModal.jsx — نافذة تسوية / ضبط رصيد الخزينة — V3.54
// -----------------------------------------------------------------------------
// يعرض الرصيد الدفتري الحالي للخزينة (netTreasury) ويطلب الجرد الفعلي للنقدية.
// الفرق = الجرد الفعلي − الرصيد الدفتري يُسجَّل قيد حركة «تسوية رصيد الخزينة»
// عبر window.createPaymentRecord (entityType: treasury) فيظهر فوراً في الخزينة
// ودفتر المدفوعات. الوصول للمدير فقط (canAdjustTreasury في uiStore).
// =============================================================================
import { useState, useMemo } from 'react'
import { Wallet } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { computeTreasury } from '@/state/reportsStore'
import { formatCurrency, getCairoFormattedDate } from '@/utils/formatters'

function currentTreasuryBalance() {
  const payments = typeof window.getPayments === 'function' ? window.getPayments() : []
  const orders = typeof window.getOrders === 'function' ? window.getOrders() : []
  return computeTreasury(payments, orders).netTreasury
}

function TreasuryAdjustModal() {
  const open = useUiStore(s => s.treasuryAdjustModal.open)
  if (!open) return null
  return <TreasuryAdjustModalInner />
}

function TreasuryAdjustModalInner() {
  const { onDone } = useUiStore(s => s.treasuryAdjustModal)
  const close = useUiStore(s => s.closeTreasuryAdjustModal)

  const currentBalance = useMemo(() => currentTreasuryBalance(), [])

  const [actualCash, setActualCash] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const parsed = actualCash === '' || actualCash === null ? null : Number(actualCash)
  const diff = parsed !== null && Number.isFinite(parsed)
    ? Math.round((parsed - currentBalance) * 100) / 100
    : null

  const handleSubmit = e => {
    e.preventDefault()
    if (submitting) return
    if (parsed === null || !Number.isFinite(parsed)) {
      showToast('يرجى إدخال قيمة الجرد الفعلي للنقدية بالخزينة', 'error')
      return
    }
    if (Math.abs(diff) < 0.005) {
      showToast('الرصيد الدفتري مطابق تماماً للجرد الفعلي — لا يوجد فرق للتسوية', 'info')
      return
    }

    const user = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null
    setSubmitting(true)
    try {
      window.createPaymentRecord({
        entityType: 'treasury',
        entityId: 'TREASURY',
        entityName: 'الخزينة',
        amount: diff,
        date: getCairoFormattedDate().slice(0, 10),
        paymentMethod: 'cash',
        notes: `تسوية رصيد الخزينة — الدفتر ${formatCurrency(currentBalance)}، الجرد الفعلي ${formatCurrency(parsed)}، الفرق ${formatCurrency(diff)}`,
        type: 'treasuryAdjustment',
        createdBy: user && user.name ? user.name : 'المدير العام',
      })
      showToast(
        diff > 0
          ? `تم تسجيل تسوية الخزينة: وارد ${formatCurrency(diff)} — الرصيد الآن ${formatCurrency(parsed)}`
          : `تم تسجيل تسوية الخزينة: صادر ${formatCurrency(Math.abs(diff))} — الرصيد الآن ${formatCurrency(parsed)}`,
        'success'
      )
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title="💰 تسوية / ضبط رصيد الخزينة" icon={Wallet} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-emerald-950/30 rounded-xl border border-emerald-800/40 flex justify-between items-center text-sm">
          <span className="text-emerald-300 font-bold">الرصيد الدفتري الحالي بالخزينة:</span>
          <span className="text-lg font-extrabold text-emerald-400 num-font">{formatCurrency(currentBalance)}</span>
        </div>

        <Input
          label="الجرد الفعلي للنقدية (ما في الصندوق فعلياً) *"
          type="number"
          step="0.01"
          value={actualCash}
          onChange={setActualCash}
          placeholder="مثال: 50000"
          className="num-font"
          autoFocus
        />

        {diff !== null ? (
          <div
            className={`p-3 rounded-xl border flex justify-between items-center text-sm ${
              diff === 0
                ? 'bg-slate-800/60 border-slate-700'
                : diff > 0
                  ? 'bg-emerald-950/30 border-emerald-800/40'
                  : 'bg-rose-950/30 border-rose-800/40'
            }`}
          >
            <span className={`font-bold ${diff === 0 ? 'text-slate-300' : diff > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {diff === 0
                ? 'الرصيد مطابق تماماً — لا فرق'
                : diff > 0
                  ? 'زيادة بالصندوق (وارد) سيُسجل قيد تسوية موجب:'
                  : 'عجز بالصندوق (صادر) سيُسجل قيد تسوية سالب:'}
            </span>
            <span className={`text-lg font-extrabold num-font ${diff === 0 ? 'text-slate-300' : diff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatCurrency(diff)}
            </span>
          </div>
        ) : null}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          يُسجل قيد حركة باسم «تسوية رصيد الخزينة» بقيمة الفرق ({'الفرق = الجرد الفعلي − الرصيد الدفتري'}) ليطابق
          الرصيد المحسوب الواقع الفعلي، ويظهر في دفتر المدفوعات وملخصات الخزينة والتقارير فوراً.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button type="submit" variant="primary" icon={Wallet} loading={submitting} disabled={submitting} className="px-6">
            {submitting ? 'جاري تسجيل التسوية...' : 'تسجيل قيد تسوية الخزينة'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default TreasuryAdjustModal
