import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAuthAccountViaREST } from '@/services/auth'

// V3.45 — إنشاء حسابات Firebase Auth عبر REST (بديل createUserWithEmailAndPassword
// كي لا تضيع جلسة المدير، وتمهيداً لقواعد firestore.rules الصارمة القائمة على staff/{uid}).

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(() => {
  delete window.getFirebaseConfig
  window.localStorage.removeItem('bms_aladdin_firebase_config')
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete window.getFirebaseConfig
})

function mockFetch(impl) {
  globalThis.fetch = vi.fn(impl)
}

describe('services/auth — createAuthAccountViaREST (V3.45)', () => {
  it('ينشئ الحساب عبر identitytoolkit ويرجع { uid, email }', async () => {
    mockFetch(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ localId: 'UID-ABC', email: 'mo@store.com' }),
    }))

    const created = await createAuthAccountViaREST('MO@Store.com', ' 456789 ')
    expect(created.uid).toBe('UID-ABC')
    expect(created.email).toBe('mo@store.com')

    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('identitytoolkit.googleapis.com/v1/accounts:signUp')
    expect(url).toContain('key=')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body)
    expect(body.email).toBe('mo@store.com')
    expect(body.password).toBe('456789')
    expect(body.returnSecureToken).toBe(true)
  })

  it('يرفض البريد المسجل بالفعل برسالة عربية واضحة', async () => {
    mockFetch(() => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'EMAIL_EXISTS' } }),
    }))

    await expect(createAuthAccountViaREST('dup@store.com', '123456')).rejects.toThrow(
      'مسجل بالفعل في Firebase Authentication'
    )
  })

  it('يحوّل أي رفض آخر إلى رسالة «تعذر إنشاء حساب الدخول السحابي»', async () => {
    mockFetch(() => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'INVALID_PASSWORD' } }),
    }))

    await expect(createAuthAccountViaREST('x@store.com', '123456')).rejects.toThrow(
      'تعذر إنشاء حساب الدخول السحابي: INVALID_PASSWORD'
    )
  })

  it('يحوّل فشل الشبكة إلى رسالة عربية دون رمي الخطأ الخام', async () => {
    mockFetch(() => Promise.reject(new Error('Network request failed')))
    await expect(createAuthAccountViaREST('y@store.com', '123456')).rejects.toThrow(
      'تعذر إنشاء حساب الدخول السحابي: Network request failed'
    )
  })
})
