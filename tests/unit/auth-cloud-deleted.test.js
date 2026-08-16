import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { login, getCurrentUser, generateSalt, hashPassword } from '@/services/auth'

// V3.58 — LOCKOUT ON CLOUD-DELETED ACCOUNTS (#8).
// بعد تقييد قراءة جدول users، يصبح الاستعلام المستهدف (uid/email) هو الدليل
// على وجود الحساب في السحابة:
//   - استعلام ناجح لكنه فارغ + بوتستراف مكتمل (المفتاح موجود) → الحساب حُذف
//     من السحابة → لا جلسة من كاش محلي عتيق، الدخول مرفوض.
//   - خطأ استعلام (رفض قواعد/شبكة) ليس دليلاً على الحذف → تُصرف الجلسة من
//     المصدر المحلي (لا قفل على دخول لا نستطيع التأكد منه).
//   - قاعدة سحابية جديدة (بلا مفتاح بوتستراف) + استعلام فارغ → مسموح ببوتستراف
//     المدير الأول.

const ADMIN = [
  { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', password: 'admin123', role: 'admin' },
]
const CACHE_KEY = 'bms_trendawy_user_cache'

let staffMap
let markerFlag
let usersQuery

// محاكاة firestore.rules V3.58: استعلام users قابل للتحكم (موجود/فارغ/رفض)،
// مفتاح البوتستراف مقروء، وسجل staff قابل للشفاء لأول مدير على مجموعة فارغة.
function fakeDb() {
  const users = new Map(ADMIN.map(u => [u.id, { ...u }]))
  users.get('USR-1001').uid = 'ADMIN-UID'

  return {
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              limit() {
                return {
                  async get() {
                    if (usersQuery === 'throw') throw new Error('permission-denied (rules)')
                    if (usersQuery === 'found') {
                      const doc = {
                        id: 'USR-1001',
                        data: () => ({ id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin', uid: 'ADMIN-UID' }),
                      }
                      return { empty: false, docs: [doc] }
                    }
                    return { empty: true, docs: [] }
                  },
                }
              },
            }
          },
          doc(id) {
            return {
              async get() {
                const d = users.get(id)
                return d ? { exists: true, data: () => ({ ...d }) } : { exists: false, data: () => ({}) }
              },
              async set(data) { users.set(id, { ...data }) },
            }
          },
        }
      }
      if (name === 'settings') {
        return {
          doc(id) {
            if (id === 'staffBootstrapDone') {
              return {
                async get() {
                  return markerFlag ? { exists: true, data: () => ({ done: true }) } : { exists: false, data: () => ({}) }
                },
              }
            }
            return { async get() { return { exists: false, data: () => ({}) } } }
          },
        }
      }
      if (name === 'staff') {
        return {
          doc(uid) {
            return {
              async get() {
                const d = staffMap.get(uid)
                return d ? { exists: true, data: () => ({ ...d }) } : { exists: false, data: () => ({}) }
              },
              async set(data) {
                const staffEmpty = staffMap.size === 0
                const allowed = data && data.role === 'admin' && (staffEmpty || markerFlag)
                if (!allowed) throw new Error('permission-denied (rules)')
                staffMap.set(uid, { ...data })
              },
              async delete() { staffMap.delete(uid) },
            }
          },
        }
      }
      throw new Error('unexpected collection ' + name)
    },
  }
}

function installEnv({ users = ADMIN, query = 'empty', marker = false, authUser } = {}) {
  staffMap = new Map()
  markerFlag = marker
  usersQuery = query
  const actor = authUser || { uid: 'ADMIN-UID', email: 'admin@store.com' }
  window.getUsers = () => users.map(u => ({ ...u }))
  window.auth = {
    currentUser: null,
    signInWithEmailAndPassword: vi.fn(async () => ({ user: actor })),
  }
  window._authUser = actor
  window.waitForFirebaseAuth = vi.fn(async () => {})
  window.startFirestoreSync = vi.fn(() => {})
  window.fetchAllFromFirestore = vi.fn(async () => {})
  window.db = fakeDb()
  window.firestoreCache = {}
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
  sessionStorage.clear()
  localStorage.removeItem(CACHE_KEY)
})

describe('services/auth — cloud-deleted account lockout (V3.58)', () => {
  it('استعلام سحابي فارغ + بوتستراف مكتمل → يُرفض الدخول حتى مع وجود الحساب محلياً', async () => {
    installEnv({ query: 'empty', marker: true })

    await expect(login('admin@store.com', 'admin123')).rejects.toThrow(/غير موجود في النظام/)
    expect(getCurrentUser()).toBeNull()
    expect(sessionStorage.getItem('bms_trendawy_user_session')).toBeNull()
  })

  it('حساب في الكاش المحلي فقط وقد حُذف من السحابة → لا جلسة من كاش عتيق', async () => {
    const salt = await generateSalt()
    const hash = await hashPassword('123456', salt)
    localStorage.setItem(CACHE_KEY, JSON.stringify([
      { id: 'USR-2002', name: 'كاشير', email: 'cashier@store.com', role: 'employee', uid: 'CASH-UID', passwordHash: hash, passwordSalt: salt },
    ]))
    // القائمة الحية لا تضم الكاشير — مصدره الكاش المحلي فقط
    installEnv({ users: [], query: 'empty', marker: true, authUser: { uid: 'CASH-UID', email: 'cashier@store.com' } })

    await expect(login('cashier@store.com', '123456')).rejects.toThrow(/غير موجود في النظام/)
    expect(getCurrentUser()).toBeNull()
  })

  it('فشل استعلام السحابة (رفض قواعد/شبكة) ليس حذفاً → تُصرف الجلسة من المصدر المحلي', async () => {
    installEnv({ query: 'throw', marker: true })

    const session = await login('admin@store.com', 'admin123')
    expect(session).toMatchObject({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' })
    expect(getCurrentUser()).not.toBeNull()
  })

  it('قاعدة سحابية جديدة (بلا مفتاح بوتستراف) + استعلام فارغ → بوتستراف المدير الأول يكتمل', async () => {
    installEnv({ query: 'empty', marker: false })

    const session = await login('admin@store.com', 'admin123')
    expect(session).toMatchObject({ id: 'USR-1001', role: 'admin' })
    expect(staffMap.has('ADMIN-UID')).toBe(true)
    expect(getCurrentUser()).not.toBeNull()
  })

  it('مستند المستخدم موجود في السحابة (استعلام ناجح) → دخول عادي بلا قفل', async () => {
    installEnv({ query: 'found', marker: true })

    const session = await login('admin@store.com', 'admin123')
    expect(session).toMatchObject({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' })
    expect(getCurrentUser()).not.toBeNull()
  })
})
