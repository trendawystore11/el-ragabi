// =============================================================================
// ui/modals/PaymentModal.jsx — نافذة تسجيل دفعة / إيصال قبض أو دفع — نسخة React من
// window.openPaymentModal (js/components/payments-view.js)
// -----------------------------------------------------------------------------
// نفس المنطق الحرفي للقديم: زر تعبئة سريعة لكامل المديونية المتبقية ⚡، حماية من
// التحصيل الزائد (تحذير + تعبئة تلقائية بالمبلغ المتبقي للمراجعة)، ومنع الحفظ
// نهائياً عند تجاوز الرصيد. الحفظ عبر window.createPaymentRecord (الجسر) مع
// تحديث paymentsStore بعد النجاح. النافذة تُركَّب في AppShell وتُفتح عبر
// uiStore.openPaymentModal (بوابة المدير العام في المخزن).
// =============================================================================
import { useState } from 'react'
import { Wallet, Zap } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { usePaymentsStore } from '@/state/paymentsStore'
import { formatCurrency, getCairoFormattedDate, labelWithCurrency } from '@/utils/formatters'
import { showToast } from '../components/toastStore.js'

function loadList(fnName) {
  if (typeof window === 'undefined' || typeof window[fnName] !== 'function') return []
  const list = window[fnName]()
  return Array.isArray(list) ? list : []
}

function PaymentModal() {
  const open = useUiStore(s => s.paymentModal.open)
  if (!open) return null
  return <PaymentModalInner />
}

function PaymentModalInner() {
  const close = useUiStore(s => s.closePaymentModal)
  const defaults = useUiStore(s => s.paymentModal.defaults) || {}
  const onDone = useUiStore(s => s.paymentModal.onDone)

  const [customers] = useState(() => loadList('getCustomers'))
  const [suppliers] = useState(() => loadList('getSuppliers'))
  // V3.62 — 'supplier_collect' = تحصيل نقدية من مورد مدين لنا (رصيد سالب).
  const [entityType, setEntityType] = useState(defaults.entityType === 'supplier_collect' ? 'supplier_collect' : (defaults.entityType === 'supplier' ? 'supplier' : 'customer'))
  const [entityId, setEntityId] = useState(() => {
    if (defaults.entityId) return defaults.entityId
    if (defaults.entityType === 'supplier_collect') {
      const negatives = suppliers.filter(s => Number(s.remainingBalance) < 0)
      return negatives.length ? negatives[0].id : ''
    }
    const list = defaults.entityType === 'supplier' ? suppliers : customers
    return list.length ? list[0].id : ''
  })
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [date, setDate] = useState(() => getCairoFormattedDate().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [validationMsg, setValidationMsg] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const isCollectMode = entityType === 'supplier_collect'
  const entityList = entityType === 'customer' ? customers : suppliers
  const entityLabel = entityType === 'customer' ? 'العميل' : 'المورد / المصنع'

  // V3.62 — في وضع تحصيل نقدية من مورد نعرض فقط الموردين المدينين لنا
  // (رصيد سالب) وسقف القبض هو المبلغ المستحق لنا = -remainingBalance.
  const collectibleSuppliers = suppliers.filter(s => Number(s.remainingBalance) < 0)

  const getMaxRemaining = () => {
    if (isCollectMode) {
      const found = collectibleSuppliers.find(x => String(x.id) === String(entityId))
      return found ? Math.max(0, -(Number(found.remainingBalance) || 0)) : 0
    }
    const found = entityList.find(x => String(x.id) === String(entityId))
    return found ? Number(found.remainingBalance) || 0 : 0
  }

  const handleAmountChange = value => {
    setAmount(value)
    clearError('amount')
    const amt = Number(value) || 0
    const max = getMaxRemaining()
    if (amt > max) {
      const overMsg =
        isCollectMode
          ? 'المبلغ المدخل أكبر من إجمالي المبلغ المستحق لنا من المورد'
          : entityType === 'supplier'
            ? 'المبلغ المدخل أكبر من إجمالي المديونية المستحقة للمورد'
            : 'المبلغ المدخل أكبر من إجمالي المديونية المتبقية على العميل'
      let msg = `⚠️ ${overMsg} (${formatCurrency(max)})`
      msg += max > 0
        ? ` — تم تعبئة الخانة تلقائياً بالمبلغ المتبقي (${formatCurrency(max)}) للمراجعة ثم التأكيد`
        : ' — لا يجوز التحصيل من حساب خالٍ من المديونية'
      setValidationMsg(msg)
      if (max > 0 && value !== String(max)) setAmount(String(max))
    } else {
      setValidationMsg('')
    }
  }

  const fillFullDebt = () => {
    const max = getMaxRemaining()
    if (max <= 0) {
      showToast(isCollectMode ? 'لا يوجد مبلغ مستحق لنا من هذا المورد' : 'الرصيد المتبقي مسدد بالكامل بالفعل (' + formatCurrency(0) + ')', 'info')
      setAmount('0')
      setValidationMsg('')
    } else {
      setAmount(String(max))
      setValidationMsg('')
      showToast(`تم تعبئة المبلغ بالكامل تلقائياً: ${formatCurrency(max)}`, 'success')
    }
  }

  const handleTypeChange = value => {
    setEntityType(value)
    const list = value === 'customer' ? customers : suppliers
    const initial = (value === 'supplier_collect' ? collectibleSuppliers : list)
    setEntityId(initial.length ? initial[0].id : '')
    setAmount('')
    setValidationMsg('')
    setErrors({})
  }

  const handleEntityChange = value => {
    setEntityId(value)
    setAmount('')
    setValidationMsg('')
    setErrors({})
  }

  const handleSubmit = e => {
    e.preventDefault()
    if (submitting) return

    if (!entityId) {
      setErrors({ entityId: 'يرجى اختيار العميل أو المورد أولاً' })
      showToast('يرجى اختيار العميل أو المورد أولاً', 'error')
      return
    }

    const numericAmount = parseFloat(amount) || 0
    if (!(numericAmount > 0)) {
      setErrors({ amount: 'يرجى إدخال مبلغ أكبر من صفر' })
      showToast('يرجى إدخال مبلغ أكبر من صفر', 'error')
      return
    }
    const maxRemaining = getMaxRemaining()
    if (numericAmount > maxRemaining) {
      const overMsg =
        isCollectMode
          ? 'المبلغ المدخل أكبر من إجمالي المبلغ المستحق لنا من المورد'
          : entityType === 'supplier'
            ? 'المبلغ المدخل أكبر من إجمالي المديونية المستحقة للمورد'
            : 'المبلغ المدخل أكبر من إجمالي المديونية المتبقية على العميل'
      setErrors({ amount: `${overMsg} (${formatCurrency(maxRemaining)})` })
      showToast(`${overMsg} (${formatCurrency(maxRemaining)}) — تم منع الحفظ وإيقاف العملية`, 'error')
      return
    }
    setErrors({})

    const entityObj = (isCollectMode ? collectibleSuppliers : entityList).find(x => String(x.id) === String(entityId))

    setSubmitting(true)
    try {
      window.createPaymentRecord({
        entityType: isCollectMode ? 'supplier' : entityType,
        entityId,
        entityName: entityObj ? entityObj.name : '',
        amount: numericAmount,
        date,
        paymentMethod: method,
        notes,
        isCollection: isCollectMode,
      })
      showToast(isCollectMode ? 'تم تحصيل المبلغ من المورد وإيداعه بالخزينة وتحديث الرصيد بنجاح' : 'تم تسجيل الدفعة وتحديث رصيد الحساب بنجاح', 'success')
      close()
      usePaymentsStore.getState().refresh()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
      setSubmitting(false)
    }
  }

  const entityOptions = isCollectMode
    ? (collectibleSuppliers.length
        ? collectibleSuppliers.map(x => ({
            value: x.id,
            label: `${x.name} - المبلغ المستحق لنا منه: ${formatCurrency(-(Number(x.remainingBalance) || 0))}`,
          }))
        : [{ value: '', label: 'لا يوجد موردين مدينين لنا (رصيد سالب)' }])
    : (entityList.length
        ? entityList.map(x => ({
            value: x.id,
            label:
              entityType === 'customer'
                ? `${x.name} (${x.phone || ''}) - الرصيد المتبقي عليه: ${formatCurrency(x.remainingBalance)}`
                : `${x.name} - الرصيد المستحق له: ${formatCurrency(x.remainingBalance)}`,
          }))
        : [{ value: '', label: entityType === 'customer' ? 'لا يوجد عملاء مسجلين' : 'لا يوجد موردين مسجلين' }])

  const methodOptions = [
    { value: 'cash', label: 'نقدي (كاش)' },
    { value: 'transfer', label: 'تحويل بنكي / محفظة فودافون كاش' },
    { value: 'check', label: 'شيك بنكي' },
  ]

  return (
    <Modal open onClose={close} title="💰 تسجيل دفعة / إيصال قبض أو دفع" icon={Wallet} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Select
          label="نوع العملية *"
          value={entityType}
          onChange={handleTypeChange}
          options={[
            { value: 'customer', label: 'تحصيل دفعة من عميل (قبض)' },
            { value: 'supplier', label: 'تسديد دفعة لمورد / مصنع (دفع)' },
            { value: 'supplier_collect', label: 'تحصيل نقدية من مورد / مصنع مدين لنا (قبض)' },
          ]}
        />

        <Select
          label={`${entityLabel} *`}
          value={entityId}
          onChange={handleEntityChange}
          options={entityOptions}
          error={errors.entityId}
        />

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="pay-amount" className="block text-xs font-bold text-slate-300">
              {labelWithCurrency('المبلغ')} *
            </label>
            <button
              type="button"
              onClick={fillFullDebt}
              className="px-2.5 py-1 text-xs font-bold bg-brand-600/30 hover:bg-brand-600 text-brand-300 hover:text-white rounded-lg border border-brand-500/40 transition-all flex items-center gap-1"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>{isCollectMode ? 'تحصيل كامل المبلغ المستحق لنا ⚡' : 'سداد كامل المديونية المتبقية ⚡'}</span>
            </button>
          </div>
          <Input
            id="pay-amount"
            type="number"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0"
            textLeft
            min={1}
            required
            error={errors.amount}
            className="!text-emerald-400 !font-extrabold !text-lg num-font"
          />
          {validationMsg ? <p className="text-xs font-bold text-rose-400 mt-1">{validationMsg}</p> : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="طريقة الدفع" value={method} onChange={setMethod} options={methodOptions} />
          <Input label="التاريخ" type="date" value={date} onChange={setDate} textLeft className="num-font" />
        </div>

        <Input label="ملاحظات وشرح الإيصال" value={notes} onChange={setNotes} placeholder={isCollectMode ? 'مثال: استلام جزء من المبلغ المستحق لنا من المورد' : 'مثال: تسديد كامل الحساب المتبقي'} />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            إلغاء
          </Button>
          <Button type="submit" variant="success" icon={Wallet} loading={submitting} disabled={submitting}>
            {submitting ? 'جاري التسجيل...' : isCollectMode ? 'تحصيل المبلغ وتحديث الرصيد' : 'تسجيل الدفعة وتحديث الرصيد'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default PaymentModal
