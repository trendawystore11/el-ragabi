import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { login, getCurrentUser } from '@/services/auth'

// V3.58 — إغلاق البوتستراف الدائم (one-shot):
// أول كتابة staff/{uid} تُنشئ معها مفتاح settings/staffBootstrapDone في نفس
// الدفعة الذرية (تحاكي القواعد الجديدة في firestore.rules). حتى لو أُفرغت
// مجموعة staff يدوياً بعد ذلك، تبقى البوابة مغلقة لأن المفتاح موجود.

const USERS = [
  { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', password: 'admin123', role: 'admin' },
  { id: 'USR-2002', name: 'كاشير', email: 'cashier@store.com', password: '123456', role: 'employee' },
]

let staffMap
let markerFlag

// محاكاة firestore.rules V3.58:
//  - الدفعة الذرية (staff/{uid} + settings/staffBootstrapDone) تنجح فقط عندما
//    تكون staff فارغة والمفتاح غير موجود والدور admin.
//  - الكتابة المفردة على staff/{uid} (مسار الشفاء العادي) تنجح للمدير عندما
//    تكون المجموعة فارغة (بوتستراف) أو المفتاح موجوداً (شفاء بمعرفة مدير سابق).
//  - users/{docId} و staff قراءة/كتابة حرة لاحتياجات الدخول.
function fakeDb() {
  const users = new Map(USERS.map(u => [u.id, { ...u }]))
  users.get('USR-1001').uid = 'ADMIN-UID'
  users.get('USR-2002').uid = 'CASH-UID'

  function docRef(name, id) {
    return {
      collection: name,
      id,
      async get() {
        if (name === 'staff') {
          const doc = staffMap.get(id)
          return doc ? { exists: true, data: () => ({ ...doc }) } : { exists: false, data: () => ({}) }
        }
        if (name === 'users') {
          const doc = users.get(id)
          return doc ? { exists: true, data: () => ({ ...doc }) } : { exists: false, data: () => ({}) }
        }
        if (name === 'settings' && id === 'staffBootstrapDone') {
          return { exists: markerFlag === true, data: () => ({ done: true }) }
        }
        return { exists: false, data: () => ({}) }
      },
      async set(data) {
        if (name === 'users') { users.set(id, { ...data }); return }
        if (name === 'staff') {
          const staffEmpty = staffMap.size === 0
          const markerExists = markerFlag === true
          const allowed = data && data.role === 'admin' && (staffEmpty || markerExists)
          if (!allowed) throw new Error('permission-denied (rules)')
          staffMap.set(id, { ...data })
          return
        }
        throw new Error('unexpected collection ' + name)
      },
      async delete() { staffMap.delete(id) },
    }
  }

  return {
    collection(name) {
      return { doc(id) { return docRef(name, id) } }
    },
    batch() {
      const ops = []
      return {
        set(ref, data) { ops.push({ ref, data }) },
        async commit() {
          const staffOp = ops.find(o => o.ref.collection === 'staff')
          const markerOp = ops.find(o => o.ref.collection === 'settings')
          const staffEmpty = staffMap.size === 0
          const markerExists = markerFlag === true
          const isSeedAdmin = !!(staffOp && staffOp.data.role === 'admin')
          if (!staffOp || !markerOp || !staffEmpty || markerExists || !isSeedAdmin) {
            throw new Error('permission-denied (rules)')
          }
          staffMap.set(staffOp.ref.id, { ...staffOp.data })
          markerFlag = true
        },
      }
    },
  }
}

function installEnv({ staffSeed = {}, marker = false, authUser } = {}) {
  staffMap = new Map(Object.entries(staffSeed))
  markerFlag = marker
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
})

describe('services/auth — bootstrap one-shot closure (V3.58)', () => {
  it('first login on a fresh DB writes staff/{uid} AND the permanent marker atomically', async () => {
    const session = await login('admin@store.com', 'admin123')

    expect(session.email).toBe('admin@store.com')
    expect(staffMap.has('ADMIN-UID')).toBe(true)
    expect(staffMap.get('ADMIN-UID').role).toBe('admin')
    expect(markerFlag).toBe(true)
    expect(getCurrentUser()).not.toBeNull()
  })

  it('re-login on an existing system does not duplicate the marker (staff doc exists → no heal)', async () => {
    installEnv({ staffSeed: { 'ADMIN-UID': { email: 'admin@store.com', role: 'admin', userId: 'USR-1001' } }, marker: true })
    const session = await login('admin@store.com', 'admin123')

    expect(session.email).toBe('admin@store.com')
    expect(staffMap.size).toBe(1)
    expect(markerFlag).toBe(true)
  })

  it('bootstrap stays CLOSED when staff is emptied but the marker survives', async () => {
    // المحاكاة: staff فارغة (أُفرغت يدوياً) لكن المفتاح ما زال موجوداً.
    // الدفعة ترفض (مفتاح موجود)، والشفاء المفرد ينجح لأن المفتاح موجود —
    // أي لا يمكن «إعادة الادعاء الأول»، بل فقط شفاء سجل المدير نفسه.
    installEnv({ staffSeed: {}, marker: true })
    const session = await login('admin@store.com', 'admin123')

    expect(session.email).toBe('admin@store.com')
    expect(staffMap.has('ADMIN-UID')).toBe(true)
    expect(markerFlag).toBe(true)
  })

  it('non-admin on a fresh DB still gets rejected (no bootstrap, no marker written)', async () => {
    installEnv({ authUser: { uid: 'CASH-UID', email: 'cashier@store.com' } })

    await expect(login('cashier@store.com', '123456')).rejects.toThrow(/غير مُفعَّل/)
    expect(staffMap.has('CASH-UID')).toBe(false)
    expect(markerFlag).toBe(false)
  })
})
