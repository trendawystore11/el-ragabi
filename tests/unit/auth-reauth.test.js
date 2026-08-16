import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { reauthenticateCurrentUser, generateSalt, hashPassword } from '@/services/auth'

// V3.57 — بوابة كلمة السر تتحقق حصراً من passwordHash + passwordSalt (النص
// الصريح مرفوض)، لذا تُبنى تجزئة حقيقية للمدير في beforeAll.
let ADMIN_HASHED
beforeAll(async () => {
  const salt = await generateSalt()
  const hash = await hashPassword('admin123', salt)
  ADMIN_HASHED = {
    id: 'USR-1001',
    name: 'المدير العام',
    email: 'admin@store.com',
    role: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
  }
})

// V3.52 — بوابة إعادة التحقق من الهوية (C2) أصبحت fail-closed:
// لو أي خدمة من خدمات التحقق غير متاحة يُرمى خطأ يوقف العملية بدلاً من
// السماح بالمرور بصمت، ولا يُبتلع أي خطأ حقيقي من Firebase حتى أوفلاين.

const SESSION_KEY = 'bms_trendawy_user_session'

function installSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'admin@store.com', name: 'المدير العام', role: 'admin' }))
}

function installAuth({ currentUser = {}, firebaseAuth = null } = {}) {
  window.auth = { currentUser }
  if (firebaseAuth === null) {
    window.firebase = { auth: { EmailAuthProvider: { credential: vi.fn((email, pass) => ({ email, pass })) } } }
  } else {
    window.firebase = { auth: firebaseAuth }
  }
}

beforeEach(() => {
  window.getUsers = () => [{ ...ADMIN_HASHED }]
})

afterEach(() => {
  delete window.getUsers
  delete window.auth
  delete window.firebase
  sessionStorage.clear()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

describe('services/auth — reauthenticateCurrentUser fail-closed (C2)', () => {
  it('يرفض بدون جلسة مستخدم نشطة', async () => {
    sessionStorage.clear()
    await expect(reauthenticateCurrentUser('admin123')).rejects.toThrow('لا توجد جلسة مستخدم نشطة')
  })

  it('يرفض كلمة المرور الخاطئة قبل أي اتصال بالسيرفر', async () => {
    installSession()
    await expect(reauthenticateCurrentUser('wrongpass')).rejects.toThrow('كلمة المرور غير صحيحة')
  })

  it('fail-closed: يُرمى خطأ إذا كانت reauthenticateWithCredential غير متاحة', async () => {
    installSession()
    installAuth({ currentUser: {} }) // بلا دالة reauthenticateWithCredential
    await expect(reauthenticateCurrentUser('admin123')).rejects.toThrow('خدمة إعادة التحقق من الهوية غير متوفرة')
  })

  it('fail-closed: يُرمى خطأ إذا كان EmailAuthProvider غير متاح', async () => {
    installSession()
    installAuth({ currentUser: { reauthenticateWithCredential: vi.fn() }, firebaseAuth: {} })
    await expect(reauthenticateCurrentUser('admin123')).rejects.toThrow('خدمة مصادقة Firebase غير متوفرة')
  })

  it('fail-closed: خطأ حقيقي من Firebase لا يُبتلع حتى لو كان المتصفح أوفلاين', async () => {
    installSession()
    installAuth({
      currentUser: { reauthenticateWithCredential: vi.fn(async () => { throw new Error('network down') }) },
    })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await expect(reauthenticateCurrentUser('admin123')).rejects.toThrow(/فشل التحقق من الهوية من السحابة/)
  })

  it('النجاح: يبني credential بالبريد وكلمة المرور ويستدعي reauthenticateWithCredential', async () => {
    installSession()
    const reauth = vi.fn(async () => {})
    installAuth({ currentUser: { reauthenticateWithCredential: reauth } })
    const result = await reauthenticateCurrentUser('admin123')
    expect(result).toBe(true)
    expect(window.firebase.auth.EmailAuthProvider.credential).toHaveBeenCalledWith('admin@store.com', 'admin123')
    expect(reauth).toHaveBeenCalledTimes(1)
  })
})
