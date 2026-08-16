// =============================================================================
// services/permissions.js — نظام الصلاحيات (RBAC) — V3.43
// -----------------------------------------------------------------------------
// نقطة واحدة لصلاحيات الأدوار الأربعة:
//   admin       → كل الصلاحيات
//   employee    → كاشير / موظف مبيعات (فواتير اليوم الخاصة به فقط)
//   storekeeper → أمين المخزن (المنتجات والمخزون والشحنات فقط)
//   accountant  → المحاسب / المالي (المصروفات والمدفوعات والتقارير والموردين مالياً)
// كل الدوال نقية (تأخذ role) كي يسهل اختبارها، مع دوال مساعدة تقرأ الدور الحالي
// من جلسة getCurrentUser() (نفس مصدر الحقيقة الذي تستخدمه بقية الخدمات).
// =============================================================================
import { getCurrentUser } from './auth.js'

/** الدور الحالي من الجلسة (null إن لم يكن هناك مستخدم جالس). */
export function currentRole() {
  const u = getCurrentUser()
  return u && u.role ? u.role : null
}

/** قائمة شاشات التطبيق بترتيب القائمة الجانبية (مشتركة بين الأدوار). */
export const NAV_ITEMS = [
  'dashboard',
  'analytics',
  'orders',
  'customers',
  'products',
  'suppliers',
  'expenses',
  'payments',
  'reports',
  'users',
  'settings',
]

/** شاشات كل دور (الترتيب بحسب ظهورها في القائمة الجانبية). */
const NAV_BY_ROLE = {
  admin: ['dashboard', 'analytics', 'orders', 'customers', 'products', 'suppliers', 'expenses', 'payments', 'reports', 'users', 'settings'],
  employee: ['orders', 'customers', 'products'],
  storekeeper: ['products'],
  accountant: ['dashboard', 'analytics', 'orders', 'customers', 'products', 'suppliers', 'expenses', 'payments', 'reports'],
}

/** الشاشات المسموح برؤيتها لدورٍ ما (بترتيب القائمة). دور غير معروف/بلا جلسة → كل الشاشات المشتركة. */
export function visibleNavItems(role) {
  const items = NAV_BY_ROLE[role] || NAV_ITEMS
  return NAV_ITEMS.filter(id => items.includes(id))
}

/* ————— بوابات المزايا (نقية حسب الدور) ————— */

/** إنشاء طلب جديد / فاتورة بيع (OrderModal). */
export const canCreateOrder = role => role === 'admin' || role === 'employee'

/** الكاشير السريع (POS). */
export const canUsePos = role => role === 'admin' || role === 'employee'

/** مساعد AI — المدير فقط (يقرأ مبيعات/مصروفات/تقارير حساسة). */
export const canUseAi = role => role === 'admin'

/** المزامنة السحابية ووضع الاختبار — المدير فقط. */
export const canSyncOrTest = role => role === 'admin'

/** تسجيل / تحصيل دفعة مالية (PaymentModal). */
export const canRecordPayment = role => role === 'admin' || role === 'accountant'

/** إدارة الحسابات والمستخدمين — المدير فقط. */
export const canManageUsers = role => role === 'admin'

/** إعدادات النظام والربط والسحابة — المدير فقط. */
export const canManageSettings = role => role === 'admin'

/** إدارة المصروفات (إضافة/تعديل/حذف). */
export const canManageExpenses = role => role === 'admin' || role === 'accountant'

/** إدارة المنتجات (إضافة/تعديل/توريد شحنات). */
export const canManageProducts = role => role === 'admin' || role === 'storekeeper'

/** حذف منتج من المخزون — المدير فقط. */
export const canDeleteProduct = role => role === 'admin'

/** إضافة مورد جديد — المدير فقط. */
export const canAddSupplier = role => role === 'admin'

/** رؤية سعر الشراء (التكلفة) — مخفي عن الكاشير فقط. */
export const canSeePurchasePrice = role => role === 'admin' || role === 'storekeeper' || role === 'accountant'

/** رؤية بيانات اتصال الموردين (هاتف/عنوان) — المدير والمحاسب (دور مالي يحتاج التواصل). */
export const canSeeSupplierContact = role => role === 'admin' || role === 'accountant'

/** رؤية/إدارة كل طلبات النظام — الكاشير يرى فواتير اليوم الخاصة به فقط. */
export const canViewAllOrders = role => role === 'admin' || role === 'accountant'

/** تحديث حالة الطلب — المدير والكاشير (لفواتير اليوم الخاصة به). */
export const canUpdateOrderStatus = role => role === 'admin' || role === 'employee'

/** شاشة لوحة التحكم (بيانات مالية). */
export const canSeeDashboard = role => role === 'admin' || role === 'accountant'

/** لوحة تحليل البيانات (V4) — مالية: المدير والمحاسب فقط. */
export const canSeeAnalytics = role => role === 'admin' || role === 'accountant'

/** التقارير المالية وأزرار التصدير. */
export const canSeeFinancialReports = role => role === 'admin' || role === 'accountant'

/** إعادة احتساب الأرباح ومسح القواعد — الكتابة التدميرية للمدير فقط. */
export const canRecalcOrWipe = role => role === 'admin'

/** تسوية / ضبط رصيد الخزينة اليدوي (قيد تعديل يصحح رصيد الصندوق) — المدير فقط. */
export const canAdjustTreasury = role => role === 'admin'

/* ————— دوال اختصار تقرأ الدور الحالي ————— */

export const currentCanCreateOrder = () => canCreateOrder(currentRole())
export const currentCanUsePos = () => canUsePos(currentRole())
export const currentCanUseAi = () => canUseAi(currentRole())
export const currentCanSyncOrTest = () => canSyncOrTest(currentRole())
export const currentCanRecordPayment = () => canRecordPayment(currentRole())
export const currentCanManageUsers = () => canManageUsers(currentRole())
export const currentCanManageSettings = () => canManageSettings(currentRole())
export const currentCanManageExpenses = () => canManageExpenses(currentRole())
export const currentCanManageProducts = () => canManageProducts(currentRole())
export const currentCanDeleteProduct = () => canDeleteProduct(currentRole())
export const currentCanAddSupplier = () => canAddSupplier(currentRole())
export const currentCanSeePurchasePrice = () => canSeePurchasePrice(currentRole())
export const currentCanSeeSupplierContact = () => canSeeSupplierContact(currentRole())

// Wire للاختبارات والوصول العام عبر window (نفس نمط auth.js).
if (typeof window !== 'undefined') {
  window.permissions = {
    currentRole,
    visibleNavItems,
    canCreateOrder,
    canUsePos,
    canUseAi,
    canSyncOrTest,
    canRecordPayment,
    canManageUsers,
    canManageSettings,
    canManageExpenses,
    canManageProducts,
    canDeleteProduct,
    canAddSupplier,
    canSeePurchasePrice,
    canSeeSupplierContact,
    canViewAllOrders,
    canUpdateOrderStatus,
    canSeeDashboard,
    canSeeAnalytics,
    canSeeFinancialReports,
    canRecalcOrWipe,
    canAdjustTreasury,
  }
}
