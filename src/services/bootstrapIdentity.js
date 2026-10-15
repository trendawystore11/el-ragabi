// =============================================================================
// services/bootstrapIdentity.js — هوية أدمن البوتستراف (مصدر واحد) — V3.70
// -----------------------------------------------------------------------------
// أول مدير يُزرع في السحابة على مشروع فارغ. يمكن تغييره لكل عميل من نفس مكان
// تشكيل النشر (GitHub Actions → npm run build) دون تعديل الكود:
//   VITE_BOOTSTRAP_ADMIN_EMAIL  (افتراضي: admin@store.com)
//   VITE_BOOTSTRAP_ADMIN_ID     (افتراضي: USR-1001)
//
// ⚠️ قواعد Firestore (firestore.rules) لا تقرأ متغيرات البيئة — النصّان
// مكتوبان صراحةً داخل isSeedUserBootstrap / isFirstBootstrap / isBootstrapMarkerWrite.
// أي تغيير هنا يجب أن يطابقه تعديل النصّين هناك (بلوك BOOTSTRAP IDENTITY أعلى
// firestore.rules). القيم الافتراضية تحافظ على السلوك الحالي تماماً.
// =============================================================================

const _env = (typeof import.meta !== 'undefined' && import.meta && import.meta.env)
  ? import.meta.env
  : {};

export const BOOTSTRAP_ADMIN_ID = String(_env.VITE_BOOTSTRAP_ADMIN_ID || 'USR-1001').trim();

export const BOOTSTRAP_ADMIN_EMAIL = String(_env.VITE_BOOTSTRAP_ADMIN_EMAIL || 'admin@store.com').trim();
