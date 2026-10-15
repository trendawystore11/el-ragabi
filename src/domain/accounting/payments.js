/**
 * Payments / Treasury accounting — pure domain layer.
 * Ported verbatim from js/services/payments.js (legacy). Pure functions take
 * data directly; createPaymentRecord receives an injected `repo` (repository
 * pattern) — see src/legacy/compat.js for adapters.
 */
import { toNumber, round2, formatCurrency, generateAutoId, getCairoFormattedDate, increment } from '../../utils/formatters.js';
import { isActiveOrderStatus, getOrderRemainingAmount } from './accounting.js';
import { getUnappliedPaymentAmount } from '../customers/customers.js';

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

/** V3.65 — Net customer debt-adjustment total (a positive entry reduces debt). */
export function getCustomerDebtAdjustmentsTotal(payments) {
  // F-10 — الدفعات المعكوسة (reversed) بلا أثر مالي ⇒ تُستبعد من الإجماليات.
  return round2((payments || [])
    .filter(p => p.type === 'customerDebtAdjustment' && p.reversed !== true)
    .reduce((sum, p) => sum + toNumber(p.amount), 0));
}

export function getTotalCustomerReceivables(orders, payments = []) {
  // V3.16 — Receivables derived DIRECTLY from ACTIVE orders.
  // V3.65 — Subtract customer debt adjustments (a positive entry reduces the
  // debt) so the dashboard/report figures stay consistent with the statements.
  const list = (payments || []).filter(p => p.reversed !== true);
  const base = orders
    .filter(o => isActiveOrderStatus(o.status))
    .reduce((sum, o) => sum + getOrderRemainingAmount(o), 0);
  // دفعات/ائتمان العميل غير المُخصَّص لطلب (تحصيل بلا طلب نشط) تخفض الدين فعلاً
  // في دفتر العميل، لكن المؤشر كان يتجاهلها فيبالغ في الذمم (500 بدل 300).
  // نستخدم نفس دلالة recalculateCustomerBalance (getUnappliedPaymentAmount) كي
  // يتطابق مؤشر الذمم مع صافي أرصدة العملاء.
  const unappliedCustomerCredit = round2(list
    .filter(p => p.entityType === 'customer' && p.type !== 'customerDebtAdjustment' && !p.isDownPayment && toNumber(p.amount) > 0)
    .reduce((sum, p) => sum + getUnappliedPaymentAmount(p), 0));
  return round2(base - getCustomerDebtAdjustmentsTotal(list) - unappliedCustomerCredit);
}

export function getTotalSupplierPayables(suppliers) {
  return round2(suppliers.reduce((sum, s) => sum + toNumber(s.remainingBalance), 0));
}

export function getTotalPaymentsCollected(payments) {
  // F-10 — استبعاد القيود المعكوسة من إجمالي المقبوضات.
  return round2((payments || []).filter(p => p.reversed !== true).reduce((sum, p) => sum + toNumber(p.amount), 0));
}

/**
 * createPaymentRecord — VERBATIM port of window.createPaymentRecord.
 * All data access is routed through the injected repo:
 *   { getPayments, getOrders, getCustomerById, getSupplierById,
 *     updateCustomer, updateSupplier, addFirestoreDoc, updateFirestoreDoc,
 *     logSupplierTransaction, storageKeys }
 */
export function createPaymentRecord({ entityType, entityId, entityName, amount, date, paymentMethod = 'cash', notes = '', isDownPayment = false, createdBy = 'المدير العام', type = '', refOrderId = '', cycleKey = '', isCollection = false, id = '', createdAt = '' }, repo) {
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

  const paymentId = id || generateAutoId('PAY');
  const now = createdAt || getCairoFormattedDate();

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
        // Phase 4 / F-05B — نتبّع المبلغ المُخصَّص فعلاً على الطلبات؛ فقد يقلّ عن
        // قيمة الدفعة (تخصيص جزئي) أو يكون صفراً (لا طلبات مؤهّلة). بغير ذلك تفنى
        // الدفعة أو بقيّتها غير المُخصَّصة عند إعادة احتساب رصيد العميل.
        // F-05 — نحفظ التخصيص الأصلي بالتفصيل (orderId + amount) وقت الإنشاء كي
        // يعكس العكسُ الطلبات التي خُصّصت لها فعلاً، لا «أحدث الطلبات المسدَّدة» عند
        // العكس. ترتيب الطلبات قد يتغيّر بين الإنشاء والعكس فيُفسد التوزيع.
        let totalAllocated = 0;
        const allocations = [];
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
          if (allocated > 0) allocations.push({ orderId: order.id, amount: allocated });
          remainingToAllocate = round2(remainingToAllocate - allocated);
          totalAllocated = round2(totalAllocated + allocated);
        }
        // allocatedToOrders = هل خُصّص أي جزء للطلبات (توافقاً مع دلالة الحقل
        // التاريخية)، وallocatedAmount = المبلغ المُخصَّص فعلاً (لتمثيل التخصيص
        // الجزئي الذي لا تكفيه العلامة المنطقية وحدها)، وallocations = التوزيع
        // الأصلي بالتفصيل الذي يعتمد عليه العكس (F-05).
        repo.updateFirestoreDoc(repo.storageKeys.PAYMENTS, paymentId, {
          allocatedToOrders: totalAllocated > 0,
          allocatedAmount: totalAllocated,
          allocations
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

/* ===================== edit / reverse / delete (admin-only flows) ===================== */

/**
 * reversePaymentRecord — يعكس الأثر المالي لقيد دفعة قائم (بدون حذف المستند).
 * مطابق بالمعكوس لآثار createPaymentRecord:
 *   - عميل: paid -= amount، remainingBalance -= balanceDelta، وإلغاء تخصيص
 *     الطلبات (إرجاع المبلغ المُخصَّص من أحدث الطلبات المسدَّدة أولاً).
 *   - مورد عادي: paid -= settlement، remainingBalance += settlement، وحذف قيد
 *     الدفتر المرتبط (refId = paymentId).
 *   - مورد (تحصيل نقدية): paid += amount، remainingBalance -= amount، وحذف
 *     القيد المرتبط.
 *   - خزينة: لا شيء (الرصيد مشتق من الدفعات).
 * 🔒 يرفض عكس الدفعات المرتبطة بفاتورة (refOrderId) — يجب تعديل الفاتورة/حالتها.
 */
export function reversePaymentRecord(paymentId, repo) {
  const payment = repo.getPayments().find(p => p.id === paymentId);
  if (!payment) throw new Error('قيد الدفعة غير موجود');
  if (payment.refOrderId) {
    throw new Error('لا يمكن عكس/حذف دفعة مرتبطة بفاتورة — عدّل الفاتورة أو حالتها بدلاً من ذلك');
  }

  // F-10 — idempotency: إعادة المحاولة بعد نجاح جزئي يجب ألا تعكس الأثر مرتين.
  // إن كان القيد مُعلَّماً بالعكس مسبقاً لا نعيد تطبيق أي أثر.
  if (payment.reversed === true) return payment;

  // F-10 — durable reversal marker: يُكتب قبل أي أثر مالي، فلو فشل العكس في منتصفه
  // (أو فشل الحذف التالي) يبقى القيد موسوماً، وتتجاهله محركات الاشتقاق
  // (recalculateCustomerBalance/computeTreasury) فيصبح بلا أثر مالي — بدل أن
  // يُحتسب مرتين. الحقل اختياري ومتوافق مع السجلات القديمة (الغائب = غير معكوس).
  repo.updateFirestoreDoc(repo.storageKeys.PAYMENTS, paymentId, { reversed: true });

  const numericAmount = round2(Number(payment.amount) || 0);
  const isSupplierCollection = payment.entityType === 'supplier' && payment.type === 'supplierCollection';

  if (payment.entityType === 'customer') {
    const customer = repo.getCustomerById(payment.entityId);
    if (customer) {
      // V3.65 — تسوية المديونية تُحتسب مباشرة في «المسدد» بإشارتها، فعكسها يعيد
      // المسدد والمتبقي معاً بإشارتها الكاملة (بخلاف الاسترداد الذي لا يمس الرصيد).
      const isAdjustment = payment.type === 'customerDebtAdjustment';
      const balanceDelta = isAdjustment ? -numericAmount : ((numericAmount < 0 || payment.isDownPayment) ? 0 : -numericAmount);
      repo.updateCustomer(payment.entityId, {
        paid: increment(-numericAmount),
        remainingBalance: increment(-balanceDelta)
      });

      // إلغاء تخصيص الدفعة على الطلبات (F-05):
      //   • السجلات الحديثة تحمل التوزيع الأصلي (payment.allocations) فنعكسه على
      //     الطلبات نفسها التي خُصّصت لها فعلاً — لا استنتاجاً من ترتيب الطلبات
      //     الحالي (الذي قد يتغيّر بين الإنشاء والعكس فيُفسد أرصدة العملاء).
      //   • السجلات القديمة بلا allocations: نسقط على allocatedAmount/العلامة
      //     المنطقية ونعيد لأحدث الطلبات المسدَّدة أولاً (توافقاً مع السلوك السابق).
      const allocations = Array.isArray(payment.allocations) ? payment.allocations : null;
      const allocatedToReverse = payment.allocatedAmount != null
        ? round2(Math.max(0, toNumber(payment.allocatedAmount)))
        : (payment.allocatedToOrders ? numericAmount : 0);
      if (!payment.isDownPayment && allocations && allocations.length > 0) {
        const ordersById = new Map(repo.getOrders().map(o => [o.id, o]));
        for (const alloc of allocations) {
          const order = ordersById.get(alloc.orderId);
          if (!order) continue;
          const amount = round2(Math.max(0, toNumber(alloc.amount)));
          if (amount <= 0) continue;
          const orderDownPayment = Number(order.downPayment) || 0;
          const removed = round2(Math.min(amount, orderDownPayment));
          const newDownPayment = round2(orderDownPayment - removed);
          const newRemaining = round2((Number(order.remainingBalance) || 0) + removed);
          repo.updateFirestoreDoc(repo.storageKeys.ORDERS, order.id, {
            downPayment: newDownPayment,
            remainingBalance: newRemaining,
            paidInFull: newRemaining <= 0
          });
        }
      } else if (!payment.isDownPayment && allocatedToReverse > 0) {
        const orders = repo.getOrders();
        const paidOrders = orders
          .filter(o => o.customerId === payment.entityId
            && o.status !== 'returned' && o.status !== 'cancelled'
            && (Number(o.downPayment) || 0) > 0)
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        let remainingToRemove = allocatedToReverse;
        for (const order of paidOrders) {
          if (remainingToRemove <= 0) break;
          const orderDownPayment = Number(order.downPayment) || 0;
          const removed = round2(Math.min(remainingToRemove, orderDownPayment));
          const newDownPayment = round2(orderDownPayment - removed);
          const newRemaining = round2((Number(order.remainingBalance) || 0) + removed);
          repo.updateFirestoreDoc(repo.storageKeys.ORDERS, order.id, {
            downPayment: newDownPayment,
            remainingBalance: newRemaining,
            paidInFull: newRemaining <= 0
          });
          remainingToRemove = round2(remainingToRemove - removed);
        }
      }
    }
  } else if (payment.entityType === 'supplier') {
    const supplier = repo.getSupplierById(payment.entityId);
    if (supplier) {
      if (isSupplierCollection) {
        repo.updateSupplier(payment.entityId, {
          paid: increment(numericAmount),
          remainingBalance: increment(-numericAmount)
        });
      } else {
        const settlementDelta = numericAmount < 0 ? 0 : numericAmount;
        repo.updateSupplier(payment.entityId, {
          paid: increment(-settlementDelta),
          remainingBalance: increment(settlementDelta)
        });
      }
    }
  }

  // حذف قيود دفتر المورد المرتبطة بهذه الدفعة (تسديد دفعة / تحصيل نقدية).
  if (payment.entityType === 'supplier' && typeof repo.getSupplierTransactions === 'function' && typeof repo.deleteFirestoreDoc === 'function') {
    repo.getSupplierTransactions()
      .filter(t => t.refId === paymentId)
      .forEach(t => repo.deleteFirestoreDoc(repo.storageKeys.SUPPLIER_TRANSACTIONS, t.id));
  }

  return payment;
}

/**
 * deletePaymentRecord — يحذف قيد دفعة مستقلة بعد عكس أثره المالي.
 * يُرفض للدفعات المرتبطة بفاتورة. يعيد قيد الدفعة المحذوف.
 *
 * F-10 — الذرّية: عندما تدعم طبقة التخزين الدفعات الذرّية
 * (repo.createWriteBatch/withBatch، كما في dataRepo()) يُنفَّذ العكس + الحذف داخل
 * WriteBatch واحد فيلتزمان معاً أو لا. عند غياب الدعم (fallback) يُعتمد على علامة
 * العكس الدائمة: فشل الحذف يترك قيداً موسوماً بلا أثر مالي (تتجاهله محركات
 * الاشتقاق)، وإعادة المحاولة آمنة لأن العكس idempotent.
 */
export async function deletePaymentRecord(paymentId, repo) {
  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;
  const wRepo = batch ? repo.withBatch(batch) : repo;
  const payment = reversePaymentRecord(paymentId, wRepo);
  await wRepo.deleteFirestoreDoc(repo.storageKeys.PAYMENTS, paymentId);
  if (batch) await batch.commit();
  return payment;
}

/**
 * F-10 — recovery helper: يُعيد إنشاء قيد الدفعة الأصلي بنفس المعرّف بعد فشل
 * مسار التعديل (عكس + حذف) قبل إتمام الإبدال. الحقول مُشتقّة من الأرشيف (`old`)،
 * والسجلات القديمة بلا حقول حديثة تبقى قابلة للاسترداد. يُستخدم فقط عند الفشل.
 */
function restorePaymentRecord(old, paymentId, repo) {
  const isSupplierCollection = old.entityType === 'supplier' && old.type === 'supplierCollection';
  const stored = Number(old.amount) || 0;
  return createPaymentRecord({
    entityType: old.entityType,
    entityId: old.entityId,
    entityName: old.entityName,
    amount: isSupplierCollection ? Math.abs(stored) : stored,
    date: old.date,
    paymentMethod: old.paymentMethod,
    notes: old.notes,
    isDownPayment: !!old.isDownPayment,
    createdBy: old.createdBy,
    type: old.type,
    isCollection: isSupplierCollection,
    id: paymentId,
    createdAt: old.createdAt
  }, repo);
}

/**
 * updatePaymentRecord — يعدّل قيد دفعة مستقلة (المبلغ/التاريخ/طريقة الدفع/
 * الملاحظات) بنفس معرّف القيد وتاريخ إنشائه الأصلي:
 *   1) يعكس الأثر القديم ويحذف المستند القديم.
 *   2) يُنشئ القيد من جديد عبر createPaymentRecord بمعرّف مثبّت.
 * يُرفض للدفعات المرتبطة بفاتورة. يعيد القيد الجديد.
 *
 * F-10 — الذرّية والاسترداد: عند دعم الدفعات الذرّية تُنفَّذ العكس+الحذف+الإبدال
 * داخل WriteBatch واحد (وإلا فعلى التسلسل مع علامة العكس الدائمة). إن فشل الإبدال
 * بعد العكس/الحذف يُستردّ السجل الأصلي فلا تُفقد الدفعة.
 */
export async function updatePaymentRecord(paymentId, changes, repo) {
  const old = repo.getPayments().find(p => p.id === paymentId);
  if (!old) throw new Error('قيد الدفعة غير موجود');
  if (old.refOrderId) {
    throw new Error('لا يمكن تعديل دفعة مرتبطة بفاتورة — عدّل الفاتورة أو حالتها بدلاً من ذلك');
  }
  if (old.type === 'customerDebtAdjustment') {
    throw new Error('قيود تسوية المديونية تُدار من نافذة «تعديل المديونية» — استخدمها لتعديل الرصيد');
  }

  const isSupplierCollection = old.entityType === 'supplier' && old.type === 'supplierCollection';
  const requestedType = changes && changes.type ? changes.type : old.type;
  const nextType = isSupplierCollection ? 'supplierCollection' : (requestedType || undefined);
  const rawAmount = changes && changes.amount !== undefined ? changes.amount : Math.abs(Number(old.amount) || 0);
  const numericAmount = round2(parseFloat(rawAmount));
  if (isNaN(numericAmount) || numericAmount === 0) throw new Error('يرجى إدخال مبلغ صحيح');

  // F-10 — WriteBatch ذرّي واحد للعكس + الحذف + الإبدال (fallback: تسلسل مباشر).
  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;
  const wRepo = batch ? repo.withBatch(batch) : repo;

  reversePaymentRecord(paymentId, wRepo);
  await wRepo.deleteFirestoreDoc(repo.storageKeys.PAYMENTS, paymentId);

  // createPaymentRecord يتوقع المبلغ «المنطقي»: موجب لوضع تحصيل المورد
  // (ثم يخزّنه سالباً)، وبإشارته الفعلية لبقية الأنواع (استرداد = سالب).
  const createAmount = isSupplierCollection ? Math.abs(numericAmount) : numericAmount;

  let created;
  try {
    created = createPaymentRecord({
      entityType: old.entityType,
      entityId: old.entityId,
      entityName: old.entityName,
      amount: createAmount,
      date: (changes && changes.date) || old.date,
      paymentMethod: (changes && changes.paymentMethod) || old.paymentMethod,
      notes: changes && changes.notes !== undefined ? changes.notes : old.notes,
      isDownPayment: !!old.isDownPayment,
      createdBy: old.createdBy,
      type: nextType,
      isCollection: isSupplierCollection,
      id: paymentId,
      createdAt: old.createdAt
    }, wRepo);
  } catch (err) {
    // F-10 — فشل الإبدال: العكس أعلاه دائم بالفعل فلا يجوز ضياع القيد. نستردّ
    // السجل الأصلي ثم نُثبّت الدفعة (ذرّياً إن أمكن) ونعيد رمي الخطأ للمتصل.
    restorePaymentRecord(old, paymentId, wRepo);
    if (batch) await batch.commit();
    throw err;
  }

  if (batch) await batch.commit();
  return created;
}
