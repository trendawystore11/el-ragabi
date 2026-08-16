// =============================================================================
// ui/modals/OrderStatusModal.jsx — نافذة تحديث حالة الطلب — نسخة React من
// window.openOrderStatusModal (js/components/orders-view.js)
// -----------------------------------------------------------------------------
// تبني خيارات الحالة الجديدة من مصفوفة آلة الحالات (ORDER_STATUS_TRANSITIONS)
// حتى لا تعرض أبداً انتقالاً غير مسموح، مع قسم استرداد العربون لـ «ملغي»/
// «مرتجع» (التحقق من 1..العربون)، وقسم إعادة التفعيل (العربون المستلم) عند
// العودة إلى «جديد». الحفظ عبر window.updateOrderStatus (الجسر) بنفس توقيع
// القديم (orderId, newStatus, refundAmount, reactivationDeposit).
// =============================================================================
import { useState, useMemo } from 'react'
import { RefreshCcw, Info } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Select from '../components/Select.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { ORDER_STATUS_TRANSITIONS } from '../../domain/orders/orderMachine.js'
import { formatCurrency } from '../../utils/formatters.js'

const STATUS_LABELS = {
  new: 'جديد (قيد الانتظار)',
  delivered: 'تم التوصيل (خصم الكميات من المخزن)',
  completed: 'مكتمل نهائي (تسليم وتم تحصيل الحساب كامل بالكامل)',
  returned: 'مرتجع (بعد الشحن: إعادة البضاعة للمخزن وخصم تكاليف الشحن الفعلية)',
  cancelled: 'ملغي (قبل الشحن: إلغاء الطلب بالكامل بلا تكاليف شحن)',
}

function OrderStatusModal() {
  const open = useUiStore(s => s.orderStatusModal.open)
  if (!open) return null
  return <OrderStatusModalInner />
}

function OrderStatusModalInner() {
  const { orderId, currentStatus, onDone } = useUiStore(s => s.orderStatusModal)
  const close = useUiStore(s => s.closeOrderStatusModal)

  const [order] = useState(() => (window.getOrderById ? window.getOrderById(orderId) : null))

  const deposit = Number(order?.downPayment) || 0
  const sourceStatus = (order && order.status) || currentStatus || ''
  const allowedTargets = useMemo(() => ORDER_STATUS_TRANSITIONS[sourceStatus] || [], [sourceStatus])
  const canReactivate = sourceStatus === 'cancelled' || sourceStatus === 'returned'
  const retainedDeposit = Math.max(0, deposit - (Number(order?.refundedAmount) || 0))

  const [newStatus, setNewStatus] = useState(allowedTargets[0] || '')
  const [refundChecked, setRefundChecked] = useState(false)
  const [refundAmount, setRefundAmount] = useState(String(deposit))
  const [reactivationAmount, setReactivationAmount] = useState(String(retainedDeposit))
  const [submitting, setSubmitting] = useState(false)

  if (!order) {
    return (
      <Modal open onClose={close} title={`تحديث حالة الطلب رقم: ${orderId}`} icon={RefreshCcw}>
        <p className="text-sm text-slate-400">لم يتم العثور على الطلب المطلوب.</p>
      </Modal>
    )
  }

  const statusOptions = allowedTargets.map(s => {
    const label =
      s === 'new' && (sourceStatus === 'cancelled' || sourceStatus === 'returned')
        ? 'جديد (إعادة تفعيل)'
        : STATUS_LABELS[s] || s
    return { value: s, label }
  })

  const showRefund = (newStatus === 'cancelled' || newStatus === 'returned') && deposit > 0
  const refundError = refundChecked && deposit > 0 && (Number(refundAmount) < 1 || Number(refundAmount) > deposit)
  const showReactivation = canReactivate && newStatus === 'new'

  const handleSubmit = async e => {
    e.preventDefault()
    if (submitting) return
    if (!newStatus) {
      showToast('اختر الحالة الجديدة أولاً', 'error')
      return
    }

    let refundAmountValue = 0
    if ((newStatus === 'cancelled' || newStatus === 'returned') && refundChecked && deposit > 0) {
      refundAmountValue = Number(refundAmount) || 0
      if (refundAmountValue < 1 || refundAmountValue > deposit) {
        showToast(`المبلغ المسترد يجب أن يكون من 1 حتى ${formatCurrency(deposit)}`, 'error')
        return
      }
    }

    let reactivationDeposit = 0
    if (newStatus === 'new' && reactivationAmount !== '') {
      reactivationDeposit = Number(reactivationAmount) || 0
    }

    setSubmitting(true)
    try {
      await window.updateOrderStatus(orderId, newStatus, refundAmountValue, reactivationDeposit)
      const toastMsg =
        refundAmountValue > 0
          ? newStatus === 'cancelled'
            ? `تم إلغاء الطلب ${orderId} واسترداد ${formatCurrency(refundAmountValue)} من العربون للعميل`
            : `تم إرجاع الطلب ${orderId} واسترداد ${formatCurrency(refundAmountValue)} من العربون للعميل`
          : `تم تحديث حالة الفاتورة رقم ${orderId} إلى (${newStatus}) بنجاح`
      showToast(toastMsg, 'success')
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء تحديث الحالة', 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title={`تحديث حالة الطلب رقم: ${orderId}`} icon={RefreshCcw} maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-300">
          تعديل حالة الفاتورة رقم <strong className="text-white font-bold">{orderId}</strong>:
        </p>

        <Select
          label="اختر الحالة الجديدة *"
          value={newStatus}
          onChange={setNewStatus}
          options={statusOptions}
          placeholder={statusOptions.length ? undefined : '— لا توجد انتقالات مسموحة —'}
        />

        <div className="p-3 bg-amber-950/30 rounded-xl border border-amber-800/40 text-xs text-amber-300">
          <div className="flex items-center gap-1.5 font-bold">
            <Info className="w-3.5 h-3.5" />
            <span>تنبيه:</span>
          </div>
          <p className="mt-1">
            اختيار «مرتجع» أو «ملغي» سيقوم آلياً بإعادة المنتجات لحساب المخزون، إلغاء مديونية الفاتورة من حساب
            العميل، وإلغاء مديونية عجز المخزون المسجلة على المورد.
          </p>
          <p className="mt-1.5 text-amber-200/90">
            💡 «ملغي» يُستخدم قبل الشحن فلا تُخصم أي تكاليف شحن، ويُبقي العربون المدفوع محتفظاً به كإيراد تشغيلي
            افتراضياً مع إمكانية استرداد كامل أو جزء منه. أما «مرتجع» فيُستخدم بعد محاولة الشحن وتُخصم تكاليف الشحن
            الفعلية، ويُرجع المسدد للعميل افتراضياً مع إمكانية تحديد مبلغ استرداد جزئي. في الحالتين يُسجَّل قيد
            الاسترداد في الخزينة وتُعاد المنتجات للمخزون وتُلغى مديونية الفاتورة.
          </p>
        </div>

        {showRefund ? (
          <div className="p-3 bg-rose-950/30 rounded-xl border border-rose-800/40 space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold text-rose-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={refundChecked}
                onChange={e => setRefundChecked(e.target.checked)}
                className="accent-rose-500 w-4 h-4 shrink-0"
                aria-label="استرداد مبلغ من العربون للعميل"
              />
              <span>استرداد مبلغ من العربون للعميل</span>
            </label>
            {refundChecked ? (
              <div>
                <Input
                  label={`المبلغ المسترد (من إجمالي عربون: ${formatCurrency(deposit)})`}
                  type="number"
                  min="1"
                  max={deposit}
                  step="any"
                  value={refundAmount}
                  onChange={setRefundAmount}
                  className="text-rose-400 font-extrabold num-font"
                />
                {refundError ? (
                  <p className="text-[11px] font-bold text-rose-400 mt-1.5">
                    ⚠️ المبلغ المسترد يجب أن يكون من 1 حتى {formatCurrency(deposit)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {showReactivation ? (
          <div className="p-3 bg-sky-950/30 rounded-xl border border-sky-800/40 space-y-3">
            <Input
              label="مبلغ العربون المستلم عند إعادة التفعيل"
              type="number"
              min="0"
              step="any"
              value={reactivationAmount}
              onChange={setReactivationAmount}
              className="text-sky-400 font-extrabold num-font"
            />
            <p className="text-[11px] text-sky-400/80">
              الافتراضي: المحتفظ به من العربون بعد أي استرداد سابق ({formatCurrency(retainedDeposit)}). يُسجَّل
              المبلغ المكتوب هنا كاستلام فعلي في خزينة العميل عند إعادة التفعيل.
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button
            type="submit"
            variant="primary"
            icon={RefreshCcw}
            loading={submitting}
            disabled={submitting}
            className="px-6"
          >
            {submitting ? 'جاري التحديث...' : 'تحديث الحالة'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default OrderStatusModal
