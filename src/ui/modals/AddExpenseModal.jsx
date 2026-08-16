// =============================================================================
// ui/modals/AddExpenseModal.jsx — نافذة تسجيل/تعديل مصروف — نسخة React من
// window.openAddExpenseModal / window.openEditExpenseModal (reports-view.js)
// -----------------------------------------------------------------------------
// بيانات المصروف (البيان، المبلغ، الفئة، التاريخ الافتراضي اليوم، المصروف
// الشهري المتكرر مع يوم الاستحقاق، الملاحظات). الحفظ عبر
// window.createExpense / window.updateExpense. التحقق من المبلغ يتم محلياً
// بجانب تحقق الدومين.
// =============================================================================
import { useState } from 'react'
import { ReceiptText, CheckCircle2 } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { getCairoFormattedDate, labelWithCurrency } from '@/utils/formatters'

const CATEGORY_OPTIONS = [
  { value: 'عمومية', label: 'مصروفات عمومية' },
  { value: 'إيجارات', label: 'إيجار المحل والمخزن' },
  { value: 'كهرباء ومرافق', label: 'كهرباء ومياه ومرافق' },
  { value: 'أجور ومرتبات', label: 'أجور ومرتبات موظفين' },
  { value: 'تغليف ومطبوعات', label: 'أكياس وتغليف ومطبوعات' },
  { value: 'شحن ونقل', label: 'شحن ونقل بضائع' },
]

function AddExpenseModal() {
  const open = useUiStore(s => s.expenseModal.open)
  if (!open) return null
  return <AddExpenseModalInner />
}

function AddExpenseModalInner() {
  const { expenseId, onDone, initialData } = useUiStore(s => s.expenseModal)
  const close = useUiStore(s => s.closeAddExpenseModal)

  const [expense] = useState(() => {
    if (!expenseId) return null
    if (typeof window === 'undefined' || !window.getExpenses) return null
    return window.getExpenses().find(e => e.id === expenseId) || null
  })
  const isEdit = !!expense

  const [title, setTitle] = useState(expense ? expense.title : (initialData ? String(initialData.description || '') : ''))
  const [amount, setAmount] = useState(expense ? String(expense.amount) : (initialData && initialData.amount != null ? String(initialData.amount) : ''))
  const [category, setCategory] = useState(expense ? expense.category || 'عمومية' : (initialData && initialData.category ? initialData.category : 'عمومية'))
  const [date, setDate] = useState(expense ? expense.date : getCairoFormattedDate().slice(0, 10))
  const [recurring, setRecurring] = useState(expense ? expense.recurring === true : false)
  const [dueDay, setDueDay] = useState(expense && expense.recurring === true ? String(expense.dueDay || '') : '')
  const [notes, setNotes] = useState(expense ? expense.notes || '' : (initialData ? String(initialData.notes || '') : ''))

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const handleSubmit = e => {
    e.preventDefault()
    if (submitting) return

    const nextErrors = {}
    if (!title.trim()) nextErrors.title = 'يرجى إدخال بيان المصروف'
    const numAmount = Number(amount)
    if (isNaN(numAmount) || numAmount <= 0) nextErrors.amount = 'يرجى إدخال مبلغ أكبر من صفر'
    if (recurring && (!dueDay || Number(dueDay) < 1 || Number(dueDay) > 31)) {
      nextErrors.dueDay = 'يرجى إدخال يوم استحقاق شهري صحيح بين 1 و 31'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      const order = ['title', 'amount', 'dueDay']
      const firstKey = order.find(k => nextErrors[k])
      const toastByKey = {
        title: 'يرجى إدخال بيان المصروف',
        amount: 'يرجى إدخال قيمة مصروف صحيحة أكبر من الصفر',
        dueDay: 'يرجى إدخال يوم استحقاق شهري صحيح بين 1 و 31',
      }
      showToast(toastByKey[firstKey], 'error')
      return
    }
    setErrors({})

    const data = {
      title,
      amount,
      category,
      date,
      notes,
      recurring,
      dueDay: recurring ? dueDay : null,
    }

    setSubmitting(true)
    try {
      if (isEdit) {
        window.updateExpense(expenseId, data)
        showToast('تم تعديل المصروف بنجاح', 'success')
      } else {
        window.createExpense(data)
        showToast(
          recurring
            ? 'تم قيد المصروف الشهري — يُخصم من الأرباح في موعد استحقاقه'
            : 'تم قيد المصروف بنجاح وخصم قيمته من الأرباح',
          'success'
        )
      }
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title={isEdit ? '✏️ تعديل المصروف' : '💸 تسجيل مصروف جديد'}
      icon={ReceiptText}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="بيان المصروف"
          required
          value={title}
          onChange={v => {
            setTitle(v)
            clearError('title')
          }}
          error={errors.title}
          placeholder="مثال: فاتورة كهرباء المحل / إيجار شهر يوليو"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={labelWithCurrency('قيمة المصروف')}
            type="number"
            min="1"
            required
            value={amount}
            onChange={v => {
              setAmount(v)
              clearError('amount')
            }}
            error={errors.amount}
            placeholder="0"
            textLeft
            hint="يُخصم من أرباحك فوراً عند الحفظ"
          />
          <Select
            label="فئة المصروف"
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS}
            hint="تُستخدم لتصنيف المصروفات في تقرير الأرباح"
          />
        </div>

        <Input
          label="التاريخ"
          type="date"
          value={date}
          onChange={setDate}
          className="num-font text-left"
          hint="افتراضياً تاريخ اليوم بتوقيت القاهرة"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-slate-950/40 rounded-xl border border-slate-800">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={recurring}
              onChange={e => setRecurring(e.target.checked)}
              className="w-4 h-4 accent-purple-500 shrink-0"
            />
            <span className="text-xs font-bold text-purple-300">مصروف شهري متكرر 🔁 (يُخصم من الصافي تلقائياً كل شهر)</span>
          </label>
          {recurring ? (
            <Input
              label="يوم الاستحقاق الشهري (1 - 31)"
              type="number"
              min="1"
              max="31"
              value={dueDay}
              onChange={v => {
                setDueDay(v)
                clearError('dueDay')
              }}
              error={errors.dueDay}
              placeholder="مثال: 5"
              textLeft
            />
          ) : null}
        </div>

        <Input label="ملاحظات إضافية" value={notes} onChange={setNotes} placeholder="ملاحظات توضيحية..." />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button
            type="submit"
            variant="primary"
            icon={CheckCircle2}
            loading={submitting}
            disabled={submitting}
            className="px-6 !bg-amber-600 hover:!bg-amber-500"
          >
            {isEdit ? (submitting ? 'جاري الحفظ...' : 'حفظ التعديلات') : submitting ? 'جاري الحفظ...' : 'حفظ المصروف'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default AddExpenseModal
