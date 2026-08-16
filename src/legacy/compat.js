// =============================================================================
// V3.25 → React — COMPAT BRIDGE (جسر التوافق) — Phase 2
// -----------------------------------------------------------------------------
// يربط الوحدات الجديدة (ES Modules) بنفس الأسماء القديمة على `window` حتى تبقى
// الهارنيسات المرجعية (tests/legacy/*.html) تعمل دون تعديل منطقها.
//
// قاعدة النقل: كل وحدة نَقِيَة تُصدّر عبر ES Module وتُحقن اعتمادياتها هنا.
// الوحدات النقية لا تلمس window إطلاقاً؛ هذا الملف وحده يبني الـ adapters.
//
// المرحلة الحالية: Phase 2 — طبقة الخدمات (db/auth/settings/sheets) تُنقل إلى
// services/ وتُسجّل نفسها على window تلقائياً عند الاستيراد (هي طبقة البنية
// التحتية، ومهمتها الوصول إلى window). باقي الجسر يربط الدومين النقي + الـ repos
// المحقونة التي تُقرأ من window وقت الاستدعاء (lazy).
// يُحذف هذا الملف كلياً في Phase 4 بعد أن تعمل الاختبارات على الوحدات مباشرة.
// =============================================================================

import * as dbService from '../services/db.js';
import * as authService from '../services/auth.js';
import * as settingsService from '../services/settings.js';
import * as sheetsService from '../services/sheets.js';
import * as formatters from '../utils/formatters.js';

import * as egypt from '../utils/egypt.js';
import * as phones from '../utils/phones.js';
import * as statements from '../utils/statements.js';
import * as excel from '../utils/excel.js';
import * as accounting from '../domain/accounting/accounting.js';
import * as payments from '../domain/accounting/payments.js';
import * as expenses from '../domain/accounting/expenses.js';
import * as orderMachine from '../domain/orders/orderMachine.js';
import * as orderRepository from '../domain/orders/orderRepository.js';
import * as customerRules from '../domain/customers/customerRules.js';
import * as customers from '../domain/customers/customers.js';
import * as suppliers from '../domain/suppliers/suppliers.js';
import * as products from '../domain/inventory/products.js';
import * as supplierReturns from '../domain/inventory/supplierReturns.js';
import { useUiStore } from '../ui/state/uiStore.js';

export const __COMPAT_BRIDGE_VERSION = '0.4.0';

// V3.51 — جسر window.openModal القديم (كانت غير معرّفة فتتعطل كشوف الحسابات
// وفتح الحقول الحساسة في إعدادات الربط): تُحوَّل إلى نافذة ContentModal.
window.openModal = function (opts) {
  opts = opts || {};
  useUiStore.getState().openContentModal({
    title: opts.title || '',
    contentHTML: opts.contentHTML || '',
    maxWidth: opts.maxWidth || 'max-w-2xl',
    onRender: typeof opts.onRender === 'function' ? opts.onRender : null,
  });
};

/* ===================== services/db (self-installs on window) ===================== */
// db.js installs window.STORAGE_KEYS / firestoreCache / isSandboxMode and the full
// CRUD+sync API on import. Re-assert the wired surface for explicitness.
window.getCollection = dbService.getCollection;
window.saveCollection = dbService.saveCollection;
window.addFirestoreDoc = dbService.addFirestoreDoc;
window.updateFirestoreDoc = dbService.updateFirestoreDoc;
window.deleteFirestoreDoc = dbService.deleteFirestoreDoc;
window.normalizeAccountingData = dbService.normalizeAccountingData;
window.initDB = dbService.initDB;
window.startFirestoreSync = dbService.startFirestoreSync;
window.stopFirestoreSync = dbService.stopFirestoreSync;
window.fetchAllFromFirestore = dbService.fetchAllFromFirestore;
window.waitForFirebaseAuth = dbService.waitForFirebaseAuth;
window.forceWipeDatabase = dbService.forceWipeDatabase;
window.forcePushPendingToCloud = dbService.forcePushPendingToCloud;
window.exportFullBackup = dbService.exportFullBackup;
window.importFullBackup = dbService.importFullBackup;
window.getPendingLocalRecords = dbService.getPendingLocalRecords;
window.pendingOpsQueue = dbService.pendingOpsQueue;
window.queueFirestoreOp = dbService.queueFirestoreOp;
window.flushPendingOps = dbService.flushPendingOps;
window.getTombstones = dbService.getTombstones;
window.getFirestoreStatus = dbService.getFirestoreStatus;
window.migrateStorageVersion = dbService.migrateStorageVersion;
window.STORAGE_VERSION = dbService.STORAGE_VERSION;
window.enterSandboxMode = dbService.enterSandboxMode;
window.exitSandboxMode = dbService.exitSandboxMode;
window.setSandboxMode = dbService.setSandboxMode;
window.isSandboxActive = dbService.isSandboxActive;

/* ===================== services/auth (self-installs on window) ===================== */
window.getUsers = authService.getUsers;
window.getCurrentUser = authService.getCurrentUser;
window.login = authService.login;
window.logout = authService.logout;
window.isAuthenticated = authService.isAuthenticated;
window.isAdmin = authService.isAdmin;
window.verifyAdminPassword = authService.verifyAdminPassword;
window.reauthenticateCurrentUser = authService.reauthenticateCurrentUser;
window.adminPasswordConfigured = authService.adminPasswordConfigured;
window.createNewUserAccount = authService.createNewUserAccount;
window.updateUserAccount = authService.updateUserAccount;
window.changeOwnPassword = authService.changeOwnPassword;
window.updateUserRole = authService.updateUserRole;
window.deleteUserAccount = authService.deleteUserAccount;

/* ===================== services/settings (self-installs on window) ===================== */
window.generalSettings = settingsService.generalSettings;
window.GeneralSettings = settingsService.generalSettings; // legacy alias used by sandbox-test
window.applyGeneralSettings = settingsService.applySettings;
window.saveGeneralSettings = settingsService.saveSettings;
window.hydrateGeneralSettings = settingsService.hydrateFromCloud;

/* ===================== services/sheets (self-installs on window) ===================== */
window.GoogleSheetsSync = window.GoogleSheetsSync || {};
window.GoogleSheetsSync.exportAll = sheetsService.exportAll;
window.GoogleSheetsSync.importAll = sheetsService.importAll;
window.GoogleSheetsSync.syncNow = sheetsService.syncNow;
window.GoogleSheetsSync.scheduleSync = sheetsService.scheduleSync;
window.GoogleSheetsSync.isSyncPending = sheetsService.isSyncPending;
window.GoogleSheetsSync.flushSync = sheetsService.flushSync;
window.GoogleSheetsSync.startAutoSync = sheetsService.startAutoSync;
window.GoogleSheetsSync.stopAutoSync = sheetsService.stopAutoSync;
window.GoogleSheetsSync.getConfig = sheetsService.getConfig;
window.GoogleSheetsSync.saveConfig = sheetsService.saveConfig;
window.GoogleSheetsSync.pushConfigToCloud = sheetsService.pushConfigToCloud;
window.GoogleSheetsSync.hydrateConfigFromCloud = sheetsService.hydrateConfigFromCloud;
window.GoogleSheetsSync.resetSyncState = sheetsService.resetSyncState;
window.GoogleSheetsSync.getSyncLog = sheetsService.getSyncLog;
window.GoogleSheetsSync.getSyncAuditRecords = sheetsService.getSyncAuditRecords;
window.GoogleSheetsSync.getSheetDefinitions = sheetsService.getSheetDefinitions;
window.GoogleSheetsSync.createMemoryTransport = sheetsService.createMemoryTransport;
window.GoogleSheetsSync.createWebhookTransport = sheetsService.createWebhookTransport;
window.GoogleSheetsSync.connectWebhook = sheetsService.connectWebhook;
window.GoogleSheetsSync.postToWebhook = sheetsService.postToWebhook;
window.GoogleSheetsSync.enqueueEvent = sheetsService.enqueueEvent;
window.GoogleSheetsSync.getPendingQueue = sheetsService.getPendingQueue;
window.GoogleSheetsSync.clearPendingQueue = sheetsService.clearPendingQueue;
window.GoogleSheetsSync.importFromFile = sheetsService.importFromFile;
window.GoogleSheetsSync.exportSheetToCsv = sheetsService.exportSheetToCsv;
window.GoogleSheetsSync.syncWithGoogleSheets = sheetsService.syncWithGoogleSheets;
window.GoogleSheetsSync.openSheetUrl = sheetsService.openSheetUrl;
window.GoogleSheetsSync.setQuickDirection = sheetsService.setQuickDirection;
window.GoogleSheetsSync.renderSyncPanel = sheetsService.renderSyncPanel;
window.GoogleSheetsSync.setTransport = sheetsService.setTransport;
window.GoogleSheetsSync.getTransport = sheetsService.getTransport;
window.syncWithGoogleSheets = sheetsService.syncWithGoogleSheets;
window.openSpreadsheet = sheetsService.openSheetUrl;

/* ===================== utils/formatters ===================== */
window.formatCurrency = formatters.formatCurrency;
window.formatDate = formatters.formatDate;
window.formatDateTime = formatters.formatDateTime;
window.formatPhonePair = formatters.formatPhonePair;
window.formatAddress = formatters.formatAddress;
window.toNumber = formatters.toNumber;
window.round2 = formatters.round2;
window.getCairoFormattedDate = formatters.getCairoFormattedDate;
window.generateAutoId = formatters.generateAutoId;

/* ===================== utils/egypt ===================== */
window.EGYPT_GOVERNORATES = egypt.EGYPT_GOVERNORATES;
window.CITY_CUSTOM_STORAGE_KEY = egypt.CITY_CUSTOM_STORAGE_KEY;
window.getCustomCities = egypt.getCustomCities;
window.addCustomCity = egypt.addCustomCity;
window.getCitiesForGovernorate = egypt.getCitiesForGovernorate;
window.citySelectOptions = egypt.citySelectOptions;
window.setupCitySelect = egypt.setupCitySelect;
window.getEffectiveCity = egypt.getEffectiveCity;
window.parseAddressComponents = egypt.parseAddressComponents;

/* ===================== utils/phones ===================== */
window.normalizePhone = phones.normalizePhone;
window.validateEgyptianPhone = phones.validateEgyptianPhone;

/* ===================== utils/statements ===================== */
window.getStatementTypeBadge = statements.getStatementTypeBadge;
window.isReturnStatementType = statements.isReturnStatementType;
window.buildCustomerStatementEntries = statements.buildCustomerStatementEntries;
window.buildSupplierStatementEntries = statements.buildSupplierStatementEntries;
window.renderBankStatementTable = statements.renderBankStatementTable;
window.renderCustomerStatementHTML = statements.renderCustomerStatementHTML;
window.renderSupplierStatementHTML = statements.renderSupplierStatementHTML;
window.openCustomerStatementModal = statements.openCustomerStatementModal;
window.openSupplierStatementModal = statements.openSupplierStatementModal;

/* ===================== utils/excel ===================== */
window.exportToExcel = excel.exportToExcel;
window.exportTableToExcel = excel.exportTableToExcel;
window.exportFullDatabaseToExcel = excel.exportFullDatabaseToExcel;

/* ===================== domain/accounting/accounting ===================== */
window.isFulfilledOrderStatus = accounting.isFulfilledOrderStatus;
window.getOrderStatusLabel = accounting.getOrderStatusLabel;
window.isActiveOrderStatus = accounting.isActiveOrderStatus;
window.getOrderRemainingAmount = accounting.getOrderRemainingAmount;
window.computeShippingRevenueDeposit = accounting.computeShippingRevenueDeposit;
window.getOrderShippingRevenue = accounting.getOrderShippingRevenue;
window.getOrderRetainedShippingDeposit = accounting.getOrderRetainedShippingDeposit;

// calculateNetProfit يحتاج حقن اعتماديات البيانات — تُؤخذ من window عند الاستدعاء
// (وهي متوفرة من الوحدات القديمة حتى تُنقل الخدمات في Phase 2).
window.calculateNetProfit = function (orders) {
  return accounting.calculateNetProfit(orders, {
    getExpenses: function () { return window.getExpenses ? window.getExpenses() : []; },
    getCurrentOperatingExpenses: function () { return window.getCurrentOperatingExpenses ? window.getCurrentOperatingExpenses() : null; },
    getSupplierReturns: function () { return window.getSupplierReturns ? window.getSupplierReturns() : []; }
  });
};

/* ===================== domain/accounting/payments ===================== */
window.getPayments = function () { return window.getCollection(window.STORAGE_KEYS.PAYMENTS); };
window.sortPaymentsDesc = payments.sortPaymentsDesc;
window.getPaymentsSorted = function () { return payments.getPaymentsSorted(window.getPayments()); };
window.searchPayments = function (query) { return payments.searchPayments(window.getPayments(), query); };
window.getPaymentsByEntity = function (entityType, entityId) {
  return payments.getPaymentsByEntity(window.getPayments(), entityType, entityId);
};
window.getTotalCustomerReceivables = function () {
  return payments.getTotalCustomerReceivables(window.getOrders());
};
window.getTotalSupplierPayables = function () {
  return payments.getTotalSupplierPayables(window.getCollection(window.STORAGE_KEYS.SUPPLIERS));
};
window.getTotalPaymentsCollected = function () {
  return payments.getTotalPaymentsCollected(window.getPayments());
};

/**
 * Full injected repository for the pure domain modules. RAW collection reads go
 * straight to storage (window.getCollection) — delegating them to the wrapped
 * window.getX() readers would recurse infinitely (window.getX wraps
 * domain.X(dataRepo().getX())). Derived lookups and actions still delegate to
 * the wired window surface, which the raw reads now make non-recursive.
 */
function dataRepo() {
  const raw = function (key) { return window.getCollection(key); };
  return {
    storageKeys: window.STORAGE_KEYS,
    getCollection: raw,
    // RAW reads — straight from storage, never through the wrapped readers:
    getPayments: function () { return raw(window.STORAGE_KEYS.PAYMENTS); },
    getOrders: function () { return raw(window.STORAGE_KEYS.ORDERS); },
    getCustomers: function () { return raw(window.STORAGE_KEYS.CUSTOMERS); },
    getProducts: function () { return raw(window.STORAGE_KEYS.PRODUCTS); },
    getSuppliers: function () { return raw(window.STORAGE_KEYS.SUPPLIERS); },
    getSupplierReturns: function () { return raw(window.STORAGE_KEYS.SUPPLIER_RETURNS); },
    getSupplierTransactions: function () { return raw(window.STORAGE_KEYS.SUPPLIER_TRANSACTIONS); },
    // Derived reads + actions — delegate to the wired window surface:
    getOrderById: function (id) { return window.getOrderById(id); },
    getExpenses: function () { return window.getExpenses ? window.getExpenses() : []; },
    getPaymentsByEntity: function (entityType, entityId) { return window.getPaymentsByEntity(entityType, entityId); },
    getCustomerById: function (id) { return window.getCustomerById(id); },
    findCustomerByPhone: function (phone) { return window.findCustomerByPhone(phone); },
    createCustomer: function (data) { return window.createCustomer(data); },
    updateCustomer: function (id, fields) { return window.updateCustomer(id, fields); },
    getCustomerAddresses: function (id) { return window.getCustomerAddresses ? window.getCustomerAddresses(id) : []; },
    getProductById: function (id) { return window.getProductById(id); },
    getSupplierById: function (id) { return window.getSupplierById(id); },
    updateSupplier: function (id, fields) { return window.updateSupplier(id, fields); },
    logSupplierTransaction: function (txn) { return window.logSupplierTransaction(txn); },
    getSupplierTransactionsBySupplier: function (id) { return window.getSupplierTransactionsBySupplier(id); },
    decrementProductStock: function (id, qty) { return window.decrementProductStock(id, qty); },
    incrementProductStock: function (id, qty) { return window.incrementProductStock(id, qty); },
    addFirestoreDoc: function (key, doc) { return window.addFirestoreDoc(key, doc); },
    updateFirestoreDoc: function (key, id, fields) { return window.updateFirestoreDoc(key, id, fields); },
    deleteFirestoreDoc: function (key, id) { return window.deleteFirestoreDoc(key, id); },
    createWriteBatch: function () { return dbService.createWriteBatch(); },
    runAtomicBatch: function (ops) { return dbService.runAtomicBatch(ops); },
    createPaymentRecord: function (input) { return window.createPaymentRecord(input); },
    recalculateCustomerBalance: function (id) { return window.recalculateCustomerBalance(id); },
    // V3.57 — withBatch(batch): wrap this repo so EVERY write of a domain
    // orchestration flow is routed into ONE atomic WriteBatch (order creation,
    // status changes, supplier returns). The wrapper also applies each write to
    // the local mirror IMMEDIATELY (mirroring db.js semantics) so later reads
    // inside the same operation see the in-flight state — the batch's own
    // cache-apply step stays idempotent for these already-applied ops.
    withBatch: function (batch) { return withBatchRepo(this, batch); }
  };
}

// Cache-apply helpers used by withBatchRepo — mirror db.js add/update/delete
// local-mirror semantics WITHOUT any cloud write (the batch owns the cloud op).
function _cacheApplyAdd(key, doc) {
  if (!window.firestoreCache[key]) window.firestoreCache[key] = [];
  const existingIdx = window.firestoreCache[key].findIndex(i => i && i.id === doc.id);
  if (existingIdx !== -1) {
    window.firestoreCache[key][existingIdx] = doc;
  } else {
    window.firestoreCache[key].unshift(doc);
  }
  if (!window.isSandboxMode) {
    try { localStorage.setItem(`bms_data_${key}`, JSON.stringify(window.firestoreCache[key])); } catch { /* ignore */ }
  }
  if (typeof window.dispatchEvent === 'function') {
    try { window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key, manual: false } })); } catch { /* ignore */ }
  }
}

function _cacheApplyUpdate(key, id, fields) {
  const list = window.firestoreCache && window.firestoreCache[key];
  if (!Array.isArray(list)) return;
  const idx = list.findIndex(i => i && i.id === id);
  if (idx === -1) return;
  const current = list[idx] || {};
  list[idx] = { ...current, ...formatters.resolveIncrementFields(current, fields) };
  if (!window.isSandboxMode) {
    try { localStorage.setItem(`bms_data_${key}`, JSON.stringify(list)); } catch { /* ignore */ }
  }
  if (typeof window.dispatchEvent === 'function') {
    try { window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key, manual: false } })); } catch { /* ignore */ }
  }
}

function _cacheApplyDelete(key, id) {
  const list = window.firestoreCache && window.firestoreCache[key];
  if (!Array.isArray(list)) return;
  window.firestoreCache[key] = list.filter(i => i && i.id !== id);
  if (!window.isSandboxMode) {
    try { localStorage.setItem(`bms_data_${key}`, JSON.stringify(window.firestoreCache[key])); } catch { /* ignore */ }
  }
}

// V3.57 — batch-wrapped repo: every write lands in `batch` (one atomic commit)
// AND in the local mirror immediately (idempotent re-apply at commit).
function withBatchRepo(repo, batch) {
  const w = Object.create(repo);
  w.addFirestoreDoc = function (key, doc) {
    batch.add(key, doc);
    _cacheApplyAdd(key, doc);
    return doc;
  };
  w.updateFirestoreDoc = function (key, id, fields) {
    batch.update(key, id, fields);
    _cacheApplyUpdate(key, id, fields);
    // V3.57 — Mark the op as already applied to the local mirror by this
    // wrapper. runAtomicBatch must NOT re-resolve increment markers against the
    // already-applied state at commit (that would double-count stock), and its
    // offline queue fallback must read back the final mirror values instead.
    const ops = (batch && batch.ops) || [];
    const op = ops[ops.length - 1];
    if (op && op.type === 'update' && op.docId === id) op._localApplied = true;
  };
  w.deleteFirestoreDoc = function (key, id) {
    batch.delete(key, id);
    _cacheApplyDelete(key, id);
    return true;
  };
  w.createCustomer = function (data) { return customers.createCustomer(data, w); };
  w.updateCustomer = function (id, fields) { return customers.updateCustomer(id, fields, w); };
  w.updateSupplier = function (id, fields) { return suppliers.updateSupplier(id, fields, w); };
  w.createPaymentRecord = function (input) { return payments.createPaymentRecord(input, w); };
  w.logSupplierTransaction = function (txn) { return supplierReturns.logSupplierTransaction(txn, w); };
  w.decrementProductStock = function (id, qty) { return products.decrementProductStock(id, qty, w); };
  w.incrementProductStock = function (id, qty) { return products.incrementProductStock(id, qty, w); };
  w.recalculateCustomerBalance = function (id) { return customers.recalculateCustomerBalance(id, w); };
  return w;
}


window.createPaymentRecord = function (input) {
  return payments.createPaymentRecord(input, dataRepo());
};

/* ===================== domain/accounting/expenses ===================== */
// Register the 'expenses' collection key + raw reader — the legacy
// js/services/expenses.js did this at load time, and db.js's syncCollections()
// reads window.STORAGE_KEYS.EXPENSES lazily. Without these two, createExpense
// wrote to firestoreCache[undefined] and the view never reloaded.
window.STORAGE_KEYS.EXPENSES = expenses.EXPENSES_STORAGE_KEY;
window.getExpenses = function () {
  return window.getCollection(window.STORAGE_KEYS.EXPENSES);
};
window.getTotalExpenses = function () {
  return expenses.getTotalExpenses(window.getExpenses ? window.getExpenses() : []);
};
window.getExpenseNextDueDate = expenses.getExpenseNextDueDate;
window.getCurrentOperatingExpenses = function (nowDate) {
  return expenses.getCurrentOperatingExpenses(window.getExpenses ? window.getExpenses() : [], nowDate);
};
window.createExpense = function (input) {
  return expenses.createExpense(input, dataRepo());
};
window.updateExpense = function (id, updates) {
  return expenses.updateExpense(id, updates, dataRepo());
};
window.deleteExpense = function (id) {
  return expenses.deleteExpense(id, dataRepo());
};

// V3.58 — ترحيل المصروفات الدورية المستحقة إلى الخزينة (صادر) مرة واحدة لكل
// فترة. يُستدعى بعد أول جلب سحابي شامل (bms-data-synced key='*') وهو idempotent
// عبر cycleKey + lastPostedPeriod فلا يُدوِّن أي فترة مرتين.
window.postDueRecurringExpenses = function (nowDate) {
  return expenses.postDueRecurringExpenses(dataRepo(), nowDate);
};
if (typeof window.addEventListener === 'function') {
  window.addEventListener('bms-data-synced', function (e) {
    const key = e && e.detail && e.detail.key;
    if (key === '*') {
      try { window.postDueRecurringExpenses(); } catch { /* ignore */ }
    }
  });
}

/* ===================== domain/orders (machine + repository) ===================== */
window.ORDER_STATUS_TRANSITIONS = orderMachine.ORDER_STATUS_TRANSITIONS;
window.getOrders = function () { return orderRepository.getOrders(dataRepo().getOrders()); };
window.getOrderById = function (id) { return orderRepository.getOrderById(dataRepo().getOrders(), id); };
window.searchOrders = function (query) { return orderRepository.searchOrders(dataRepo().getOrders(), query); };
window.getOpenOrdersCount = function () { return orderRepository.getOpenOrdersCount(dataRepo().getOrders()); };
window.getTotalSalesAmount = function () { return orderRepository.getTotalSalesAmount(dataRepo().getOrders()); };
window.createOrder = async function (input) { return orderRepository.createOrder(input, dataRepo()); };
window.applyOrderFulfillment = function (order) { return orderRepository.applyOrderFulfillment(order, dataRepo()); };
window.updateOrderStatus = async function (orderId, newStatus, refundAmount, reactivationDeposit) {
  const currentUser = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
  return orderRepository.updateOrderStatus(orderId, newStatus, refundAmount, reactivationDeposit, dataRepo(), currentUser ? currentUser.role : null);
};

/* ===================== domain/customers ===================== */
window.CUSTOMER_CATEGORIES = customerRules.CUSTOMER_CATEGORIES;
window.DEFAULT_CUSTOMER_CATEGORY = customerRules.DEFAULT_CUSTOMER_CATEGORY;
window.getCustomers = function () { return customers.getCustomers(dataRepo().getCustomers()); };
window.searchCustomers = function (query) { return customers.searchCustomers(dataRepo().getCustomers(), query); };
window.findCustomerByPhone = function (phone, excludeId) { return customers.findCustomerByPhone(dataRepo().getCustomers(), phone, excludeId); };
window.findCustomerPhoneConflict = function (phone, secondaryPhone, excludeId) {
  return customers.findCustomerPhoneConflict(dataRepo().getCustomers(), phone, secondaryPhone, excludeId);
};
window.assertCustomerPhoneAvailable = function (phone, secondaryPhone, excludeId) {
  return customers.assertCustomerPhoneAvailable(dataRepo().getCustomers(), phone, secondaryPhone, excludeId);
};
window.getCustomerById = function (id) { return customers.getCustomerById(dataRepo().getCustomers(), id); };
window.createCustomer = function (data) { return customers.createCustomer(data, dataRepo()); };
window.updateCustomer = function (id, fields) { return customers.updateCustomer(id, fields, dataRepo()); };
window.getCustomerAddresses = function (customerId) { return customers.getCustomerAddresses(customerId, dataRepo()); };
window.addCustomerAddress = function (customerId, data) { return customers.addCustomerAddress(customerId, data, dataRepo()); };
window.setDefaultCustomerAddress = function (customerId, addressId) { return customers.setDefaultCustomerAddress(customerId, addressId, dataRepo()); };
window.removeCustomerAddress = function (customerId, addressId) { return customers.removeCustomerAddress(customerId, addressId, dataRepo()); };
window.recalculateCustomerBalance = function (customerId) { return customers.recalculateCustomerBalance(customerId, dataRepo()); };
window.recalculateAllCustomerBalances = function () { return customers.recalculateAllCustomerBalances(dataRepo()); };

/* ===================== domain/suppliers ===================== */
window.getSuppliers = function () { return suppliers.getSuppliers(dataRepo().getSuppliers()); };
window.searchSuppliers = function (query) { return suppliers.searchSuppliers(dataRepo().getSuppliers(), query); };
window.getSupplierById = function (id) { return suppliers.getSupplierById(dataRepo().getSuppliers(), id); };
window.findSupplierByPhone = function (phone, excludeId) { return suppliers.findSupplierByPhone(dataRepo().getSuppliers(), phone, excludeId); };
window.findSupplierPhoneConflict = function (phone, secondaryPhone, excludeId) {
  return suppliers.findSupplierPhoneConflict(dataRepo().getSuppliers(), phone, secondaryPhone, excludeId);
};
window.assertSupplierPhoneAvailable = function (phone, secondaryPhone, excludeId) {
  return suppliers.assertSupplierPhoneAvailable(dataRepo().getSuppliers(), phone, secondaryPhone, excludeId);
};
window.createSupplier = function (data) { return suppliers.createSupplier(data, dataRepo()); };
window.updateSupplier = function (id, fields) { return suppliers.updateSupplier(id, fields, dataRepo()); };

/* ===================== domain/inventory (products) ===================== */
window.getProducts = function () { return products.getProducts(dataRepo().getProducts()); };
window.getProductById = function (id) { return products.getProductById(dataRepo().getProducts(), id); };
window.findDuplicateProduct = function (opts) { return products.findDuplicateProduct(dataRepo().getProducts(), opts); };
window.searchProducts = function (query) { return products.searchProducts(dataRepo().getProducts(), query); };
window.getLowStockProducts = function () { return products.getLowStockProducts(dataRepo().getProducts()); };
window.createProduct = function (input) { return products.createProduct(input, dataRepo()); };
window.updateProduct = function (id, data) { return products.updateProduct(id, data, dataRepo()); };
window.deleteProduct = function (id) { return products.deleteProduct(id, dataRepo()); };
window.decrementProductStock = function (productId, qty) { return products.decrementProductStock(productId, qty, dataRepo()); };
window.incrementProductStock = function (productId, qty) { return products.incrementProductStock(productId, qty, dataRepo()); };
window.addStockShipment = function (productId, addedQty, supplierId, unitPurchasePrice, notes, extras) {
  return products.addStockShipment(productId, addedQty, supplierId, unitPurchasePrice, notes, extras, dataRepo());
};

/* ===================== domain/inventory (supplier returns) ===================== */
window.getSupplierReturns = function () { return supplierReturns.getSupplierReturns(dataRepo().getSupplierReturns()); };
window.getSupplierReturnsBySupplier = function (supplierId) { return supplierReturns.getSupplierReturnsBySupplier(dataRepo().getSupplierReturns(), supplierId); };
window.getSupplierTransactions = function () { return supplierReturns.getSupplierTransactions(dataRepo().getSupplierTransactions()); };
window.getSupplierTransactionsBySupplier = function (supplierId) { return supplierReturns.getSupplierTransactionsBySupplier(dataRepo().getSupplierTransactions(), supplierId); };
window.logSupplierTransaction = function (input) { return supplierReturns.logSupplierTransaction(input, dataRepo()); };
window.createSupplierReturn = async function (input) { return supplierReturns.createSupplierReturn(input, dataRepo()); };
window.getTotalSupplierReturnsValue = function () { return supplierReturns.getTotalSupplierReturnsValue(dataRepo().getSupplierReturns()); };
window.recalculateTotals = function () { return supplierReturns.recalculateTotals(dataRepo()); };
