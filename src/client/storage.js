/**
 * =============================================================================
 * client/storage.js — مفاتيح التخزين المحلي المعزولة لكل عميل
 * =============================================================================
 * كل مفاتيح localStorage تُسبق بمعرّف العميل (CLIENT.clientId) حتى لا يتداخل
 * أي نظام عميل مع آخر حتى على نفس المتصفح/الجهاز:
 *   'bms_data_customers'  ←→  'bms_<clientId>_data_customers'
 *   'bms_ai_config'       ←→  'bms_<clientId>_ai_config'
 * كل مفاتيح نظامنا تبدأ بـ bms_ (باستثناء city_custom_entries التاريخية التي
 * تُنقل أيضاً تحت البادئة عبر storageKey).
 *
 * الأدوات:
 *   - storageKey(base)  →  مفتاح مخزّن ببادئة العميل.
 *   - isOwnKey(k)       →  هل المفتاح يخص هذا العميل (أو مفتاح قديم قابل للهجرة)؟
 *   - isDataKey(k)      →  مفتاح مرآة بيانات (bms_data_*) قديم أو مسبوق.
 *   - isSnapshotKey(k)  →  مفتاح لقطة استرداد (bms_pending_snapshot_*) قديم أو مسبوق.
 * =============================================================================
 */
import { CLIENT } from './config.js'

const PREFIX = 'bms_' + CLIENT.clientId + '_'

export function storageKey(base) {
  return PREFIX + String(base)
}

/** هل المفتاح ملك هذا العميل؟ (يشمل المفاتيح القديمة القابلة للهجرة). */
export function isOwnKey(k) {
  if (typeof k !== 'string') return false
  if (k.indexOf(PREFIX) === 0) return true
  // المفاتيح القديمة (قبل إضافة البادئة) — تنظيف بقايا النسخ السابقة فقط:
  return k.indexOf('bms_data_') === 0
    || k.indexOf('bms_pending_') === 0
    || k === 'bms_storage_version'
    || k === 'bms_tombstones'
}

/** مفتاح مرآة بيانات (قائمة تشغيلية) قديم أو مسبوق بالعميل. */
export function isDataKey(k) {
  if (typeof k !== 'string') return false
  return k.indexOf(PREFIX + 'data_') === 0 || k.indexOf('bms_data_') === 0
}

/** مفتاح لقطة استرداد (بنديدغ) قديم أو مسبوق بالعميل. */
export function isSnapshotKey(k) {
  if (typeof k !== 'string') return false
  return k.indexOf(PREFIX + 'pending_snapshot_') === 0 || k.indexOf('bms_pending_snapshot_') === 0
}

/**
 * V3.52 — يُفرّغ كل مرايا بيانات العمل (bms_data_*) + لقطات الاسترداد من
 * localStorage عند تسجيل الخروج، كي لا تبقى بيانات المستخدم السابق على جهاز
 * مشترك (بند II.8 في تقرير التدقيق). لا يمس مفاتيح التهيئة/الجلسة/الطابور
 * المعلّق (pending ops) عمداً. عند الاتصال تُعاد المرايا تلقائياً من Firestore
 * في أول جلسة تالية؛ التسجيل الأوفلاين بعد الخروج+إعادة التحميل لا يعمل عمداً.
 */
export function clearDataMirrors() {
  if (typeof localStorage === 'undefined') return
  const doomed = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)
    if (k && (isDataKey(k) || isSnapshotKey(k))) doomed.push(k)
  }
  doomed.forEach(k => localStorage.removeItem(k))
}
