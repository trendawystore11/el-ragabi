/**
 * Operational Expenses accounting — pure domain layer.
 * Ported verbatim from js/services/expenses.js (legacy). Pure calculations take
 * data directly; create/update/delete receive an injected `repo`
 * (repository pattern) — see src/legacy/compat.js for adapters.
 */
import { toNumber, round2, generateAutoId, getCairoFormattedDate } from '../../utils/formatters.js';

export const EXPENSES_STORAGE_KEY = 'expenses';

export function getTotalExpenses(expenses) {
  return round2(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
}

/* ===== Recurring (monthly) expenses ===== */
export function getExpenseNextDueDate(expense, baseDate) {
  if (!expense || expense.recurring !== true) return '';
  const due = parseInt(expense.dueDay, 10);
  if (isNaN(due) || due < 1 || due > 31) return '';
  const now = baseDate ? new Date(baseDate) : new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (now.getDate() >= due) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(due, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getCurrentOperatingExpenses(expenses, nowDate) {
  const list = expenses || [];
  const now = nowDate ? new Date(nowDate) : new Date();
  const currentDay = now.getDate();
  const toNum = toNumber;
  let oneTime = 0;
  let recurringThisMonth = 0;
  let recurringFuture = 0;
  list.forEach(e => {
    const amt = toNum(e.amount);
    if (e.recurring === true) {
      const due = parseInt(e.dueDay, 10);
      if (isNaN(due) || due < 1 || due > 31) {
        oneTime += amt;
        return;
      }
      if (currentDay >= due) recurringThisMonth += amt;
      else recurringFuture += amt;
    } else {
      oneTime += amt;
    }
  });
  return {
    oneTime: round2(oneTime),
    recurringThisMonth: round2(recurringThisMonth),
    recurringFuture: round2(recurringFuture),
    total: round2(oneTime + recurringThisMonth)
  };
}

/* ===== Recurring expense treasury posting (V3.58 audit) ===== */

/** Pure: period key `YYYY-MM` of a date string. */
export function getExpensePeriodKey(dateStr) {
  if (!dateStr) return '';
  return String(dateStr).slice(0, 7);
}

/**
 * Pure: is this recurring expense due for posting in the current period?
 * Postable when its due day for the current month has arrived (or is overdue)
 * and it has not been posted for that period yet. A recurring expense created
 * this month AFTER its due day is not due until next period.
 */
export function isExpenseDueForPosting(expense, nowDate) {
  if (!expense || expense.recurring !== true) return false;
  const due = parseInt(expense.dueDay, 10);
  if (isNaN(due) || due < 1 || due > 31) return false;
  const now = nowDate ? new Date(nowDate) : new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (expense.lastPostedPeriod === currentPeriod) return false;

  const created = String(expense.date || '').slice(0, 10);
  if (created && getExpensePeriodKey(created) === currentPeriod) {
    const createdDay = parseInt(created.slice(8, 10), 10);
    if (!isNaN(createdDay) && createdDay > due) return false;
  }
  return now.getDate() >= due;
}

/**
 * Post every due recurring expense to the treasury as ONE atomic batch: a
 * treasury outflow payment record (entityType 'treasury', negative amount) with
 * an idempotent cycleKey 'expense-<period>' + the expense's lastPostedPeriod
 * marker. createPaymentRecord's cycleKey guard is the second line of defense,
 * so re-running can never double-post a period. Returns the number posted.
 */
export async function postDueRecurringExpenses(repo, nowDate) {
  const expenses = repo.getExpenses();
  const postable = (expenses || []).filter(e => isExpenseDueForPosting(e, nowDate) && (Math.abs(Number(e.amount) || 0) > 0));
  if (postable.length === 0) return 0;

  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;
  const wRepo = batch ? repo.withBatch(batch) : repo;
  const now = nowDate ? new Date(nowDate) : new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  postable.forEach(expense => {
    const dueDay = Math.min(parseInt(expense.dueDay, 10), lastDay);
    const dueDate = `${currentPeriod}-${String(dueDay).padStart(2, '0')}`;
    const amount = Math.abs(Number(expense.amount) || 0);

    wRepo.createPaymentRecord({
      entityType: 'treasury',
      entityId: expense.id,
      entityName: expense.title || 'مصروف دوري',
      amount: -amount,
      date: dueDate,
      paymentMethod: 'cash',
      notes: `مصروف دوري${expense.category ? ' (' + expense.category + ')' : ''}: ${expense.title || ''}`,
      type: 'expense',
      refOrderId: expense.id,
      cycleKey: 'expense-' + currentPeriod,
      createdBy: expense.createdBy || 'المدير العام'
    });
    wRepo.updateFirestoreDoc(repo.storageKeys.EXPENSES, expense.id, { lastPostedPeriod: currentPeriod });
  });

  if (batch) {
    await batch.commit();
  }
  return postable.length;
}

export function createExpense({ title, amount, category = 'عمومية', date, notes = '', createdBy = 'المدير العام', recurring = false, dueDay = null }, repo) {
  const numAmount = round2(parseFloat(amount));
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('يرجى إدخال قيمة مصروف صحيحة أكبر من الصفر');
  }

  const expenseId = generateAutoId('EXP');
  const now = getCairoFormattedDate();

  const newExpense = {
    id: expenseId,
    title: title.trim(),
    amount: numAmount,
    category: category.trim(),
    date: date || now.slice(0, 10),
    notes: notes.trim(),
    recurring: !!recurring,
    dueDay: recurring ? (parseInt(dueDay, 10) || null) : null,
    createdBy,
    createdAt: now,
    updatedAt: now
  };

  return repo.addFirestoreDoc(repo.storageKeys.EXPENSES, newExpense);
}

export function updateExpense(id, updates, repo) {
  const sanitized = { ...updates };
  if (sanitized.amount != null) sanitized.amount = round2(parseFloat(sanitized.amount));
  if (sanitized.recurring != null) sanitized.recurring = !!sanitized.recurring;
  if (sanitized.recurring === true) {
    sanitized.dueDay = parseInt(sanitized.dueDay, 10) || null;
  } else if (sanitized.recurring === false) {
    sanitized.dueDay = null;
  }
  repo.updateFirestoreDoc(repo.storageKeys.EXPENSES, id, { ...sanitized, updatedAt: getCairoFormattedDate() });
  return repo.getExpenses().find(e => e.id === id) || null;
}

export function deleteExpense(id, repo) {
  return repo.deleteFirestoreDoc(repo.storageKeys.EXPENSES, id);
}
