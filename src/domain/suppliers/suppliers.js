/**
 * Supplier domain — pure core + injected repository (100% pure).
 * Ported VERBATIM from js/services/suppliers.js (legacy).
 */
import { normalizePhone } from '../../utils/phones.js';
import { round2, generateAutoId, formatCurrency } from '../../utils/formatters.js';
import { getCairoFormattedDate } from '../../utils/formatters.js';

/* ===================== pure query helpers ===================== */

export function getSuppliers(list) {
  return list;
}

export function getSupplierById(suppliers, id) {
  return suppliers.find(s => s.id === id) || null;
}

export function searchSuppliers(suppliers, query) {
  if (!query) return suppliers;
  const q = query.trim().toLowerCase();
  return suppliers.filter(s =>
    (s.name && s.name.toLowerCase().includes(q)) ||
    (s.phone && s.phone.includes(q)) ||
    (s.secondaryPhone && s.secondaryPhone.includes(q)) ||
    (s.id && s.id.toLowerCase().includes(q))
  );
}

export function findSupplierByPhone(suppliers, phone, excludeId = '') {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return suppliers.find(s => {
    if (s.id === excludeId) return false;
    const primary = s.phone ? normalizePhone(s.phone) : '';
    const secondary = s.secondaryPhone ? normalizePhone(s.secondaryPhone) : '';
    return (primary && primary === normalized) || (secondary && secondary === normalized);
  }) || null;
}

// V3.21 / V3.25 — Supplier phone uniqueness across BOTH primary & secondary.
export function findSupplierPhoneConflict(suppliers, phone, secondaryPhone, excludeId = '') {
  return (phone ? findSupplierByPhone(suppliers, phone, excludeId) : null)
    || (secondaryPhone ? findSupplierByPhone(suppliers, secondaryPhone, excludeId) : null);
}

export function assertSupplierPhoneAvailable(suppliers, phone, secondaryPhone, excludeId = '') {
  const conflict = findSupplierPhoneConflict(suppliers, phone, secondaryPhone, excludeId);
  if (conflict) {
    throw new Error('رقم الهاتف هذا مسجل بالفعل لمورد آخر (' + conflict.name + ')');
  }
}

/* ===================== orchestration ===================== */

export function createSupplier(data, repo) {
  const phone = (data.phone || '').trim();
  const secondaryPhone = (data.secondaryPhone || '').trim();
  assertSupplierPhoneAvailable(repo.getSuppliers(), phone, secondaryPhone, '');
  if (secondaryPhone && secondaryPhone === phone) {
    throw new Error('رقم الهاتف الثانوي لا يمكن أن يطابق الرقم الرئيسي');
  }

  const newSupplier = {
    id: generateAutoId('SUP'),
    name: (data.name || '').trim(),
    phone,
    secondaryPhone,
    address: (data.address || '').trim(),
    notes: (data.notes || '').trim(),
    totalPurchases: round2(Number(data.totalPurchases) || 0),
    paid: round2(Number(data.paid) || 0),
    remainingBalance: round2((Number(data.totalPurchases) || 0) - (Number(data.paid) || 0)),
    createdAt: getCairoFormattedDate(),
    updatedAt: getCairoFormattedDate()
  };

  return repo.addFirestoreDoc(repo.storageKeys.SUPPLIERS, newSupplier);
}

export function updateSupplier(id, updatedFields, repo) {
  const phone = (updatedFields.phone || '').trim();
  const secondaryPhone = (updatedFields.secondaryPhone || '').trim();
  assertSupplierPhoneAvailable(repo.getSuppliers(), phone, secondaryPhone, id);
  if (secondaryPhone && secondaryPhone === phone) {
    throw new Error('رقم الهاتف الثانوي لا يمكن أن يطابق الرقم الرئيسي');
  }

  const payload = {
    ...updatedFields,
    updatedAt: getCairoFormattedDate()
  };
  repo.updateFirestoreDoc(repo.storageKeys.SUPPLIERS, id, payload);
  return getSupplierById(repo.getSuppliers(), id);
}

/* ===================== manual debt adjustment (admin only) ===================== */

/**
 * adjustSupplierDebt — تعديل مديونية مورد (تصحيح يدوي من المدير) عبر تسجيل
 * **قيد تسوية في دفتر الموردين** (supplierTransactions) بقيمة الفرق، بدل الكتابة
 * فوق الرصيد. فيصمد أمام recalculateTotals ويظهر كبند «تسوية مديونية مورد» في
 * كشف المورد. يُسمح برصيد سالب (مستحق لنا من المورد).
 * يُقبل الرصيد المستحق المستهدف ويُشتق «المسدد» تلقائياً.
 */
export function adjustSupplierDebt(supplierId, { remainingBalance, createdBy = 'المدير العام', notes = '' } = {}, repo) {
  const supplier = getSupplierById(repo.getSuppliers(), supplierId);
  if (!supplier) throw new Error('المورد غير موجود');
  const targetRemaining = round2(Number(remainingBalance) || 0);

  const txns = typeof repo.getSupplierTransactionsBySupplier === 'function'
    ? repo.getSupplierTransactionsBySupplier(supplierId)
    : [];
  const ledgerNet = round2(txns.reduce((sum, t) => sum + (Number(t.debit) || 0) - (Number(t.credit) || 0), 0));
  const delta = round2(targetRemaining - ledgerNet);

  if (delta !== 0 && typeof repo.logSupplierTransaction === 'function') {
    repo.logSupplierTransaction({
      supplierId,
      supplierName: supplier.name,
      type: 'تسوية مديونية مورد',
      refId: '',
      debit: delta > 0 ? delta : 0,
      credit: delta < 0 ? Math.abs(delta) : 0,
      note: notes || `تسوية مديونية المورد — تعديل الرصيد المستحق إلى ${formatCurrency(targetRemaining)} (بواسطة ${createdBy})`,
      date: getCairoFormattedDate()
    });
  }

  const purchases = round2(Number(supplier.totalPurchases) || 0);
  const newPaid = round2(Math.max(0, purchases - targetRemaining));
  updateSupplier(supplierId, { paid: newPaid, remainingBalance: targetRemaining }, repo);
  return getSupplierById(repo.getSuppliers(), supplierId);
}
