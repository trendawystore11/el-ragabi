import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { login, getCurrentUser, generateSalt, hashPassword } from '@/services/auth'

// V3.55 — مرونة الدخول أمام أخطاء الشبكة + كاش الحساب المحلي.
// 1) خطأ auth/network-request-failed (شبكة معطّلة) لا يعطّل إقلاع التطبيق:
//    تُصرف جلسة محلية صارمة بدل إشعار «فشل تسجيل الدخول إلى السحابة».
// 2) كاش user_cache يمكّن مطابقة الحساب والتحقق من كلمة السر قبل اكتمال
//    مزامنة السحابة على متصفح جديد، ويُكتب معقّماً (بلا كلمة سر صريحة).

const USERS = [
  { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', password: 'admin123', role: 'admin', uid: 'ADMIN-UID' },
  { id: 'USR-2002', name: 'كاشير', email: 'cashier@store.com', password: '123456', role: 'employee', uid: 'CASH-UID' },
]

const CACHE_KEY = 'bms_trendawy_user_cache'

let staffMap
let signInImpl
let authUser

function fakeDb() {
  return {
    collection(name) {
      if (name !== 'staff') throw new Error('unexpected collection ' + name)
      return {
        doc(uid) {
          return {
            async get() {
              const doc = staffMap.get(uid)
              return doc ? { exists: true, data: () => ({ ...doc }) } : { exists: false, data: () => ({}) }
            },
            async set(data) {
              const staffEmpty = staffMap.size === 0
              const allowed = data && data.role === 'admin' && staffEmpty
              if (!allowed) throw new Error('permission-denied (rules)')
              staffMap.set(uid, { ...data })
            },
            async delete() {
              staffMap.delete(uid)
            },
          }
        },
      }
    },
  }
}

function installEnv({ users = USERS, cloudDb = true } = {}) {
  staffMap = new Map()
  signInImpl = null
  authUser = { uid: 'ADMIN-UID', email: 'admin@store.com' }
  window.getUsers = () => users.map(u => ({ ...u }))
  window.auth = {
    currentUser: null,
    signInWithEmailAndPassword: vi.fn(async () => {
      if (signInImpl) throw signInImpl
      return { user: authUser }
    }),
  }
  window._authUser = authUser
  window.waitForFirebaseAuth = vi.fn(async () => {})
  window.startFirestoreSync = vi.fn(() => {})
  window.fetchAllFromFirestore = vi.fn(async () => {})
  if (cloudDb) window.db = fakeDb()
  else delete window.db
  window.firestoreCache = undefined
  sessionStorage.clear()
}

beforeEach(() => {
  localStorage.removeItem(CACHE_KEY)
  installEnv()
})

afterEach(() => {
  delete window.getUsers
  delete window.auth
  delete window._authUser
  delete window.waitForFirebaseAuth
  delete window.startFirestoreSync
  delete window.fetchAllFromFirestore
  delete window.db
  delete window.firestoreCache
  delete window.__bmsFirestoreTimeoutMs
  sessionStorage.clear()
  localStorage.removeItem(CACHE_KEY)
})

describe('services/auth — network-error fallback (V3.55)', () => {
  it('خطأ auth/network-request-failed مع مستخدم محلي صالح (online) → جلسة تُصرف دون فشل سحابة', async () => {
    signInImpl = { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' }

    const session = await login('admin@store.com', 'admin123')

    expect(session).toMatchObject({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' })
    expect(getCurrentUser()).toMatchObject({ email: 'admin@store.com', role: 'admin' })
    // لا يُسحب السحابة عند تعطّل الشبكة (لا تباطؤ إقلاع بانتظار مهلات)
    expect(window.startFirestoreSync).not.toHaveBeenCalled()
  })

  it('خطأ شبكة عابر برسالة إنجليزية شائعة → نفس المسار المحلي الآمن', async () => {
    signInImpl = new Error('Failed to fetch')

    const session = await login('admin@store.com', 'admin123')
    expect(session.role).toBe('admin')
  })

  it('خطأ غير شبكة (اعتماد خاطئ) مع online → يبقى فشل السحابة الصريح', async () => {
    signInImpl = { code: 'auth/invalid-credential', message: 'Firebase: Error (auth/invalid-credential).' }

    // كلمة السر محلية صحيحة، لكن السحابة رفضت الاعتماد → فشل سحابة صريح
    await expect(login('admin@store.com', 'admin123')).rejects.toThrow(/فشل تسجيل الدخول إلى السحابة/)
    expect(getCurrentUser()).toBeNull()
  })
})

describe('services/auth — local account cache (V3.55)', () => {
  it('حساب في الكاش فقط (متصفح جديد، شبكة معطّلة) → تُصرف الجلسة منه بنفس الدور', async () => {
    const salt = await generateSalt()
    const hash = await hashPassword('123456', salt)
    localStorage.setItem(CACHE_KEY, JSON.stringify([
      { id: 'USR-2002', name: 'كاشير', email: 'cashier@store.com', role: 'employee', uid: 'CASH-UID', passwordHash: hash, passwordSalt: salt },
    ]))
    // لا يوجد سوى البذرة المحلية (المدير) — الكاش هو مصدر موظف الكاشير فقط
    installEnv({ users: [] })
    signInImpl = { code: 'auth/network-request-failed', message: 'Network Error' }

    const session = await login('cashier@store.com', '123456')

    expect(session).toMatchObject({ email: 'cashier@store.com', role: 'employee' })
    expect(getCurrentUser()).toMatchObject({ email: 'cashier@store.com', role: 'employee' })
  })

  it('دخول ناجح يكتب الكاش معقّماً: بلا كلمة سر صريحة ومع تجزئة الحساب', async () => {
    const salt = await generateSalt()
    const hash = await hashPassword('admin123', salt)
    installEnv({ users: [
      { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', passwordHash: hash, passwordSalt: salt, role: 'admin', uid: 'ADMIN-UID' },
    ] })

    await login('admin@store.com', 'admin123')

    const cache = JSON.parse(localStorage.getItem(CACHE_KEY))
    expect(Array.isArray(cache)).toBe(true)
    const admin = cache.find(u => u.email === 'admin@store.com')
    expect(admin).toBeTruthy()
    expect(admin.passwordHash).toBe(hash)
    expect(admin.passwordSalt).toBe(salt)
    // 🔒 لا تُخزَّن كلمة السر الصريحة في الكاش إطلاقاً
    cache.forEach(u => expect(u.password).toBeUndefined())
  })
})

describe('services/auth — Firestore read watchdog (V3.59)', () => {
  it('قراءات Firestore معلّقة بلا نهاية لا تعلق الدخول — يُكمل بالبيانات المحلية', async () => {
    // يحاكي السيناريو الحقيقي: Auth REST يستجيب فوراً بينما firestore.googleapis.com
    // بطيئة/محجوبة → .get() لا يستقر إطلاقاً ولا يرفض. قبل V3.59 كان الدخول «يقعد
    // يحمل» بلا نهاية لأن try/catch لا يلتقط وعداً معلّقاً للأبد.
    window.__bmsFirestoreTimeoutMs = 80
    window.db = {
      collection() {
        return {
          where() { return this },
          limit() { return this },
          get() { return new Promise(() => {}) },
        }
      },
    }
    window.fetchAllFromFirestore = () => new Promise(() => {})

    const session = await login('admin@store.com', 'admin123')

    // الجلسة تُصرف من المصدر المحلي رغم تعطل القراءات السحابية
    expect(session).toMatchObject({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' })
    expect(getCurrentUser()).toMatchObject({ email: 'admin@store.com', role: 'admin' })
  })

  it('رفض قراءة مستند المستخدم (قواعد/شبكة) لا يُفعّل قفل الحذف السحابي خطأً', async () => {
    window.__bmsFirestoreTimeoutMs = 80
    window.db = {
      collection() {
        return {
          where() { return this },
          limit() { return this },
          get() { return Promise.reject(new Error('permission-denied (rules)')) },
        }
      },
    }
    window.fetchAllFromFirestore = () => Promise.resolve()

    const session = await login('admin@store.com', 'admin123')

    expect(session.role).toBe('admin')
  })
})
