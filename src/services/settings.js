/**
 * General System Settings Module — V3.17 → React (Phase 2 port)
 * =============================================================
 * V3.63 — SPLIT SCOPE (قرار العميل):
 *   هوية النظام (اسم/تاجلاين/شعار): تُحفظ محلياً + تُرفع للسحابة
 *     (LWW عبر `updatedAt`) — يعدّلها المدير فقط وتظهر لكل الموظفين.
 *   تفضيلات العرض (ثيم/لون أساسي/وضع الاختصار): شخصية لكل مستخدم على
 *     جهازه (localStorage فقط بلا سحابة) — تغيير موظف لا يؤثر على غيره.
 *
 * Persistence:
 *   - localStorage key `bms_<client>_general_settings` → الهوية (عالمية).
 *   - localStorage key `bms_<client>_user_prefs` → خريطة تفضيلات لكل مستخدم.
 *   - Firestore doc `settings/appSettings` → الهوية فقط (LWW via `updatedAt`).
 */
import { CLIENT } from '../client/config.js';
import { storageKey } from '../client/storage.js';
import { getCurrentUser } from './auth.js';

const KEY = storageKey('general_settings');
const PREFS_KEY = storageKey('user_prefs');

// V3.44 — هوية المتجر الافتراضية تُقرأ من ملف التخصيص المركزي (client.config):
// لعميل جديد عدّل src/client/config.js فقط (اسم/شعار/لون/مظهر).
const IDENTITY_DEFAULT = {
  appName: CLIENT.appName,
  tagline: CLIENT.tagline,
  logo: CLIENT.logo,
  updatedAt: 0
};

const PERSONAL_DEFAULT = {
  primaryColor: CLIENT.primaryColor,
  theme: CLIENT.theme,
  // V3.61 — «وضع الاختصار» للأرقام (K/M): معطّل افتراضياً (رقم كامل)، يؤثر
  // على الداشبورد والتقارير معاً عبر مفتاح واحد في الإعدادات.
  compactNumbers: false
};

const IDENTITY_KEYS = ['appName', 'tagline', 'logo'];
const PERSONAL_KEYS = ['theme', 'primaryColor', 'compactNumbers'];

// دمج افتراضيات الهوية والتفضيلات لمواقع التطبيق البصري التي لا تهتم بالانقسام.
const DEFAULT = Object.assign({}, IDENTITY_DEFAULT, PERSONAL_DEFAULT);

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v == null ? null : v;
  } catch {
    return null;
  }
}
// حفظ محمي ضد امتلاء سعة التخزين المحلي (مثل شعار ضخم): عند رفض الكتابة نعيد
// المحاولة دون الشعار كي لا يضيع بقية الإعدادات بصمت ويبدو الحفظ «راجعاً».
function writeLocal(o) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch (e) {
    if (o.logo && o.logo !== DEFAULT.logo) {
      writeLocal(Object.assign({}, o, { logo: DEFAULT.logo }));
      return;
    }
    console.warn('settings: localStorage write failed', e && e.message ? e.message : e);
  }
}

// ————— تفضيلات العرض الشخصية (لكل مستخدم على جهازه) —————
// مخزنة في مفتاح واحد لكل الجهاز، خريطة { userId: {...prefs} }، فيعود ثيم كل
// موظف تلقائياً عند دخوله على أي متصفح استخدمه من قبل — دون أي مزامنة سحابية.
function currentUserId() {
  const u = getCurrentUser();
  return u && (u.id || u.email) ? String(u.id || u.email) : null;
}

function readPrefsMap() {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writePrefsMap(map) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('settings: prefs write failed', e && e.message ? e.message : e);
  }
}

// تفضيلات المستخدم الجالس (أو الافتراضيات إن لم توجد جلسة/لم يحفظ بعد).
function readPersonal() {
  const id = currentUserId();
  const map = readPrefsMap();
  const mine = (id && map[id]) ? map[id] : {};
  return Object.assign({}, PERSONAL_DEFAULT, mine);
}

export function getSettings() {
  const identity = Object.assign({}, IDENTITY_DEFAULT, readLocal() || {});
  const personal = readPersonal();
  return Object.assign({}, identity, personal, { compactNumbers: !!personal.compactNumbers });
}

// ---------------------------------------------------------------
// Color helpers — derive the full brand-* palette from one accent.
// ---------------------------------------------------------------
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function blend(rgb, towardWhite, t) {
  const tgt = towardWhite ? [255, 255, 255] : [0, 0, 0];
  return '#' + rgb.map(function (v, i) {
    const x = Math.max(0, Math.min(255, Math.round(v + (tgt[i] - v) * t)));
    return x.toString(16).padStart(2, '0');
  }).join('');
}
function palette(primary) {
  const rgb = hexToRgb(primary) || hexToRgb('#0284c7');
  return {
    50: blend(rgb, true, 0.9),
    100: blend(rgb, true, 0.8),
    300: blend(rgb, true, 0.45),
    400: blend(rgb, true, 0.25),
    500: primary,
    600: blend(rgb, false, 0.1),
    700: blend(rgb, false, 0.2),
    800: blend(rgb, false, 0.3),
    900: blend(rgb, false, 0.45)
  };
}

const THEMES = ['dark', 'light', 'ocean', 'emerald', 'royal', 'coffee', 'luxury-gold', 'graphite', 'mint', 'midnight', 'deep-purple', 'light-professional'];

export function setTheme(theme) {
  const t = THEMES.indexOf(theme) !== -1 ? theme : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export function applyPalette(primary) {
  const p = palette(primary);
  const style = document.documentElement.style;
  Object.keys(p).forEach(function (k) { style.setProperty('--brand-' + k, p[k]); });
}

function applyBranding(g) {
  const name = g.appName || DEFAULT.appName;
  const tag = g.tagline || DEFAULT.tagline;
  const logo = g.logo || DEFAULT.logo;

  document.title = name + ' — نظام الإدارة اليومية الذكي';

  const setEl = function (ids, value, isSrc) {
    ids.forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (isSrc) {
        el.setAttribute('src', value);
        if (el.hasAttribute('alt')) el.setAttribute('alt', name);
      } else {
        el.textContent = value;
      }
    });
  };

  setEl(['header-brand-name', 'login-brand-name', 'mobile-brand-name'], name, false);
  setEl(['header-brand-tagline', 'login-brand-tagline', 'mobile-brand-tagline'], tag, false);
  setEl(['header-brand-logo', 'login-brand-logo', 'mobile-brand-logo'], logo, true);

  const foot = document.getElementById('footer-brand-text');
  if (foot) foot.textContent = name + ' — نظام الإدارة اليومية الذكي — جميع الحقوق محفوظة © 2026';

  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.setAttribute('href', logo);
}

export function applyTo(g) {
  const settings = Object.assign({}, DEFAULT, g || {});
  setTheme(settings.theme);
  applyPalette(settings.primaryColor);
  applyBranding(settings);
}

export function applySettings() {
  applyTo(getSettings());
}

export function saveSettings(partial, opts) {
  const prev = getSettings();
  const p = partial || {};

  // فصل التحديثات: الهوية (سحابية/عالمية) عن التفضيلات (محلية/شخصية).
  const identityPatch = {};
  const personalPatch = {};
  Object.keys(p).forEach(function (k) {
    if (k === 'updatedAt') return;
    if (IDENTITY_KEYS.indexOf(k) !== -1) identityPatch[k] = p[k];
    if (PERSONAL_KEYS.indexOf(k) !== -1) personalPatch[k] = p[k];
  });

  const next = Object.assign({}, prev, p);
  if (THEMES.indexOf(next.theme) === -1) next.theme = 'dark';
  if (!hexToRgb(next.primaryColor)) next.primaryColor = prev.primaryColor || PERSONAL_DEFAULT.primaryColor;

  if (window.isSandboxMode) {
    // Sandbox: apply the look visually from the NEW values ONLY (session-wise) —
    // nothing is written to localStorage or mirrored to Firestore (وضع الاختبار
    // لا يمس البيانات). Previously this re-applied the OLD storage value, which
    // made saved settings appear to "revert" immediately in test mode.
    applyTo(next);
    return next;
  }

  const hasIdentity = Object.keys(identityPatch).length > 0;
  const hasPersonal = Object.keys(personalPatch).length > 0;

  // التفضيلات الشخصية: تُكتب للمستخدم الجالس فقط (لا سحابة أبداً).
  if (hasPersonal) {
    const uid = currentUserId();
    if (uid) {
      const map = readPrefsMap();
      map[uid] = Object.assign({}, readPersonal(), personalPatch);
      writePrefsMap(map);
    }
  }

  // الهوية: تُكتب عالمياً بطابع LWW.
  if (hasIdentity) {
    const prevStamp = Number(prev.updatedAt) || 0;
    next.updatedAt = Math.max(Date.now(), prevStamp + 1);
    const local = Object.assign({}, readLocal() || {}, identityPatch, { updatedAt: next.updatedAt });
    writeLocal(local);
  }

  applySettings();
  // V3.62/63 — الرفع للسحابة للهوية فقط (يعدّلها المدير). التفضيلات الشخصية لا
  // تُرفع أبداً. noCloudPush تُستخدم عندما يدفع المتصل (SettingsView) بنفسه.
  if (hasIdentity && !(opts && opts.noCloudPush)) pushToCloud();
  return next;
}

export function pushToCloud() {
  if (window.isSandboxMode) return Promise.resolve(false);
  if (!window.db || !window._authUser) return Promise.resolve(false);
  const g = getSettings();
  try {
    // V3.63 — الهوية فقط (اسم/تاجلاين/شعار): الثيم واللون صارا شخصيين لكل
    // مستخدم ولا يُرفعان للسحابة أبداً.
    const p = window.db.collection('settings').doc('appSettings').set({
      appName: g.appName,
      tagline: g.tagline,
      logo: g.logo,
      updatedAt: g.updatedAt
    }, { merge: true });
    p.catch(function (err) {
      window.dispatchEvent(new CustomEvent('bms-sync-error', {
        detail: { context: 'appSettings', message: err && err.message ? err.message : String(err) }
      }));
    });
    return p;
    } catch (pushErr) {
      return Promise.reject(pushErr);
    }
}

export function hydrateFromCloud() {
  if (window.isSandboxMode || !window.db || !window._authUser) return Promise.resolve(false);
  return window.db.collection('settings').doc('appSettings').get()
    .then(function (snap) {
      if (!snap.exists) return false;
      const cloud = snap.data() || {};
      const ct = Number(cloud.updatedAt) || 0;
      if (!ct) return false;
      const local = getSettings();
      const lt = Number(local.updatedAt) || 0;
      if (ct > lt) {
        // V3.63 — نتبنّى الهوية فقط (اسم/تاجلاين/شعار)؛ لا تُعاد كتابة أي
        // حقل مظهر شخصي من السحابة أبداً.
        const identity = {};
        IDENTITY_KEYS.forEach(function (k) {
          if (cloud[k] !== undefined) identity[k] = cloud[k];
        });
        writeLocal(Object.assign({}, readLocal() || {}, identity, { updatedAt: ct }));
        applySettings();
        return true;
      }
      // V3.55 — لا يُرفع المحلي إلى السحابة هنا أبداً: الرفع يحدث فقط عند
      // تغيير الهوية يدوياً عبر saveSettings (يمنع إعادة رفع إعدادات قديمة
      // / ممسوحة بعد «التصفير» لمجرد فتح شاشة الإعدادات).
      return false;
    })
    .catch(function () { return false; });
}

/**
 * V3.63 — تطبيق تفضيلات العرض للمستخدم الجالس عند الدخول/الإقلاع.
 * الثيم واللون صارا شخصيين لكل مستخدم/جهاز (localStorage فقط بلا سحابة)، لذا
 * هذه الدالة لم تعد تقرأ من Firestore؛ تُطبّق تفضيلات المستخدم الحالي (إن وُجدت
 * جلسة) بصرياً وتعيد الإعدادات المطبَّقة — بهذا يعود ثيم كل موظف فور دخوله على
 * أي متصفح استخدمه من قبل، بلا قراءة سحابية وبلا أي رفع تلقائي.
 */
export function hydrateCloudThemeReadOnly() {
  const merged = getSettings();
  applyTo(merged);
  return Promise.resolve(getCurrentUser() ? merged : false);
}

const NS = {
  get: getSettings,
  setTheme,
  applyPalette,
  apply: applySettings,
  save: saveSettings,
  pushToCloud,
  hydrateFromCloud,
  hydrateCloudThemeReadOnly
};

// Public aliases used by other modules / views.
if (typeof window !== 'undefined') {
  window.applyGeneralSettings = applySettings;
  window.saveGeneralSettings = saveSettings;
  window.hydrateGeneralSettings = hydrateFromCloud;
  window.hydrateCloudThemeReadOnly = hydrateCloudThemeReadOnly;
  window.generalSettings = NS;
}

function boot() {
  applySettings();
  // V3.55 — عند الإقلاع (إن وُجدت جلسة سحابية مُستعادة) نطبّق ثيم السحابة
  // «قراءة فقط» دون أي كتابة/رفع تلقائي.
  if (window._authUser) hydrateCloudThemeReadOnly();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

export { NS as generalSettings };
