// =============================================================================
// ui/modals/PaymentEditModal.jsx — تعديل قيد دفعة مسجَّلة (المدير فقط) — V3.63
// -----------------------------------------------------------------------------
// تعديل المبلغ / التاريخ / طريقة الدفع / الملاحظات لقيد دفعة مستقلة (غير مرتبط
// بفاتورة). الحفظ عبر window.updatePaymentRecord الذي يعكس أثر القيد القديم ثم
// يُعيد إنشاءه بنفس المعرّف وتاريخ الإنشاء. يُرفض القيد المرتبط بفاتورة.
// =============================================================================
import { useState } from 'react'
import { Pencil, AlertTriangle } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { usePaymentsStore } from '@/state/paymentsStore'
import { showToast } from '../components/toastStore.js'
import { formatCurrency, labelWithCurrency } from '@/utils/formatters'

function findPayment(paymentId) {
  if (typeof window === 'undefined' || !window.getPayments) return null
  return window.getPayments().find(p => p.id === paymentId) || null
}

function PaymentEditModal() {
  const open = useUiStore(s => s.paymentEditModal.open)
  if (!open) return null
  return <PaymentEditModalInner />
}

function PaymentEditModalInner() {
  const { paymentId, onDone } = useUiStore(s => s.paymentEditModal)
  const close = useUiStore(s => s.closePaymentEditModal)

  const [payment] = useState(() => findPayment(paymentId))
  const isSupplierCollection = !!payment && payment.entityType === 'supplier' && payment.type === 'supplierCollection'
  const isRefund = !!payment && (Number(payment.amount) || 0) < 0

  const [amount, setAmount] = useState(() => {
    if (!payment) return ''
    return isSupplierCollection ? String(Math.abs(Number(payment.amount) || 0)) : String(Number(payment.amount) || 0)
  })
  const [method, setMethod] = useState(payment ? payment.paymentMethod || 'cash' : 'cash')
  const [date, setDate] = useState(payment ? String(payment.date || '').slice(0, 10) : '')
  const [notes, setNotes] = useState(payment ? payment.notes || '' : '')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const methodOptions = [
    { value: 'cash', label: 'نقدي (كاش)' },
    { value: 'transfer', label: 'تحويل بنكي / محفظة فودافون كاش' },
    { value: 'check', label: 'شيك بنكي' },
  ]

  if (!payment) {
    return (
      <Modal open onClose={close} title="✏️ تعديل قيد الدفعة" icon={Pencil} maxWidth="max-w-lg">
        <div className="flex items-start gap-3 p-4 bg-amber-950/30 border border-amber-800/40 rounded-xl text-sm text-amber-300">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>قيد الدفعة غير موجود — ربما حُذف بالفعل.</p>
        </div>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={close}>إغلاق</Button>
        </div>
      </Modal>
    )
  }

  if (payment.refOrderId) {
    return (
      <Modal open onClose={close} title="✏️ تعديل قيد الدفعة" icon={Pencil} maxWidth="max-w-lg">
        <div className="flex items-start gap-3 p-4 bg-amber-950/30 border border-amber-800/40 rounded-xl text-sm text-amber-300">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>هذه الدفعة مرتبطة بفاتورة ولا يمكن تعديلها من هنا — عدّل الفاتورة أو حالتها بدلاً من ذلك.</p>
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

    const numAmount = Number(amount)
    if (String(amount).trim() === '' || !Number.isFinite(numAmount) || numAmount === 0) {
      setErrors({ amount: 'يرجى إدخال مبلغ صحيح غير صفر' })
      showToast('يرجى إدخال مبلغ صحيح غير صفر', 'error')
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      await window.updatePaymentRecord(paymentId, {
        amount: numAmount,
        date,
        paymentMethod: method,
        notes,
      })
      showToast('تم تعديل قيد الدفعة وتصحيح الرصيد بنجاح', 'success')
      close()
      usePaymentsStore.getState().refresh()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
      setSubmitting(false)
    }
  }

  const entityLabel = payment.entityType === 'customer' ? 'عميل' : payment.entityType === 'supplier' ? 'مورد / مصنع' : 'حركة خزينة'

  return (
    <Modal open onClose={close} title="✏️ تعديل قيد دفعة مسجَّلة" icon={Pencil} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">رقم الإيصال:</span>
            <span className="font-bold text-white font-mono">{payment.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">الجهة ({entityLabel}):</span>
            <span className="font-bold text-white">{payment.entityName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">المبلغ الحالي:</span>
            <span className="font-bold num-font text-amber-300">{formatCurrency(Number(payment.amount) || 0)}</span>
          </div>
        </div>

        <div>
          <Input
            label={labelWithCurrency(isSupplierCollection ? 'قيمة التحصيل من المورد' : 'المبلغ')}
            type="number"
            step="0.01"
            value={amount}
            onChange={v => { setAmount(v); clearError('amount') }}
            required
            error={errors.amount}
            textLeft
            className="num-font !text-emerald-400 !font-extrabold"
          />
          {isSupplierCollection ? (
            <p className="text-[11px] text-teal-400 mt-1">وضع تحصيل نقدية من مورد — أدخل القيمة الموجبة.</p>
          ) : isRefund ? (
            <p className="text-[11px] text-rose-400 mt-1">قيد استرداد / رد عربون — القيمة سالبة حالياً.</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="طريقة الدفع" value={method} onChange={setMethod} options={methodOptions} />
          <Input label="التاريخ" type="date" value={date} onChange={setDate} textLeft className="num-font" />
        </div>

        <Input label="ملاحظات وشرح الإيصال" value={notes} onChange={setNotes} />

        <p className="text-[11px] text-slate-500 leading-relaxed">
          سيُعكَس أثر القيد القديم على رصيد {entityLabel} ثم يُطبَّق الأثر الجديد للمبلغ المُعدَّل، مع الحفاظ على رقم الإيصال وتاريخ الإنشاء.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button type="submit" variant="success" icon={Pencil} loading={submitting} disabled={submitting}>
            {submitting ? 'جاري الحفظ...' : 'حفظ التعديل وتصحيح الرصيد'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default PaymentEditModal
