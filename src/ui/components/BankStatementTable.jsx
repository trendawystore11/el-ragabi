// =============================================================================
// ui/components/BankStatementTable.jsx — كشف الحساب البنكي — نسخة React من
// renderBankStatementTable (js/utils/statements.js)
// -----------------------------------------------------------------------------
// يعرض كشف الحساب المصرفي: رأس الكيان مع الرصيد الختامي وشارة المديونية،
// وجدول حركات (التاريخ / النوع والمرجع / البيان / مدين / دائن / الرصيد
// التراكمي) مع إجمالي ختامي. يستخدمه StatementModal وتبويبا كشف الحساب في
// ReportsView. يستهلك الصفوف الجاهزة من buildCustomerStatementEntries /
// buildSupplierStatementEntries (مع صف التسوية الافتتاحية).
// =============================================================================
import { formatCurrency, formatDateTime, formatPhonePair, formatAddress } from '../../utils/formatters.js'
import { isReturnStatementType } from '../../utils/statements.js'

const TYPE_BADGE = {
  'فاتورة': 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  'دفعة مقدمة (عربون)': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'تحصيل دفعة': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'استرداد / رد مبلغ': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'رصيد افتتاحي': 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  'تسوية افتتاحية': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'شحنة توريد': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'تسجيل منتج ومخزون': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'مديونية عجز مخزون': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'تسديد دفعة': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'مرتجع مشتريات': 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'مرتجع نقدي': 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'إلغاء مديونية عجز': 'bg-slate-700/40 text-slate-300 border-slate-600/40',
}

function BankStatementTable({ entity, isSupplier, rows = [] }) {
  const totalDebit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0)
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0)
  const lastBalance = rows.length ? rows[rows.length - 1].balance : 0
  // V3.54 — كشف المورد دفترَي بالكامل: الرصيد الختامي يتبع آخر رصيد تراكمي
  // (لا بند «أرصدة وحركات سابقة» وهمي) بينما يظل كشف العميل مربوطاً بالرصيد المخزَّن.
  const bal = isSupplier ? lastBalance : (Number(entity ? entity.remainingBalance : 0) || 0)

  const badge = isSupplier
    ? bal > 0
      ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : bal > 0
      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  const badgeText = bal > 0
    ? `مستحق ${isSupplier ? 'للمورد' : 'على العميل'} (${formatCurrency(bal)})`
    : bal < 0
      ? `رصيد دائن لصالحنا (${formatCurrency(Math.abs(bal))})`
      : 'الحساب خالص (' + formatCurrency(0) + ')'
  const closingLabel = isSupplier
    ? bal < 0 ? 'رصيد دائن لصالحنا (المورد مدين لنا)' : 'الرصيد المستحق للمورد'
    : 'الرصيد المتبقي على العميل'
  const closingColor = isSupplier
    ? bal > 0 ? 'text-purple-400' : 'text-emerald-400'
    : bal > 0 ? 'text-rose-400' : 'text-emerald-400'
  const debitLabel = isSupplier ? 'عليه / لنا (تسديد ومرتجع +)' : 'علية (فاتورة +)'
  const creditLabel = isSupplier ? 'له / علينا (توريد بضاعة +)' : 'سدده (تحصيل -)'
  const emptyMessage = isSupplier
    ? 'لا توجد حركات مسجلة لهذا المورد'
    : 'لا توجد فواتير أو دفعات مسجلة لهذا العميل'

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-800/60 rounded-xl border border-slate-800 flex justify-between items-center flex-wrap gap-3">
        <div>
          <h4 className="font-bold text-white text-base">{entity ? entity.name : '—'}</h4>
          {entity ? (
            <p className="text-xs text-slate-400 font-mono">
              {formatPhonePair(entity.phone, entity.secondaryPhone)}
              {formatAddress(entity.address) !== '—' ? ` — ${formatAddress(entity.address)}` : ''}
            </p>
          ) : null}
        </div>
        <div className="text-left">
          <span className="text-xs text-slate-400 block">{closingLabel}</span>
          <span className={`text-xl font-extrabold num-font ${closingColor}`}>{formatCurrency(bal)}</span>
          <div className="mt-1.5">
            <span className={`inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg border ${badge}`}>
              {badgeText}
            </span>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>نوع العملية / المرجع</th>
                <th>البيان</th>
                <th>{debitLabel}</th>
                <th>{creditLabel}</th>
                <th>الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const isReturn = isReturnStatementType(r.type)
                // V3.53 — للمورد، المرتجع مبلغ موجب في خانة المدين فلا يُضاف الطرح.
                const signed = !isSupplier && isReturn
                const debitDisp = r.debit > 0
                  ? signed ? `−${formatCurrency(r.debit)}` : formatCurrency(r.debit)
                  : '—'
                const creditDisp = r.credit > 0
                  ? signed ? `−${formatCurrency(r.credit)}` : formatCurrency(r.credit)
                  : '—'
                return (
                  <tr key={idx} className={isReturn ? 'bg-rose-950/20' : r.isOpening ? 'bg-slate-800/40' : ''}>
                    <td className="text-xs text-slate-400 num-font whitespace-nowrap">
                      {r.isOpening ? '— (سابق)' : formatDateTime(r.date)}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <span
                          className={`px-2 py-0.5 text-[11px] font-bold rounded-lg border inline-block w-fit ${TYPE_BADGE[r.type] || TYPE_BADGE['رصيد افتتاحي']}`}
                        >
                          {r.type}
                        </span>
                        {r.refId ? <span className="text-[10px] font-mono text-slate-500">{r.refId}</span> : null}
                      </div>
                    </td>
                    <td className="text-xs text-slate-300 max-w-[240px]">{r.note || '—'}</td>
                    <td className={`num-font font-bold ${r.debit > 0 ? 'text-rose-400' : 'text-slate-600'}`}>
                      {debitDisp}
                    </td>
                    <td className={`num-font font-bold ${r.credit > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {creditDisp}
                    </td>
                    <td className="num-font font-extrabold text-white">{formatCurrency(r.balance)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800/60 border-t-2 border-slate-700">
                <td className="text-xs font-bold text-slate-300" colSpan={3}>الإجمالي الختامي</td>
                <td className="num-font font-extrabold text-rose-400">{totalDebit ? formatCurrency(totalDebit) : '—'}</td>
                <td className="num-font font-extrabold text-emerald-400">{totalCredit ? formatCurrency(totalCredit) : '—'}</td>
                <td className="num-font font-extrabold text-white">{formatCurrency(lastBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export default BankStatementTable
