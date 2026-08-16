/**
 * Supplier Returns (مرتجع المشتريات) domain — pure core + injected repository.
 * Ported VERBATIM from js/services/supplier-returns.js (legacy).
 */
import { round2, generateAutoId } from '../../utils/formatters.js';
import { getCairoFormattedDate } from '../../utils/formatters.js';
import { getSupplierById } from '../suppliers/suppliers.js';
import { getProductById } from './products.js';

/* ===================== pure query helpers ===================== */

export function getSupplierReturns(list) {
  return list;
}

export function getSupplierReturnsBySupplier(returns, supplierId) {
  return returns.filter(r => r.supplierId === supplierId);
}

export function getSupplierTransactions(list) {
  return list;
}

export function getSupplierTransactionsBySupplier(txns, supplierId) {
  return txns.filter(t => t.supplierId === supplierId);
}

/**
 * Unified Supplier Ledger Log
 * debit  = amount that increases our debt to the supplier
 * credit = amount that decreases our debt to the supplier
 */
export function logSupplierTransaction({ supplierId, supplierName, type, refId = '', debit = 0, credit = 0, note = '', date = null }, repo) {
  const txn = {
    id: generateAutoId('SUPLOG'),
    supplierId,
    supplierName: supplierName || '',
    type,
    refId,
    debit: Number(debit) || 0,
    credit: Number(credit) || 0,
    note: (note || '').trim(),
    createdAt: date || getCairoFormattedDate()
  };
  return repo.addFirestoreDoc(repo.storageKeys.SUPPLIER_TRANSACTIONS, txn);
}

/* ===================== orchestration ===================== */

export async function createSupplierReturn({ supplierId, items, refundType = 'debt', notes = '', createdBy = 'المدير العام' }, repo) {
  if (!supplierId) throw new Error('يرجى اختيار المورد / المصنع أولاً');
  const supplier = getSupplierById(repo.getSuppliers(), supplierId);
  if (!supplier) throw new Error('المورد المحدد غير موجود في النظام');

  const selectedRefundType = refundType === 'cash' ? 'cash' : 'debt';

  const validItems = (items || []).filter(i => i && i.productId && Number(i.quantity) > 0);
  if (validItems.length === 0) throw new Error('يرجى إدخال منتج واحد على الأقل بكمية صحيحة أكبر من الصفر');

  // 1. Validate stock availability & prices
  validItems.forEach(i => {
    const product = getProductById(repo.getProducts(), i.productId);
    if (!product) throw new Error('أحد المنتجات المحددة غير موجود في المخزن');
    const qty = Number(i.quantity);
    const unitCost = Number(i.unitCost);
    if (isNaN(unitCost) || unitCost < 0) throw new Error(`يرجى إدخال سعر وحدة صحيح للمنتج ${product.name}`);
    if (qty > Number(product.stock)) {
      throw new Error(`لا يمكن إرجاع ${qty} قطعة من "${product.name}" لأن المخزون الحالي ${product.stock} قطعة فقط`);
    }
  });

  const processedItems = validItems.map(i => {
    const product = getProductById(repo.getProducts(), i.productId);
    const qty = Number(i.quantity);
    const unitCost = Number(i.unitCost);
    return {
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitCost,
      subtotal: round2(qty * unitCost)
    };
  });

  const totalValue = round2(processedItems.reduce((s, i) => s + i.subtotal, 0));
  if (totalValue <= 0) throw new Error('قيمة المرتجع يجب أن تكون أكبر من الصفر');

  const now = getCairoFormattedDate();
  const returnId = generateAutoId('SRET');
  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;
  // V3.57 — single atomic WriteBatch: stock deduction + supplier balance +
  // return record + treasury + supplier ledger commit together or not at all.
  const wRepo = batch ? repo.withBatch(batch) : repo;

  // 2. Deduct returned quantities from inventory
  processedItems.forEach(i => {
    wRepo.decrementProductStock(i.productId, i.quantity);
  });

  // 3. Smart Refund Routing (V3.54) — التوجيه الذكي لمرتجع المشتريات:
  //   currentDebt = ما ندين به للمورد (الرصيد الموجب فقط).
  //   debtOffset  = ما يُخصم تلقائياً من المديونية (لا يتجاوز قيمة المرتجع).
  //   excess      = فائض المرتجع فوق المديونية المتبقية.
  //   «استرداد نقدي» → خصم المديونية (إن وُجدت) تلقائياً + استلام الفائض كاش
  //                     (وارد خزينة). الرصيد الجديد يتبع صافي الدفتر ولا يُصفَّر
  //                     عندما يكون المورد هو المدين لنا (رصيد سالب) — يبقى كما هو.
  //   «تخفيض الدين»   → يبقى الفائض رصيداً دائناً لصالحنا لدى المورد (سالبة).
  const oldPurchases = Number(supplier.totalPurchases) || 0;
  const oldBalance = Number(supplier.remainingBalance) || 0;
  const currentDebt = round2(Math.max(0, oldBalance));
  const debtOffset = round2(Math.min(totalValue, currentDebt));
  const excess = round2(totalValue - debtOffset);
  const cashRefund = selectedRefundType === 'cash' ? excess : 0;
  const newPurchases = round2(Math.max(0, oldPurchases - totalValue));
  // V3.53 — الرصيد قد يتحول دائناً لصالحنا (سالبة) عند تجاوز قيمة المرتجع
  // للمديونية المتبقية، بدلاً من تصفير الفائض وحرقه بصمت.
  // V3.62 — حساب الرصيد الجديد يطابق صافي الدفتر (debit - credit) تماماً:
  //   a) 'مرتجع مشتريات' credit totalValue → ينقص الرصيد.
  //   b) 'مرتجع نقدي' debit cashRefund → يعيد الرصيد نحو الصفر.
  // لذلك الصيغة الصحيحة = oldBalance - totalValue + cashRefund. عند رصيد سالب
  // (المورد مدين لنا) لا يصبح newBalance صفراً — بل يبقى كما هو (المورد ما زال
  // مديناً لنا بنفس المبلغ بعد استلام الفائض كاشاً).
  const newBalance = selectedRefundType === 'cash'
    ? round2(oldBalance - totalValue + cashRefund)
    : round2(oldBalance - totalValue);
  const newPaid = round2(Math.max(0, newPurchases - newBalance));

  const supplierPayload = {
    totalPurchases: newPurchases,
    remainingBalance: newBalance,
    paid: newPaid
  };

  wRepo.updateSupplier(supplierId, supplierPayload);

  // 4. Persist the return record
  const returnRecord = {
    id: returnId,
    supplierId,
    supplierName: supplier.name,
    items: processedItems,
    totalValue,
    refundType: selectedRefundType,
    debtOffset,
    cashRefund,
    excessAsCredit: selectedRefundType === 'debt' ? excess : 0,
    notes: (notes || '').trim(),
    createdBy,
    createdAt: now
  };

  wRepo.addFirestoreDoc(repo.storageKeys.SUPPLIER_RETURNS, returnRecord);

  // 5. Cash refund => record ONLY the excess actually received as a POSITIVE
  //    treasury inflow (وارد خزينة — «مردودات نقدية مستردة»). No negative
  //    supplier payment is ever created: the debt portion is settled by the
  //    ledger return entry, and the money received does NOT touch net profit.
  if (cashRefund > 0) {
    wRepo.createPaymentRecord({
      entityType: 'treasury',
      entityId: 'TREASURY',
      entityName: 'الخزينة',
      amount: cashRefund,
      date: now.slice(0, 10),
      paymentMethod: 'cash',
      notes: `مردودات نقدية مستردة - مرتجع مشتريات للمورد (${returnId}): ${processedItems.map(i => `${i.productName} x${i.quantity}`).join('، ')}`,
      type: 'supplierCashRefund',
      createdBy
    });
  }

  // 6. Log the supplier ledger — TWO entries so the ledger net always ties to
  //    the stored balance:
  //    a) 'مرتجع مشتريات' credit totalValue (goods back = our debt decreases).
  //    b) 'مرتجع نقدي' debit cashRefund (cash received FROM the supplier moves
  //       the balance back toward 0 — it cancels the credit in our favor).
  const returnNote = (notes || '').trim() || 'إرجاع بضاعة للمورد وخصمها من المديونية';
  const cashNote = 'استرداد نقدي مستلم من المورد عن بضاعة مرتجعة';
  wRepo.logSupplierTransaction({
    supplierId,
    supplierName: supplier.name,
    type: 'مرتجع مشتريات',
    refId: returnId,
    credit: totalValue,
    note: returnNote,
    date: now
  });
  if (cashRefund > 0) {
    wRepo.logSupplierTransaction({
      supplierId,
      supplierName: supplier.name,
      type: 'مرتجع نقدي',
      refId: returnId,
      debit: cashRefund,
      note: cashNote,
      date: now
    });
  }

  if (batch) {
    await batch.commit();
  }

  return returnRecord;

}

export function getTotalSupplierReturnsValue(returns) {
  return round2(returns.reduce((sum, r) => sum + (Number(r.totalValue) || 0), 0));
}

/**
 * V3.19 — إعادة احتساب الأرباح والتقارير (Recalculate Totals)
 * Non-destructive reconciliation of the supplier-returns ledger.
 * Returns the number of restated entries (0 means everything already consistent).
 */
export function recalculateTotals(repo) {
  const returns = repo.getSupplierReturns();
  const payments = repo.getPayments();
  let restated = 0;

  returns.forEach(r => {
    if (!r || !r.supplierId) return;
    const supplier = getSupplierById(repo.getSuppliers(), r.supplierId);
    const name = (supplier && supplier.name) || r.supplierName || '';
    const totalValue = round2(Number(r.totalValue) || 0);
    if (totalValue <= 0) return;

    // V3.54 — السجلات الجديدة تحمل cashRefund = الفائض المستلم فعلياً كاش:
    //   1) قيد وارد خزينة موجب (entityType treasury) بقيمة الفائض.
    //   2) قيد دفتر 'مرتجع نقدي' دائن (debit) يصفّر الرصيد الدائن لصالحنا.
    // السجلات القديمة (بلا حقل cashRefund) تحافظ على سلوكها التاريخي: إيصال
    // مورد سالب (استرداد كامل) — حتى لا يتضاعف أي مبلغ ولا تتغير أرصدة قديمة.
    const cashRefund = round2(Number(r.cashRefund) || 0);
    const isNewCash = r.refundType === 'cash' && cashRefund > 0;

    if (isNewCash) {
      const treasuryExists = payments.some(p =>
        p.entityType === 'treasury' && (Number(p.amount) || 0) > 0 &&
        (p.notes || '').indexOf('(' + r.id + ')') !== -1
      );
      if (!treasuryExists && repo.createPaymentRecord) {
        repo.createPaymentRecord({
          entityType: 'treasury',
          entityId: 'TREASURY',
          entityName: 'الخزينة',
          amount: cashRefund,
          date: (r.createdAt || '').slice(0, 10),
          paymentMethod: 'cash',
          notes: `مردودات نقدية مستردة - مرتجع مشتريات للمورد (${r.id}): إعادة احتساب`,
          type: 'supplierCashRefund',
          createdBy: 'المدير العام'
        });
        restated++;
      }
    } else if (r.refundType === 'cash') {
      // Legacy cash return: restore the historical negative supplier receipt.
      const exists = payments.some(p =>
        p.entityType === 'supplier' && p.entityId === r.supplierId &&
        (Number(p.amount) || 0) < 0 && (p.notes || '').indexOf('(' + r.id + ')') !== -1
      );
      if (!exists && repo.createPaymentRecord) {
        repo.createPaymentRecord({
          entityType: 'supplier',
          entityId: r.supplierId,
          entityName: name,
          amount: -totalValue,
          date: (r.createdAt || '').slice(0, 10),
          paymentMethod: 'cash',
          notes: `استرداد نقدي - مرتجع مشتريات للمورد (${r.id}): إعادة احتساب`,
          createdBy: 'المدير العام'
        });
        restated++;
      }
    }

    // Return-goods ledger entry (credit = totalValue, decreases our debt).
    const returnTxnExists = repo.getSupplierTransactions().some(t =>
      t.refId === r.id && (Number(t.credit) || 0) > 0 &&
      (t.type === 'مرتجع مشتريات' || t.type === 'مرتجع نقدي')
    );
    if (!returnTxnExists && repo.logSupplierTransaction) {
      repo.logSupplierTransaction({
        supplierId: r.supplierId,
        supplierName: name,
        type: isNewCash ? 'مرتجع مشتريات' : (r.refundType === 'cash' ? 'مرتجع نقدي' : 'مرتجع مشتريات'),
        refId: r.id,
        credit: totalValue,
        note: (r.notes || '').trim() || 'إرجاع بضاعة للمورد وخصمها من المديونية',
        date: r.createdAt || null
      });
      restated++;
    }

    // Cash-refund debit entry (new records only) — cancels the credit-in-our-favor.
    if (isNewCash) {
      const cashDebitExists = repo.getSupplierTransactions().some(t =>
        t.refId === r.id && (Number(t.debit) || 0) > 0 && t.type === 'مرتجع نقدي'
      );
      if (!cashDebitExists && repo.logSupplierTransaction) {
        repo.logSupplierTransaction({
          supplierId: r.supplierId,
          supplierName: name,
          type: 'مرتجع نقدي',
          refId: r.id,
          debit: cashRefund,
          note: 'استرداد نقدي مستلم من المورد عن بضاعة مرتجعة',
          date: r.createdAt || null
        });
        restated++;
      }
    }
  });

  // 3. Recompute derived supplier balances from the ledger
  repo.getSuppliers().forEach(sup => {
    const txns = getSupplierTransactionsBySupplier(repo.getSupplierTransactions(), sup.id);
    if (!txns || txns.length === 0) return;
    const totalDebit = txns.reduce((s, t) => s + (Number(t.debit) || 0), 0);
    const totalCredit = txns.reduce((s, t) => s + (Number(t.credit) || 0), 0);
    const purchases = round2(Number(sup.totalPurchases) || 0);
    // V3.53 — لا تصفير للرصيد الدائن (السالبة) عند إعادة الحساب؛ الرصيد يتبع الدفتر.
    const newBalance = round2(totalDebit - totalCredit);
    const newPaid = round2(Math.max(0, purchases - newBalance));
    repo.updateSupplier(sup.id, { remainingBalance: newBalance, paid: newPaid });
  });

  return restated;
}
