import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { login, getCurrentUser } from '@/services/auth'

// V3.45.1 — الشفاء الذاتي لبوابة التفعيل staff/{uid} عند الدخول.
// السيناريو المحوري: حساب مدير مسجّل في `users` لكن وثيقة تفعيله staff/{uid}
// مفقودة في Firestore (مشروع جديد أو انقطاع إنشاء) → يُعاد إنشاؤها تلقائياً
// وتُفعَّل الجلسة دون رسالة الرفض.

const USERS = [
  { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', password: 'admin123', role: 'admin', uid: 'ADMIN-UID' },
  { id: 'USR-2002', name: 'كاشير', email: 'cashier@store.com', password: '123456', role: 'employee', uid: 'CASH-UID' },
]

let staffMap
let onlineFlag = true

// محاكاة firestore.rules V3.45.1: الكتابة على staff/{uid} تنجح فقط لأول مدير
// (بوتستراب على مجموعة فارغة)؛ أي كتابة أخرى تُرفض كأن القواعد رفضتها.
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

function installEnv({ staffSeed = {}, authUser } = {}) {
  staffMap = new Map(Object.entries(staffSeed))
  const actor = authUser || { uid: 'ADMIN-UID', email: 'admin@store.com' }
  window.getUsers = () => USERS.map(u => ({ ...u }))
  window.auth = {
    currentUser: null,
    signInWithEmailAndPassword: vi.fn(async () => ({ user: actor })),
  }
  window._authUser = actor
  window.waitForFirebaseAuth = vi.fn(async () => {})
  window.startFirestoreSync = vi.fn(() => {})
  window.fetchAllFromFirestore = vi.fn(async () => {})
  window.db = fakeDb()
  window.firestoreCache = undefined
  sessionStorage.clear()
}

beforeEach(() => {
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
  sessionStorage.clear()
  onlineFlag = true
})

describe('services/auth — self-healing of staff/{uid} on login (V3.45.1)', () => {
  it('admin موجود في users لكنه مفقود في staff → تُنشأ الوثيقة تلقائياً وتُفعَّل الجلسة', async () => {
    // staff مجموعة فارغة تماماً — سيناريو المشروع الجديد
    const session = await login('admin@store.com', 'admin123')

    expect(session).toMatchObject({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' })

    // الوثيقة أُنشئت تلقائياً بمواصفات الطلب
    const staffDoc = staffMap.get('ADMIN-UID')
    expect(staffDoc).toBeTruthy()
    expect(staffDoc.role).toBe('admin')
    expect(staffDoc.active).toBe(true)
    expect(staffDoc.userId).toBe('USR-1001')
    expect(staffDoc.email).toBe('admin@store.com')
    expect(staffDoc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // الجلسة نشطة بدون رسالة الرفض
    expect(getCurrentUser()).toMatchObject({ email: 'admin@store.com', role: 'admin' })
  })

  it('مجموعة staff غير موجودة أصلاً → بوتستراب المدير الأول يكتمل ونُفعَّل الجلسة', async () => {
    const session = await login('admin@store.com', 'admin123')
    expect(session.role).toBe('admin')
    expect(staffMap.get('ADMIN-UID')).toMatchObject({ role: 'admin', active: true })
    expect(getCurrentUser()).not.toBeNull()
  })

  it('مدير مفقود في staff بينما المجموعة غير فارغة → تُكتمل الجلسة دون رفض (ولا يُكتب سجل)', async () => {
    // موظف آخر مفعّل موجود → group ليست فارغة، فترفض القواعد الكتابة الذاتية
    installEnv({ staffSeed: { 'OTHER-UID': { email: 'other@store.com', role: 'employee', userId: 'USR-3003' } } })

    const session = await login('admin@store.com', 'admin123')
    expect(session).toMatchObject({ role: 'admin' })
    expect(staffMap.has('ADMIN-UID')).toBe(false)
    expect(getCurrentUser()).toMatchObject({ email: 'admin@store.com', role: 'admin' })
  })

  it('حساب غير مدير بدون تفعيل ومجموعة staff غير فارغة → يبقى الرفض كالسابق', async () => {
    installEnv({
      staffSeed: { 'OTHER-UID': { email: 'other@store.com', role: 'employee', userId: 'USR-3003' } },
      authUser: { uid: 'CASH-UID', email: 'cashier@store.com' },
    })

    await expect(login('cashier@store.com', '123456')).rejects.toThrow(
      /غير مُفعَّل في نظام هذا المتجر/
    )
    expect(staffMap.has('CASH-UID')).toBe(false)
    expect(getCurrentUser()).toBeNull()
  })

  it('وضع الأوفلاين: اعتماد users المحلي يُنشئ جلسة أدمين مفعّلة دون فحص السحابة', async () => {
    onlineFlag = false
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    // لا يوجد db سحابي ولا staff — الدخول المحلي يجب أن يكتمل
    delete window.db
    window.auth.signInWithEmailAndPassword = vi.fn(async () => { throw new Error('offline') })

    const session = await login('admin@store.com', 'admin123')
    expect(session).toMatchObject({ role: 'admin' })
    expect(getCurrentUser()).toMatchObject({ email: 'admin@store.com', role: 'admin' })
  })
})
