// =============================================================================
// ui/modals/DebtEditModal.jsx — تعديل مديونية عميل/مورد (المدير فقط) — V3.65
// -----------------------------------------------------------------------------
// يُسجَّل التعديل كـ **قيد تسوية دفترية** (customerDebtAdjustment للعميل داخل
// الدفعات، وقيد «تسوية مديونية مورد» في دفتر الموردين) بقيمة الفرق، لا كتابة
// فوق الرصيد. لذلك يصمد أمام أي إعادة احتساب، ويظهر فوراً في كشف الحساب، ولا
// يمسّ الطلبات ولا الدفعات الفعلية ولا الخزينة.
// يُدخل المدير الرصيد المتبقي المستهدف، ويُشتق «المسدد» تلقائياً.
// =============================================================================
import { useState } from 'react'
import { Scale, AlertTriangle } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { formatCurrency, labelWithCurrency, round2 } from '@/utils/formatters'

function DebtEditModal() {
  const open = useUiStore(s => s.debtEditModal.open)
  if (!open) return null
  return <DebtEditModalInner />
}

function DebtEditModalInner() {
  const { entityType, entityId, onDone } = useUiStore(s => s.debtEditModal)
  const close = useUiStore(s => s.closeDebtEditModal)

  const isSupplier = entityType === 'supplier'
  const [entity] = useState(() => {
    if (typeof window === 'undefined') return null
    if (isSupplier) return window.getSupplierById ? window.getSupplierById(entityId) : null
    return window.getCustomerById ? window.getCustomerById(entityId) : null
  })

  const paidValue = entity ? String(Number(entity.paid) || 0) : '0'
  const currentRemaining = entity ? Number(entity.remainingBalance) || 0 : 0
  const [remaining, setRemaining] = useState(() => (entity ? String(Number(entity.remainingBalance) || 0) : '0'))
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const entityLabel = isSupplier ? 'المورد / المصنع' : 'العميل'

  const parsedRemaining = String(remaining).trim() === '' ? null : Number(remaining)
  const adjustmentDelta = parsedRemaining !== null && Number.isFinite(parsedRemaining)
    ? round2(currentRemaining - parsedRemaining)
    : null

  if (!entity) {
    return (
      <Modal open onClose={close} title="⚖️ تعديل المديونية" icon={Scale} maxWidth="max-w-lg">
        <div className="flex items-start gap-3 p-4 bg-amber-950/30 border border-amber-800/40 rounded-xl text-sm text-amber-300">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>تعذّر العثور على الحساب المطلوب.</p>
        </div>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={close}>إغلاق</Button>
        </div>
      </Modal>
    )
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (submitting) return

    const numRemaining = Number(remaining)
    const nextErrors = {}
    if (String(remaining).trim() === '' || !Number.isFinite(numRemaining)) nextErrors.remaining = 'يرجى إدخال قيمة رصيد صحيحة'
    if (!isSupplier && numRemaining < 0) nextErrors.remaining = 'الرصيد المتبقي على العميل لا يمكن أن يكون سالباً'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      const user = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null
      const createdBy = user && user.name ? user.name : 'المدير العام'
      if (isSupplier) {
        window.adjustSupplierDebt(entityId, { remainingBalance: numRemaining, createdBy })
      } else {
        window.adjustCustomerDebt(entityId, { remainingBalance: numRemaining, createdBy })
      }
      showToast(`تم تسجيل تسوية مديونية ${entityLabel} وتحديث الرصيد بنجاح`, 'success')
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title={`⚖️ تعديل مديونية ${entityLabel}`} icon={Scale} maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">الاسم:</span>
            <span className="font-bold text-white">{entity.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">الكود:</span>
            <span className="font-mono text-slate-300">{entity.id}</span>
          </div>
          {isSupplier ? (
            <div className="flex justify-between">
              <span className="text-slate-400">إجمالي التعاملات:</span>
              <span className="num-font font-bold text-slate-200">{formatCurrency(entity.totalPurchases)}</span>
            </div>
          ) : (
            <div className="flex justify-between">
              <span className="text-slate-400">إجمالي المشتريات:</span>
              <span className="num-font font-bold text-slate-200">{formatCurrency(entity.totalPurchases)}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={labelWithCurrency('المسدد (الحالي)')}
            type="number"
            step="0.01"
            value={paidValue}
            onChange={() => {}}
            disabled
            textLeft
            hint="يُعدّل عبر تسجيل/تعديل الدفعات، لا من هنا"
            className="num-font !text-emerald-400 !font-extrabold"
          />
          <Input
            label={labelWithCurrency(isSupplier ? 'الرصيد المستحق للمورد' : 'الرصيد المتبقي على العميل')}
            type="number"
            step="0.01"
            value={remaining}
            onChange={v => { setRemaining(v); clearError('remaining') }}
            error={errors.remaining}
            textLeft
            autoFocus
            className="num-font !text-rose-400 !font-extrabold"
          />
        </div>

        {adjustmentDelta !== null && adjustmentDelta !== 0 ? (
          <div className="p-3 rounded-xl border flex justify-between items-center text-sm bg-amber-950/30 border-amber-800/40">
            <span className="text-amber-300 font-bold">
              {adjustmentDelta > 0
                ? 'قيد تسوية يخفض المديونية بقيمة:'
                : 'قيد تسوية يزيد المديونية بقيمة:'}
            </span>
            <span className="text-lg font-extrabold text-amber-400 num-font">{formatCurrency(adjustmentDelta)}</span>
          </div>
        ) : null}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          يُسجَّل التعديل كـ<b className="text-slate-400">قيد تسوية حقيقي في الدفتر</b> بقيمة الفرق (لا كتابة فوق الرصيد)،
          فيظهر فوراً في كشف الحساب ويصمد أمام أي إعادة احتساب لاحقة، دون المساس بالطلبات أو الدفعات أو الخزينة.
          يُشتق «المسدد» تلقائياً من الرصيد المتبقي.
          {isSupplier ? ' يُسمح برصيد سالب (مستحق لنا من المورد).' : ''}
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button type="submit" variant="primary" icon={Scale} loading={submitting} disabled={submitting} className="px-6">
            {submitting ? 'جاري الحفظ...' : 'حفظ تعديل المديونية'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default DebtEditModal
