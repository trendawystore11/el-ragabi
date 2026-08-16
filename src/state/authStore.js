// =============================================================================
// state/authStore.js — الجلسة والدور (RBAC) — Phase 3
// -----------------------------------------------------------------------------
// يغلّف services/auth (نقل js/auth.js) في مخزن Zustand. الحالة المحلية للنظام
// هي المصدر الوحيد الموثوق للجلسة (محددة عبر login() فقط بعد تحقق صارم ضد
// حسابات المستخدمين النشطة). المخزن يقرأ getCurrentUser() عند الإنشاء وفي
// restore()، ويوكّل كل قرارات الصلاحيات إلى نفس دوال الخدمة المنقولة.
// =============================================================================
import { create } from 'zustand'
import * as authService from '../services/auth.js'

// 🔐 قراءة حالة تسجيل كلمة سر المدير من نفس مصدر الواجهة
// (window.adminPasswordConfigured — نفس الدالة في الإنتاج) مع بديل آمن للاختبارات.
function readAdminPasswordConfigured() {
  if (typeof window !== 'undefined' && typeof window.adminPasswordConfigured === 'function') {
    return window.adminPasswordConfigured()
  }
  return authService.adminPasswordConfigured()
}

function hydrate() {
  const u = authService.getCurrentUser()
  return {
    user: u,
    authed: !!u,
    role: u ? u.role || 'employee' : null,
    adminPasswordConfigured: readAdminPasswordConfigured(),
  }
}

export const useAuthStore = create((set) => ({
  ...hydrate(),

  // إعادة مزامنة الحالة من الجلسة المخزنة (لا تُسجّل الخروج).
  restore() {
    set(hydrate())
    return authService.getCurrentUser()
  },

  // تسجيل الدخول عبر الخدمة المنقولة (نفس التحقق الصارم والرسائل).
  async login(email, password) {
    const u = await authService.login(email, password)
    set({ user: u, authed: true, role: u.role || 'employee' })
    return u
  },

  // ضبط الجلسة يدوياً (استعادة فورية من حدث خارجي إن وُجد).
  setUser(u) {
    set({
      user: u,
      authed: !!u,
      role: u ? u.role || 'employee' : null,
    })
  },

  // تسجيل الخروج عبر الخدمة (signOut + إيقاف مستمعي Firestore + مسح الجلسة).
  logout() {
    authService.logout()
    set({ user: null, authed: false, role: null })
  },

  // بوابات الصلاحيات — تفويض مباشر للخدمة (الحقيقة الواحدة).
  isAdmin() {
    return authService.isAdmin()
  },

  verifyAdminPassword(password) {
    return authService.verifyAdminPassword(password)
  },

  // 🔐 تحديث فوري لحالة «هل كلمة سر المدير مسجلة» بعد أي تغيير/إنشاء للكلمة
  // (يُستدعى من ChangePasswordModal و AdminPasswordModal بعد الحفظ الناجح).
  refreshAdminPasswordState() {
    set({ adminPasswordConfigured: readAdminPasswordConfigured() })
  },
}))
