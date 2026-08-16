import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  applySettings,
  hydrateFromCloud,
  hydrateCloudThemeReadOnly,
} from '@/services/settings'

// V3.63 — SPLIT SCOPE:
//   - الهوية (اسم/تاجلاين/شعار) في `general_settings` (عالمية) وتُزامن للسحابة (LWW).
//   - الثيم/اللون/الاختصار تفضيلات شخصية لكل مستخدم في `user_prefs` — بلا سحابة.
// 1) hydrateCloudThemeReadOnly تُطبّق تفضيلات المستخدم الجالس محلياً — لا تقرأ
//    السحابة إطلاقاً (المظهر لم يعد يُزامن بين الأجهزة).
// 2) hydrateFromCloud تتبنّى الهوية الأحدث فقط (اسم/تاجلاين/شعار) ولا تمس المظهر.

const SETTINGS_KEY = 'bms_trendawy_general_settings'
const PREFS_KEY = 'bms_trendawy_user_prefs'
const SESSION_KEY = 'bms_trendawy_user_session'

function seedSession(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user))
}

function seedLocal(identity) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(identity))
}

function seedPrefs(userId, prefs) {
  const map = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  map[userId] = prefs
  localStorage.setItem(PREFS_KEY, JSON.stringify(map))
}

function cloudDoc(data) {
  return { exists: true, data: () => ({ ...data }) }
}

function installCloud(cloud) {
  const snap = cloud ? cloudDoc(cloud) : { exists: false, data: () => ({}) }
  window._authUser = { uid: 'ADMIN-UID', email: 'admin@store.com' }
  window.db = {
    collection(name) {
      if (name !== 'settings') throw new Error('unexpected collection ' + name)
      return {
        doc(id) {
          if (id !== 'appSettings') throw new Error('unexpected doc ' + id)
          return {
            get: vi.fn(async () => snap),
            set: vi.fn(async () => {}),
          }
        },
      }
    },
  }
  return window.db
}

function localTheme() {
  return document.documentElement.getAttribute('data-theme')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  seedLocal({ appName: 'Trendawy', tagline: 'لراحة بالك ناوي', logo: '2.png', updatedAt: 100 })
  seedSession({ id: 'USR-1001', email: 'admin@store.com', role: 'admin', name: 'المدير العام' })
  applySettings()
})

afterEach(() => {
  delete window._authUser
  delete window.db
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.setAttribute('data-theme', 'dark')
})

describe('services/settings — hydrateCloudThemeReadOnly يطبّق تفضيلات المستخدم المحلية (V3.63)', () => {
  it('يعيد تفضيلات المستخدم الجالس ويطبّقها على data-theme دون أي قراءة سحابية', async () => {
    seedPrefs('USR-1001', { theme: 'emerald', primaryColor: '#10b981' })

    const adopted = await hydrateCloudThemeReadOnly()

    expect(adopted).toBeTruthy()
    expect(adopted.theme).toBe('emerald')
    expect(localTheme()).toBe('emerald')
    // 🔒 لا يلمس السحابة إطلاقاً — لا window.db ولا أي رفع
    expect(window.db).toBeUndefined()
  })

  it('بدون جلسة → يعيد false وتبقى الافتراضيات المطبّقة عند الإقلاع', async () => {
    sessionStorage.clear()

    const adopted = await hydrateCloudThemeReadOnly()

    expect(adopted).toBe(false)
    // لا يوجد مستخدم جالس → لا تُطبَّق أي تفضيلات شخصية، يبقى مظهر الافتراضي
    expect(localTheme()).toBe('graphite')
  })
})

describe('services/settings — hydrateFromCloud تتبنّى الهوية فقط (V3.63)', () => {
  it('السحابة أحدث → تتبنّى اسم/شعار فقط وتُرجع true، دون المساس بالمظهر الشخصي', async () => {
    seedPrefs('USR-1001', { theme: 'royal', primaryColor: '#8b5cf6' })
    seedLocal({ appName: 'Trendawy', updatedAt: 100 })
    installCloud({ appName: 'اسم جديد', logo: 'new.png', theme: 'emerald', primaryColor: '#10b981', updatedAt: 400 })

    const adopted = await hydrateFromCloud()

    expect(adopted).toBe(true)
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY))
    expect(stored.appName).toBe('اسم جديد')
    expect(stored.logo).toBe('new.png')
    expect(stored.updatedAt).toBe(400)
    // 🔒 المظهر الشخصي لم يُمسّ من السحابة
    expect(localTheme()).toBe('royal')
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY))
    expect(prefs['USR-1001'].theme).toBe('royal')
  })

  it('المحلي أحدث أو مساوٍ → لا يُرفع ولا يُكتب، وتُرجع false', async () => {
    seedLocal({ appName: 'Trendawy', updatedAt: 300 })
    const db = installCloud({ appName: 'قديم', updatedAt: 100 })
    const before = localStorage.getItem(SETTINGS_KEY)

    const adopted = await hydrateFromCloud()

    expect(adopted).toBe(false)
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before)
    // 🔒 الرفع لم يعد يحدث تلقائياً — فقط عند تغيير الهوية يدوياً (saveSettings)
    expect(db.collection('settings').doc('appSettings').set).not.toHaveBeenCalled()
  })

  it('مستند سحابي مفقود → لا شيء ولا كتابة محلية', async () => {
    installCloud(null)
    const before = localStorage.getItem(SETTINGS_KEY)

    const adopted = await hydrateFromCloud()

    expect(adopted).toBe(false)
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before)
  })
})
