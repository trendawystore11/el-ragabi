import { describe, it, expect, beforeEach } from 'vitest'

describe('services/firebaseLoader.js — تحميل Firebase SDK', () => {
  beforeEach(() => {
    delete window.firebase
    delete window.db
    delete window.auth
    window.localStorage.clear()
  })

  it('يثبّت SDK ويستخدم الإعداد المحفوظ في localStorage (bms_firebase_config)', async () => {
    window.localStorage.setItem(
      'bms_trendawy_firebase_config',
      JSON.stringify({
        apiKey: 'FAKE-KEY',
        projectId: 'custom-project',
        authDomain: 'custom-project.firebaseapp.com',
        appId: '1:1:web:1',
      })
    )
    await import('@/services/firebaseLoader')
    expect(window.firebase).toBeTruthy()
    expect(window.db).toBeTruthy()
    const apps = window.firebase.apps
    expect(apps.length).toBeGreaterThan(0)
    expect(window.firebase.app(apps[0].name).options.projectId).toBe('custom-project')
  })
})
