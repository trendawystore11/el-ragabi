/**
 * Cloud Firestore Data Storage & Service Layer — V3.25 → React (Phase 2 port)
 * ============================================================================
 * Faithful ES-module port of js/services/db.js. Logic is byte-for-byte identical
 * to the legacy reference — the ONLY structural changes are:
 *   1. ES module wrapper + `export` on the public functions.
 *   2. `getCairoFormattedDate` imported from utils/formatters instead of window.
 *   3. `firebase` global referenced via `window.firebase` (module-safe).
 * All shared state (STORAGE_KEYS / firestoreCache / isSandboxMode / _authUser /
 * diagnostics / sync subscribers) lives on `window` EXACTLY as the legacy script
 * did, so the other ported services (auth / settings / sheets) keep reading the
 * same live values they always read.
 *
 * This is the STORAGE service — touching window/localStorage is its job. The
 * pure-domain rule applies to business logic modules, not here.
 */
import { getCairoFormattedDate, isIncrementField, resolveIncrementFields, round2 } from '../utils/formatters.js';
import { storageKey, isOwnKey, isDataKey, isSnapshotKey } from '../client/storage.js';
import { FALLBACK_FIREBASE_CONFIG as CLIENT_FIREBASE, CLIENT } from '../client/config.js';

// V3.50 — إعدادات Firebase تُقرأ من CLIENT_FIREBASE (src/client/config.js) كي يكفي
// استبدال config.js وحده لتهيئة مشروع Firebase الخاص بالعميل.
export const FALLBACK_FIREBASE_CONFIG = {
  apiKey:            CLIENT_FIREBASE.apiKey            || '',
  authDomain:        CLIENT_FIREBASE.authDomain        || '',
  projectId:         CLIENT_FIREBASE.projectId        || '',
  storageBucket:     CLIENT_FIREBASE.storageBucket     || '',
  messagingSenderId: CLIENT_FIREBASE.messagingSenderId || '',
  appId:             CLIENT_FIREBASE.appId             || '',
  measurementId:     CLIENT_FIREBASE.measurementId     || '',
};

if (typeof window !== 'undefined') {
  try {
    if (typeof window.firebase !== 'undefined' && window.firebase) {
      if (!window.firebase.apps || !window.firebase.apps.length) {
        const fbConfig = (typeof window.getFirebaseConfig === 'function') ? window.getFirebaseConfig() : FALLBACK_FIREBASE_CONFIG;
        window.firebase.initializeApp(fbConfig);
      }
      window.db = window.firebase.firestore();
      window.auth = window.firebase.auth();
    }
  } catch (initErr) {
    console.warn('Firebase Initialization Note:', initErr);
  }
}

export const STORAGE_KEYS = {
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  PRODUCTS: 'products',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  USER: 'users',
  SUPPLIER_RETURNS: 'supplierReturns',
  SUPPLIER_TRANSACTIONS: 'supplierTransactions',
};
if (typeof window !== 'undefined') window.STORAGE_KEYS = STORAGE_KEYS;

// In-memory cache starting completely clean for real store operations
export const firestoreCache = {
  customers: [],
  suppliers: [],
  products: [],
  orders: [],
  payments: [],
  users: [],
  supplierReturns: [],
  supplierTransactions: []
};
if (typeof window !== 'undefined') window.firestoreCache = firestoreCache;

// =====================================================================
// STORAGE VERSION / CACHE MIGRATION (V3.27)
// ---------------------------------------------------------------------
// كل بيانات العمل تُخزَّن في مرايا localStorage (bms_data_*) + صفوف كتابة
// معلقة (bms_pending_ops) وقبور (bms_tombstones) ولقطات استرداد
// (bms_pending_snapshot_*). عند أي تغيير جذري في بنية/معنى البيانات يُرفَع
// STORAGE_VERSION فتُمسح هذه المرايا القديمة قبل أي قراءة — فلا يمكن أن
// تُسترجَع أبداً بيانات قديمة أو Mock/أكواد من إصدار سابق، ويُعاد السحب
// النظيف من Firestore (أو من صفر محلياً).
// =====================================================================
export const STORAGE_VERSION = 'v2_clean';
const STORAGE_VERSION_KEY = storageKey('storage_version');

export function migrateStorageVersion() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    const current = localStorage.getItem(STORAGE_VERSION_KEY);
    if (current === STORAGE_VERSION) return false;

    const staleKeys = [];
    Object.keys(localStorage).forEach(k => {
      // مفتاح قديم (bms_data_*) أو مفتاح مسبوق بمعرّف هذا العميل:
      if (isDataKey(k) || isSnapshotKey(k)) staleKeys.push(k);
    });
    ['bms_pending_ops', 'bms_tombstones'].forEach(k => {
      [k, storageKey(k.replace(/^bms_/, ''))].forEach(full => {
        if (localStorage.getItem(full) !== null) staleKeys.push(full);
      });
    });
    staleKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    Object.keys(firestoreCache).forEach(k => { firestoreCache[k] = []; });
    try { localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION); } catch { /* storage blocked */ }
    return true;
  } catch {
    return false;
  }
}

// يُنفَّذ في أعلى مستوى للوحدة كي يمسح الكاش القديم قبل أن يقرأ authStore أو
// أي مخزن بيانات من localStorage (firebaseLoader يستورد db.js أولاً في main.jsx).
if (typeof window !== 'undefined') {
  migrateStorageVersion();
  window.STORAGE_VERSION = STORAGE_VERSION;
}

// Every synced collection. 'expenses' is appended at runtime by expenses.js.
function syncCollections() {
  const list = [
    window.STORAGE_KEYS.PRODUCTS,
    window.STORAGE_KEYS.CUSTOMERS,
    window.STORAGE_KEYS.SUPPLIERS,
    window.STORAGE_KEYS.ORDERS,
    window.STORAGE_KEYS.PAYMENTS,
    window.STORAGE_KEYS.USER,
    window.STORAGE_KEYS.SUPPLIER_RETURNS,
    window.STORAGE_KEYS.SUPPLIER_TRANSACTIONS
  ];
  if (window.STORAGE_KEYS.EXPENSES) list.push(window.STORAGE_KEYS.EXPENSES);
  return list;
}

// =====================================================================
// V3.25 — SANDBOX MODE (وضع الاختبار / حقل التجارب)
// ---------------------------------------------------------------------
// Hard isolation layer for safely demonstrating the app without touching ANY
// real data. While active (window.isSandboxMode === true):
//   - Every write choke point (add/update/delete/saveCollection) mutates ONLY
//     the in-RAM firestoreCache — never localStorage, never Firestore, never
//     the bms_pending_ops queue, never tombstones.
//   - Realtime Firestore listeners are detached (frozen connection).
//   - getCollection returns the RAM sandbox view and never falls back to the
//     real localStorage mirrors.
//   - _wipeStaleLocalCache / forceWipeDatabase / forcePushPendingToCloud /
//     Google Sheets sync / Firestore settings mirrors are all blocked.
// The ORIGINAL data is deep-cloned into RAM on entry (window._sandboxOriginal)
// and restored 100% unchanged on exit. A page refresh discards the RAM-only
// state naturally — the flag is never persisted.
// =====================================================================
if (typeof window !== 'undefined') {
  window.isSandboxMode = false;
  window._sandboxOriginal = null;
}

function _sandboxDeepClone(value) {
  try { return JSON.parse(JSON.stringify(value == null ? [] : value)); }
  catch { return value == null ? [] : value; }
}

export function enterSandboxMode() {
  if (window.isSandboxMode) return false;
  // Freeze the live connection FIRST: no server snapshot can flow in/out.
  _detachFirestoreListeners();
  // Snapshot the CURRENT real data into RAM only (never written to storage).
  window._sandboxOriginal = {};
  syncCollections().forEach(function (key) {
    window._sandboxOriginal[key] = _sandboxDeepClone(window.firestoreCache[key] || []);
  });
  window.isSandboxMode = true;
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bms-sandbox-changed', { detail: { active: true } }));
    }
  } catch { /* ignore */ }
  return true;
}

export function exitSandboxMode() {
  if (!window.isSandboxMode) return false;
  window.isSandboxMode = false;
  // Discard the sandbox memory state and restore the ORIGINAL RAM snapshot.
  if (window._sandboxOriginal) {
    syncCollections().forEach(function (key) {
      window.firestoreCache[key] = _sandboxDeepClone(window._sandboxOriginal[key] || []);
    });
  }
  window._sandboxOriginal = null;
  // Resume live cloud sync exactly as before — never a wipe of the real data.
  if (window.db && window._authUser) {
    _attachFirestoreListeners();
    fetchAllFromFirestore(true);
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bms-sandbox-changed', { detail: { active: false } }));
    }
  } catch { /* ignore */ }
  return true;
}

export function setSandboxMode(on) {
  return on ? enterSandboxMode() : exitSandboxMode();
}

export function isSandboxActive() { return !!window.isSandboxMode; }

// =====================================================================
// SYNC DIAGNOSTICS
// =====================================================================
if (typeof window !== 'undefined') {
  window.firestoreSyncErrors = [];
  window.firestoreLastSyncAt = null;
  window.firestoreLastSyncSource = null;
  window._firestoreWriteFailures = 0;
}

function _recordWriteError(context, err, opts) {
  const message = err && err.message ? err.message : String(err);
  opts = opts || {};

  // 🔒 Public / login-screen guard: without an active session Firestore rules
  // correctly reject reads & writes ("Missing or insufficient permissions").
  // Those failures are EXPECTED on the login screen and must never surface as a
  // red sync-error toast or console noise. The grace window also swallows the
  // brief permission-denied flash right after login, before the background
  // Firebase Auth sign-in has settled, and anything raised WHILE a sign-in is
  // still in flight (_pendingAuth) is suppressed too — a mid-login transient
  // failure must never toast on the first page open.
  const isPublicView = !(window.isAuthenticated && window.isAuthenticated());
  const inGraceWindow = Date.now() < (window._authGraceUntil || 0);
  const authInFlight = !!window._pendingAuth;
  // V3.16.1 — Auth-hydration suppression. On page refresh Firebase Auth restores
  // the session ASYNCHRONOUSLY: Firestore listeners can fire
  // "Missing or insufficient permissions" before onAuthStateChanged confirms the
  // user. That failure is EXPECTED, never a real error.
  //  - authHydrating: the auth gate has not settled yet (pre-first onAuth event).
  //  - isPermissionDenied && !window._authUser: auth settled but no user
  //    confirmed yet → permission failures are transient, suppress them.
  const authHydrating = window._authSettled !== true;
  const _msg = String(message || '').toLowerCase();
  const isPermissionDenied = _msg.indexOf('permission-denied') !== -1
    || _msg.indexOf('permission denied') !== -1
    || _msg.indexOf('missing or insufficient permissions') !== -1;
  if (isPublicView || inGraceWindow || authInFlight || authHydrating || (isPermissionDenied && !window._authUser)) return;

  window._firestoreWriteFailures = (window._firestoreWriteFailures || 0) + 1;
  window.firestoreSyncErrors.push({ at: getCairoFormattedDate(), context, message });
  if (window.firestoreSyncErrors.length > 100) window.firestoreSyncErrors.shift();

  if (opts.noEvent) {
    // Caller surfaces its own (more specific) toast; still keep diagnostics.
    console.warn('Firestore [' + context + '] (action failed):', message);
    return;
  }
  console.error('Firestore [' + context + ']', message);
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bms-sync-error', { detail: { context, message } }));
    }
  } catch { /* ignore */ }
}

export function getFirestoreStatus() {
  return {
    connected: !!window.db,
    lastSyncAt: window.firestoreLastSyncAt,
    lastSyncSource: window.firestoreLastSyncSource,
    writeFailures: window._firestoreWriteFailures || 0,
    pendingOps: window.pendingOpsQueue().length,
    writeErrors: window.firestoreSyncErrors.slice(-5)
  };
}

// =====================================================================
// OFFLINE PENDING-WRITE QUEUE
// ---------------------------------------------------------------------
// Guarantees every local mutation eventually reaches Firestore:
//  - when window.db is missing (SDK blocked / local-only mode) ops are queued;
//  - when a live Firestore write fails (offline / blocked rules / quota) the
//    failing op is queued and retried on reconnect, reload, or next view render.
// =====================================================================
export function pendingOpsQueue() {
  try { return JSON.parse(localStorage.getItem(storageKey('pending_ops')) || '[]'); }
  catch { return []; }
}

function _savePendingOps(ops) {
  try { localStorage.setItem(storageKey('pending_ops'), JSON.stringify(ops.slice(-1000))); }
  catch (e) { console.warn('Unable to persist pending sync queue:', e && e.message ? e.message : String(e)); }
}

export function queueFirestoreOp(op) {
  if (window.isSandboxMode) return; // sandbox must never queue a real write
  const ops = window.pendingOpsQueue();
  ops.push({
    qid: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    ts: getCairoFormattedDate(),
    ...op
  });
  _savePendingOps(ops);
}

if (typeof window !== 'undefined') {
  window._flushing = false;
  window._lastFlushError = null;
}
export function flushPendingOps() {
  if (window.isSandboxMode || !window.db || window._flushing) return Promise.resolve(0);
  window._flushing = true;
  window._lastFlushError = null;
  const queue = window.pendingOpsQueue();
  if (queue.length === 0) {
    window._flushing = false;
    return Promise.resolve(0);
  }
  const flushedIds = queue.map(o => o.qid);
  return queue.reduce((chain, op) => {
    return chain.then(() => {
      if (!window.db) return Promise.resolve();
      const ref = window.db.collection(op.collection).doc(op.docId);
      if (op.kind === 'delete') return ref.delete();
      return ref.set(op.data, { merge: true });
    });
  }, Promise.resolve())
    .then(() => {
      const remaining = window.pendingOpsQueue().filter(o => flushedIds.indexOf(o.qid) === -1);
      _savePendingOps(remaining);
      window.firestoreLastSyncAt = getCairoFormattedDate();
      window.firestoreLastSyncSource = 'flush';
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bms-pending-flushed'));
    })
    .catch(err => {
      // V3.16.4 — surface the exact Firestore error to forcePushPendingToCloud
      // so the UI can toast it instead of swallowing it.
      window._lastFlushError = err;
      _recordWriteError('flushPendingOps', err);
    })
    .finally(() => { window._flushing = false; });
}

// Tombstones: ids deleted locally that must not reappear from a server snapshot
export function getTombstones() {
  try { return JSON.parse(localStorage.getItem(storageKey('tombstones')) || '[]'); }
  catch { return []; }
}
function _setTombstones(list) {
  try { localStorage.setItem(storageKey('tombstones'), JSON.stringify(list)); }
  catch { /* ignore */ }
}
function _addTombstone(docId) {
  const t = window.getTombstones();
  if (t.indexOf(docId) === -1) { t.push(docId); _setTombstones(t); }
}

// =====================================================================
// V3.16.4 — PENDING-LOCAL-DATA RECONCILE & FORCE PUSH
// ---------------------------------------------------------------------
// Every locally-created entity (customer / order / payment / return ...) is
// written into the local mirror (bms_data_*) AND either reaches Firestore
// immediately or is queued in bms_pending_ops. This reconcile closes the only
// remaining gap: a local-only doc whose queue entry was truncated (queue is
// capped at 1000) or that was never queued would otherwise be WIPED by the
// cloud-first cache wipe on the next login.
// =====================================================================

// Synchronous cheap snapshot of every local mirror (safe to call before the
// cloud-first wipe clears them).
function _snapshotLocalMirrors() {
  const snap = {};
  const collections = syncCollections();
  collections.forEach(key => {
    try {
      const raw = localStorage.getItem(storageKey('data_' + key));
      snap[key] = raw ? (JSON.parse(raw) || []) : [];
    } catch {
      snap[key] = [];
    }
  });
  return snap;
}

// V3.16.4 — the snapshot is also PERSISTED to localStorage (bms_pending_snapshot_*)
// before the cloud-first wipe, so a crash / tab close between the snapshot and the
// background push can never strand a local-only doc. It is cleared only after a
// flush that succeeded, and re-read on the next boot if a previous push never landed.
function _persistLocalSnapshot(snap) {
  try {
    syncCollections().forEach(key => {
      const stored = (snap && snap[key]) || [];
      localStorage.setItem(storageKey('pending_snapshot_' + key), JSON.stringify(stored));
    });
  } catch { /* storage full / blocked — the in-memory snapshot still protects */ }
}
function _loadPersistedLocalSnapshot() {
  const snap = {};
  let any = false;
  syncCollections().forEach(key => {
    try {
      const raw = localStorage.getItem(storageKey('pending_snapshot_' + key));
      if (raw != null) {
        snap[key] = JSON.parse(raw) || [];
        any = true;
      }
    } catch { /* ignore corrupt entry */ }
  });
  return any ? snap : null;
}
function _clearPersistedLocalSnapshot() {
  syncCollections().forEach(key => {
    try { localStorage.removeItem(storageKey('pending_snapshot_' + key)); } catch { /* ignore */ }
  });
}

// Normalise a createdAt-like value into an epoch timestamp for cutoff filtering.
function _tsValue(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/))) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  const p = Date.parse(s);
  return isNaN(p) ? 0 : p;
}
function _cutoffTs(cutoff) {
  if (cutoff == null) return 0;
  if (typeof cutoff === 'number') return cutoff;
  if (typeof cutoff === 'string') {
    const p = _tsValue(cutoff);
    // A bare date ('2026-07-31') means "created after the end of that day".
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(cutoff).trim()) && p) return p + 24 * 3600 * 1000 - 1;
    return p;
  }
  return 0;
}
function _docCreatedTs(doc) {
  return _tsValue(doc && (doc.createdAt || doc.created_at || doc.createdDate));
}

// List every local doc that is not yet safely on Firestore: either still in the
// pending queue ('queue') or present only in the local mirror with no server doc
// and no queued op ('stranded'). Optional cutoff: only entities created on/after
// the given date are reported (e.g. '2026-07-31').
export async function getPendingLocalRecords(cutoff) {
  const cutoffTs = _cutoffTs(cutoff);
  const matches = function (doc) {
    return !cutoffTs || (_docCreatedTs(doc) >= cutoffTs);
  };
  const out = [];

  window.pendingOpsQueue().forEach(op => {
    if (op.kind === 'delete') return;
    if (!matches(op.data || {})) return;
    out.push({ collection: op.collection, docId: op.docId, source: 'queue', queuedAt: op.ts });
  });

  if (!window.db) return out;

  const tombSet = {};
  window.getTombstones().forEach(id => { tombSet[id] = true; });
  const queuedIds = {};
  window.pendingOpsQueue().forEach(op => {
    if (op.kind !== 'delete' && op.collection && op.docId) {
      if (!queuedIds[op.collection]) queuedIds[op.collection] = {};
      queuedIds[op.collection][op.docId] = true;
    }
  });

  const collections = syncCollections();
  await Promise.all(collections.map(async (key) => {
    let serverIds = null;
    try {
      const snap = await window.db.collection(key).get();
      serverIds = {};
      snap.forEach(doc => { serverIds[doc.id] = true; });
    } catch { return; }
    let localDocs = [];
    try {
      const raw = localStorage.getItem(storageKey('data_' + key));
      localDocs = raw ? (JSON.parse(raw) || []) : [];
    } catch { localDocs = []; }
    localDocs.forEach(doc => {
      if (!doc || !doc.id || tombSet[doc.id]) return;
      if (serverIds[doc.id]) return;
      if (queuedIds[key] && queuedIds[key][doc.id]) return;
      if (!matches(doc)) return;
      out.push({ collection: key, docId: doc.id, source: 'stranded' });
    });
  }));

  return out;
}

// Queue every local-only doc (from the snapshot, or the live mirrors) that is
// missing on Firestore so flushPendingOps uploads it instead of losing it.
// When a collection cannot be read from the server (offline / rules deny), every
// non-tombstoned local doc of that collection is queued — an idempotent set+merge
// is always safe, and it guarantees no local copy is ever stranded.
// V3.16.4 — prefers the persisted crash-safe snapshot when no live snapshot is
// passed, and re-persists any passed snapshot so a crash between reconcile and
// flush cannot lose the queued set.
async function _reconcileStrandedLocalDocs(snapshot) {
  if (!window.db) return 0;
  const src = snapshot || _loadPersistedLocalSnapshot() || _snapshotLocalMirrors();
  if (snapshot) _persistLocalSnapshot(snapshot);
  const tombSet = {};
  window.getTombstones().forEach(id => { tombSet[id] = true; });
  const queuedIds = {};
  window.pendingOpsQueue().forEach(op => {
    if (op.kind !== 'delete' && op.collection && op.docId) {
      if (!queuedIds[op.collection]) queuedIds[op.collection] = {};
      queuedIds[op.collection][op.docId] = true;
    }
  });

  const collections = syncCollections();
  let queued = 0;
  await Promise.all(collections.map(async (key) => {
    const localDocs = (src && src[key]) || [];
    if (!localDocs.length) return;

    let serverIds = {};
    let readOk = true;
    try {
      const snap = await window.db.collection(key).get();
      snap.forEach(doc => { serverIds[doc.id] = true; });
    } catch {
      readOk = false;
    }

    localDocs.forEach(doc => {
      if (!doc || !doc.id || tombSet[doc.id]) return;
      if (readOk && serverIds[doc.id]) return;
      if (queuedIds[key] && queuedIds[key][doc.id]) return;
      window.queueFirestoreOp({ kind: 'set', collection: key, docId: doc.id, data: doc });
      queued++;
    });
  }));

  return queued;
}

// Force-push every pending local record to Firestore (requires an active
// onAuthStateChanged user). Returns the number of records pushed.
export async function forcePushPendingToCloud(snapshot, opts) {
  opts = opts || {};
  if (window.isSandboxMode) return 0;
  if (!window.db) {
    if (window.showToast && !opts.silent) window.showToast('☁️ التزامن السحابي غير متاح حالياً — ستُرفع البيانات عند عودة الاتصال', 'warning');
    return 0;
  }
  if (!window._authUser) {
    if (window.showToast && !opts.silent) window.showToast('☁️ سجّل الدخول أولاً لرفع السجلات المعلقة إلى السحابة', 'warning');
    return 0;
  }
  try {
    await _reconcileStrandedLocalDocs(snapshot);
    const queuedBefore = window.pendingOpsQueue().length;
    await window.flushPendingOps();
    // V3.16.4 — flushPendingOps records the exact Firestore error instead of
    // swallowing it; surface it here so the failure toast is not a generic lie.
    if (window._lastFlushError) throw window._lastFlushError;
    const pushed = Math.max(0, queuedBefore - window.pendingOpsQueue().length);
    // The push landed: the crash-safe snapshot has served its purpose.
    _clearPersistedLocalSnapshot();
    if (window.showToast && !opts.silent) {
      if (pushed > 0) {
        window.showToast('☁️ تم رفع ' + pushed + ' سجل محلي معلق إلى السحابة بنجاح', 'success');
      } else {
        window.showToast('☁️ لا توجد سجلات محلية معلقة — كل البيانات مزامنة بالفعل', 'info');
      }
    }
    return pushed;
  } catch (err) {
    _recordWriteError('forcePushPendingToCloud', err);
    // V3.16.4 — requirement: do NOT swallow exceptions. The toast carries the
    // exact Firestore error so the user (and any support) can see the real cause.
    if (window.showToast && !opts.silent) {
      window.showToast('⚠️ تعذر رفع السجلات المعلقة إلى السحابة: ' + (err && err.message ? err.message : String(err)), 'error');
    }
    return 0;
  }
}

// =====================================================================
// AUTH-GATED REALTIME SYNC
// ---------------------------------------------------------------------
// Realtime listeners + cloud queries + collection syncs are gated behind
// firebase.auth().onAuthStateChanged yielding a NON-NULL user. On the public
// login screen (no Firebase user) NOTHING talks to Firestore, so the
// "Missing or insufficient permissions" error can never toast on page load —
// even while Firebase Auth is still asynchronously restoring a session.
// =====================================================================
if (typeof window !== 'undefined') {
  window._syncUnsubscribers = [];
  window._authGraceUntil = 0;
  window._authUser = undefined;      // undefined = not observed yet, null = signed out, object = signed in
  window._authSettled = false;
  window._authWaiters = [];
  window._pendingAuth = false;       // true while login()'s sign-in is in flight
  window._authGateInstalled = false;
}

function _flushAuthWaiters() {
  const waiters = window._authWaiters;
  window._authWaiters = [];
  waiters.forEach(function (fn) {
    try { fn(window._authUser || null); } catch { /* ignore */ }
  });
}

// Register the ONE auth gate that drives all Firestore activity. It always
// replays the current auth state on subscribe, so nothing is ever missed.
function _installAuthGate() {
  if (window._authGateInstalled) return;
  window._authGateInstalled = true;

  const onAuth = function (user) {
    window._authUser = user || null;
    // While a login sign-in is still in flight, an intermediate "signed out"
    // snapshot is not authoritative — keep waiting for the real user.
    if (window._pendingAuth && !user) return;
    window._authSettled = true;
    _flushAuthWaiters();
    if (user) {
      _doStartSync();
    } else {
      _detachFirestoreListeners();
    }
  };

  if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
    window.auth.onAuthStateChanged(onAuth);
  } else if (typeof window !== 'undefined') {
    // No Firebase Auth SDK (e.g. the isolated logic test harness): gate on the
    // local session model instead.
    onAuth(window.isAuthenticated() ? { local: true } : null);
  }
}

// Resolve once the auth gate has settled (or after a safety timeout so an
// offline / blocked sign-in can never hang the app). Resolves with the current
// Firebase user, or null.
export function waitForFirebaseAuth(timeoutMs) {
  _installAuthGate();
  return new Promise(function (resolve) {
    if (window._authSettled && window._authUser) return resolve(window._authUser);
    if (window._authSettled && !window._authUser && !window._pendingAuth) return resolve(null);
    const timer = setTimeout(function () {
      resolve(window._authUser || null);
    }, timeoutMs || 6000);
    window._authWaiters.push(function (user) {
      clearTimeout(timer);
      resolve(user);
    });
  });
}

if (typeof window !== 'undefined') {
  window._syncRetryCount = 0;
  window._syncRetryTimer = null;
  window.firestoreSubscriptionStatus = { connectionState: 'online', error: null };
}

function _notifySyncStatusChanged(status) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.firestoreSubscriptionStatus = status;
  try {
    window.dispatchEvent(new CustomEvent('bms-sync-status-changed', { detail: status }));
  } catch { /* ignore */ }
}

function _scheduleListenerReconnect() {
  if (typeof window === 'undefined' || window.isSandboxMode || !window.db) return;
  if (window._syncRetryTimer) clearTimeout(window._syncRetryTimer);

  const retryCount = (window._syncRetryCount || 0) + 1;
  window._syncRetryCount = retryCount;
  const delayMs = Math.min(30000, Math.pow(2, retryCount - 1) * 1000);

  _notifySyncStatusChanged({ connectionState: 'reconnecting', retryCount, delayMs });

  window._syncRetryTimer = setTimeout(() => {
    _detachFirestoreListeners();
    _attachFirestoreListeners();
  }, delayMs);
}

function _attachFirestoreListeners() {
  if (window.isSandboxMode || !window.db) return;
  if (window._syncUnsubscribers && window._syncUnsubscribers.length > 0) return;

  const collections = syncCollections();
  // V3.51 — نفس التقييد: الموظف لا يشترك في كامل جدول users (رفض قراءته
  // سيعيد إشعال حلقة إعادة الاتصال) — مستندُه الخاص يكفيه.
  const listenCollections = isAdminSession()
    ? collections
    : collections.filter(k => k !== window.STORAGE_KEYS.USER);
  const subs = [];

  listenCollections.forEach((key) => {
    const unsub = window.db.collection(key).onSnapshot((snapshot) => {
      _notifySyncStatusChanged({ connectionState: 'online', retryCount: 0, error: null });
      window._syncRetryCount = 0;
      if (window._syncRetryTimer) {
        clearTimeout(window._syncRetryTimer);
        window._syncRetryTimer = null;
      }

      // Apply server truth. V3.8: local-only docs survive a snapshot ONLY when
      // they have a queued offline write (a genuine pending change not yet on the
      // server). Docs present locally but absent on the server with NO pending op
      // are STALE (deleted on another device) → dropped, so every browser shows
      // identical live data from Firestore.
      const serverItems = [];
      snapshot.forEach(doc => {
        serverItems.push({ id: doc.id, ...doc.data() });
      });

      // Never resurrect locally-deleted docs
      const tombSet = {};
      window.getTombstones().forEach(id => { tombSet[id] = true; });

      const serverIds = {};
      serverItems.forEach(d => { serverIds[d.id] = true; });

      // Docs with a queued offline write are genuinely "pending upload".
      const pendingIds = {};
      window.pendingOpsQueue().forEach(op => {
        if (op.collection === key && op.kind !== 'delete' && op.docId) pendingIds[op.docId] = true;
      });

      const localItems = window.firestoreCache[key] || [];
      const merged = serverItems.filter(d => !tombSet[d.id]);
      localItems.forEach(d => {
        if (d.id && !serverIds[d.id] && !tombSet[d.id] && pendingIds[d.id]) merged.push(d);
      });

      // Prune tombstones whose delete already landed on the server
      _setTombstones(window.getTombstones().filter(id => serverIds[id]));

      window.firestoreCache[key] = merged;
      if (!window.isSandboxMode) {
        localStorage.setItem(`${storageKey('data_' + key)}`, JSON.stringify(merged));
        window.firestoreLastSyncAt = getCairoFormattedDate();
        window.firestoreLastSyncSource = 'snapshot';
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key, items: merged } }));
        }
        if (key === window.STORAGE_KEYS.ORDERS) window.normalizeAccountingData();
      }
    }, (error) => {
      _recordWriteError('snapshot ' + key, error);
      _notifySyncStatusChanged({ connectionState: 'error', error: error && error.message ? error.message : String(error) });
      _scheduleListenerReconnect();
    });
    subs.push(unsub);
  });

  window._syncUnsubscribers = subs;
}

function _detachFirestoreListeners() {
  if (window._syncUnsubscribers) {
    window._syncUnsubscribers.forEach(unsub => {
      try { unsub(); } catch { /* ignore */ }
    });
    window._syncUnsubscribers = [];
  }
}

/**
 * V3.46 — Targeted Query & Pagination Helper (Finding P1)
 * Allows views to query Firestore / RAM cache with pagination (limit, offset, orderBy, where)
 * preventing low-spec POS hardware from overloading memory on massive datasets.
 */
export async function queryFirestoreCollection(collectionKey, options = {}) {
  const { limit = 100, offset = 0, orderBy = null, orderDirection = 'asc', where = [] } = options;

  if (window.isSandboxMode || !window.db) {
    let list = (window.firestoreCache && window.firestoreCache[collectionKey]) ? [...window.firestoreCache[collectionKey]] : [];

    if (Array.isArray(where) && where.length > 0) {
      where.forEach(clause => {
        if (clause && clause.field && clause.value !== undefined) {
          list = list.filter(item => {
            const val = item[clause.field];
            if (clause.op === '==') return val === clause.value;
            if (clause.op === '!=') return val !== clause.value;
            if (clause.op === '>') return val > clause.value;
            if (clause.op === '>=') return val >= clause.value;
            if (clause.op === '<') return val < clause.value;
            if (clause.op === '<=') return val <= clause.value;
            return true;
          });
        }
      });
    }

    if (orderBy) {
      list.sort((a, b) => {
        const valA = a[orderBy] != null ? a[orderBy] : '';
        const valB = b[orderBy] != null ? b[orderBy] : '';
        const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
        return orderDirection === 'desc' ? -cmp : cmp;
      });
    }

    return list.slice(offset, offset + limit);
  }

  try {
    let q = window.db.collection(collectionKey);

    if (Array.isArray(where)) {
      where.forEach(clause => {
        if (clause && clause.field && clause.value !== undefined) {
          q = q.where(clause.field, clause.op || '==', clause.value);
        }
      });
    }

    if (orderBy) {
      q = q.orderBy(orderBy, orderDirection || 'asc');
    }

    if (limit > 0) {
      q = q.limit(limit);
    }

    const snap = await q.get();
    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    return items;
  } catch (err) {
    _recordWriteError('queryCollection ' + collectionKey, err);
    const list = (window.firestoreCache && window.firestoreCache[collectionKey]) || [];
    return list.slice(offset, offset + limit);
  }
}


// V3.8 — Cloud-first convergence. Called once the auth gate confirms a real
// Firebase user: the cloud is the single source of truth, so stale local mirrors
// (data deleted/changed on another device) are wiped before listeners + a forced
// pull rebuild the local cache from Firestore. Pure-local mode (no Firestore SDK)
// is untouched — there the local cache IS the source of truth.
// V3.16.1 — OFFLINE GUARD: when the browser reports we are offline, the wipe is
// skipped so a pre-hydrated local mirror keeps rendering while the cloud is
// unreachable.
function _wipeStaleLocalCache() {
  if (window.isSandboxMode) return; // sandbox exit/enter must NEVER wipe real data
  if (!window.db) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const collections = syncCollections();
  collections.forEach(key => {
    window.firestoreCache[key] = [];
    localStorage.removeItem(`${storageKey('data_' + key)}`);
  });
}

// Attach realtime listeners + safety-net pull. Called ONLY after the auth gate
// has confirmed a non-null Firebase user.
function _doStartSync() {
  if (window.isSandboxMode || !window._authUser) return;

  // Brief grace window so transient failures at session start don't toast.
  window._authGraceUntil = Date.now() + 5000;

  // V3.23 — Full customer-balance recomputation runs ONCE per session, deferred
  // into idle time so it can never block the login screen, the first render, or
  // the realtime sync startup. initDB deliberately skips it (see initDB), and
  // recalculateCustomerBalance skips the write when nothing actually changed.
  if (!window._balancesRecalculated) {
    window._balancesRecalculated = true;
    const recalc = function () {
      if (window.recalculateAllCustomerBalances) window.recalculateAllCustomerBalances();
    };
    if (window.requestIdleCallback) {
      window.requestIdleCallback(recalc, { timeout: 3000 });
    } else {
      setTimeout(recalc, 0);
    }
  }

  // V3.16.4 — capture the local mirrors BEFORE the cloud-first wipe below. Any
  // local-only doc (created offline, never queued, or queue-truncated) would
  // otherwise be wiped before it could reach Firestore; the snapshot lets the
  // background reconcile push it after sync settles.
  const localSnapshot = _loadPersistedLocalSnapshot() || _snapshotLocalMirrors();
  _persistLocalSnapshot(localSnapshot);

  // V3.8: enforce cloud-first on every (re)sync — never keep serving a stale
  // local mirror once the cloud is reachable.
  _wipeStaleLocalCache();

  _attachFirestoreListeners();

  // 🛟 Safety-net pull: an explicit GET guarantees cloud data reaches this
  //     device even if a listener was missed or failed to attach.
  window.flushPendingOps().finally(() => {
    window.fetchAllFromFirestore(true);
    // V3.16.2: pull the Google Sheets link settings from Firestore so a brand
    // new browser restores them after login instead of forcing a re-fill.
    if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.hydrateConfigFromCloud === 'function') {
      window.GoogleSheetsSync.hydrateConfigFromCloud();
    }
    // V3.16.4 — once (per session) force-push any pending local records and
    // toast how many made it to the cloud.
    if (!window._autoPushReported) {
      window._autoPushReported = true;
      window.forcePushPendingToCloud(localSnapshot, { silent: false });
    }
  });
}

// Request realtime sync. Harmless on the login screen — it will only actually
// start once onAuthStateChanged confirms a real user.
export function startFirestoreSync() {
  _installAuthGate();
  if (window._authSettled && window._authUser) {
    _doStartSync();
  }
  // Otherwise the onAuthStateChanged gate calls _doStartSync() itself.
}

// Tear down realtime listeners when the session ends (logout / login screen).
// Fully settles the auth gate so a later login starts from a clean state and
// nothing stays subscribed while the user is signed out (persistent toasts).
export function stopFirestoreSync() {
  window._authGraceUntil = 0;
  window._autoPushReported = false;
  _detachFirestoreListeners();
  if (!window._pendingAuth) {
    window._authUser = null;
    window._authSettled = true;
  }
}

// Initialize DB: Synchronously pre-hydrate cache from LocalStorage FIRST.
// Realtime listeners/cloud pulls are NOT attached here anymore — they are gated
// behind an active session (see startFirestoreSync above), so the public login
// screen never triggers unauthenticated Firestore reads.
export function initDB() {
  // V3.27 — لا تُقرأ مرايا قديمة أبداً: إن تغيّر إصدار التخزين تُمسح أولاً.
  if (migrateStorageVersion()) {
    console.info('Storage migration: old local cache cleared (version ' + STORAGE_VERSION + ').');
  }
  const collections = syncCollections();

  // ⚡ 1. Synchronously pre-hydrate firestoreCache from localStorage BEFORE network resolves
  collections.forEach(key => {
    const stored = localStorage.getItem(`${storageKey('data_' + key)}`);
    if (stored) {
      try {
        window.firestoreCache[key] = JSON.parse(stored) || [];
      } catch {
        window.firestoreCache[key] = [];
      }
    } else {
      window.firestoreCache[key] = [];
    }
  });

  // V3.16 — Self-heal accounting data on every load: cancelled/returned orders
  // are settled invoices (متبقي 0), so no legacy cancelled/returned order can
  // keep inflating "المتبقي على العميل" or the debt cards.
  window.normalizeAccountingData();
  // V3.23 — the full customer-balance recomputation is NOT run here anymore
  // (see the deferred recalculateAllCustomerBalances in _doStartSync).

  // 🔒 2. Install the auth gate now: from here on, onAuthStateChanged drives all
  //     realtime sync — listeners/queries only run after a non-null user.
  _installAuthGate();

  // 🔒 3. If an active local session already exists at init time, request sync
  //     (it only actually attaches after the auth gate confirms a user).
  if (window.isAuthenticated()) {
    window.startFirestoreSync();
  }
}

// Re-fetch every collection directly from Firestore (not localStorage) and refresh
// the UI. Throttled so repeated view renders don't hammer the backend.
if (typeof window !== 'undefined') window._lastFetchAt = 0;
// =====================================================================
// V3.51 — ROLE-AWARE CLOUD ACCESS (بما يتطابق مع firestore.rules الجديدة)
// ---------------------------------------------------------------------
// أصبحت قراءة `users` في القواعد للمدير + صاحب المستند نفسه فقط. أي جلسة
// غير إدارية: (أ) تتخطى جلب/اشتراك كامل الجدول كي لا تُرفض القراءة وتُطلق
// طوفان إعادة اتصال، و(ب) تعتمد على مستندها الخاص الذي يجلبه
// fetchOwnUserDocFromCloud عند تسجيل الدخول.
// =====================================================================
function isAdminSession() {
  if (typeof window === 'undefined') return false;
  const u = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
  return !!(u && u.role === 'admin');
}

/**
 * V3.51 — يجلب مستند المستخدم الحالي فقط (استعلام مستهدف بالـ uid ثم بالبريد
 * الموثّق) ويضعه في كاش users + المرآة المحلية. يعود بالمستند أو null. هو ما
 * يغذي مطابقة تسجيل الدخول للموظفين على متصفح جديد بعد تقييد قراءة الجدول.
 */
export async function fetchOwnUserDocFromCloud() {
  const fb = window._authUser;
  // No cloud infrastructure → "not checked" (null) so callers degrade to local.
  if (!fb || !window.db || typeof window.db.collection !== 'function') return null;
  const cacheOwn = (doc) => {
    const item = { id: doc.id, ...doc.data() };
    const arr = [item];
    window.firestoreCache[window.STORAGE_KEYS.USER] = arr;
    try { localStorage.setItem(`${storageKey('data_' + window.STORAGE_KEYS.USER)}`, JSON.stringify(arr)); } catch { /* ignore */ }
    return item;
  };
  // V3.58 — a query ERROR (rules/network) now THROWS so callers can tell it
  // apart from a genuine "no such account" (empty result → null). Only the
  // success-with-empty result may drive a cloud-deletion lockout.
  if (fb.uid) {
    const snap = await window.db.collection(window.STORAGE_KEYS.USER).where('uid', '==', fb.uid).limit(1).get();
    if (!snap.empty) return cacheOwn(snap.docs[0]);
  }
  if (fb.email) {
    const snap = await window.db.collection(window.STORAGE_KEYS.USER).where('email', '==', fb.email).limit(1).get();
    if (!snap.empty) return cacheOwn(snap.docs[0]);
  }
  return null;
}

export function fetchAllFromFirestore(force) {
  if (window.isSandboxMode || !window.db) return Promise.resolve();
  // 🔒 Auth gate: never query Firestore until onAuthStateChanged has confirmed
  //     a real user (silently defers everything to the post-login sync).
  if (window.auth && !window._authUser) return Promise.resolve();
  const now = Date.now();
  if (!force && now - (window._lastFetchAt || 0) < 2500) return Promise.resolve();
  window._lastFetchAt = now;
  const collections = syncCollections();
  // V3.51 — الجلسات غير الإدارية تتخطى كامل جدول users (قراءته أصبحت
  // للمدير + صاحب المستند) — مستندها الخاص وصل عبر fetchOwnUserDocFromCloud.
  const fetchCollections = isAdminSession()
    ? collections
    : collections.filter(k => k !== window.STORAGE_KEYS.USER);
  const fetchErrors = [];
  let fetchedCount = 0;
  return window.flushPendingOps().then(() =>
    Promise.all(fetchCollections.map(key =>
      window.db.collection(key).get().then(snapshot => {
        const serverItems = [];
        snapshot.forEach(doc => serverItems.push({ id: doc.id, ...doc.data() }));
        const tombSet = {};
        window.getTombstones().forEach(id => { tombSet[id] = true; });
        const serverIds = {};
        serverItems.forEach(d => { serverIds[d.id] = true; });
        const filtered = serverItems.filter(d => !tombSet[d.id]);
        // Prune tombstones that are confirmed gone from the server
        _setTombstones(window.getTombstones().filter(id => !serverIds[id]));
        window.firestoreCache[key] = filtered;
        fetchedCount += filtered.length;
        if (!window.isSandboxMode) {
          localStorage.setItem(`${storageKey('data_' + key)}`, JSON.stringify(filtered));
          if (key === window.STORAGE_KEYS.ORDERS) window.normalizeAccountingData();
        }
      }).catch(err => {
        fetchErrors.push({ key, message: err && err.message ? err.message : String(err) });
        _recordWriteError('fetchAll ' + key, err);
      })
    ))
  ).then(() => {
    window.firestoreLastSyncAt = getCairoFormattedDate();
    window.firestoreLastSyncSource = 'fetchAll';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key: '*', manual: true } }));
    }
    // V3.28 — post-login cloud fetch diagnostics: surface a blocked/empty fetch
    // instead of silently rendering an empty dashboard (mismatched projectId or
    // Firestore Security Rules). Only fires when a real cloud session exists.
    if (window._authUser && fetchErrors.length > 0) {
      const detail = fetchErrors.map(e => e.key + ': ' + e.message).join(' ; ');
      console.error('[fetchAllFromFirestore] تعذر جلب بيانات السحابة - تحقق من إعدادات الربط وقواعد الأمان في Firebase. تفاصيل: ' + detail);
      if (window.showToast) {
        window.showToast('⚠️ تعذر جلب بيانات السحابة - تحقق من إعدادات الربط وقواعد الأمان في Firebase', 'error');
      }
    } else if (window._authUser && fetchErrors.length === 0 && fetchedCount === 0) {
      console.warn('[fetchAllFromFirestore] لم تُجلب أي بيانات من السحابة - تحقق من مطابقة إعدادات الربط لمشروعك في Firebase');
      if (window.showToast) {
        window.showToast('⚠️ لم تُجلب بيانات السحابة - تحقق من إعدادات الربط ومطابقة المشروع في Firebase', 'warning');
      }
    }
  });
}

// Auto-recover on reconnect & when the app returns to foreground
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('online', () => {
    if (!window._authUser) return;
    // V3.16.4 — recovery re-reconcile: connectivity is back, so re-run the
    // crash-safe snapshot reconcile + push (silently) instead of only once per
    // session.
    window._autoPushReported = false;
    window.flushPendingOps().finally(() => {
      window.fetchAllFromFirestore();
      if (window._authUser && !window._flushing) {
        window.forcePushPendingToCloud(null, { silent: true }).then(() => {
          if (window._authUser) window._autoPushReported = true;
        });
      }
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window._authUser) {
      window.flushPendingOps().finally(() => window.fetchAllFromFirestore());
    }
  });
}

// =====================================================================
// V3.16 — ACCOUNTING DATA NORMALIZATION
// ---------------------------------------------------------------------
// Cancelled (ملغي) and returned (مرتجع) orders are SETTLED invoices: their
// outstanding balance must always be 0 so they can never pollute the debt cards
// ("الديون والآجل لدى العملاء") or the "المتبقي" columns.
// =====================================================================
export function normalizeAccountingData() {
  const orders = window.firestoreCache[window.STORAGE_KEYS.ORDERS];
  if (!Array.isArray(orders)) return;
  let changed = false;
  orders.forEach(o => {
    if ((o.status === 'cancelled' || o.status === 'returned') && !(Number(o.remainingBalance) === 0)) {
      o.remainingBalance = 0;
      changed = true;
    }
  });
  if (changed && !window.isSandboxMode) {
    try {
      localStorage.setItem(`${storageKey('data_' + window.STORAGE_KEYS.ORDERS)}`, JSON.stringify(orders));
    } catch { /* ignore */ }
  }
}

export function getCollection(key) {
  if (window.isSandboxMode) {
    // Sandbox reads ONLY from the in-RAM view — never the real localStorage.
    return (window.firestoreCache && window.firestoreCache[key]) || [];
  }
  if (window.firestoreCache && window.firestoreCache[key] && window.firestoreCache[key].length > 0) {
    return window.firestoreCache[key];
  }
  const fallbackKey = `${storageKey('data_' + key)}`;
  try {
    const stored = JSON.parse(localStorage.getItem(fallbackKey)) || [];
    if (stored.length > 0 && window.firestoreCache) {
      window.firestoreCache[key] = stored;
    }
    if (key === window.STORAGE_KEYS.ORDERS) window.normalizeAccountingData();
    return stored;
  } catch {
    return window.firestoreCache[key] || [];
  }
}

export function saveCollection(key, data) {
  if (window.isSandboxMode) {
    window.firestoreCache[key] = data; // RAM view only
    return;
  }
  // V3.40 — GRANULAR UPDATES: diff each item against its previous local copy so
  // only the changed fields are written (set + merge). A stale whole-object
  // write would clobber fields another device changed in the meantime.
  const previous = window.firestoreCache[key] || [];
  window.firestoreCache[key] = data;
  localStorage.setItem(`${storageKey('data_' + key)}`, JSON.stringify(data));

  if (window.db) {
    data.forEach(item => {
      if (item.id) {
        const prior = previous.find(p => p.id === item.id) || null;
        const patch = prior ? _changedFields(prior, item) : item;
        if (patch === null) return; // nothing actually changed for this doc
        window.db.collection(key).doc(item.id).set(patch, { merge: true })
          .then(() => { window.firestoreLastSyncAt = getCairoFormattedDate(); window.firestoreLastSyncSource = 'saveCollection'; })
          .catch(err => {
            _recordWriteError('saveCollection ' + key, err);
            window.queueFirestoreOp({ kind: 'set', collection: key, docId: item.id, data: patch });
          });
      }
    });
  }
  _notifyDataSynced(key);
}

// V3.40 — Return an object containing ONLY the fields whose value changed
// between two versions of the same document, or null when nothing changed.
// Used by saveCollection so an update never pushes untouched/stale fields.
function _changedFields(prior, next) {
  const patch = {};
  let changed = false;
  const keys = Object.keys(next);
  keys.forEach(k => {
    if (JSON.stringify(prior[k]) !== JSON.stringify(next[k])) {
      patch[k] = next[k];
      changed = true;
    }
  });
  return changed ? patch : null;
}

// Best-effort hook for the Google Sheets sync module. Safe to call
// before/without the module loaded — it is a no-op then. V3.59: data-change
// events are queued (data_syncQueue) and scheduleSync flushes them to the
// Apps Script webhook in a debounced batch — never blocking this write path.
function _notifySheetsSync(evt) {
  if (window.isSandboxMode) return; // sandbox never triggers a Sheets sync
  if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.enqueueEvent === 'function') {
    try { window.GoogleSheetsSync.enqueueEvent(evt || { type: 'op' }); } catch { /* never break the write path */ }
    return;
  }
  if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.scheduleSync === 'function') {
    try { window.GoogleSheetsSync.scheduleSync(); } catch { /* never break the write path */ }
  }
}

// أخطر الواجهة الحية (مخازن الشاشات + لوحة الرصد) بأن كتابة محلية نجحت في ذات
// المجموعة — نفس حدث bms-data-synced الذي تطلقه لقطات Firestore، بحيث تتحدث
// الـ Stores تلقائياً بعد أي إضافة/تعديل/حذف دون إعادة تحميل يدوية للصفحة.
function _notifyDataSynced(key) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('bms-data-synced', { detail: { key, manual: false } }));
  } catch { /* never break the write path */ }
}

export function addFirestoreDoc(collectionKey, docData) {
  if (window.isSandboxMode) {
    if (!window.firestoreCache[collectionKey]) {
      window.firestoreCache[collectionKey] = [];
    }
    window.firestoreCache[collectionKey].unshift(docData);
    _notifyDataSynced(collectionKey);
    return docData;
  }
  if (!window.firestoreCache[collectionKey]) {
    window.firestoreCache[collectionKey] = [];
  }
  window.firestoreCache[collectionKey].unshift(docData);
  localStorage.setItem(`${storageKey('data_' + collectionKey)}`, JSON.stringify(window.firestoreCache[collectionKey]));
  _notifySheetsSync({ type: 'add', entityKey: collectionKey, entityId: docData.id });

  if (window.db && docData.id) {
    window.db.collection(collectionKey).doc(docData.id).set(docData)
      .then(() => { window.firestoreLastSyncAt = getCairoFormattedDate(); window.firestoreLastSyncSource = 'add'; })
      .catch(err => {
        _recordWriteError('add ' + collectionKey + '/' + docData.id, err);
        window.queueFirestoreOp({ kind: 'set', collection: collectionKey, docId: docData.id, data: docData });
      });
  } else if (docData.id) {
    window.queueFirestoreOp({ kind: 'set', collection: collectionKey, docId: docData.id, data: docData });
  }
  _notifyDataSynced(collectionKey);
  return docData;
}

// =============================================================================
// V3.57 — ATOMIC INCREMENT MARKER RESOLUTION (Finding B1)
// -----------------------------------------------------------------------------
// `increment(n)` (utils/formatters) produces `{ __inc: n }` markers for fields
// that must be changed ATOMICALLY on the server (stock). Every write path here
// resolves them:
//   - the LOCAL MIRROR always stores real numbers (current + n) exactly like the
//     legacy sync math, so UI reads never see a marker object;
//   - the CLOUD WRITE becomes FieldValue.increment(n) when the Firebase SDK is
//     present, otherwise the resolved numeric (merge semantics stay correct);
//   - QUEUED OFFLINE OPS are serialized with the resolved numeric so JSON
//     persistence and later flush never leak or freeze a marker.
// =============================================================================

// Numeric value (current cache value + inc) for a marker field.
function _resolvedNumericFromCache(collectionKey, docId, field, inc) {
  try {
    const list = window.firestoreCache && window.firestoreCache[collectionKey];
    const cur = Array.isArray(list) ? list.find(i => i && i.id === docId) : null;
    if (cur) return round2((Number(cur[field]) || 0) + inc);
  } catch { /* ignore */ }
  return inc;
}

// Resolve markers against the current cache doc → a numeric-only fields map.
function _resolveMarkerFields(collectionKey, docId, fields) {
  let current = {};
  try {
    const list = window.firestoreCache && window.firestoreCache[collectionKey];
    current = (Array.isArray(list) ? list.find(i => i && i.id === docId) : null) || {};
  } catch { /* ignore */ }
  return resolveIncrementFields(current, fields);
}

// For ops already applied to the local mirror by the withBatch wrapper, the
// mirror doc already holds the FINAL resolved values — read them back instead
// of re-resolving increment markers against the already-applied state (which
// would double-count). Marker fields missing from the mirror fall back to a
// fresh resolution so a raw marker never leaks into the offline queue.
function _appliedSafeFields(collectionKey, docId, fields) {
  const out = {};
  let current = {};
  try {
    const list = window.firestoreCache && window.firestoreCache[collectionKey];
    current = (Array.isArray(list) ? list.find(i => i && i.id === docId) : null) || {};
  } catch { /* ignore */ }
  for (const key in fields) {
    const curVal = current[key];
    if (curVal !== undefined) {
      out[key] = curVal;
    } else if (isIncrementField(fields[key])) {
      out[key] = resolveIncrementFields(current, { [key]: fields[key] })[key];
    } else {
      out[key] = fields[key];
    }
  }
  return out;
}

// Build the cloud-safe fields map: markers → FieldValue.increment (or numeric).
function _cloudFields(collectionKey, docId, fields) {
  let fv = null;
  try { fv = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue; } catch { fv = null; }
  const out = {};
  for (const key in fields) {
    const value = fields[key];
    if (isIncrementField(value)) {
      out[key] = (fv && typeof fv.increment === 'function')
        ? fv.increment(value.__inc)
        : _resolvedNumericFromCache(collectionKey, docId, key, value.__inc);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function updateFirestoreDoc(collectionKey, docId, updatedFields) {
  if (window.isSandboxMode) {
    if (window.firestoreCache[collectionKey]) {
      const idx = window.firestoreCache[collectionKey].findIndex(item => item.id === docId);
      if (idx !== -1) {
        window.firestoreCache[collectionKey][idx] = {
          ...window.firestoreCache[collectionKey][idx],
          ..._resolveMarkerFields(collectionKey, docId, updatedFields)
        };
        _notifyDataSynced(collectionKey);
      }
    }
    return;
  }
  if (window.firestoreCache[collectionKey]) {
    const idx = window.firestoreCache[collectionKey].findIndex(item => item.id === docId);
    if (idx !== -1) {
      window.firestoreCache[collectionKey][idx] = {
        ...window.firestoreCache[collectionKey][idx],
        ..._resolveMarkerFields(collectionKey, docId, updatedFields)
      };
      localStorage.setItem(`${storageKey('data_' + collectionKey)}`, JSON.stringify(window.firestoreCache[collectionKey]));
      _notifyDataSynced(collectionKey);
    }
  }
  _notifySheetsSync({ type: 'update', entityKey: collectionKey, entityId: docId });

  const cloudSafe = _cloudFields(collectionKey, docId, updatedFields);
  const queuedSafe = _resolveMarkerFields(collectionKey, docId, updatedFields);

  if (window.db && docId) {
    // Upsert (set + merge) instead of update(): a partial update can never fail
    // with "no document to update" if the doc was never created on Firestore.
    window.db.collection(collectionKey).doc(docId).set(cloudSafe, { merge: true })
      .then(() => { window.firestoreLastSyncAt = getCairoFormattedDate(); window.firestoreLastSyncSource = 'update'; })
      .catch(err => {
        _recordWriteError('update ' + collectionKey + '/' + docId, err);
        window.queueFirestoreOp({ kind: 'update', collection: collectionKey, docId, data: queuedSafe });
      });
  } else if (docId) {
    window.queueFirestoreOp({ kind: 'update', collection: collectionKey, docId, data: queuedSafe });
  }
}

// Remove a doc from the in-memory cache + localStorage (local mirror).
function _removeFromCache(collectionKey, docId) {
  if (!window.firestoreCache[collectionKey]) return;
  window.firestoreCache[collectionKey] = window.firestoreCache[collectionKey].filter(item => item.id !== docId);
  localStorage.setItem(`${storageKey('data_' + collectionKey)}`, JSON.stringify(window.firestoreCache[collectionKey]));
}

/**
 * Server-first deletion. The local UI state/cache is only updated AFTER the
 * cloud confirms the document was actually deleted (await on the server write).
 * If the server rejects the delete (e.g. permission denied / offline), an
 * explicit error toast is shown, the item is KEPT locally, and the delete is
 * queued + tombstoned so it lands when connectivity/rules allow.
 */
export async function deleteFirestoreDoc(collectionKey, docId) {
  if (window.isSandboxMode) {
    if (window.firestoreCache[collectionKey]) {
      window.firestoreCache[collectionKey] = window.firestoreCache[collectionKey].filter(item => item.id !== docId);
      _notifyDataSynced(collectionKey);
    }
    return true; // RAM view only — no tombstones, no queue, no server delete
  }
  if (!docId) return false;

  // 🔒 Wait for the auth gate so a server delete never races an in-flight
  //     onAuthStateChanged restore (offline/blocked sign-in times out fast).
  await waitForFirebaseAuth();

  if (window.db) {
    try {
      await window.db.collection(collectionKey).doc(docId).delete();
      // ✅ Server confirmed the deletion — now update the local mirror.
      _removeFromCache(collectionKey, docId);
      window.firestoreLastSyncAt = getCairoFormattedDate();
      window.firestoreLastSyncSource = 'delete';
      _notifySheetsSync({ type: 'delete', entityKey: collectionKey, entityId: docId });
      _notifyDataSynced(collectionKey);
      return true;
    } catch (err) {
      // ❌ Server rejected / unreachable: surface it, keep the item locally.
      _recordWriteError('delete ' + collectionKey + '/' + docId, err, { noEvent: true });
      if (window.showToast) {
        window.showToast(
          '⚠️ تعذر حذف العنصر من السحابة: ' + (err && err.message ? err.message : 'خطأ غير معروف'),
          'error'
        );
      }
      _addTombstone(docId);
      window.queueFirestoreOp({ kind: 'delete', collection: collectionKey, docId });
      return false;
    }
  }

  // Local-only mode (no Firestore SDK): apply the deletion locally and queue it
  // so it reaches the cloud as soon as a connection becomes available.
  _removeFromCache(collectionKey, docId);
  _addTombstone(docId);
  window.queueFirestoreOp({ kind: 'delete', collection: collectionKey, docId });
  _notifySheetsSync({ type: 'delete', entityKey: collectionKey, entityId: docId });
  _notifyDataSynced(collectionKey);
  return true;
}


// =====================================================================
// FIRESTORE ATOMIC WRITE BATCHES (Finding B1)
// ---------------------------------------------------------------------
// Provides transactional safety across multi-document operations (Order
// creation, Stock decrement, Customer balance recalculation, Treasury
// payments). Falls back to in-memory/queued execution when offline or in tests.
// =====================================================================
export class WriteBatch {
  constructor() {
    this.ops = [];
  }

  add(collectionKey, docData) {
    if (docData && docData.id) {
      this.ops.push({ type: 'add', collectionKey, docId: docData.id, data: docData });
    }
    return this;
  }

  update(collectionKey, docId, updatedFields) {
    if (docId) {
      this.ops.push({ type: 'update', collectionKey, docId, data: updatedFields });
    }
    return this;
  }

  delete(collectionKey, docId) {
    if (docId) {
      this.ops.push({ type: 'delete', collectionKey, docId });
    }
    return this;
  }

  async commit() {
    return runAtomicBatch(this.ops);
  }
}

export function createWriteBatch() {
  return new WriteBatch();
}

export async function runAtomicBatch(operations) {
  const ops = Array.isArray(operations) ? operations : (operations && operations.ops ? operations.ops : []);
  if (!ops.length) return Promise.resolve(true);

  const touchedKeys = new Set();

  // 1. Synchronously update RAM firestoreCache & localStorage
  ops.forEach(op => {
    const { type, collectionKey, docId, data } = op;
    touchedKeys.add(collectionKey);

    if (window.isSandboxMode) {
      if (!window.firestoreCache[collectionKey]) window.firestoreCache[collectionKey] = [];
      if (type === 'add') {
        window.firestoreCache[collectionKey].unshift(data);
      } else if (type === 'update') {
        const idx = window.firestoreCache[collectionKey].findIndex(i => i && i.id === docId);
        if (idx !== -1 && !op._localApplied) {
          window.firestoreCache[collectionKey][idx] = {
            ...window.firestoreCache[collectionKey][idx],
            ..._resolveMarkerFields(collectionKey, docId, data)
          };
        }
      } else if (type === 'delete') {
        window.firestoreCache[collectionKey] = window.firestoreCache[collectionKey].filter(i => i && i.id !== docId);
      }
      return;
    }

    if (!window.firestoreCache[collectionKey]) window.firestoreCache[collectionKey] = [];

    if (type === 'add') {
      const existingIdx = window.firestoreCache[collectionKey].findIndex(i => i && i.id === docId);
      if (existingIdx !== -1) {
        window.firestoreCache[collectionKey][existingIdx] = data;
      } else {
        window.firestoreCache[collectionKey].unshift(data);
      }
    } else if (type === 'update') {
      const idx = window.firestoreCache[collectionKey].findIndex(i => i && i.id === docId);
      if (idx !== -1 && !op._localApplied) {
        window.firestoreCache[collectionKey][idx] = {
          ...window.firestoreCache[collectionKey][idx],
          ..._resolveMarkerFields(collectionKey, docId, data)
        };
      }
    } else if (type === 'delete') {
      window.firestoreCache[collectionKey] = window.firestoreCache[collectionKey].filter(i => i && i.id !== docId);
      _addTombstone(docId);
    }

    try {
      localStorage.setItem(storageKey('data_' + collectionKey), JSON.stringify(window.firestoreCache[collectionKey]));
    } catch { /* ignore quota/storage errors */ }
  });

  if (window.isSandboxMode) {
    touchedKeys.forEach(k => _notifyDataSynced(k));
    return true;
  }

  // 2. Commit atomically to Cloud Firestore via Firestore SDK WriteBatch
  if (window.db && typeof window.db.batch === 'function') {
    try {
      const fsBatch = window.db.batch();
      ops.forEach(op => {
        const { type, collectionKey, docId, data } = op;
        const docRef = window.db.collection(collectionKey).doc(docId);
        if (type === 'add') {
          fsBatch.set(docRef, data);
        } else if (type === 'update') {
          fsBatch.set(docRef, _cloudFields(collectionKey, docId, data), { merge: true });
        } else if (type === 'delete') {
          fsBatch.delete(docRef);
        }
      });
      await fsBatch.commit();
      window.firestoreLastSyncAt = getCairoFormattedDate();
      window.firestoreLastSyncSource = 'batch';
    } catch (err) {
      _recordWriteError('batch commit', err);
      // Queue operations for background retry
      ops.forEach(op => {
        if (op.docId) {
          window.queueFirestoreOp({
            kind: op.type === 'delete' ? 'delete' : (op.type === 'add' ? 'set' : 'update'),
            collection: op.collectionKey,
            docId: op.docId,
            data: op.type === 'update'
              ? (op._localApplied ? _appliedSafeFields(op.collectionKey, op.docId, op.data) : _resolveMarkerFields(op.collectionKey, op.docId, op.data))
              : op.data
          });
        }
      });
    }
  } else {
    // Local-only / unit-test fallback: queue operations
    ops.forEach(op => {
      if (op.docId) {
        window.queueFirestoreOp({
          kind: op.type === 'delete' ? 'delete' : (op.type === 'add' ? 'set' : 'update'),
          collection: op.collectionKey,
          docId: op.docId,
          data: op.type === 'update'
            ? (op._localApplied ? _appliedSafeFields(op.collectionKey, op.docId, op.data) : _resolveMarkerFields(op.collectionKey, op.docId, op.data))
            : op.data
        });
      }
    });
  }

  _notifySheetsSync({ type: 'batch', entityKey: Array.from(touchedKeys).join(','), entityId: '' });
  touchedKeys.forEach(k => _notifyDataSynced(k));
  return true;
}


/**
 * V3.19 — DEEP DATA RESET (Cloud + Local).
 * Full pipeline before the page auto-reloads with a clean state:
 *   1. Pause/unsubscribe Firestore listeners FIRST.
 *   2. Delete EVERY document in ALL collections using writeBatch() chunks.
 * 2.5 Re-seed the default seed admin (USR-1001) plus the currently logged-in
 *      admin's account so the owner can NEVER be locked out.
 *   3. Clear localStorage mirrors (bms_*), sessionStorage (auth session) and
 *      purge any local IndexedDB databases.
 *   3.5 V3.40 — PRESERVE the app config: the Firebase project config
 *      (bms_firebase_config), the AI provider config (bms_ai_config) and the
 *      storage-version marker (bms_storage_version, so migrateStorageVersion
 *      does not wipe the preserved config on reload).
 *      V3.59 — the Google Sheets WEBHOOK link config is NO LONGER preserved:
 *      a wipe resets it so no live webhook survives a full reset.
 *   4. Auto-reload so every module re-initializes from an empty, consistent state.
 */
const WIPE_PRESERVED_KEYS = [
  storageKey('storage_version'),  // keep the migration marker → no cache wipe on reload
  storageKey('firebase_config'),  // Firebase project config (firebaseLoader)
  storageKey('ai_config'),        // AI provider config (aiProvider.js)
  storageKey('data_syncLog'),     // Sheets sync log
  storageKey('data_syncAudit')    // Sheets sync audit trail
];
export function isUsingFallbackConfig() {
  if (typeof window === 'undefined') return false;
  if (CLIENT.firebaseIsClientProject) return false;
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey('firebase_config')) || 'null');
    return !saved || !saved.apiKey || saved.apiKey === FALLBACK_FIREBASE_CONFIG.apiKey;
  } catch {
    return true;
  }
}

export async function forceWipeDatabase(providedAdminPassword = '') {
  if (window.isSandboxMode) {
    if (window.showToast) window.showToast('⚠️ وضع الاختبار نشط — لا يمكن تصفير البيانات قبل الخروج من وضع الاختبار', 'error');
    return false;
  }

  const isVerified = window.verifyAdminPassword ? await window.verifyAdminPassword(providedAdminPassword) : false;
  if (!isVerified) {
    if (window.adminPasswordConfigured && window.adminPasswordConfigured()) {
      window.showToast('كلمة المرور غير صحيحة! تم حظر وإيقاف عملية تصفير البيانات 🛑', 'error');
    } else {
      window.showToast('لا توجد كلمة سر مسجلة للمدير — سجّلها أولاً من (القائمة ▾ ← تغيير كلمة السر) ثم أعد المحاولة', 'error');
    }
    return false;
  }

  // Finding C2: Real Server Re-authentication Gate
  if (typeof window.reauthenticateCurrentUser === 'function') {
    try {
      await window.reauthenticateCurrentUser(providedAdminPassword);
    } catch (reauthErr) {
      const msg = (reauthErr && reauthErr.message) ? reauthErr.message : 'فشل التحقق من هوية المستخدم لدى الخادم';
      if (window.showToast) window.showToast('🛑 حظر عملية المسح: ' + msg, 'error');
      return false;
    }
  }

  if (window.showToast) window.showToast('جارٍ مسح القواعد السحابية والمحلية نهائياً…', 'warning');


  // 1. Pause realtime listeners first — no cascading snapshot/permission errors.
  //    Also clears the auth gate so nothing auto-restarts mid-wipe.
  window.stopFirestoreSync();

  // 🔒 OWNER LOCKOUT PROTECTION: capture the currently logged-in admin's FULL
  //    account record BEFORE the wipe so it can be re-seeded in step 2.5.
  let currentUserDoc = null;
  try {
    const current = window.getCurrentUser();
    if (current && current.email) {
      const allUsers = window.getUsers();
      const norm = function (v) { return ((v || '') + '').trim().toLowerCase(); };
      currentUserDoc = allUsers.find(u => norm(u.email) === norm(current.email)) || null;
    }
  } catch { /* ignore */ }

  // 2. Deep cloud cleanup via writeBatch() across ALL collections. The list is
  //    canonical (independent of script load order): every data collection plus
  //    'expenses' and 'sync_logs' even if their modules are not loaded yet.
  // 🔒 V3.58 — Access-control collections are NEVER business data: staff/{uid}
  //    (activation records) and settings (including the one-shot
  //    staffBootstrapDone marker) must survive a wipe, otherwise the bootstrap
  //    gate could re-open and other admins could lose access. Guarded explicitly
  //    here so future edits to syncCollections() cannot silently pull them in.
  const WIPE_SKIP = ['staff', 'settings'];
  const allKeys = syncCollections();
  ['expenses', 'sync_logs'].forEach(k => { if (allKeys.indexOf(k) === -1) allKeys.push(k); });

  if (window.db) {
    const BATCH_LIMIT = 450; // writeBatch hard limit is 500 operations
    for (const key of allKeys) {
      if (WIPE_SKIP.indexOf(key) !== -1) continue;
      try {
        const snap = await window.db.collection(key).get();
        const docIds = [];
        snap.forEach(doc => {
          if (key === 'settings' && doc.id === 'staffBootstrapDone') return;
          docIds.push(doc.id);
        });
        for (let i = 0; i < docIds.length; i += BATCH_LIMIT) {
          const chunk = docIds.slice(i, i + BATCH_LIMIT);
          const batch = window.db.batch();
          chunk.forEach(id => batch.delete(window.db.collection(key).doc(id)));
          await batch.commit();
        }
      } catch (err) {
        // A collection may not exist yet — that is fine, keep wiping the rest.
        if (window.console && console.warn) {
          console.warn('Wipe [' + key + ']:', err && err.message ? err.message : err);
        }
      }
    }

    // 2.5 🔒 RE-SEED ADMIN ACCOUNTS after the wipe. Business data stays fully
    //     wiped — only access accounts are restored so the owner can always get
    //     back in after the auto-reload.
    //     V3.20 — PASSWORD PRESERVATION: when the logged-in admin IS USR-1001,
    //     the wipe must NOT drop the stored password.
    const usersCol = window.db.collection(window.STORAGE_KEYS.USER);
    const seedAdmin = { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin', createdAt: '2026-07-01T10:00:00Z' };
    if (currentUserDoc && currentUserDoc.id === 'USR-1001') {
      // V3.57 — preserve the PBKDF2 credential fields + uid only; never the
      // plaintext password (a wiped DB must never reintroduce a text password).
      if (currentUserDoc.passwordHash && currentUserDoc.passwordSalt) {
        seedAdmin.passwordHash = currentUserDoc.passwordHash;
        seedAdmin.passwordSalt = currentUserDoc.passwordSalt;
      }
      if (currentUserDoc.uid) seedAdmin.uid = currentUserDoc.uid;
    }
    const toReSeed = [seedAdmin];
    if (currentUserDoc && currentUserDoc.id !== 'USR-1001') toReSeed.push(currentUserDoc);
    for (const doc of toReSeed) {
      try {
        await usersCol.doc(doc.id).set(doc);
      } catch (err) {
        if (window.console && console.warn) {
          console.warn('Wipe re-seed admin [' + doc.id + ']:', err && err.message ? err.message : err);
        }
      }
    }
  }

  // 3. Clear every local mirror (bms_*), the auth session, and IndexedDB —
  //    EXCEPT the preserved cloud-link keys (V3.40, see WIPE_PRESERVED_KEYS).
  Object.keys(window.firestoreCache).forEach(k => { window.firestoreCache[k] = []; });
  try {
    Object.keys(localStorage).forEach(k => {
      if (isOwnKey(k) && WIPE_PRESERVED_KEYS.indexOf(k) === -1) localStorage.removeItem(k);
    });
  } catch { /* ignore */ }

  // 🔒 V3.59 — the webhook link config (data_syncConfig) is NOT preserved by a
  //     wipe: it is wiped with the business data so a full reset never leaves a
  //     live webhook pointed at a freshly-cleared database. (No Google secrets
  //     existed in it anymore — the OAuth-era fields are gone entirely.)

  // 🔒 V3.20 — LOCAL-ONLY MODE LOCKOUT PROTECTION: without Firestore there is
  //     no cloud re-seed to fall back on, so the users mirror (just wiped above)
  //     must be restored with the preserved admin account(s) — INCLUDING the
  //     password field — before the auto-reload.
  const localSeed = { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin', createdAt: '2026-07-01T10:00:00Z' };
  if (currentUserDoc && currentUserDoc.id === 'USR-1001') {
    // V3.57 — preserve PBKDF2 credentials + uid (never plaintext password).
    if (currentUserDoc.passwordHash && currentUserDoc.passwordSalt) {
      localSeed.passwordHash = currentUserDoc.passwordHash;
      localSeed.passwordSalt = currentUserDoc.passwordSalt;
    }
    if (currentUserDoc.uid) localSeed.uid = currentUserDoc.uid;
  }
  const localSeeds = [localSeed];
  if (currentUserDoc && currentUserDoc.id !== 'USR-1001') localSeeds.push(currentUserDoc);
  try {
    window.firestoreCache[window.STORAGE_KEYS.USER] = localSeeds;
    localStorage.setItem(storageKey('data_' + window.STORAGE_KEYS.USER), JSON.stringify(localSeeds));
  } catch { /* ignore */ }

  try { sessionStorage.clear(); } catch { /* ignore */ }
  try {
    if (typeof window !== 'undefined' && window.indexedDB && typeof window.indexedDB.databases === 'function') {
      window.indexedDB.databases().then(dbs => {
        (dbs || []).forEach(db => {
          if (db && db.name) window.indexedDB.deleteDatabase(db.name);
        });
      }).catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }

  window._firestoreWriteFailures = 0;
  window.firestoreSyncErrors = [];
  window.firestoreLastSyncAt = null;

  if (window.showToast) window.showToast('تم مسح وتصفير القواعد السحابية والمحلية بنجاح (تم الإبقاء على حسابات المديرين فقط) — سيتم إعادة التحميل تلقائياً 🧹', 'success');
  setTimeout(function () { if (window.location && window.location.reload) window.location.reload(); }, 800);
  return true;
}

// =====================================================================
// V3.60 — FULL JSON BACKUP / RESTORE
// ---------------------------------------------------------------------
// The CSV/Excel path covers only the 8 system tables and re-derives fields
// (restored users get a default password, protected/computed columns are
// skipped). This export dumps EVERY synced collection as-is (byte-for-byte,
// incl. stored password hashes — never plaintext) into a single JSON file;
// import replaces those collections wholesale. staff/settings (access-control,
// not business data) are deliberately excluded — same guard as the wipe.
// =====================================================================
const FULL_BACKUP_VERSION = 1;

export function exportFullBackup() {
  const collections = {};
  syncCollections().forEach(function (key) {
    collections[key] = JSON.parse(JSON.stringify(getCollection(key) || []));
  });
  return {
    app: 'bms',
    type: 'full-backup',
    version: FULL_BACKUP_VERSION,
    exportedAt: getCairoFormattedDate(),
    collections,
  };
}

export function importFullBackup(backup) {
  if (window.isSandboxMode) throw new Error('وضع الاختبار نشط — استعادة النسخة الاحتياطية محظورة');
  if (!backup || typeof backup !== 'object' || !backup.collections || typeof backup.collections !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح (يُتوقع JSON صادر من «تصدير نسخة كاملة»)');
  }
  const allowed = syncCollections();
  const report = { collections: 0, records: 0, skipped: [] };
  Object.keys(backup.collections).forEach(function (key) {
    if (allowed.indexOf(key) === -1) {
      report.skipped.push(key);
      return;
    }
    const docs = Array.isArray(backup.collections[key]) ? backup.collections[key] : [];
    saveCollection(key, JSON.parse(JSON.stringify(docs)));
    report.collections += 1;
    report.records += docs.length;
  });
  // Best-effort: flush the restored snapshot to the webhook mirror too.
  if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.scheduleSync === 'function') {
    try { window.GoogleSheetsSync.scheduleSync(); } catch { /* never break the restore */ }
  }
  return report;
}

// Wire the full service onto window — identical surface to the legacy global
// script. Importing this module (via the compat bridge) is the only step the
// harnesses need to get the ported storage layer.
if (typeof window !== 'undefined') {
  window.getCollection = getCollection;
  window.saveCollection = saveCollection;
  window.addFirestoreDoc = addFirestoreDoc;
  window.updateFirestoreDoc = updateFirestoreDoc;
  window.deleteFirestoreDoc = deleteFirestoreDoc;
  window.normalizeAccountingData = normalizeAccountingData;
  window.initDB = initDB;
  window.startFirestoreSync = startFirestoreSync;
  window.stopFirestoreSync = stopFirestoreSync;
  window.fetchAllFromFirestore = fetchAllFromFirestore;
  // Alias requested by the cloud-init spec: pullFromFirebase() == a forced full
  // pull from Firestore. Same auth gate as fetchAllFromFirestore(true) — it is
  // a no-op until onAuthStateChanged confirms a real user.
  window.pullFromFirebase = function () { return fetchAllFromFirestore(true); };
  window.waitForFirebaseAuth = waitForFirebaseAuth;
  window.forceWipeDatabase = forceWipeDatabase;
  window.forcePushPendingToCloud = forcePushPendingToCloud;
  window.exportFullBackup = exportFullBackup;
  window.importFullBackup = importFullBackup;
  window.getPendingLocalRecords = getPendingLocalRecords;
  window.pendingOpsQueue = pendingOpsQueue;
  window.queueFirestoreOp = queueFirestoreOp;
  window.flushPendingOps = flushPendingOps;
  window.getTombstones = getTombstones;
  window.getFirestoreStatus = getFirestoreStatus;
  window.migrateStorageVersion = migrateStorageVersion;
  window.STORAGE_VERSION = STORAGE_VERSION;
  window.enterSandboxMode = enterSandboxMode;
  window.exitSandboxMode = exitSandboxMode;
  window.setSandboxMode = setSandboxMode;
  window.isSandboxActive = isSandboxActive;
  window.createWriteBatch = createWriteBatch;
  window.runAtomicBatch = runAtomicBatch;
  window.WriteBatch = WriteBatch;
  window.queryFirestoreCollection = queryFirestoreCollection;
}


