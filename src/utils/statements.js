/**
 * Banking-Style Statements of Account (كشف حساب مصرفي) — → React (Phase 2 port)
 * ============================================================================
 * Faithful ES-module port of js/utils/statements.js. Customer & Supplier
 * statements with exact timestamps (YYYY-MM-DD HH:mm:ss), debit/credit columns
 * and a running cumulative balance that always reconciles to the entity's
 * current stored balance.
 *
 * Pure module: reads the live data-access helpers from `window` at call time
 * (getCustomerById / getOrders / getPaymentsByEntity / ...) exactly as the
 * legacy script did. The compat bridge wires the exports onto window.
 */

import { escapeHtml } from './escapeHtml';

export function getStatementTypeBadge(type) {
  const map = {
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
    'إلغاء مديونية عجز': 'bg-slate-700/40 text-slate-300 border-slate-600/40'
  };
  const cls = map[type] || 'bg-slate-700/40 text-slate-300 border-slate-600/40';
  return `<span class="px-2 py-0.5 text-[11px] font-bold rounded-lg border inline-block ${cls}">${escapeHtml(type)}</span>`;
}

export function isReturnStatementType(type) {
  return type === 'مرتجع مشتريات' || type === 'مرتجع نقدي' || type === 'استرداد / رد مبلغ';
}

/**
 * Build customer statement rows: orders (debit) + payments (credit) + refunds (debit),
 * sorted ascending by timestamp, with a running balance. Pending ('new') orders are
 * KEPT in the ledger (never excluded). An opening settlement row absorbs any drift
 * between the ledger net and the stored remainingBalance — including the pending
 * orders the stored balance does not book — so the statement always reconciles 100%.
 */
export function buildCustomerStatementEntries(customerId) {
  const customer = window.getCustomerById(customerId);
  if (!customer) return [];

  const entries = [];
  let seq = 0;

  window.getOrders().forEach(o => {
    if (o.customerId !== customerId) return;
    if (o.status === 'returned' || o.status === 'cancelled') return;
    entries.push({
      seq: seq++,
      sortKey: o.createdAt || o.date || '',
      date: o.createdAt || o.date || '',
      type: 'فاتورة',
      refId: o.id,
      note: (o.items || []).map(i => `${i.productName} x${i.quantity}`).join('، ') || 'فاتورة بيع',
      debit: Number(o.totalAmount) || 0,
      credit: 0
    });
  });

  window.getPaymentsByEntity('customer', customerId).forEach(p => {
    const amt = Number(p.amount) || 0;
    const isRefund = amt < 0;
    entries.push({
      seq: seq++,
      sortKey: p.createdAt || p.date || '',
      date: p.createdAt || p.date || '',
      type: isRefund ? 'استرداد / رد مبلغ' : (p.isDownPayment ? 'دفعة مقدمة (عربون)' : 'تحصيل دفعة'),
      refId: p.id,
      note: p.notes || (isRefund ? 'رد مبلغ مسدد للعميل' : ''),
      debit: isRefund ? Math.abs(amt) : 0,
      credit: isRefund ? 0 : amt
    });
  });

  entries.sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || '') || (a.seq - b.seq));

  const netEntries = entries.reduce((s, e) => s + (e.debit - e.credit), 0);
  // V3.20 — Two-way reconciliation: the opening settlement row absorbs ANY
  // drift (legacy pre-ledger balances AND pending/'new' orders that the stored
  // balance does not book at creation), in both directions. The statement keeps
  // every ledger row intact while its closing balance always ties 100% to the
  // stored remainingBalance. round2 keeps float drift like 1400.0000000000002
  // from ever surfacing.
  const reconGap = window.round2((Number(customer.remainingBalance) || 0) - netEntries);
  const opening = reconGap;

  const rows = [];
  if (opening !== 0) {
    rows.push({
      date: '',
      type: 'تسوية افتتاحية',
      refId: '',
      note: 'تسوية فروق أرصدة سابقة لتطابق الكشف مع الرصيد الحالي',
      debit: 0,
      credit: 0,
      balance: opening,
      isOpening: true
    });
  }

  let running = opening;
  entries.forEach(e => {
    running = window.round2(running + e.debit - e.credit);
    rows.push({ ...e, balance: running });
  });

  return rows;
}

/**
 * Build supplier statement rows from the unified supplier transaction ledger.
 * V3.54 — الكشف دفترَي بالكامل: لا يُختلق أي بند «أرصدة وحركات سابقة / رصيد
 * افتتاحي» مهما كان الرصيد المخزَّن — لو كان الدفتر فارغاً يظهر الكشف فارغاً
 * لا بنداً وهمياً بمبالغ لا تسندها حركات فعلية. الرصيد التراكمي يغلق على صافي
 * الدفتر، ولتصحيح أي انحراف تاريخي يستخدم المدير زر «إعادة احتساب الأرباح».
 */
export function buildSupplierStatementEntries(supplierId) {
  const supplier = window.getSupplierById(supplierId);
  if (!supplier) return [];

  const txns = window.getSupplierTransactionsBySupplier(supplierId);

  const rows = [];
  let running = 0;
  txns
    .slice()
    .map((t, idx) => ({ ...t, seq: idx }))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.seq - b.seq))
    .forEach(t => {
      // V3.53 — عكس القطبية لكشف المورد: المشتريات (مدين في السجل) «له / علينا»،
      // والتسديد والمرتجع (دائن في السجل) «عليه / لنا». الرصيد التراكمي يتبع صافي
      // التدفق فينزل إلى سالب عند فائض المرتجع بدلاً من الالتفاف على الصفر.
      const debit = Number(t.credit) || 0;
      const credit = Number(t.debit) || 0;
      running = window.round2(running + credit - debit);
      rows.push({
        date: t.createdAt || '',
        type: t.type || 'حركة',
        refId: t.refId || '',
        note: t.note || '',
        debit,
        credit,
        balance: running
      });
    });

  return rows;
}

/**
 * Shared banking-style statement table renderer with running balance.
 */
export function renderBankStatementTable({ entityName, entitySub = '', closingLabel, closingValue, closingColor = 'text-rose-400', rows, emptyMessage, debitLabel = 'مدين', creditLabel = 'دائن', closingBadge = '', reconWarning = '', signReturns = true }) {
  const totalDebit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const lastBalance = rows.length ? rows[rows.length - 1].balance : 0;

  return `
    <div class="space-y-4">
      ${reconWarning ? `
        <div class="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs font-bold leading-relaxed">
          ⚠️ ${reconWarning}
        </div>
      ` : ''}
      <div class="p-4 bg-slate-850 rounded-xl border border-slate-800 flex justify-between items-center flex-wrap gap-3">
        <div>
          <h4 class="font-bold text-white text-base">${escapeHtml(entityName)}</h4>
          <p class="text-xs text-slate-400 font-mono">${escapeHtml(entitySub || '')}</p>
        </div>
        <div class="text-left">
          <span class="text-xs text-slate-400 block">${closingLabel}</span>
          <span class="text-xl font-extrabold ${closingColor} num-font">${window.formatCurrency(closingValue)}</span>
          ${closingBadge ? `<div class="mt-1.5">${closingBadge}</div>` : ''}
        </div>
      </div>

      ${rows.length === 0 ? `
        <div class="text-center py-10 text-slate-500 text-sm">${emptyMessage || 'لا توجد حركات مسجلة'}</div>
      ` : `
        <div class="overflow-x-auto rounded-xl border border-slate-800">
          <table class="data-table">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>نوع العملية / المرجع</th>
                <th>البيان</th>
                <th>${debitLabel}</th>
                <th>${creditLabel}</th>
                <th>الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const isReturn = window.isReturnStatementType(r.type);
                // V3.53 — للمورد، المرتجع مبلغ موجب في خانة المدين («عليه / لنا»)
                // فلا يُعرض بعلامة سالبة كما يفعل كشف العميل.
                const signed = signReturns && isReturn;
                const debitDisp = r.debit > 0
                  ? (signed ? `<span class="text-rose-400 font-extrabold">−${window.formatCurrency(r.debit)}</span>` : window.formatCurrency(r.debit))
                  : '—';
                const creditDisp = r.credit > 0
                  ? (signed ? `<span class="text-rose-400 font-extrabold">−${window.formatCurrency(r.credit)}</span>` : window.formatCurrency(r.credit))
                  : '—';
                return `
                  <tr class="${isReturn ? 'bg-rose-950/20' : r.isOpening ? 'bg-slate-800/40' : ''}">
                    <td class="text-xs text-slate-400 num-font whitespace-nowrap">${r.isOpening ? '— (سابق)' : window.formatDateTime(r.date)}</td>
                    <td>
                      <div class="flex flex-col gap-1">
                        ${window.getStatementTypeBadge(r.type)}
                        ${r.refId ? `<span class="text-[10px] font-mono text-slate-500">${escapeHtml(r.refId)}</span>` : ''}
                      </div>
                    </td>
                    <td class="text-xs text-slate-300 max-w-[240px]">${escapeHtml(r.note || '—')}</td>
                    <td class="num-font font-bold ${r.debit > 0 ? 'text-rose-400' : 'text-slate-600'}">${debitDisp}</td>
                    <td class="num-font font-bold ${r.credit > 0 ? 'text-emerald-400' : 'text-slate-600'}">${creditDisp}</td>
                    <td class="num-font font-extrabold text-white">${window.formatCurrency(r.balance)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="bg-slate-800/60 border-t-2 border-slate-700">
                <td class="text-xs font-bold text-slate-300" colspan="3">الإجمالي الختامي</td>
                <td class="num-font font-extrabold text-rose-400">${totalDebit ? window.formatCurrency(totalDebit) : '—'}</td>
                <td class="num-font font-extrabold text-emerald-400">${totalCredit ? window.formatCurrency(totalCredit) : '—'}</td>
                <td class="num-font font-extrabold text-white">${window.formatCurrency(lastBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `}
    </div>
  `;
}

export function renderCustomerStatementHTML(customerId) {
  const customer = window.getCustomerById(customerId);
  if (!customer) return '<p class="text-xs text-slate-500 py-4 text-center">لا توجد بيانات عميل متاحة</p>';
  const rows = window.buildCustomerStatementEntries(customerId);
  const bal = Number(customer.remainingBalance) || 0;
  const badge = bal > 0
    ? `<span class="inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-rose-500/20 text-rose-300 border-rose-500/30">مستحق على العميل (${window.formatCurrency(bal)})</span>`
    : `<span class="inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">الحساب خالص (${window.formatCurrency(0)})</span>`;
  return window.renderBankStatementTable({
    entityName: customer.name,
    entitySub: `${customer.phone || ''}${customer.address ? ' — ' + customer.address : ''}`,
    closingLabel: 'الرصيد المتبقي على العميل',
    closingValue: bal,
    closingColor: bal > 0 ? 'text-rose-400' : 'text-emerald-400',
    debitLabel: 'علية (فاتورة +)',
    creditLabel: 'سدده (تحصيل -)',
    closingBadge: badge,
    rows,
    reconWarning: rows.reconWarning || '',
    emptyMessage: 'لا توجد فواتير أو دفعات مسجلة لهذا العميل'
  });
}

export function renderSupplierStatementHTML(supplierId) {
  const supplier = window.getSupplierById(supplierId);
  if (!supplier) return '<p class="text-xs text-slate-500 py-4 text-center">لا توجد بيانات مورد متاحة</p>';
  const rows = window.buildSupplierStatementEntries(supplierId);
  // V3.54 — الرصيد الختامي يتبع الدفتر (آخر رصيد تراكمي) لا الرصيد المخزَّن،
  // فبلا بند افتتاحي وهمي يطابق الكشف صافي الحركات الفعلية دائماً.
  const bal = rows.length ? (Number(rows[rows.length - 1].balance) || 0) : 0;
  const badge = bal > 0
    ? `<span class="inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-purple-500/20 text-purple-300 border-purple-500/30">مستحق للمورد (${window.formatCurrency(bal)})</span>`
    : bal < 0
      ? `<span class="inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">رصيد دائن لصالحنا (${window.formatCurrency(Math.abs(bal))})</span>`
    : `<span class="inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">الحساب خالص (${window.formatCurrency(0)})</span>`;
  return window.renderBankStatementTable({
    entityName: supplier.name,
    entitySub: `${supplier.phone || ''}${supplier.address ? ' — ' + supplier.address : ''}`,
    closingLabel: bal < 0 ? 'رصيد دائن لصالحنا (المورد مدين لنا)' : 'الرصيد المستحق للمورد',
    closingValue: bal,
    closingColor: bal > 0 ? 'text-purple-400' : 'text-emerald-400',
    debitLabel: 'عليه / لنا (تسديد ومرتجع +)',
    creditLabel: 'له / علينا (توريد بضاعة +)',
    closingBadge: badge,
    rows,
    emptyMessage: 'لا توجد حركات مسجلة لهذا المورد',
    signReturns: false
  });
}

export function openCustomerStatementModal(customerId) {
  const customer = window.getCustomerById(customerId);
  if (!customer) return;
  window.openModal({
    title: `📒 كشف حساب مصرفي: ${customer.name}`,
    icon: 'book-open',
    maxWidth: 'max-w-5xl',
    contentHTML: `<div id="bank-statement-body">${window.renderCustomerStatementHTML(customerId)}</div>`
  });
}

export function openSupplierStatementModal(supplierId) {
  const supplier = window.getSupplierById(supplierId);
  if (!supplier) return;
  window.openModal({
    title: `📒 كشف حساب مورد: ${supplier.name}`,
    icon: 'book-open',
    maxWidth: 'max-w-5xl',
    contentHTML: `<div id="bank-statement-body">${window.renderSupplierStatementHTML(supplierId)}</div>`
  });
}

/**
 * Resolve the full statement payload (entity + rows) for either entity type.
 * Shared by StatementModal and the ReportsView statement tabs so both render
 * through the same React table (BankStatementTable).
 */
export function resolveStatement(entityType, entityId) {
  if (entityType === 'supplier') {
    const supplier = window.getSupplierById ? window.getSupplierById(entityId) : null;
    return {
      entity: supplier,
      isSupplier: true,
      rows: supplier ? buildSupplierStatementEntries(entityId) : []
    };
  }
  const customer = window.getCustomerById ? window.getCustomerById(entityId) : null;
  return {
    entity: customer,
    isSupplier: false,
    rows: customer ? buildCustomerStatementEntries(entityId) : []
  };
}
