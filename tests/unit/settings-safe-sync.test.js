import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  applySettings,
  hydrateFromCloud,
  hydrateCloudThemeReadOnly,
} from '@/services/settings'

// V3.55 — SAFE THEME SYNC «قراءة فقط» عند الإقلاع.
// 1) hydrateCloudThemeReadOnly تُطبّق ثيم السحابة (الأحدث) على data-theme دون
//    أي كتابة إلى localStorage ودون أي رفع تلقائي — فلا تُستعاد بيانات ممسوحة.
// 2) hydrateFromCloud لم تعد ترفع المحلي إلى السحابة عندما يكون أحدث: الرفع
//    يحدث فقط عند تغيير الثيم يدوياً (saveSettings → pushToCloud).

const SETTINGS_KEY = 'bms_trendawy_general_settings'

function seedLocal({ theme = 'dark', primaryColor = '#001C3D', updatedAt = 100 } = {}) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, primaryColor, updatedAt }))
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
  seedLocal()
  applySettings()
})

afterEach(() => {
  delete window._authUser
  delete window.db
  localStorage.removeItem(SETTINGS_KEY)
  document.documentElement.setAttribute('data-theme', 'dark')
})

describe('services/settings — hydrateCloudThemeReadOnly (قراءة فقط)', () => {
  it('نسخة سحابية أحدث → تُطبَّق على data-theme وتُعاد القيم، بلا كتابة محلية وبلا رفع', async () => {
    const db = installCloud({ theme: 'emerald', primaryColor: '#10b981', updatedAt: 200 })
    const before = localStorage.getItem(SETTINGS_KEY)

    const adopted = await hydrateCloudThemeReadOnly()

    expect(adopted).toBeTruthy()
    expect(adopted.theme).toBe('emerald')
    expect(localTheme()).toBe('emerald')
    // 🔒 لا تُكتب أي نسخة محلية من القراءة-فقط
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before)
    // 🔒 لا يُرفع شيء إلى السحابة من هذه الدالة
    expect(db.collection('settings').doc('appSettings').set).not.toHaveBeenCalled()
  })

  it('نسخة سحابية أقدم أو مساوية → لا تُطبَّق ولا تُكتب ولا يُرفع', async () => {
    const db = installCloud({ theme: 'royal', primaryColor: '#8b5cf6', updatedAt: 50 })
    const before = localStorage.getItem(SETTINGS_KEY)

    const adopted = await hydrateCloudThemeReadOnly()

    expect(adopted).toBe(false)
    expect(localTheme()).toBe('dark')
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before)
    expect(db.collection('settings').doc('appSettings').set).not.toHaveBeenCalled()
  })

  it('بدون جلسة سحابية → لا شيء (لا شبكة سحابية = لا تطبيق)', async () => {
    delete window._authUser
    const adopted = await hydrateCloudThemeReadOnly()
    expect(adopted).toBe(false)
    expect(localTheme()).toBe('dark')
  })

  it('مستند سحابي مفقود → لا شيء ولا كتابة محلية', async () => {
    installCloud(null)
    const before = localStorage.getItem(SETTINGS_KEY)
    const adopted = await hydrateCloudThemeReadOnly()
    expect(adopted).toBe(false)
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before)
  })
})

describe('services/settings — hydrateFromCloud لا ترفع المحلي الأحدث (V3.55)', () => {
  it('المحلي أحدث من السحابة → لا يُرفع ولا يُكتب، وتُرجع false', async () => {
    seedLocal({ theme: 'coffee', updatedAt: 300 })
    applySettings()
    const db = installCloud({ theme: 'emerald', updatedAt: 100 })

    const adopted = await hydrateFromCloud()

    expect(adopted).toBe(false)
    expect(localTheme()).toBe('coffee')
    // 🔒 الرفع لم يعد يحدث تلقائياً — فقط عند تغيير الثيم يدوياً
    expect(db.collection('settings').doc('appSettings').set).not.toHaveBeenCalled()
  })

  it('السحابة أحدث → تُتبنّى في شاشة الإعدادات (كتابة محلية مسموحة هناك) وتُرجع true', async () => {
    seedLocal({ theme: 'dark', updatedAt: 100 })
    installCloud({ theme: 'ocean', primaryColor: '#06b6d4', updatedAt: 400 })

    const adopted = await hydrateFromCloud()

    expect(adopted).toBe(true)
    expect(localTheme()).toBe('ocean')
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY))
    expect(stored.theme).toBe('ocean')
    expect(stored.updatedAt).toBe(400)
  })
})
