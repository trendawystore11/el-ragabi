/**
 * Supplier domain — pure core + injected repository (100% pure).
 * Ported VERBATIM from js/services/suppliers.js (legacy).
 */
import { normalizePhone } from '../../utils/phones.js';
import { round2, generateAutoId } from '../../utils/formatters.js';
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
