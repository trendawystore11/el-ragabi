/**
 * Payments / Treasury accounting — pure domain layer.
 * Ported verbatim from js/services/payments.js (legacy). Pure functions take
 * data directly; createPaymentRecord receives an injected `repo` (repository
 * pattern) — see src/legacy/compat.js for adapters.
 */
import { toNumber, round2, formatCurrency, generateAutoId, getCairoFormattedDate, increment } from '../../utils/formatters.js';
import { isActiveOrderStatus, getOrderRemainingAmount } from './accounting.js';

/** V3.15 — Explicit mandatory ordering for the treasury ledger. */
export function sortPaymentsDesc(list) {
  return (list || []).slice().sort((a, b) => {
    const ta = String(a.createdAt || a.date || '');
    const tb = String(b.createdAt || b.date || '');
    const byDate = tb.localeCompare(ta);
    if (byDate !== 0) return byDate;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

export function getPaymentsSorted(payments) {
  return sortPaymentsDesc(payments);
}

export function searchPayments(payments, query) {
  const list = getPaymentsSorted(payments);
  if (!query) return list;
  const q = query.trim().toLowerCase();
  return list.filter(p =>
    (p.entityName && p.entityName.toLowerCase().includes(q)) ||
    (p.id && p.id.toLowerCase().includes(q)) ||
    (p.notes && p.notes.toLowerCase().includes(q))
  );
}

export function getPaymentsByEntity(payments, entityType, entityId) {
  return (payments || []).filter(p => p.entityType === entityType && p.entityId === entityId);
}

export function getTotalCustomerReceivables(orders) {
  // V3.16 — Receivables derived DIRECTLY from ACTIVE orders.
  return round2(orders
    .filter(o => isActiveOrderStatus(o.status))
    .reduce((sum, o) => sum + getOrderRemainingAmount(o), 0));
}

export function getTotalSupplierPayables(suppliers) {
  return round2(suppliers.reduce((sum, s) => sum + toNumber(s.remainingBalance), 0));
}

export function getTotalPaymentsCollected(payments) {
  return round2((payments || []).reduce((sum, p) => sum + toNumber(p.amount), 0));
}

/**
 * createPaymentRecord — VERBATIM port of window.createPaymentRecord.
 * All data access is routed through the injected repo:
 *   { getPayments, getOrders, getCustomerById, getSupplierById,
 *     updateCustomer, updateSupplier, addFirestoreDoc, updateFirestoreDoc,
 *     logSupplierTransaction, storageKeys }
 */
export function createPaymentRecord({ entityType, entityId, entityName, amount, date, paymentMethod = 'cash', notes = '', isDownPayment = false, createdBy = 'المدير العام', type = '', refOrderId = '', cycleKey = '', isCollection = false }, repo) {
  const numericAmount = round2(parseFloat(amount));
  if (isNaN(numericAmount) || numericAmount === 0) {
    throw new Error('يرجى إدخال مبلغ صحيح');
  }

  // V3.62 — تحصيل نقدية من مورد / مصنع (المورد مدين لنا: رصيد سالب).
  // يُسجَّل قيدُ قبض سالب (أي قيمة واردة لصالح الخزينة مثل legacy cash-back)
  // فيرتفع الرصيد نحو الصفر ولا يُصفَّر الدَّين المستحق لنا.
  const isSupplierCollection = entityType === 'supplier' && isCollection === true;

  // 🔒 V3.15.1 — Idempotency key (refOrderId + cycleKey).
  if (refOrderId && cycleKey) {
    const keyKind = cycleKey.toLowerCase();
    if (keyKind.includes('refund') && numericAmount > 0) {
      throw new Error('سجل رد المبلغ (refund) يجب أن يكون بقيمة سالبة — افحص اتجاه الحركة');
    }
    if ((keyKind.includes('recredit') || keyKind.includes('settle') || keyKind === 'deposit') && numericAmount < 0) {
      throw new Error('سجل القبض / الرصيد (credit) يجب أن يكون بقيمة موجبة — افحص اتجاه الحركة');
    }

    const existing = repo.getPayments().find(p => p.refOrderId === refOrderId && p.cycleKey === cycleKey);
    if (existing) {
      const oldAmount = Number(existing.amount) || 0;
      const signedDelta = round2(numericAmount - oldAmount);
      if (entityType === 'customer') {
        const customer = repo.getCustomerById(entityId);
        if (customer) {
          repo.updateCustomer(entityId, { paid: increment(signedDelta) });
        }
      } else if (entityType === 'supplier') {
        const supplier = repo.getSupplierById(entityId);
        if (supplier) {
          repo.updateSupplier(entityId, { paid: increment(signedDelta) });
        }
      }
      repo.updateFirestoreDoc(repo.storageKeys.PAYMENTS, existing.id, {
        amount: numericAmount,
        date: date || existing.date,
        paymentMethod: paymentMethod || existing.paymentMethod,
        notes: (notes || '').trim() || existing.notes
      });
      return { ...existing, amount: numericAmount, date: date || existing.date, notes: (notes || '').trim() || existing.notes };
    }
  }

  // 🔒 1. Validation: Prevent standalone payments exceeding remaining balance
  if (!isDownPayment && numericAmount > 0) {
    if (entityType === 'customer') {
      const customer = repo.getCustomerById(entityId);
      if (customer) {
        const maxRemaining = Number(customer.remainingBalance) || 0;
        if (numericAmount > maxRemaining) {
          throw new Error(`المبلغ المدخل أكبر من إجمالي المديونية المتبقية على العميل (${formatCurrency(maxRemaining)}) — يتجاوز إجمالي الرصيد المتبقي`);
        }
      }
    } else if (entityType === 'supplier') {
      const supplier = repo.getSupplierById(entityId);
      if (supplier) {
        if (isSupplierCollection) {
          // V3.62 — تحصيل نقدية من مورد مدين لنا (رصيد سالب): السقف هو المبلغ
          // المستحق لنا منه، وليس المديونية المستحقة له.
          const owedToUs = round2(Math.max(0, -(Number(supplier.remainingBalance) || 0)));
          if (owedToUs <= 0) {
            throw new Error('لا يوجد مبلغ مستحق لنا من هذا المورد — رصيده غير دائن لصالحنا');
          }
          if (numericAmount > owedToUs) {
            throw new Error(`المبلغ المدخل أكبر من إجمالي المبلغ المستحق لنا من المورد (${formatCurrency(owedToUs)}) — يتجاوز الرصيد الدائن لصالحنا`);
          }
        } else {
          const maxRemaining = Number(supplier.remainingBalance) || 0;
          if (numericAmount > maxRemaining) {
            throw new Error(`المبلغ المدخل أكبر من إجمالي المديونية المستحقة للمورد (${formatCurrency(maxRemaining)}) — يتجاوز إجمالي الرصيد المستحق`);
          }
        }
      }
    }
  }

  const paymentId = generateAutoId('PAY');
  const now = getCairoFormattedDate();

  // V3.62 — تحصيل نقدية من مورد: يُسجَّل قيد قبض سالب (مثل convention استرداد
  // كاش legacy) فيرتفع رصيد المورد نحو الصفر، وتحتسبه الخزينة وارداً
  // (supplierCashBack في computeTreasury).
  const storedAmount = isSupplierCollection ? -numericAmount : numericAmount;

  const newPayment = {
    id: paymentId,
    entityType,
    entityId,
    entityName: entityName.trim(),
    amount: storedAmount,
    date: date || now.slice(0, 10),
    paymentMethod,
    notes: notes.trim(),
    isDownPayment: !!isDownPayment,
    createdBy,
    createdAt: now,
    type: type || (isSupplierCollection ? 'supplierCollection' : (numericAmount < 0 ? 'refund' : (isDownPayment ? 'deposit' : 'payment'))),
    refOrderId,
    cycleKey
  };

  // Save Payment doc to Cloud Firestore
  repo.addFirestoreDoc(repo.storageKeys.PAYMENTS, newPayment);

  // Update Customer or Supplier Balance in Cloud Firestore
  if (entityType === 'customer') {
    const customer = repo.getCustomerById(entityId);
    if (customer) {
      // V3.61 — ATOMIC BALANCE WRITES: emit increment(delta) markers so the
      //     server applies FieldValue.increment — removes the read-modify-write
      //     race (audit item B). The >0 validation above is the clamp guard;
      //     remainingBalance can only go negative via a simultaneous
      //     double-payment race. Down-payments/refunds don't touch the balance.
      const balanceDelta = (numericAmount < 0 || isDownPayment) ? 0 : -numericAmount;
      repo.updateCustomer(entityId, {
        paid: increment(numericAmount),
        remainingBalance: increment(balanceDelta)
      });

      // 🔒 SYNC STANDALONE PAYMENTS TO ORDER
      if (!isDownPayment && numericAmount > 0) {
        const orders = repo.getOrders();
        const unpaidOrders = orders
          .filter(o => o.customerId === entityId && o.status !== 'returned' && o.status !== 'cancelled' && (Number(o.remainingBalance) || 0) > 0)
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        let remainingToAllocate = numericAmount;
        for (const order of unpaidOrders) {
          if (remainingToAllocate <= 0) break;
          const orderRemaining = Number(order.remainingBalance) || 0;
          const allocated = round2(Math.min(remainingToAllocate, orderRemaining));
          const newRemaining = round2(orderRemaining - allocated);
          const newDownPayment = round2((Number(order.downPayment) || 0) + allocated);
          repo.updateFirestoreDoc(repo.storageKeys.ORDERS, order.id, {
            downPayment: newDownPayment,
            remainingBalance: newRemaining,
            paidInFull: newRemaining <= 0
          });
          remainingToAllocate -= allocated;
        }
        repo.updateFirestoreDoc(repo.storageKeys.PAYMENTS, paymentId, {
          allocatedToOrders: true
        });
      }
    }
  } else if (entityType === 'supplier') {
    const supplier = repo.getSupplierById(entityId);
    if (supplier) {
      if (isSupplierCollection) {
        // V3.62 — تحصيل نقدية من مورد مدين لنا: نستلم كاشاً فيرتفع رصيده نحو
        // الصفر (من سالب إلى أقل سالبية) ويقل صافي المدفوعات له.
        repo.updateSupplier(entityId, {
          paid: increment(-numericAmount),
          remainingBalance: increment(numericAmount)
        });

        if (repo.logSupplierTransaction) {
          repo.logSupplierTransaction({
            supplierId: entityId,
            supplierName: supplier.name,
            type: 'تحصيل نقدية من المورد',
            refId: paymentId,
            debit: numericAmount,
            note: (notes || '').trim() || 'تحصيل نقدي مستلم من المورد (رصيد دائن لصالحنا)',
            date: now
          });
        }
      } else {
        // V3.61 — ATOMIC: same marker scheme as the customer branch. Refunds
        //     (negative amounts) never touch supplier paid/remainingBalance.
        const settlementDelta = numericAmount < 0 ? 0 : numericAmount;
        repo.updateSupplier(entityId, {
          paid: increment(settlementDelta),
          remainingBalance: increment(-settlementDelta)
        });

        // 📒 Log the supplier ledger credit for positive payments (debt settlement)
        if (numericAmount > 0 && repo.logSupplierTransaction) {
          repo.logSupplierTransaction({
            supplierId: entityId,
            supplierName: supplier.name,
            type: 'تسديد دفعة',
            refId: paymentId,
            credit: numericAmount,
            note: (notes || '').trim() || 'تسديد دفعة / تحويل للمورد',
            date: now
          });
        }
      }
    }
  }

  return newPayment;
}
