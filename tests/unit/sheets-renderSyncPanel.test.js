import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// استيراد الخدمة الحقيقية — تُثبّت window.GoogleSheetsSync تلقائياً عند الاستيراد.
// V3.59 — لوحة المزامنة في عصر الـ Webhook: حقل واحد للرابط، بلا أي توكنات
// OAuth أو Spreadsheet ID. انحدار V3.52 (escapeAttr غير مستورد → شاشة سوداء)
// ما زال مغطى هنا: نرسم اللوحة الحقيقية دون أي mock.
import { renderSyncPanel, getConfig, saveConfig, resetSyncState } from '@/services/sheets'

describe('services/sheets — renderSyncPanel (Webhook Edition)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    resetSyncState()
    localStorage.clear()
  })

  it('يرسم لوحة المزامنة دون أي خطأ مع قيم إعدادات كاملة', () => {
    saveConfig({
      webhookUrl: 'https://script.google.com/macros/s/ABC123/exec',
      direction: 'both',
      frequency: '1h',
      enabled: true,
    })
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(() => renderSyncPanel(el, { unlocked: true })).not.toThrow()
    expect(el.querySelector('#gs-webhook-url')).toBeTruthy()
    expect(el.querySelector('#gs-save')).toBeTruthy()
    expect(el.querySelector('#gs-connect')).toBeTruthy()
    expect(el.querySelector('#gs-webhook-url').value).toBe('https://script.google.com/macros/s/ABC123/exec')
    expect(el.querySelector('#gs-direction').value).toBe('both')
    expect(el.querySelector('#gs-enabled').checked).toBe(true)
    // V3.59 — لا توجد حقول OAuth/توكنات بعد الآن إطلاقاً
    expect(el.querySelector('#gs-sheet-id')).toBeNull()
    expect(el.querySelector('#gs-client-id')).toBeNull()
    expect(el.querySelector('#gs-token')).toBeNull()
    expect(el.querySelector('#gs-refresh-token')).toBeNull()
    el.remove()
  })

  it('يرسم اللوحة حتى مع غياب أي إعدادات محفوظة (قيم افتراضية)', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(() => renderSyncPanel(el, {})).not.toThrow()
    expect(el.querySelector('#gs-webhook-url')).toBeTruthy()
    expect(el.querySelector('#gs-last').textContent).toContain('آخر مزامنة')
    el.remove()
  })

  it('يُهرب القيم المخزنة في سمات HTML كي لا تكسر اللوحة أو تنفّذ برمجيات (XSS)', () => {
    saveConfig({
      webhookUrl: 'https://x.example/"><script>alert(1)</script>',
      lastSyncStatus: '<img src=x onerror=alert(1)>',
    })
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(() => renderSyncPanel(el, { unlocked: true })).not.toThrow()
    const input = el.querySelector('#gs-webhook-url')
    expect(input.value).toBe('https://x.example/"><script>alert(1)</script>')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('[onerror]')).toBeNull()
    expect(el.querySelector('[onfocus]')).toBeNull()
    el.remove()
  })

  it('يعكس القيم المحفوظة في حقول اللوحة بعد الحفظ (getConfig/saveConfig متسقان)', () => {
    saveConfig({ webhookUrl: 'https://script.google.com/macros/s/DEF456/exec', direction: 'import' })
    const el = document.createElement('div')
    renderSyncPanel(el, { unlocked: true })
    expect(el.querySelector('#gs-direction').value).toBe('import')
    expect(el.querySelector('#gs-webhook-url').value).toBe('https://script.google.com/macros/s/DEF456/exec')
    expect(getConfig().webhookUrl).toBe('https://script.google.com/macros/s/DEF456/exec')
    el.remove()
  })

  it('الحفظ من اللوحة يعيد كتابة رابط الـ Webhook ويستدعي onSaved', () => {
    const onSaved = vi.fn()
    // Stub Firestore so pushConfigToCloud (fired on save) resolves cleanly.
    window._authUser = { uid: 'u-1' }
    window.db = { collection: () => ({ doc: () => ({ set: () => Promise.resolve() }) }) }
    const el = document.createElement('div')
    document.body.appendChild(el)
    renderSyncPanel(el, { unlocked: true, onSaved })
    const input = el.querySelector('#gs-webhook-url')
    input.value = 'https://script.google.com/macros/s/SAVE-NEW/exec'
    el.querySelector('#gs-save').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(getConfig().webhookUrl).toBe('https://script.google.com/macros/s/SAVE-NEW/exec')
    expect(onSaved).toHaveBeenCalledTimes(1)
    el.remove()
    delete window.db
    delete window._authUser
  })
})
