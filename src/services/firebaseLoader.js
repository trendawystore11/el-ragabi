// =============================================================================
// services/firebaseLoader.js — تحميل Firebase SDK في تطبيق React
// -----------------------------------------------------------------------------
// النسخة القديمة كانت تحمّل نصوص firebase من index.html (CDN) عبر window.firebase.
// نسخة React تستورد حزمة firebase/compat مباشرة (app + auth + firestore) وتُثبّت
// نفس العاموديات التي ينتظرها النظام (window.firebase / window.db / window.auth)
// حتى تعمل المزامنة السحابية و Firebase Auth بنفس المنطق القديم تماماً.
//
// يجب أن يكون أول استيراد في main.jsx كي يُثبَّت window.firebase قبل تقييم
// db.js (الذي يهيئ window.db/window.auth عند وجود window.firebase).
//
// مصدر الإعداد: window.getFirebaseConfig (إن وُجد من legacy) ← ثم الإعداد
// المحفوظ في localStorage (bms_firebase_config — يُعدَّل من نافذة «إعدادات
// الربط والسحابة») ← ثم FALLBACK_FIREBASE_CONFIG الافتراضي.
//
// آمن تماماً: أي فشل (مشروع غير مفعّل / لا شبكة) يمر بصمت ويبقى التطبيق يعمل
// محلياً (localStorage) دون انقطاع.
// =============================================================================
import firebase from 'firebase/compat/app'
import 'firebase/compat/auth'
import 'firebase/compat/firestore'
import { FALLBACK_FIREBASE_CONFIG } from './db.js'
import { storageKey } from '../client/storage.js'

const FB_KEY = storageKey('firebase_config')

function resolveConfig() {
  if (typeof window === 'undefined') return FALLBACK_FIREBASE_CONFIG
  if (typeof window.getFirebaseConfig === 'function') {
    try {
      const legacy = window.getFirebaseConfig()
      if (legacy && legacy.apiKey) return legacy
    } catch {
      /* ignore corrupted legacy config */
    }
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(FB_KEY) || 'null')
    if (saved && saved.apiKey && saved.projectId && saved.authDomain) {
      return { ...FALLBACK_FIREBASE_CONFIG, ...saved }
    }
  } catch {
    /* ignore corrupted saved config */
  }
  return FALLBACK_FIREBASE_CONFIG
}

if (typeof window !== 'undefined' && typeof firebase !== 'undefined') {
  window.firebase = firebase
  // Firestore ثم Auth — كلٌّ في معزل حتى لا يعطّل فشل أحدهما الآخر.
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(resolveConfig())
    }
    window.db = firebase.firestore()
  } catch (initErr) {
    console.warn('Firebase Firestore Initialization Note:', initErr)
  }
  try {
    window.auth = firebase.auth()
  } catch (authErr) {
    console.warn('Firebase Auth Initialization Note:', authErr)
  }
}

export default firebase
