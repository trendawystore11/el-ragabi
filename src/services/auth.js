/**
 * Authentication & Role-Based User Management Module — → React (Phase 2 port)
 * ============================================================================
 * Faithful ES-module port of js/auth.js. Connected to Firebase Auth & Cloud
 * Firestore Users Collection. Logic is identical to the legacy reference; the
 * only changes are the module wrapper + `export` + importing getCairoFormattedDate
 * and generateAutoId from the ported utils instead of window.
 */
import { generateAutoId, getCairoFormattedDate } from '../utils/formatters.js';
import { storageKey, clearDataMirrors } from '../client/storage.js';
import { FALLBACK_FIREBASE_CONFIG, fetchOwnUserDocFromCloud } from './db.js';
import { FALLBACK_FIREBASE_CONFIG as CLIENT_FIREBASE_CFG } from '../client/config.js';

const AUTH_STORAGE_KEY = storageKey('user_session');
const USER_CACHE_KEY = storageKey('user_cache');

// Clean Slate Admin Primary Account
const INITIAL_USERS = [
  { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin', createdAt: '2026-07-01T10:00:00Z' }
];

// =============================================================================
// V3.59 — FIREBASE READ WATCHDOG (حارس مهلة قراءات Firestore بعد الدخول)
// -----------------------------------------------------------------------------
// بعد نجاح Firebase Auth (REST سريع) قد تعلق قراءات Firestore بلا مهلة: حزمة
// Firestore لا تملك مهلة افتراضية على .get() وتعيد المحاولة ما دام navigator.onLine
// صحيحاً، فإذا كانت firestore.googleapis.com بطيئة/محجوبة (بينما Auth تستجيب فوراً)
// كان الدخول «يقعد يحمل» بلا نهاية. هنا تُحل الدالة بالـ fallback عند تجاوز المهلة
// أو رفض الطلب، فلا يتوقف الدخول أبداً على اتصال معلّق.
// =============================================================================
const FIREBASE_READ_TIMEOUT_MS = 12000;
const READ_TIMED_OUT = { __readTimedOut: true };

function withTimeout(promise, ms, fallback) {
  return new Promise(function (resolve) {
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise).then(
      function (v) { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      function () { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } }
    );
  });
}

// قابلة للضبط في الاختبارات عبر window.__bmsFirestoreTimeoutMs (مؤقت قصير).
function readTimeoutMs() {
  return (typeof window !== 'undefined' && window.__bmsFirestoreTimeoutMs) || FIREBASE_READ_TIMEOUT_MS;
}

// =============================================================================
// V3.55 — LOCAL ACCOUNT CACHE (كاش حساب محلي للدخول السريع/الأوفلاين)
// -----------------------------------------------------------------------------
// نسخة معقّمة من حسابات `users` تُحفظ محلياً في localStorage بعد كل دخول ناجح:
//   - تُستخدم كمصدر إضافي لمطابقة الدخول والتحقق من كلمة السر على متصفح جديد
//     قبل اكتمال مزامنة السحابة (تسريع الدخول عند تأخر الاستجابة).
//   - تُمكّن الدخول المحلي الصارم عند انقطاع الشبكة حتى لو لم يُنزَّل جدول
//     users بعد (تخطي `users` المحلي + كاش).
// أمان: لا تُحفظ كلمة السر الصريحة أبداً — فقط التجزئة PBKDF2 + الملح.
// لاحظ أن hydrateFromCloud الخاص بالثيمات لم يعد يرفع محلياً إلى السحابة؛
// الرفع يحدث فقط عند تغيير الثيم يدوياً (saveSettings).
// =============================================================================

function readCachedUsers() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(USER_CACHE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeCachedUsers(list) {
  if (typeof localStorage === 'undefined' || window.isSandboxMode) return;
  const safe = (list || [])
    .filter(u => u && u.email)
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      uid: u.uid || '',
      passwordHash: u.passwordHash || '',
      passwordSalt: u.passwordSalt || ''
    }));
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(safe));
  } catch {
    /* best-effort cache */
  }
}

// دمج الكاش مع القائمة الحية: القيم الحية لها الأولوية، والكاش يكمل ما ينقص
// (مثل تجزئة كلمة السر لحساب لم يصل جدوله بعد من السحابة).
function mergedUsers(liveList) {
  const cached = readCachedUsers();
  const live = (Array.isArray(liveList) ? liveList : [])
    .filter(u => u && u.email);
  const byId = {};
  live.forEach(u => { if (u.id) byId[u.id] = u; });
  cached.forEach(u => {
    if (!u || !u.id) return;
    if (!byId[u.id]) byId[u.id] = u;
  });
  return Object.keys(byId).map(k => byId[k]);
}

/**
 * هل الخطأ خطأ شبكة مؤقت (وليس رفض بيانات اعتماد)؟ عندها لا يجب أن يعطّل
 * الدخول: نكمل بجلسة محلية صارمة بدل إشعار «فشل تسجيل الدخول إلى السحابة».
 */
function isNetworkError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  if (code.indexOf('network-request-failed') !== -1) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.indexOf('network') !== -1
    || msg.indexOf('fetch') !== -1
    || msg.indexOf('failed to connect') !== -1
    || msg.indexOf('timeout') !== -1
    || msg.indexOf('timed out') !== -1
    || msg.indexOf('offline') !== -1
    || msg.indexOf('err_') !== -1;
}

// =============================================================================
// V3.45 — إنشاء حسابات Firebase Auth عبر REST + سجل أدوار staff/{uid}
// -----------------------------------------------------------------------------
// سبب REST: firebase.auth().createUserWithEmailAndPassword يوقّع في الحساب
// الجديد فوراً (يستبدل جلسة المدير الحالية). بعد نشر firestore.rules الصارمة
// ستُرفض أي كتابة موقّعة بالمستخدم الجديد — فهو غير مسجَّل في سجل الفريق بعد.
// استدعاء identitytoolkit مباشرة ينشئ الحساب في Firebase Authentication دون
// المساس بجلسة المدير الجالسة، فيبقى كل مستند يُكتب بتوقيع المدير (isAdmin).
// سجل الأدوار staff/{uid} (مفتاح المستند = Firebase Auth UID) هو مصدر الحقيقة
// الذي تعتمده قواعد Firestore لتمييز أعضاء الفريق عن أي حساب وهمي مسجّل.
// =============================================================================

function resolveFirebaseApiKey() {
  if (typeof window !== 'undefined') {
    if (typeof window.getFirebaseConfig === 'function') {
      try {
        const legacy = window.getFirebaseConfig();
        if (legacy && legacy.apiKey) return legacy.apiKey;
      } catch { /* ignore corrupted legacy config */ }
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey('firebase_config')) || 'null');
      if (saved && saved.apiKey) return saved.apiKey;
    } catch { /* ignore corrupted saved config */ }
  }
  // V3.50 — آخر احتياط: FALLBACK_FIREBASE_CONFIG من db.js (يُقرأ من config.js)
  // ثم CLIENT_FIREBASE_CFG مباشرةً من config.js كحراسة مزدوجة.
  return FALLBACK_FIREBASE_CONFIG.apiKey || CLIENT_FIREBASE_CFG.apiKey || '';
}

/**
 * ينشئ حساباً في Firebase Authentication عبر Identity Toolkit REST دون تغيير
 * المستخدم الحالي في جلسة SDK. يعيد { uid: localId, email }.
 */
export async function createAuthAccountViaREST(email, password) {
  const apiKey = resolveFirebaseApiKey();
  if (!apiKey) {
    throw new Error('تعذر إنشاء حساب الدخول السحابي: مفتاح مشروع Firebase غير متوفر');
  }
  let res;
  try {
    res = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: _normEmail(email), password: (password || '').trim(), returnSecureToken: true })
      }
    );
  } catch (netErr) {
    throw new Error('تعذر إنشاء حساب الدخول السحابي: ' + ((netErr && netErr.message) ? netErr.message : 'فشل الاتصال بالسحابة'));
  }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok || !data.localId) {
    const code = data && data.error && data.error.message;
    if (code === 'EMAIL_EXISTS') {
      throw new Error('هذا البريد الإلكتروني مسجل بالفعل في Firebase Authentication — استخدم بريداً آخر أو احذف الحساب القديم');
    }
    throw new Error('تعذر إنشاء حساب الدخول السحابي: ' + (code || ('HTTP ' + res.status) || 'فشل الاتصال بالسحابة'));
  }
  return { uid: data.localId, email: data.email || email };
}

// ————— مزامنة سجل الأدوار staff/{uid} —————

function writeStaffDoc(uid, data) {
  if (!uid || !window.db || typeof window.db.collection !== 'function') return;
  window.db.collection('staff').doc(uid).set({
    email: data.email,
    role: data.role,
    userId: data.userId,
    updatedAt: getCairoFormattedDate()
  }).catch(err => {
    console.warn('staff mapping sync note:', err && err.message);
  });
}

function deleteStaffDoc(uid) {
  if (!uid || !window.db || typeof window.db.collection !== 'function') return;
  window.db.collection('staff').doc(uid).delete().catch(err => {
    console.warn('staff mapping delete note:', err && err.message);
  });
}

/**
 * V3.45.1 — SELF-HEALING of the staff/{uid} activation record on login.
 * Called only after a successful Firebase Auth sign-in whose staff/{uid} doc is
 * missing. Resolves the matching account in the `users` collection (by uid, then
 * by email, then by the already-resolved local record) and rewrites its
 * staff/{uid} doc so the session can start.
 *
 * Firestore rules allow this write only for a FIRST-ADMIN BOOTSTRAP on an empty
 * staff collection (or by a signed-in staff admin). A denied write — e.g. a
 * non-admin account whose activation was never created — returns false so the
 * caller keeps the previous activation error for non-admin accounts.
 */
async function healMissingStaffDoc(fbUid, email, resolvedUser) {
  if (!fbUid || !window.db || typeof window.db.collection !== 'function') return false;

  let userDoc = null;
  const users = (typeof window.getUsers === 'function' && window.getUsers()) || [];
  userDoc = users.find(u => u && u.uid && String(u.uid) === String(fbUid)) || null;
  if (!userDoc) {
    const norm = v => ((v || '') + '').trim().toLowerCase();
    userDoc = users.find(u => u && norm(u.email) === norm(email)) || null;
  }
  if (!userDoc && resolvedUser && resolvedUser.id) userDoc = resolvedUser;
  if (!userDoc || !userDoc.id) return false;

  const role = (userDoc.role === 'admin' || userDoc.id === 'USR-1001') ? 'admin' : (userDoc.role || 'employee');

  const docPayload = {
    email: userDoc.email || email,
    role,
    userId: userDoc.id,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: getCairoFormattedDate()
  };

  // V3.58 — BOOTSTRAP ONE-SHOT CLOSURE: أول كتابة staff/{uid} تُغلق بوابة
  // البوتستراف نهائياً بإنشاء مفتاح settings/staffBootstrapDone في نفس الدفعة
  // الذرية (القواعد تسمح به فقط لبوتستراف أول مدير على مجموعة staff فارغة
  // وبلا مفتاح سابق). إن رفضت القواعد الدفعة (المفتاح موجود سابقاً أو المجموعة
  // غير فارغة)، نعود لمسار الشفاء العادي بسجل staff واحد — يسمح به المدير.
  if (typeof window.db.batch === 'function') {
    try {
      const batch = window.db.batch();
      batch.set(window.db.collection('staff').doc(fbUid), docPayload);
      batch.set(window.db.collection('settings').doc('staffBootstrapDone'), {
        done: true,
        uid: fbUid,
        email: userDoc.email || email,
        createdAt: new Date().toISOString()
      });
      await batch.commit();
      return true;
    } catch (err) {
      console.warn('staff bootstrap batch note:', err && err.message);
    }
  }

  try {
    await window.db.collection('staff').doc(fbUid).set(docPayload);
    return true;
  } catch (err) {
    console.warn('staff self-heal note:', err && err.message);
    return false;
  }
}

// Purge any legacy persistent sessions from localStorage so login is ALWAYS enforced on launch
if (typeof window !== 'undefined') localStorage.removeItem(AUTH_STORAGE_KEY);

export function getUsers() {
  const users = window.getCollection(window.STORAGE_KEYS.USER);
  return (users && users.length > 0) ? users : INITIAL_USERS;
}

// 🔒 Null-safe email normalization: a user doc/record may be missing its email
// (incomplete write, partial merge, legacy import). Sanitizing an undefined
// email with .toLowerCase() crashes the whole login/relogin flow with
// "Cannot read properties of undefined (reading 'toLowerCase')", so every email
// comparison must go through this helper.
function _normEmail(value) {
  return ((value || '') + '').trim().toLowerCase();
}

export function getCurrentUser() {
  // The local session is the app's authoritative identity (set by login() only
  // after strict validation against active user accounts).
  const session = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (session) {
    try {
      const parsed = JSON.parse(session);
      if (parsed && parsed.email) return parsed;
    } catch (parseErr) {
      console.error(parseErr);
    }
  }

  // Fallback: restore identity from a persisted Firebase Auth session, but ONLY
  // when its email still matches an active user document. A stale/deprecated
  // email (e.g. after an account email change) is rejected.
  if (window.auth && window.auth.currentUser) {
    const fbUser = window.auth.currentUser;
    const users = window.getUsers();
    const matched = users.find(u => _normEmail(u.email) === _normEmail(fbUser && fbUser.email));
    if (!matched) return null;
    return {
      email: fbUser.email,
      name: matched.name,
      role: matched.role
    };
  }

  return null;
}

// =============================================================================
// V3.46 — SALTED PBKDF2 PASSWORD HASHING (Finding C1)
// Web Crypto API (crypto.subtle) PBKDF2 SHA-256 with 100,000 iterations & 16B salt.
// Eliminates plaintext password fields while retaining secure offline auth.
// =============================================================================

export async function generateSalt() {
  // V3.57 — fail-closed: بدون Web Crypto لا يمكن إنشاء salt آمن، والإنشاء يجب
  // أن يتوقف بخطأ واضح بدلاً من السقوط إلى مصادر عشوائية ضعيفة (Math.random).
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('إنشاء salt يتطلب بيئة Web Crypto — بيئة غير مدعومة');
  }
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  const pwd = String(password || '').trim();
  const slt = String(salt || '').trim();
  if (!pwd) return '';
  if (!slt) throw new Error('لا يمكن تجزئة كلمة السر بدون salt — أعد تسجيل الحساب');

  // V3.57 — fail-closed: التجزئة تُنفَّذ حصرياً عبر PBKDF2 (Web Crypto). أي
  // غياب لأداة التجزئة الآمنة يوقف العملية — لا fallback ضعيف يُكتب في السحابة.
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('تجزئة كلمة السر تتطلب Web Crypto (PBKDF2) — بيئة غير مدعومة');
  }

  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(pwd),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(slt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', derivedKey);
    return Array.from(new Uint8Array(exported), b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    throw new Error('فشل تجزئة كلمة السر عبر Web Crypto: ' + (err && err.message ? err.message : String(err)));
  }
}

export async function verifyPasswordHash(user, enteredPassword) {
  // V3.57 — fail-closed: التحقق يتم فقط من التجزئة (passwordHash + passwordSalt).
  // حسابات قديمة تحمل password نصي صريح تُرفض (يجب إعادة تعيين كلمة السر عبر
  // admin) — لم يعد النص الصريح يُقبَل ولا يُهاجر تلقائياً بأي مسار.
  if (!user || !enteredPassword) return false;
  if (!user.passwordHash || !user.passwordSalt) return false;

  const cleanInput = String(enteredPassword).trim();
  const computedHash = await hashPassword(cleanInput, user.passwordSalt);
  return computedHash === user.passwordHash;
}

/**
 * V3.58 — هل اكتمل بوتستراف المتجر (settings/staffBootstrapDone موجود)؟
 * يُستخدم للتمييز بين «حساب محذوف من السحابة» (بوتستراف مكتمل + مستند
 * المستخدم مفقود في السحابة) وبين «قاعدة بيانات سحابية جديدة لم تُهيَّأ بعد»
 * (يجب السماح ببوتستراف المدير الأول). أي فشل في قراءة المفتاح (شبكة/قواعد)
 * يعيد false — لا قفل على دخول لا نستطيع التأكد منه.
 */
async function isBootstrapDone() {
  if (!window.db || typeof window.db.collection !== 'function') return false;
  try {
    const snap = await window.db.collection('settings').doc('staffBootstrapDone').get();
    return !!(snap && snap.exists);
  } catch {
    return false;
  }
}

export async function login(email, password) {
  const cleanEmail = _normEmail(email);
  const cleanPassword = (password || '').trim();

  if (!cleanEmail || !cleanPassword) {
    throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور');
  }

  // 🔒 STRICT validation against active user accounts (null-safe email compare).
  // On a fresh device the local users list may hold only the seed admin until
  // the first cloud sync; a real Firebase Auth credential is then accepted and
  // the session is minted from the cloud-synced record below.
  //
  // V3.55 — يُدمج كاش الحساب المحلي (user_cache) مع القائمة الحية كي يُطابَق
  // الحساب والتحقق من كلمة السر فوراً دون انتظار بطء/انقطاع السحابة على
  // متصفح جديد. الكاش لا يُكتب/يُرفع تلقائياً للسحابة أبداً — مجرد مصدر محلي.
  let user = mergedUsers(window.getUsers()).find(u => _normEmail(u.email) === cleanEmail);

  // Local password gate first: instant feedback, no cloud latency on typos.
  if (user && user.passwordHash && user.passwordSalt) {
    const valid = await verifyPasswordHash(user, cleanPassword);
    if (!valid) {
      throw new Error('كلمة المرور غير صحيحة');
    }
  }

  if (window.auth) {
    window._pendingAuth = true;
    // 🔌 V3.28 — ONLINE vs OFFLINE login gate. When the browser reports it is
    // online, a session is ONLY minted from a real Firebase Auth user: the old
    // silent fallback to a local-only seed session left the dashboard empty on
    // fresh browsers (mismatched projectId / rules / wrong cloud password).
    // Offline keeps the strict local fallback so the app still works without
    // the network.

    const online = (typeof navigator === 'undefined') || (navigator.onLine !== false);
    let authErr = null;
    try {
      // ✅ Await the real Firebase sign-in so onAuthStateChanged settles with a
      //    non-null user BEFORE any render / route-guard runs. This removes the
      //    relogin race (permission toasts + stale role/email sanitization) and
      //    lets a real cloud credential mint a session even when the local
      //    users list on THIS device hasn't synced yet (multi-device login).
      await window.auth.signInWithEmailAndPassword(cleanEmail, cleanPassword);
      if (window.waitForFirebaseAuth) await window.waitForFirebaseAuth();
    } catch (err) {
      authErr = err;
    } finally {
      window._pendingAuth = false;
    }

    // 🔒 ONLINE: no silent local-only session. If Firebase Auth failed OR the
    //    auth gate never confirmed a real user (_authUser === null), the login
    //    MUST fail with an explicit cloud error instead of a fake empty state.
    //    The REAL Firebase error (code + message) is surfaced so the operator can
    //    tell "wrong password" from "no such account in Firebase Auth" from
    //    "project/config mismatch" instead of guessing.
    //    V3.55 — الاستثناء الوحيد: خطأ شبكة مؤقت (auth/network-request-failed)
    //    لا يعطّل إقلاع التطبيق؛ نكمل بالتحقق المحلي الصارم (نفس مسار الأوفلاين)
    //    ونصرف الجلسة محلياً، وتبقى المزامنة معلّقة حتى يعود الاتصال.
    if (authErr || !window._authUser) {
      const realReason = authErr ? (authErr.message || authErr.code || String(authErr)) : '';
      const netFailure = isNetworkError(authErr);
      if (online && !netFailure) {
        throw new Error(
          'فشل تسجيل الدخول إلى السحابة - تحقق من بيانات الحساب وإعدادات الربط' +
          (realReason ? (' [' + realReason + ']') : '')
        );
      }
      // OFFLINE / blocked cloud / شبكة معطّلة: keep the strict LOCAL validation
      // result as the fallback (session still works, cloud sync is skipped until
      // reconnect).
      if (!user) {
        throw new Error(realReason || 'فشل تسجيل الدخول إلى السحابة');
      }
    }

    // 🔒 V3.51 — SELF-FETCH FIRST: قراءة `users` في firestore.rules أصبحت للمدير
    // + صاحب المستند نفسه. قبل الفحص الشامل (الذي لن يجلب كامل الجدول لموظف على
    // متصفح جديد)، نجلب مستند المستخدم الحالي باستعلام مستهدف (بالـ uid ثم
    // بالبريد الموثّق) ونضعه في الكاش كي يطابقه تسجيل الدخول في السطر أدناه.
    if (!authErr && window._authUser && window.db) {
      try {
        const ownDoc = await withTimeout(fetchOwnUserDocFromCloud(), readTimeoutMs(), READ_TIMED_OUT);
        // على انتهاء المهلة يصل ownDoc === READ_TIMED_OUT (وليس null) فلا يُفعل
        // قفل الحذف السحابي خطأً — نكمل بالمصدر المحلي وتُعاد المزامنة لاحقاً.
        // V3.58 — LOCKOUT ON CLOUD-DELETED ACCOUNTS. Firebase Auth قبل الاعتماد
        // نجح، لكن الاستعلام المستهدف يعود فارغاً: لا يوجد مستند لهذا الحساب في
        // مجموعة users السحابية (حُذف من جهاز آخر / أزاله المدير). طالما نحن
        // أونلاين والمتجر مكتمل البوتستراف (المفتاح موجود)، يُرفض صرف الجلسة من
        // الكاش المحلي — الحساب يبقى مقفولاً. خطأ استعلام (قواعد/شبكة) ليس
        // دليلاً على الحذف، فيُتجاهل هنا ونكمل بالمصدر المحلي.
        if (ownDoc === null && online && !window.isSandboxMode && (await isBootstrapDone())) {
          throw new Error('حساب المستخدم غير موجود في النظام — تم حذف الحساب من السحابة');
        }
      } catch (err) {
        if (err && err.message && err.message.indexOf('غير موجود في النظام') !== -1) throw err;
        /* fall back to local snapshot on rules/network errors */
      }
    }

    // 🛰️ CLOUD-FIRST: after successful authentication, pull Firestore as the
    //    single source of truth so every device/browser converges to the exact
    //    same data before the dashboard is rendered. A failed fetch never
    //    blocks login — the local snapshot stays usable offline.
    //    V3.55 — عند خطأ شبكة مؤقت (authErr) نتخطى السحب حتى لا يتباطأ الدخول
    //    بانتظار مهلات الشبكة؛ تعود المزامنة تلقائياً عند استعادة الاتصال.
    if (!authErr) {
      try {
        window.startFirestoreSync();
        const pullResult = await withTimeout(window.fetchAllFromFirestore(true), readTimeoutMs(), READ_TIMED_OUT);
        if (pullResult === READ_TIMED_OUT) {
          const cfg = (typeof window.getFirebaseConfig === 'function') ? (window.getFirebaseConfig() || {}) : {};
          console.warn('[auth.login] استجابة Firestore تجاوزت ' + readTimeoutMs() + 'ms — الدخول بالبيانات المحلية وستُعاد المزامنة تلقائياً عند عودة الاتصال. projectId: ' + (cfg.projectId || 'غير معروف'));
          if (window.showToast) {
            window.showToast('⚠️ السحابة بطيئة أو محجوبة — تم الدخول بالبيانات المحلية وستُعاد المزامنة تلقائياً', 'warning');
          }
        }
      } catch { /* local snapshot remains authoritative offline */ }
    }

    // Re-resolve the account from the (now cloud-synced) users collection so a
    // role/name changed on another device is honored immediately.
    const synced = window.getUsers().find(u => _normEmail(u.email) === cleanEmail);
    if (synced && synced.id) user = synced;

    // 🔐 V3.45 — STAFF ACTIVATION + UID BACKFILL. بعد تأكيد الدخول السحابي:
    // 1) اربط حساب Firebase Auth (uid) بسجل المستخدم إن كان غائباً (backfill
    //    يسمح به تحديث الذات في القواعد دون تغيير الدور/البريد).
    // 2) تأكد من وجود سجل الفريق staff/{uid} — بدونه سترفض قواعد Firestore كل
    //    قراءة/كتابة من هذا الحساب (حساب وهمي أو حساب غير مُفعّل بعد).
    if (!authErr && window._authUser && window.db) {
      const fbUid = window._authUser.uid;
      if (fbUid) {
        const usersCache = window.firestoreCache && window.firestoreCache[window.STORAGE_KEYS.USER];
        const userDocExists = Array.isArray(usersCache) && usersCache.some(u => u && u.id === user.id);
        if (userDocExists && user && !user.uid && typeof window.updateFirestoreDoc === 'function') {
          window.updateFirestoreDoc(window.STORAGE_KEYS.USER, user.id, { uid: fbUid });
          user.uid = fbUid;
        }
        // V3.57 — SEED USER DOC FIRST: on a brand-new cloud database neither
        // users/USR-1001 nor staff exist. Firestore rules now bind the very
        // first bootstrap to the seed user record carrying this Firebase uid,
        // so we create users/USR-1001 (with uid) BEFORE the staff self-heal.
        // The rules allow this single, exact write only while both users and
        // staff are completely empty — after that the bootstrap is closed.
        if (user && user.id === 'USR-1001' && !userDocExists && typeof window.db.collection === 'function') {
          try {
            await window.db.collection('users').doc('USR-1001').set({
              id: 'USR-1001',
              name: 'المدير العام',
              email: 'admin@store.com',
              role: 'admin',
              uid: fbUid,
              createdAt: '2026-07-01T10:00:00Z',
              updatedAt: getCairoFormattedDate()
            });
            user.uid = fbUid;
          } catch (seedErr) {
            console.warn('seed user ensure note:', seedErr && seedErr.message);
          }
        }
        try {
          const staffSnap = await window.db.collection('staff').doc(fbUid).get();
          if (staffSnap && !staffSnap.exists) {
            // 🔧 V3.45.1 — SELF-HEALING: الحساب مسجّل فعلاً في Firebase Auth وله
            // وثيقة في `users`، لكن سجل تفعيله staff/{uid} مفقود (مشروع جديد أو
            // انقطاع أثناء إنشاء الحساب). نعيد إنشاءه تلقائياً — القواعد تسمح
            // بكتابته كأول مدير (بوتستراف) عندما تكون المجموعة فارغة. إن لم
            // يُكتب السجل ولم يكن الحساب مديراً، يبقى الرفض كما في السابق.
            const healed = await healMissingStaffDoc(fbUid, cleanEmail, user);
            const isPrivileged = !!(user && (user.role === 'admin' || user.id === 'USR-1001'));
            if (!healed && !isPrivileged) {
              throw new Error('حسابك غير مُفعَّل في نظام هذا المتجر — يرجى التواصل مع المدير');
            }
          }
        } catch (staffErr) {
          if (staffErr && staffErr.message && staffErr.message.indexOf('غير مُفعَّل') !== -1) throw staffErr;
          // فشل شبكة/صلاحيات في قراءة سجل الفريق: يترك للقواعد الطبيعية.
        }
      }
    }
  }

  if (!user) {
    throw new Error('حساب المستخدم غير موجود في النظام');
  }

  // V3.55 — حدّث كاش الحساب المحلي بعد دخول ناجح (من القائمة الحية) كي يتسارع
  // الدخول التالي ويسير الأوفلاين. يُكتب الحسابات المعقّمة فقط (بلا كلمة سر
  // صريحة) ولا يُرفع شيء إلى السحابة من هنا أبداً. الدمج يضمن ألا يمحو كاش
  // أثرى بعناصر من قائمة محلية جزئية (متصفح جديد قبل اكتمال مزامنة السحابة).
  try { writeCachedUsers(mergedUsers(window.getUsers())); } catch { /* best-effort cache */ }

  const sessionUser = {
    id: user.id,
    email: cleanEmail,
    name: user.name,
    role: user.role,
    loginTime: getCairoFormattedDate()
  };

  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));

  return sessionUser;
}

export function logout() {
  if (window.auth) {
    window.auth.signOut().catch(err => console.error(err));
  }
  // 🔒 Tear down every realtime Firestore listener the moment the session ends
  // (idempotent: the auth gate also unsubscribes on the signOut() event).
  if (window.stopFirestoreSync) window.stopFirestoreSync();
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  // V3.52 — II.8: امسح كل مرايا بيانات العمل (bms_data_*) كي لا تبقى بيانات
  // المستخدم السابق على جهاز مشترك. عند الاتصال تُعاد تلقائياً في أول جلسة.
  clearDataMirrors();
  // V3.55 — امسح كاش الحساب المحلي (يحوي تجزئات كلمات السر) مع الجلسة.
  try { localStorage.removeItem(USER_CACHE_KEY); } catch { /* best-effort */ }
}

export function isAuthenticated() {
  return !!getCurrentUser();
}

export function isAdmin() {
  const user = getCurrentUser();
  return user && user.role === 'admin';
}

/**
 * Strict Admin Password Verification Helper
 * Returns strict boolean (true/false)
 * Uses Firestore-stored password as source of truth only
 */
/**
 * Strict Admin Password Verification Helper
 * Returns strict Promise<boolean> (true/false)
 * Uses PBKDF2 hash verification against stored account
 */
export async function verifyAdminPassword(enteredPassword) {
  if (!enteredPassword || typeof enteredPassword !== 'string' || !enteredPassword.trim()) {
    return false;
  }

  const currentUser = getCurrentUser();
  if (!currentUser) return false;

  const usersList = window.getUsers();
  const activeUserDoc = usersList.find(u => _normEmail(u.email) === _normEmail(currentUser.email));
  if (!activeUserDoc) return false;

  return verifyPasswordHash(activeUserDoc, enteredPassword);
}

/**
 * Whether the current admin has a real password registered in the users
 * document. Callers use this to surface a friendly "set a password first"
 * message instead of a generic wrong-password error.
 */
export function adminPasswordConfigured() {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  const usersList = window.getUsers();
  const activeUserDoc = usersList.find(u => _normEmail(u.email) === _normEmail(currentUser.email));
  return !!(activeUserDoc && activeUserDoc.passwordHash && activeUserDoc.passwordSalt);
}

/**
 * Finding C2: Real Server Re-authentication Gate.
 * Enforces server verification before sensitive operations like database wipe.
 * 🔒 fail-closed: إذا كانت أي خدمة من خدمات إعادة التحقق (SDK / helper / جلسة
 * Firebase) غير متاحة يُرمى خطأ يوقف العملية بدلاً من السماح بالمرور بصمت،
 * ولا يُبتلع أي خطأ حقيقي من Firebase حتى لو كان المتصفح أوفلاين.
 */
export async function reauthenticateCurrentUser(enteredPassword) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error('لا توجد جلسة مستخدم نشطة');

  const cleanPassword = (enteredPassword || '').trim();
  if (!cleanPassword) throw new Error('يرجى إدخال كلمة المرور للتأكيد');

  const verified = await verifyAdminPassword(cleanPassword);
  if (!verified) throw new Error('كلمة المرور غير صحيحة');

  if (!window.auth || !window.auth.currentUser) {
    throw new Error('خدمة التحقق من الهوية السحابية غير متوفرة — أعد المحاولة لاحقاً');
  }
  if (typeof window.auth.currentUser.reauthenticateWithCredential !== 'function') {
    throw new Error('خدمة إعادة التحقق من الهوية غير متوفرة — أعد المحاولة لاحقاً');
  }
  if (!window.firebase || !window.firebase.auth || !window.firebase.auth.EmailAuthProvider) {
    throw new Error('خدمة مصادقة Firebase غير متوفرة — أعد المحاولة لاحقاً');
  }

  try {
    const email = currentUser.email;
    const cred = window.firebase.auth.EmailAuthProvider.credential(email, cleanPassword);
    await window.auth.currentUser.reauthenticateWithCredential(cred);
  } catch (err) {
    console.warn('Firebase reauthentication note:', err && err.message);
    throw new Error('فشل التحقق من الهوية من السحابة: ' + (err && err.message ? err.message : String(err)));
  }

  return true;
}

/**
 * Admin User Creation without session overwrite
 */
export async function createNewUserAccount({ name, email, password, role }) {
  if (!isAdmin()) {
    throw new Error('غير مصرح لك بإنشاء حسابات مستخدمين. هذه الصلاحية للمدير فقط');
  }

  const cleanEmail = _normEmail(email);
  const existing = window.getUsers().find(u => _normEmail(u.email) === cleanEmail);
  if (existing) {
    throw new Error('هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر');
  }

  const cleanPassword = (password || '').trim();
  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error('كلمة المرور يجب ألا تقل عن 6 أحرف');
  }

  const salt = await generateSalt();
  const hash = await hashPassword(cleanPassword, salt);

  const newUser = {
    id: generateAutoId('USR'),
    name: name.trim(),
    email: cleanEmail,
    passwordHash: hash,
    passwordSalt: salt,
    role: role || 'employee',
    createdAt: getCairoFormattedDate()
  };

  let authUid = null;
  if (window.auth) {
    const created = await createAuthAccountViaREST(cleanEmail, cleanPassword);
    authUid = created.uid;
  }
  if (authUid) newUser.uid = authUid;

  const saved = window.addFirestoreDoc(window.STORAGE_KEYS.USER, newUser);

  if (authUid) {
    writeStaffDoc(authUid, { email: cleanEmail, role: role || 'employee', userId: newUser.id });
  }

  return saved;
}

/**
 * V3.41 — CLOUD AUTH SYNC helper.
 */
function syncAuthCredentials(email, newPassword) {
  const firebase = window.auth;
  if (!firebase || !newPassword) return Promise.resolve('unchanged');
  const clean = _normEmail(email);

  return firebase.fetchSignInMethodsForEmail(clean)
    .then(function (methods) {
      const exists = Array.isArray(methods) && methods.length > 0;
      if (exists) {
        const cur = firebase.currentUser;
        if (cur && _normEmail(cur.email) === clean) {
          return cur.updatePassword(newPassword).then(function () { return 'updated'; });
        }
        return Promise.resolve('exists-other');
      }
      return createAuthAccountViaREST(clean, newPassword)
        .then(function (created) { return 'created:' + created.uid; });
    });
}

export async function updateUserAccount(userId, { name, email, password, role }) {
  if (!isAdmin()) {
    throw new Error('غير مصرح لك بتعديل بيانات الحسابات');
  }

  const payload = {
    updatedAt: getCairoFormattedDate()
  };

  let changedEmail = false;
  let oldEmail = '';

  if (name) payload.name = name.trim();

  if (role && userId === 'USR-1001' && role !== 'admin') {
    throw new Error('لا يمكن تغيير صلاحية المدير العام الرئيسي');
  }

  if (role && role !== 'admin') {
    const target = window.getUsers().find(u => u.id === userId);
    const currentSession = getCurrentUser();
    if (target && currentSession && _normEmail(target.email) === _normEmail(currentSession.email)) {
      throw new Error('لا يمكن تغيير صلاحية المدير العام الرئيسي');
    }
  }

  if (role) payload.role = role;
  if (password && password.trim().length > 0) {
    const cleanPwd = password.trim();
    const salt = await generateSalt();
    const hash = await hashPassword(cleanPwd, salt);
    payload.passwordHash = hash;
    payload.passwordSalt = salt;
    payload.password = null;
  }

  if (email) {
    const cleanEmail = _normEmail(email);
    const oldUser = window.getUsers().find(u => u.id === userId);
    oldEmail = oldUser ? _normEmail(oldUser.email) : '';

    if (cleanEmail !== oldEmail) {
      const duplicate = window.getUsers().find(u => u.id !== userId && _normEmail(u.email) === cleanEmail);
      if (duplicate) {
        throw new Error('هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر');
      }
      changedEmail = true;
    }
    payload.email = cleanEmail;
  }

  window.updateFirestoreDoc(window.STORAGE_KEYS.USER, userId, payload);

  if (changedEmail) {
    window.getUsers().forEach(u => {
      if (u.id !== userId && _normEmail(u.email) === oldEmail) {
        window.deleteFirestoreDoc(window.STORAGE_KEYS.USER, u.id);
      }
    });

    if (window.auth && window.auth.currentUser && _normEmail(window.auth.currentUser.email) === oldEmail) {
      window.auth.currentUser.updateEmail(payload.email).catch(err => {
        console.warn('Firebase Auth email sync note:', err && err.message);
      });
    }
  }

  let authSyncResult = 'unchanged';
  const finalEmail = payload.email || oldEmail;
  if (finalEmail && password && password.trim().length > 0) {
    try {
      authSyncResult = await syncAuthCredentials(finalEmail, password.trim());
    } catch (syncErr) {
      console.warn('Firebase Auth credential sync note:', syncErr && syncErr.message);
      authSyncResult = 'failed';
    }
  }

  const sessionRaw = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (sessionRaw) {
    try {
      const sess = JSON.parse(sessionRaw);
      const sessionEmail = _normEmail(sess && sess.email);
      const targetEmail = _normEmail(payload.email || oldEmail || '');
      if (sess && sessionEmail && sessionEmail === targetEmail) {
        sess.id = userId;
        if (payload.name) sess.name = payload.name;
        if (payload.email) sess.email = payload.email;
        if (payload.role) sess.role = payload.role;
        sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sess));
      }
    } catch { /* ignore malformed session */ }
  }

  let targetUid = null;
  const updatedTarget = window.getUsers().find(u => u.id === userId);
  if (updatedTarget && updatedTarget.uid) {
    targetUid = updatedTarget.uid;
  } else if (typeof authSyncResult === 'string' && authSyncResult.indexOf('created:') === 0) {
    targetUid = authSyncResult.split(':')[1] || null;
    if (targetUid) {
      window.updateFirestoreDoc(window.STORAGE_KEYS.USER, userId, { uid: targetUid });
    }
  }
  if (targetUid) {
    writeStaffDoc(targetUid, {
      email: finalEmail || (updatedTarget && updatedTarget.email),
      role: payload.role || (updatedTarget && updatedTarget.role),
      userId
    });
  }

  return { authSync: authSyncResult };
}

/**
 * Self-service password change for the logged-in account.
 */
export async function changeOwnPassword(currentPassword, newPassword) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    throw new Error('يجب تسجيل الدخول أولاً لتغيير كلمة السر');
  }
  if (!newPassword || newPassword.trim().length < 6) {
    throw new Error('كلمة السر الجديدة يجب ألا تقل عن 6 أحرف');
  }

  const usersList = window.getUsers();
  const activeUser = usersList.find(u => _normEmail(u.email) === _normEmail(currentUser.email));
  if (!activeUser) {
    throw new Error('حساب المستخدم غير موجود في النظام');
  }

  const hasStoredPassword = !!(activeUser.passwordHash && activeUser.passwordSalt);

  if (hasStoredPassword) {
    if (!currentPassword || !currentPassword.trim()) {
      throw new Error('يرجى إدخال كلمة السر الحالية');
    }
    const verified = await verifyPasswordHash(activeUser, currentPassword.trim());
    if (!verified) {
      throw new Error('كلمة السر الحالية غير صحيحة');
    }
  } else if (currentUser.role !== 'admin') {
    throw new Error('كلمة السر الحالية غير صحيحة');
  }

  const newPasswordTrimmed = newPassword.trim();
  const salt = await generateSalt();
  const hash = await hashPassword(newPasswordTrimmed, salt);

  const collection = window.firestoreCache && window.firestoreCache[window.STORAGE_KEYS.USER];
  const inCollection = Array.isArray(collection) && collection.some(u => u && u.id === activeUser.id);

  const pwdPayload = {
    passwordHash: hash,
    passwordSalt: salt,
    password: null,
    updatedAt: getCairoFormattedDate()
  };

  if (inCollection) {
    window.updateFirestoreDoc(window.STORAGE_KEYS.USER, activeUser.id, pwdPayload);
  } else {
    window.addFirestoreDoc(window.STORAGE_KEYS.USER, {
      ...activeUser,
      ...pwdPayload
    });
  }

  if (window.auth) {
    try {
      await syncAuthCredentials(activeUser.email, newPasswordTrimmed);
    } catch (syncErr) {
      console.warn('Firebase Auth password sync note:', syncErr && syncErr.message);
    }
  }

  return true;
}


export function updateUserRole(userId, newRole) {
  if (!isAdmin()) {
    throw new Error('غير مصرح لك بتعديل الرتب والصلاحيات');
  }
  // 🔒 Main Admin & self-protection: the primary admin account (USR-1001) and
  // the currently logged-in account can never be demoted from any JS action.
  if (userId === 'USR-1001' && newRole !== 'admin') {
    throw new Error('لا يمكن تغيير صلاحية المدير العام الرئيسي');
  }
  if (newRole !== 'admin') {
    const target = window.getUsers().find(u => u.id === userId);
    const currentSession = getCurrentUser();
    if (target && currentSession && _normEmail(target.email) === _normEmail(currentSession.email)) {
      throw new Error('لا يمكن تغيير صلاحية المدير العام الرئيسي');
    }
  }
  window.updateFirestoreDoc(window.STORAGE_KEYS.USER, userId, { role: newRole });

  // 🔐 V3.45 — مزامنة الدور في سجل staff/{uid} كي تواكب قواعد Firestore القرار.
  const target = window.getUsers().find(u => u.id === userId);
  if (target && target.uid) {
    writeStaffDoc(target.uid, { email: target.email, role: newRole, userId });
  }
}

export async function deleteUserAccount(userId) {
  if (!isAdmin()) {
    throw new Error('غير مصرح لك بحذف الحسابات');
  }
  // 🔒 The primary admin account (USR-1001) and the logged-in account can never
  // be deleted from any JS action (prevents self lock-out / losing the owner).
  if (userId === 'USR-1001') {
    throw new Error('لا يمكن حذف حساب المدير العام الرئيسي');
  }
  const target = window.getUsers().find(u => u.id === userId);
  const currentSession = getCurrentUser();
  if (target && currentSession && _normEmail(target.email) === _normEmail(currentSession.email)) {
    throw new Error('لا يمكن حذف حسابك الحالي');
  }

  // 🔐 V3.45 — احذف سجل الأدوار staff/{uid} مع الحساب حتى يُغلق الوصول فوراً.
  if (target && target.uid) {
    deleteStaffDoc(target.uid);
  }

  const result = window.deleteFirestoreDoc(window.STORAGE_KEYS.USER, userId);

  // 🔐 V3.41 — also delete the linked Firebase Auth account so the email can be
  // reused later. From the client SDK an admin can only delete the CURRENT
  // user, so for other accounts we disable the Auth user's access instead by
  // signing out / notifying — falls back silently when not possible.
  if (target && target.email && window.auth && window.auth.currentUser) {
    const targetEmail = _normEmail(target.email);
    const curEmail = _normEmail(window.auth.currentUser.email);
    if (targetEmail === curEmail) {
      // Self deletion is blocked above; this branch is defensive only.
      window.auth.currentUser.delete().catch(err => {
        console.warn('Firebase Auth account delete note:', err && err.message);
      });
    } else {
      // Other users cannot be deleted from the client SDK. Best-effort: if the
      // Auth account's email is the same as this user's, nothing else can be done
      // from the browser — the Firestore record is gone (login will fail with
      // 'حساب المستخدم غير موجود في النظام' after the next sync).
      console.info('Firebase Auth account for other users must be removed from the Firebase console:', target.email);
    }
  }

  return result;
}

// Wire the full service onto window — identical surface to the legacy script.
if (typeof window !== 'undefined') {
  window.getUsers = getUsers;
  window.getCurrentUser = getCurrentUser;
  window.login = login;
  window.logout = logout;
  window.isAuthenticated = isAuthenticated;
  window.isAdmin = isAdmin;
  window.verifyAdminPassword = verifyAdminPassword;
  window.adminPasswordConfigured = adminPasswordConfigured;
  window.createNewUserAccount = createNewUserAccount;
  window.updateUserAccount = updateUserAccount;
  window.changeOwnPassword = changeOwnPassword;
  window.updateUserRole = updateUserRole;
  window.deleteUserAccount = deleteUserAccount;
}
