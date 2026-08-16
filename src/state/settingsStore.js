// =============================================================================
// state/settingsStore.js — المظهر (theme/primaryColor/logo) — Phase 3
// -----------------------------------------------------------------------------
// يغلّف services/settings (نقل js/services/general-settings.js). الحالة تنعكس
// من getSettings() (localStorage + الافتراضيات)، وكل كتابة تمر عبر saveSettings()
// للحفاظ على سلوك V3.17: التحقق من theme/primaryColor، طابع LWW عبر updatedAt،
// وضع الاختبار لا يلمس التخزين، والتطبيق البصري الفوري (CSS vars + title + علامة).
// =============================================================================
import { create } from 'zustand'
import * as settingsService from '../services/settings.js'

function snapshot() {
  return settingsService.getSettings()
}

export const useSettingsStore = create((set) => ({
  ...snapshot(),

  // إعادة القراءة من التخزين + تطبيق المظهر بصرياً (على الإقلاع بعد login).
  hydrate() {
    settingsService.applySettings()
    set(snapshot())
    return snapshot()
  },

  // V3.63 — عند الدخول/الإقلاع: تُطبَّق تفضيلات العرض الشخصية للمستخدم الجالس
  // (ثيم/لون/اختصار أرقام — مخزنة محلياً لكل مستخدم، بلا قراءة سحابية) وتُحدَّث
  // حالة الواجهة لتطابق ما ظهر فعلاً.
  async hydrateCloudTheme() {
    const applied = await settingsService.hydrateCloudThemeReadOnly()
    if (applied && typeof applied === 'object') set(applied)
    return !!applied
  },

  // حفظ تغييرات جزئية عبر الخدمة (تطبيق + كتابة + نسخة سحابية). تُحدَّث حالة
  // المخزن من القيم الناتجة (next) لا من إعادة القراءة فقط — فيبقى المخزن
  // متطابقاً مع ما حُفظ فعلاً حتى في وضع الاختبار (الذي لا يكتب للتخزين).
  save(partial, opts) {
    const next = settingsService.saveSettings(partial, opts)
    set(next)
    return next
  },

  // تبديل فوري للثيم بدون كتابة.
  setTheme(theme) {
    settingsService.setTheme(theme)
    set({ theme })
  },

  // تبديل فوري للون الأساسي بدون كتابة.
  setPrimary(primaryColor) {
    settingsService.applyPalette(primaryColor)
    set({ primaryColor })
  },
}))
