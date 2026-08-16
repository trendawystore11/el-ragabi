// =============================================================================
// ui/views/ExpensesView.jsx — نسخة React من renderExpensesReport (reports-view.js) — Phase 7
// -----------------------------------------------------------------------------
// دليل مصاريف التشغيل والمصروفات الإدارية: ملخصات (إجمالي مستحق حالياً من
// getCurrentOperatingExpenses + إجمالي اليوم + إجمالي الشهر) + فلترة حسب
// الفئة/نطاق التاريخ + جدول المصروفات مع شارة المتكرر وأزرار التعديل/الحذف.
// «إضافة/تعديل» عبر AddExpenseModal (uiStore) و«حذف» عبر window.deleteExpense.
// =============================================================================
import { useMemo, useEffect, useState } from 'react'
import { Wallet, Plus, Edit3, Trash2, Repeat, CalendarDays } from 'lucide-react'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { useExpensesStore, applyExpenseFilters, EXPENSE_CATEGORIES, getExpensesTotalByDate, getExpensesTotalByMonth } from '@/state/expensesStore'
import { useUiStore } from '../state/uiStore.js'
import { getCurrentOperatingExpenses } from '@/domain/accounting/expenses'
import { formatCurrency, getCairoFormattedDate } from '@/utils/formatters'
import { showToast } from '../components/toastStore.js'

function ExpenseRow({ expense, onRefresh }) {
  const [deleting, setDeleting] = useState(false)
  const openEdit = () =>
    useUiStore.getState().openAddExpenseModal(expense.id, onRefresh)

  const remove = async () => {
    if (deleting) return
    if (!window.confirm(`هل أنت تأكد من حذف المصروف "${expense.title}"؟`)) return
    setDeleting(true)
    try {
      const ok = await window.deleteExpense(expense.id)
      if (ok) showToast('تم حذف المصروف بنجاح', 'info')
      else showToast('تعذر حذف المصروف — حاول مرة أخرى', 'error')
    } catch (err) {
      showToast((err && err.message) || 'حدث خطأ أثناء حذف المصروف', 'error')
    } finally {
      setDeleting(false)
      onRefresh()
    }
  }

  return (
    <tr>
      <td className="font-bold text-slate-400 font-mono num-font">{expense.id}</td>
      <td className="font-bold text-white">{expense.title}</td>
      <td>
        <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold">
          {expense.category || 'عمومية'}
        </span>
      </td>
      <td className="num-font font-extrabold text-rose-400">{formatCurrency(expense.amount)}</td>
      <td className="text-xs text-slate-400">
        {expense.date}
        {expense.recurring === true ? (
          <div className="mt-1">
            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded text-[10px] font-bold inline-flex items-center gap-1">
              <Repeat className="w-3 h-3" />
              شهري 🔁 استحقاق يوم {expense.dueDay}
            </span>
          </div>
        ) : null}
      </td>
      <td className="text-xs text-slate-400">{expense.notes || '—'}</td>
      <td>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={Edit3} onClick={openEdit} className="text-sky-400 hover:bg-sky-950/40 hover:text-sky-300">
            تعديل
          </Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={remove} loading={deleting} disabled={deleting} className="text-rose-400 hover:bg-rose-950/40 hover:text-rose-300">
            حذف
          </Button>
        </div>
      </td>
    </tr>
  )
}

function ExpensesView() {
  const expenses = useExpensesStore(s => s.expenses)
  const category = useExpensesStore(s => s.category)
  const dateFrom = useExpensesStore(s => s.dateFrom)
  const dateTo = useExpensesStore(s => s.dateTo)
  const setCategory = useExpensesStore(s => s.setCategory)
  const setDateFrom = useExpensesStore(s => s.setDateFrom)
  const setDateTo = useExpensesStore(s => s.setDateTo)
  const resetFilters = useExpensesStore(s => s.resetFilters)
  const refresh = useExpensesStore(s => s.refresh)

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(
    () => applyExpenseFilters(expenses, category, dateFrom, dateTo),
    [expenses, category, dateFrom, dateTo]
  )

  const today = useMemo(() => getCairoFormattedDate().slice(0, 10), [])
  const month = today.slice(0, 7)
  const todayTotal = useMemo(() => getExpensesTotalByDate(expenses, today), [expenses, today])
  const monthTotal = useMemo(() => getExpensesTotalByMonth(expenses, month), [expenses, month])
  const operating = useMemo(() => getCurrentOperatingExpenses(expenses), [expenses])

  const openAdd = () => useUiStore.getState().openAddExpenseModal(null, () => useExpensesStore.getState().refresh())

  const categoryOptions = [
    { value: '', label: 'كل الفئات' },
    ...EXPENSE_CATEGORIES.map(c => ({ value: c, label: c })),
  ]

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-900/70 p-6 rounded-2xl border border-slate-800 v7-page-hero">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-amber-400" />
            <span>دليل مصاريف التشغيل والمصروفات الإدارية</span>
          </h1>
          <p className="text-sm text-slate-400">سجل الإيجارات، الأجور، المرافق والتكلفة التشغيلية للمحل</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-left">
            <span className="text-xs text-slate-400 block">إجمالي المصروفات المستحقة حالياً:</span>
            <span className="text-lg font-extrabold text-rose-400 num-font">{formatCurrency(operating.total)}</span>
            {operating.recurringThisMonth > 0 ? (
              <span className="block text-[10px] font-bold text-purple-300">
                منها دورية مستحقة هذا الشهر: {formatCurrency(operating.recurringThisMonth)}
              </span>
            ) : null}
            {operating.recurringFuture > 0 ? (
              <span className="block text-[10px] font-bold text-slate-500">
                دورية لم يستحق موعدها بعد (قادمة): {formatCurrency(operating.recurringFuture)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-rose-400" />
            مصروفات اليوم
          </div>
          <div className="text-xl font-extrabold text-white num-font">{formatCurrency(todayTotal)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{today}</div>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-purple-400" />
            مصروفات هذا الشهر
          </div>
          <div className="text-xl font-extrabold text-white num-font">{formatCurrency(monthTotal)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{month}</div>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
            <Repeat className="w-3.5 h-3.5 text-amber-400" />
            دورية مستحقة هذا الشهر
          </div>
          <div className="text-xl font-extrabold text-purple-300 num-font">{formatCurrency(operating.recurringThisMonth)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">تُخصم من الصافي تلقائياً</div>
        </div>
      </div>

      <FilterBar
        cols="sm:grid-cols-1 lg:grid-cols-3"
        actions={
          <>
            <Button variant="secondary" onClick={resetFilters} className="text-slate-300">
              إعادة ضبط الفلتر
            </Button>
            <Button variant="primary" icon={Plus} onClick={openAdd} className="!bg-amber-600 hover:!bg-amber-500">
              إضافة مصروف جديد
            </Button>
          </>
        }
      >
        <Select label="الفئة" value={category} onChange={setCategory} options={categoryOptions} />
        <Input label="من تاريخ" type="date" value={dateFrom} onChange={setDateFrom} />
        <Input label="إلى تاريخ" type="date" value={dateTo} onChange={setDateTo} />
      </FilterBar>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>كود المصروف</th>
                <th>بيان المصروف</th>
                <th>الفئة والتصنيف</th>
                <th>المبلغ</th>
                <th>التاريخ</th>
                <th>الملاحظات</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-500">
                    لا توجد مصروفات مسجلة تطابق الفلتر
                  </td>
                </tr>
              ) : (
                rows.map(e => <ExpenseRow key={e.id} expense={e} onRefresh={refresh} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ExpensesView
