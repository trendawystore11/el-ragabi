import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { useSandboxStore } from '@/state/sandboxStore'
import * as settingsService from '@/services/settings'
import * as authService from '@/services/auth'

// V3.57 — login/verifyAdminPassword reject accounts without passwordHash +
// passwordSalt (plaintext `password` no longer accepted), so the fixture must
// provide real PBKDF2 hashes.
let ACTIVE_USERS
beforeAll(async () => {
  const adminSalt = await authService.generateSalt()
  const storeSalt = await authService.generateSalt()
  ACTIVE_USERS = [
    {
      id: 'USR-1001',
      name: 'المدير العام',
      email: 'admin@store.com',
      role: 'admin',
      passwordHash: await authService.hashPassword('admin123', adminSalt),
      passwordSalt: adminSalt,
    },
    {
      id: 'USR-1002',
      name: 'أمين مخزن',
      email: 'store@store.com',
      role: 'storekeeper',
      passwordHash: await authService.hashPassword('store123', storeSalt),
      passwordSalt: storeSalt,
    },
  ]
})

function resetStores() {
  useAuthStore.setState({ user: null, authed: false, role: null })
  useSettingsStore.setState(settingsService.getSettings())
  useSandboxStore.setState({ active: false })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  resetStores()
  window.getUsers = () => ACTIVE_USERS.map(u => ({ ...u }))
  window.getCollection = () => []
  window.STORAGE_KEYS = window.STORAGE_KEYS || { USER: 'users' }
  window.createNewUserAccount = authService.createNewUserAccount
  window.updateUserAccount = authService.updateUserAccount
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('style')
})

describe('authStore (Phase 3 wiring to services/auth)', () => {
  it('starts signed-out when no session exists', () => {
    expect(useAuthStore.getState().authed).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().role).toBeNull()
  })

  it('login validates against active accounts and syncs state', async () => {
    const user = await useAuthStore.getState().login('ADMIN@store.com', 'admin123')
    expect(user.email).toBe('admin@store.com')
    expect(user.role).toBe('admin')
    const s = useAuthStore.getState()
    expect(s.authed).toBe(true)
    expect(s.role).toBe('admin')
    expect(s.user.name).toBe('المدير العام')
  })

  it('login rejects wrong password and unknown accounts', async () => {
    await expect(useAuthStore.getState().login('admin@store.com', 'wrong')).rejects.toThrow('كلمة المرور غير صحيحة')
    await expect(useAuthStore.getState().login('ghost@store.com', 'x')).rejects.toThrow('حساب المستخدم غير موجود في النظام')
    expect(useAuthStore.getState().authed).toBe(false)
  })

  it('restore() re-reads the persisted session', async () => {
    await useAuthStore.getState().login('store@store.com', 'store123')
    useAuthStore.setState({ user: null, authed: false, role: null })
    expect(useAuthStore.getState().authed).toBe(false)
    const restored = useAuthStore.getState().restore()
    expect(restored.email).toBe('store@store.com')
    expect(useAuthStore.getState().role).toBe('storekeeper')
  })

  it('logout clears the session and store state', async () => {
    await useAuthStore.getState().login('admin@store.com', 'admin123')
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().authed).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().role).toBeNull()
    expect(sessionStorage.getItem('bms_trendawy_user_session')).toBeNull()
  })

  it('setUser maps role and derives authed flag', () => {
    useAuthStore.getState().setUser({ id: 'U', email: 'e@x.com', role: 'employee' })
    expect(useAuthStore.getState().authed).toBe(true)
    expect(useAuthStore.getState().role).toBe('employee')
    useAuthStore.getState().setUser(null)
    expect(useAuthStore.getState().authed).toBe(false)
  })

  it('RBAC helpers delegate to the service', async () => {
    await useAuthStore.getState().login('admin@store.com', 'admin123')
    expect(useAuthStore.getState().isAdmin()).toBe(true)
    expect(await useAuthStore.getState().verifyAdminPassword('admin123')).toBe(true)
    expect(await useAuthStore.getState().verifyAdminPassword('nope')).toBe(false)
  })


  it('createNewUserAccount creates the Firebase Auth account via REST when window.auth exists', async () => {
    await useAuthStore.getState().login('admin@store.com', 'admin123')
    window.addFirestoreDoc = vi.fn((key, doc) => doc)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ localId: 'UID-MOHAMED', email: 'mo@store.com' }) })
    )
    window.auth = {}

    const created = await window.createNewUserAccount({ name: 'محمد مخزن', email: 'mo@store.com', password: '456789', role: 'storekeeper' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('identitytoolkit.googleapis.com/v1/accounts:signUp'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(created.email).toBe('mo@store.com')
    expect(created.role).toBe('storekeeper')
    expect(created.uid).toBe('UID-MOHAMED')
    expect(window.addFirestoreDoc).toHaveBeenCalled()
    globalThis.fetch = originalFetch
    delete window.auth
    delete window.addFirestoreDoc
  })

  it('createNewUserAccount rejects when the Auth email is already in use', async () => {
    await useAuthStore.getState().login('admin@store.com', 'admin123')
    window.addFirestoreDoc = vi.fn((key, doc) => doc)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: { message: 'EMAIL_EXISTS' } }) })
    )
    window.auth = {}

    await expect(
      window.createNewUserAccount({ name: 'مكرر', email: 'dup@store.com', password: '123456', role: 'employee' })
    ).rejects.toThrow('مسجل بالفعل في Firebase Authentication')
    expect(window.addFirestoreDoc).not.toHaveBeenCalled()
    globalThis.fetch = originalFetch
    delete window.auth
    delete window.addFirestoreDoc
  })
})

describe('settingsStore (Phase 3 wiring to services/settings)', () => {
  it('defaults match the general-settings DEFAULT', () => {
    const s = useSettingsStore.getState()
    expect(s.appName).toBe('Trendawy')
    expect(s.tagline).toBe('لراحة بالك ناوي')
    expect(s.theme).toBe('graphite')
    expect(s.primaryColor).toBe('#8B7CFF')
    expect(s.logo).toBe('2.png')
  })

  it('save() persists to localStorage and applies visually', () => {
    const next = useSettingsStore.getState().save({ theme: 'light', appName: 'نظام جديد' })
    expect(next.theme).toBe('light')
    expect(useSettingsStore.getState().appName).toBe('نظام جديد')
    const stored = JSON.parse(localStorage.getItem('bms_trendawy_general_settings'))
    expect(stored.theme).toBe('light')
    expect(stored.appName).toBe('نظام جديد')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('save() sanitizes unknown themes back to dark', () => {
    useSettingsStore.getState().save({ theme: 'neon' })
    expect(useSettingsStore.getState().theme).toBe('dark')
  })

  it('setTheme switches instantly without persisting', () => {
    useSettingsStore.getState().setTheme('ocean')
    expect(useSettingsStore.getState().theme).toBe('ocean')
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean')
    expect(localStorage.getItem('bms_trendawy_general_settings')).toBeNull()
  })

  it('setPrimary remaps the brand CSS variable', () => {
    useSettingsStore.getState().setPrimary('#ff0000')
    expect(useSettingsStore.getState().primaryColor).toBe('#ff0000')
    expect(document.documentElement.style.getPropertyValue('--brand-500')).toBe('#ff0000')
  })

  it('hydrate() re-applies stored settings', () => {
    useSettingsStore.getState().save({ theme: 'royal' })
    useSettingsStore.setState(settingsService.getSettings())
    useSettingsStore.getState().hydrate()
    expect(useSettingsStore.getState().theme).toBe('royal')
    expect(document.documentElement.getAttribute('data-theme')).toBe('royal')
  })
})

describe('sandboxStore (Phase 3 wiring to services/db sandbox API)', () => {
  it('starts inactive', () => {
    expect(useSandboxStore.getState().active).toBe(false)
    expect(window.isSandboxActive()).toBe(false)
  })

  it('enter() activates the isolation layer', () => {
    const ok = useSandboxStore.getState().enter()
    expect(ok).toBe(true)
    expect(useSandboxStore.getState().active).toBe(true)
    expect(window.isSandboxActive()).toBe(true)
    expect(window.isSandboxMode).toBe(true)
  })

  it('enter() is idempotent and exit() restores state', () => {
    useSandboxStore.getState().enter()
    expect(useSandboxStore.getState().enter()).toBe(false) // already active
    const ok = useSandboxStore.getState().exit()
    expect(ok).toBe(true)
    expect(useSandboxStore.getState().active).toBe(false)
    expect(window.isSandboxMode).toBe(false)
  })

  it('toggle() flips the mode', () => {
    useSandboxStore.getState().toggle()
    expect(useSandboxStore.getState().active).toBe(true)
    useSandboxStore.getState().toggle()
    expect(useSandboxStore.getState().active).toBe(false)
  })

  it('set(active) maps boolean to enter/exit', () => {
    useSandboxStore.getState().set(true)
    expect(useSandboxStore.getState().active).toBe(true)
    useSandboxStore.getState().set(false)
    expect(useSandboxStore.getState().active).toBe(false)
  })

  it('stays in sync with the bms-sandbox-changed event', () => {
    window.dispatchEvent(new CustomEvent('bms-sandbox-changed', { detail: { active: true } }))
    expect(useSandboxStore.getState().active).toBe(true)
    window.dispatchEvent(new CustomEvent('bms-sandbox-changed', { detail: { active: false } }))
    expect(useSandboxStore.getState().active).toBe(false)
  })

  it('enter() clones real collections to RAM and restores them unchanged on exit', () => {
    window.firestoreCache = window.firestoreCache || {}
    window.firestoreCache.orders = [{ id: 'ORD-1', totalAmount: 500 }]
    window.firestoreCache.customers = [{ id: 'C-1', name: 'أحمد' }]
    window.STORAGE_KEYS.ORDERS = 'orders'
    window.STORAGE_KEYS.CUSTOMERS = 'customers'
    window.STORAGE_KEYS.SUPPLIER_RETURNS = 'supplier_returns'
    window.STORAGE_KEYS.SUPPLIER_TRANSACTIONS = 'supplier_transactions'
    window.STORAGE_KEYS.PRODUCTS = 'products'
    window.STORAGE_KEYS.SUPPLIERS = 'suppliers'
    window.STORAGE_KEYS.PAYMENTS = 'payments'

    useSandboxStore.getState().enter()
    // Writes inside sandbox mutate ONLY the RAM cache view.
    window.firestoreCache.orders[0].totalAmount = 999
    useSandboxStore.getState().exit()
    // Original RAM snapshot restored 100% unchanged.
    expect(window.firestoreCache.orders[0].totalAmount).toBe(500)
  })
})
