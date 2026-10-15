/**
 * Customer domain — pure core + injected repository (100% pure).
 * Ported VERBATIM from js/services/customers.js (legacy). Every data access goes
 * through the injected `repo`; constants come from customerRules.js.
 */
import { normalizePhone } from '../../utils/phones.js';
import { round2, toNumber, generateAutoId, formatCurrency } from '../../utils/formatters.js';
import { getCairoFormattedDate } from '../../utils/formatters.js';
import { DEFAULT_CUSTOMER_CATEGORY } from './customerRules.js';
import { isFulfilledOrderStatus } from '../accounting/accounting.js';

/* ===================== pure query helpers ===================== */

export function getCustomers(list) {
  return list;
}

export function getCustomerById(customers, id) {
  return customers.find(c => c.id === id) || null;
}

export function searchCustomers(customers, query) {
  if (!query) return customers;
  const q = query.trim().toLowerCase();
  return customers.filter(c =>
    (c.name && c.name.toLowerCase().includes(q)) ||
    (c.phone && c.phone.includes(q)) ||
    (c.secondaryPhone && c.secondaryPhone.includes(q)) ||
    (c.id && c.id.toLowerCase().includes(q))
  );
}

export function findCustomerByPhone(customers, phone, excludeId = '') {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return customers.find(c => {
    if (c.id === excludeId) return false;
    const primary = c.phone ? normalizePhone(c.phone) : '';
    const secondary = c.secondaryPhone ? normalizePhone(c.secondaryPhone) : '';
    return (primary && primary === normalized) || (secondary && secondary === normalized);
  }) || null;
}

// V3.25 — Customer phone uniqueness across BOTH primary & secondary numbers.
export function findCustomerPhoneConflict(customers, phone, secondaryPhone, excludeId = '') {
  return (phone ? findCustomerByPhone(customers, phone, excludeId) : null)
    || (secondaryPhone ? findCustomerByPhone(customers, secondaryPhone, excludeId) : null);
}

export function assertCustomerPhoneAvailable(customers, phone, secondaryPhone, excludeId = '') {
  const conflict = findCustomerPhoneConflict(customers, phone, secondaryPhone, excludeId);
  if (conflict) {
    throw new Error('رقم الهاتف هذا مسجل بالفعل لعميل آخر (' + conflict.name + ')');
  }
}

/* ===================== orchestration ===================== */

export function createCustomer(data, repo) {
  const existing = findCustomerByPhone(repo.getCustomers(), data.phone);
  if (existing) {
    return existing;
  }

  const secondaryPhone = (data.secondaryPhone || '').trim();
  // V3.25 — Reject a secondary phone that already belongs to another customer
  if (secondaryPhone) {
    if (normalizePhone(secondaryPhone) === normalizePhone(data.phone)) {
      throw new Error('رقم الهاتف الثانوي لا يمكن أن يطابق الرقم الرئيسي');
    }
    assertCustomerPhoneAvailable(repo.getCustomers(), '', secondaryPhone, '');
  }

  const addressText = (data.address || '').trim();
  const addresses = Array.isArray(data.addresses)
    ? data.addresses
    : (addressText
        ? [{ id: generateAutoId('ADDR'), label: 'العنوان الأساسي', address: addressText, isDefault: true }]
        : []);

  const newCustomer = {
    id: generateAutoId('CUST'),
    name: (data.name || '').trim(),
    phone: (data.phone || '').trim(),
    secondaryPhone,
    category: data.category || DEFAULT_CUSTOMER_CATEGORY,
    address: addressText,
    addresses,
    notes: (data.notes || '').trim(),
    ordersCount: 0,
    totalPurchases: 0,
    paid: 0,
    remainingBalance: 0,
    lastOrderDate: null,
    createdAt: getCairoFormattedDate(),
    updatedAt: getCairoFormattedDate()
  };

  return repo.addFirestoreDoc(repo.storageKeys.CUSTOMERS, newCustomer);
}

export function updateCustomer(id, updatedFields, repo) {
  // V3.25 — Phone uniqueness enforced on edit too.
  const phone = (updatedFields.phone != null ? String(updatedFields.phone).trim() : '');
  const secondaryPhone = (updatedFields.secondaryPhone != null ? String(updatedFields.secondaryPhone).trim() : '');
  if (phone || secondaryPhone) {
    if (secondaryPhone && phone && normalizePhone(secondaryPhone) === normalizePhone(phone)) {
      throw new Error('رقم الهاتف الثانوي لا يمكن أن يطابق الرقم الرئيسي');
    }
    const finalPhone = phone || String((getCustomerById(repo.getCustomers(), id) || {}).phone || '');
    const finalSecondary = secondaryPhone !== '' ? secondaryPhone : String((getCustomerById(repo.getCustomers(), id) || {}).secondaryPhone || '');
    assertCustomerPhoneAvailable(repo.getCustomers(), finalPhone, finalSecondary, id);
  }
  // Addresses are managed exclusively through the dedicated address APIs.
  const sanitized = { ...updatedFields };
  delete sanitized.address;
  delete sanitized.addresses;
  const payload = {
    ...sanitized,
    updatedAt: getCairoFormattedDate()
  };
  repo.updateFirestoreDoc(repo.storageKeys.CUSTOMERS, id, payload);
  return getCustomerById(repo.getCustomers(), id);
}

/* ===================== address management ===================== */

export function getCustomerAddresses(customerId, repo) {
  const customer = getCustomerById(repo.getCustomers(), customerId);
  if (!customer) return [];
  const list = Array.isArray(customer.addresses)
    ? customer.addresses.filter(a => a && a.address && String(a.address).trim())
    : [];
  if (list.length === 0 && customer.address && String(customer.address).trim()) {
    list.push({ id: 'ADDR-DEFAULT', label: 'العنوان الأساسي', address: String(customer.address).trim(), isDefault: true });
  }
  if (list.length && !list.some(a => a.isDefault)) {
    list[0] = { ...list[0], isDefault: true };
  }
  return list.map(a => ({ ...a }));
}

function saveCustomerAddresses(customerId, addresses, repo) {
  const list = addresses.filter(a => a && a.address && String(a.address).trim());
  if (list.length && !list.some(a => a.isDefault)) {
    list[0] = { ...list[0], isDefault: true };
  }
  const primary = list.find(a => a.isDefault) || list[0] || null;
  repo.updateFirestoreDoc(repo.storageKeys.CUSTOMERS, customerId, {
    addresses: list,
    address: primary ? String(primary.address).trim() : '',
    updatedAt: getCairoFormattedDate()
  });
  return list;
}

export function addCustomerAddress(customerId, data, repo) {
  const customer = getCustomerById(repo.getCustomers(), customerId);
  if (!customer) throw new Error('العميل غير موجود');
  const addressText = String((data && data.address) || '').trim();
  if (!addressText) throw new Error('يرجى إدخال عنوان صحيح');
  const label = String((data && data.label) || '').trim();
  const forceDefault = !!(data && data.isDefault);
  const current = getCustomerAddresses(customerId, repo);
  const isFirst = current.length === 0;
  const newAddress = {
    id: generateAutoId('ADDR'),
    label,
    address: addressText,
    isDefault: isFirst || forceDefault
  };
  const updated = current.map(a => ({ ...a, isDefault: forceDefault ? false : a.isDefault }));
  updated.push(newAddress);
  saveCustomerAddresses(customerId, updated, repo);
  return newAddress;
}

export function setDefaultCustomerAddress(customerId, addressId, repo) {
  const customer = getCustomerById(repo.getCustomers(), customerId);
  if (!customer) throw new Error('العميل غير موجود');
  const current = getCustomerAddresses(customerId, repo);
  if (!current.some(a => a.id === addressId)) throw new Error('العنوان غير موجود');
  const updated = current.map(a => ({ ...a, isDefault: a.id === addressId }));
  saveCustomerAddresses(customerId, updated, repo);
  return updated;
}

export function removeCustomerAddress(customerId, addressId, repo) {
  const customer = getCustomerById(repo.getCustomers(), customerId);
  if (!customer) throw new Error('العميل غير موجود');
  const current = getCustomerAddresses(customerId, repo);
  if (current.length <= 1) throw new Error('لا يمكن حذف العنوان الوحيد للعميل');
  const remaining = current.filter(a => a.id !== addressId);
  if (remaining.length === current.length) throw new Error('العنوان غير موجود');
  const removedDefault = current.some(a => a.id === addressId && a.isDefault);
  if (removedDefault) remaining[0] = { ...remaining[0], isDefault: true };
  saveCustomerAddresses(customerId, remaining, repo);
  return remaining;
}

/* ===================== audit & recalculation engine ===================== */

/**
 * Phase 4 / F-05B — المبلغ غير المُخصَّص لطلب من دفعة مستقلة موجبة.
 * الدفعات الجديدة تحمل `allocatedAmount` (المبلغ المُخصَّص فعلاً، وقد يكون
 * صفراً)، فيُحتسب الباقي فقط كدفعة مباشرة. السجلات التاريخية تفتقد الحقل
 * فنسقط على العلامة المنطقية `allocatedToOrders` (true = مُخصَّص كاملاً).
 * يُستدعى بعد استبعاد التسويات والدفعات المقدَّمة والقيم غير الموجبة.
 */
export function getUnappliedPaymentAmount(payment) {
  const amount = toNumber(payment.amount);
  if (payment.allocatedAmount != null) {
    return round2(Math.max(0, amount - toNumber(payment.allocatedAmount)));
  }
  return payment.allocatedToOrders ? 0 : amount;
}

export function recalculateCustomerBalance(customerId, repo) {
  const customer = getCustomerById(repo.getCustomers(), customerId);
  if (!customer) return;
  // V3.16.4 — الرصيد الدفتري المخزَّن يُحتسب من الطلبات **المُسلَّمة/المكتملة** فقط،
  // مطابقةً لدفتر الأحداث (applyOrderFulfillment يزيد المشتريات عند التوصيل/الإتمام
  // فقط). الطلبات «قيد الانتظار» (new) لا تُقيَّد في الرصيد المخزَّن (انظر
  // statements.js:42-47) وتبقى في كشف الحساب مع سطر تسوية افتتاحي؛ بغير ذلك تتباعد
  // إعادة البناء عن دفتر الأحداث عند طلب pending (F-01). حقل paid يبقى استثناءً
  // موثّقاً (يُحدَّث تراكمياً) لذا لا يتحقق منه expectCustomerLedgerTies.
  const orders = repo.getOrders().filter(o => o.customerId === customerId && isFulfilledOrderStatus(o.status));
  // F-10 — استبعاد الدفعات المعكوسة (reversed) فلا تُحتسب مرتين بعد عكس جزئي/فاشل.
  const payments = repo.getPaymentsByEntity('customer', customerId).filter(p => p.reversed !== true);

  const totalPurchases = round2(orders.reduce((sum, o) => sum + toNumber(o.totalAmount), 0));
  const totalDownPayments = round2(orders.reduce((sum, o) => sum + toNumber(o.downPayment), 0));
  // V3.65 — التسويات اليدوية للمديونية (customerDebtAdjustment) قيود دفترية
  // موقّعة تُحتسب في «المسدد» (سالب = زيادة المديونية). تُستثنى من الدفعات
  // المباشرة حتى لا تُحتسب مرتين، فتصمد أمام أي إعادة احتساب.
  const totalDirectPayments = round2(payments
    .filter(p => p.type !== 'customerDebtAdjustment' && !p.isDownPayment && toNumber(p.amount) > 0)
    .reduce((sum, p) => sum + getUnappliedPaymentAmount(p), 0));
  const totalAdjustments = round2(payments.filter(p => p.type === 'customerDebtAdjustment').reduce((sum, p) => sum + toNumber(p.amount), 0));

  const totalPaid = round2(totalDownPayments + totalDirectPayments + totalAdjustments);
  // V3.15.1 — Keep an overpayment (credit balance) EXPLICIT.
  const rawBalance = round2(totalPurchases - totalPaid);
  const remainingBalance = round2(Math.max(0, rawBalance));
  const creditBalance = rawBalance < 0 ? round2(Math.abs(rawBalance)) : 0;
  const ordersCount = orders.length;
  const lastOrderDate = orders.length ? orders.map(o => o.createdAt || o.updatedAt || '').filter(Boolean).sort().pop() : null;

  // V3.23 — Performance: only persist when a value actually changed.
  const unchanged =
    toNumber(customer.totalPurchases) === totalPurchases &&
    toNumber(customer.paid) === totalPaid &&
    toNumber(customer.remainingBalance) === remainingBalance &&
    toNumber(customer.creditBalance) === creditBalance &&
    toNumber(customer.ordersCount) === ordersCount &&
    String(customer.lastOrderDate || '') === String(lastOrderDate || '');
  if (unchanged) return;

  updateCustomer(customerId, {
    totalPurchases,
    paid: totalPaid,
    remainingBalance,
    creditBalance,
    ordersCount,
    lastOrderDate
  }, repo);
}

export function recalculateAllCustomerBalances(repo) {
  const customers = repo.getCustomers();
  customers.forEach(c => {
    recalculateCustomerBalance(c.id, repo);
  });
}

/* ===================== manual debt adjustment (admin only) ===================== */

/**
 * adjustCustomerDebt — تعديل مديونية عميل (تصحيح يدوي من المدير) عبر تسجيل
 * **قيد تسوية دفترية** (customerDebtAdjustment) بقيمة الفرق، بدل الكتابة فوق
 * الرصيد. القيد يُحتسب في recalculateCustomerBalance فيصمد أمام أي إعادة
 * احتساب، ويظهر كبند «تسوية مديونية» في كشف الحساب، ولا يمسّ الطلبات ولا
 * الدفعات الفعلية ولا الخزينة (يُستثنى من computeTreasury).
 * يُقبل الرصيد المتبقي المستهدف فقط ويُشتق «المسدد» تلقائياً.
 */
export function adjustCustomerDebt(customerId, { remainingBalance, createdBy = 'المدير العام', notes = '' } = {}, repo) {
  const customer = getCustomerById(repo.getCustomers(), customerId);
  if (!customer) throw new Error('العميل غير موجود');

  const targetRemaining = round2(Math.max(0, Number(remainingBalance) || 0));

  const orders = repo.getOrders().filter(o => o.customerId === customerId && isFulfilledOrderStatus(o.status));
  const totalPurchases = round2(orders.reduce((sum, o) => sum + toNumber(o.totalAmount), 0));
  const totalDownPayments = round2(orders.reduce((sum, o) => sum + toNumber(o.downPayment), 0));
  // F-10 — استبعاد الدفعات المعكوسة من حساب التسويات القائمة.
  const payments = repo.getPaymentsByEntity('customer', customerId).filter(p => p.reversed !== true);
  const totalDirectPayments = round2(payments
    .filter(p => p.type !== 'customerDebtAdjustment' && !p.isDownPayment && toNumber(p.amount) > 0)
    .reduce((sum, p) => sum + getUnappliedPaymentAmount(p), 0));
  const existingAdjustments = round2(payments.filter(p => p.type === 'customerDebtAdjustment').reduce((sum, p) => sum + toNumber(p.amount), 0));

  const basePaid = round2(totalDownPayments + totalDirectPayments);
  // نريد: basePaid + totalAdjustments = totalPurchases − targetRemaining
  const neededAdjustments = round2((totalPurchases - targetRemaining) - basePaid);
  const delta = round2(neededAdjustments - existingAdjustments);

  if (delta !== 0) {
    repo.addFirestoreDoc(repo.storageKeys.PAYMENTS, {
      id: generateAutoId('PAY'),
      entityType: 'customer',
      entityId: customerId,
      entityName: customer.name,
      amount: delta,
      date: getCairoFormattedDate().slice(0, 10),
      paymentMethod: 'other',
      notes: notes || `تسوية مديونية العميل — تعديل الرصيد المتبقي إلى ${formatCurrency(targetRemaining)}`,
      isDownPayment: false,
      createdBy,
      createdAt: getCairoFormattedDate(),
      type: 'customerDebtAdjustment',
      refOrderId: '',
      cycleKey: ''
    });
  }

  recalculateCustomerBalance(customerId, repo);
  return getCustomerById(repo.getCustomers(), customerId);
}
