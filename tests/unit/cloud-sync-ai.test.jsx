import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import CloudSyncModal from '@/ui/modals/CloudSyncModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useSandboxStore } from '@/state/sandboxStore'
import { useToastStore } from '@/ui/components/toastStore'
import { getAiConfig, saveAiConfig, clearAiConfig, hasAiProvider, DEFAULT_GEMINI_MODEL } from '@/services/aiProvider'

const AI_KEY = 'bms_trendawy_ai_config'

function mountModal() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<CloudSyncModal />)
  })
  return {
    host,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function getInput(labelText) {
  const labels = Array.from(document.body.querySelectorAll('label'))
  const label =
    labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText)) ||
    labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function lastToast() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1] : null
}

beforeEach(() => {
  window.localStorage.clear()
  useToastStore.setState({ toasts: [] })
  useUiStore.setState({ syncCloudModal: { open: true } })
  useSandboxStore.setState({ active: false })
})

afterEach(() => {
  useUiStore.setState({ syncCloudModal: { open: false } })
  useSandboxStore.setState({ active: false })
  window.localStorage.clear()
  useToastStore.setState({ toasts: [] })
  delete globalThis.fetch
})

describe('aiProvider (services/aiProvider.js) — حفظ وقراءة إعدادات الـ AI', () => {
  it(`بدون إعدادات محفوظة تعيد الافتراضيات (gemini / مفتاح فارغ / نموذج ${DEFAULT_GEMINI_MODEL})`, () => {
    const config = getAiConfig()
    expect(config.provider).toBe('gemini')
    expect(config.apiKey).toBe('')
    expect(config.model).toBe(DEFAULT_GEMINI_MODEL)
    expect(hasAiProvider(config)).toBe(false)
  })

  it('حفظ مفتاح API ونموذج ثم قراءتهما مرة أخرى يعيد القيم المنظفة', () => {
    saveAiConfig({ provider: 'openai', apiKey: '  sk-ABCD1234  ', model: ' gpt-4o-mini ' })
    const saved = JSON.parse(window.localStorage.getItem(AI_KEY))
    expect(saved.apiKey).toBe('sk-ABCD1234')
    expect(saved.model).toBe('gpt-4o-mini')
    expect(saved.provider).toBe('openai')

    const config = getAiConfig()
    expect(config.provider).toBe('openai')
    expect(config.apiKey).toBe('sk-ABCD1234')
    expect(config.model).toBe('gpt-4o-mini')
    expect(hasAiProvider(config)).toBe(true)
  })

  it('حفظ إعدادات فارغة يُفرّغ المفتاح (والنموذج يعود لافتراضيه) وclearAiConfig يمسح التخزين', () => {
    saveAiConfig({ provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' })
    saveAiConfig({ provider: 'gemini', apiKey: '', model: '' })
    expect(getAiConfig().apiKey).toBe('')
    expect(hasAiProvider(getAiConfig())).toBe(false)

    clearAiConfig()
    expect(window.localStorage.getItem(AI_KEY)).toBeNull()
  })
})

describe('CloudSyncModal (ui/modals/CloudSyncModal.jsx) — إعدادات الذكاء الاصطناعي الحساسة', () => {
  it('يعرض قسم إعدادات الذكاء الاصطناعي في نافذة الإعدادات الحساسة', () => {
    const { host, unmount } = mountModal()
    expect(document.body.textContent).toContain('إعدادات الربط والسحابة 🔐')
    expect(document.body.textContent).toContain('إعدادات الذكاء الاصطناعي (AI)')
    expect(document.body.textContent).toContain('مزوّد الذكاء الاصطناعي')
    unmount()
  })

  it('تعبئة مفتاح API والنموذج وحفظهما يخزّن الإعدادات محلياً ويعرض نجاح الحفظ', () => {
    const { host, unmount } = mountModal()
    setInputValue(getInput('مفتاح الذكاء الاصطناعي (API Key)'), 'AIza-xyz-789')
    setInputValue(getInput('اسم النموذج (Model)'), 'gemini-1.5-flash')
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('حفظ إعدادات الذكاء الاصطناعي')))
    const saved = JSON.parse(window.localStorage.getItem(AI_KEY))
    expect(saved.apiKey).toBe('AIza-xyz-789')
    expect(saved.model).toBe('gemini-1.5-flash')
    expect(lastToast().message).toContain('تم حفظ إعدادات الذكاء الاصطناعي بنجاح')
    unmount()
  })

  it('حفظ دون مفتاح يخزّن ويخبر المستخدم أن الإجابات المتقدمة تحتاج المفتاح', () => {
    const { host, unmount } = mountModal()
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('حفظ إعدادات الذكاء الاصطناعي')))
    expect(lastToast().message).toContain('أضف المفتاح والنموذج لتفعيل الإجابات المتقدمة')
    unmount()
  })

  it('وضع الاختبار يعطّل حقول وحفظ إعدادات الـ AI حتى الخروج منه', () => {
    useSandboxStore.setState({ active: true })
    const { host, unmount } = mountModal()
    expect(getInput('مفتاح الذكاء الاصطناعي (API Key)').disabled).toBe(true)
    expect(getInput('اسم النموذج (Model)').disabled).toBe(true)
    const saveBtn = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('حفظ إعدادات الذكاء الاصطناعي'))
    expect(saveBtn.disabled).toBe(true)
    click(saveBtn)
    expect(window.localStorage.getItem(AI_KEY)).toBeNull()
    unmount()
  })

  it('زر «اختبار الاتصال» بمفتاح مرفوض يعرض Toast خطأ واضحاً (دليل على ربط المفتاح)', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }))
    const { host, unmount } = mountModal()
    setInputValue(getInput('مفتاح الذكاء الاصطناعي (API Key)'), 'BADKEY')
    setInputValue(getInput('اسم النموذج (Model)'), 'gemini-1.5-flash')
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال')))
    await act(async () => {})
    expect(lastToast().message).toContain('المفتاح مرفوض')
    unmount()
  })

  it('زر «اختبار الاتصال» بمفتاح صالح يعرض Toast نجاح', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const { host, unmount } = mountModal()
    setInputValue(getInput('مفتاح الذكاء الاصطناعي (API Key)'), 'GOODKEY')
    setInputValue(getInput('اسم النموذج (Model)'), 'gemini-1.5-flash')
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال')))
    await act(async () => {})
    expect(lastToast().message).toContain('ناجح')
    unmount()
  })

  it('زر «اختبار الاتصال» دون مفتاح يطلب إضافة المفتاح أولاً', async () => {
    const { host, unmount } = mountModal()
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال')))
    await act(async () => {})
    expect(lastToast().message).toContain('أضف مفتاح API أولاً')
    unmount()
  })

  it('نتيجة الاختبار تظهر مضمّنة في الواجهة أسفل المفتاح (نجاح وفشل)', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const { host, unmount } = mountModal()
    setInputValue(getInput('مفتاح الذكاء الاصطناعي (API Key)'), 'GOODKEY')
    setInputValue(getInput('اسم النموذج (Model)'), 'gemini-1.5-flash')
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال')))
    await act(async () => {})
    const resultBox = document.body.querySelector('[data-testid="ai-test-result"]')
    expect(resultBox).toBeTruthy()
    expect(resultBox.textContent).toContain('ناجح')

    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }))
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال')))
    await act(async () => {})
    const resultBox2 = document.body.querySelector('[data-testid="ai-test-result"]')
    expect(resultBox2.textContent).toContain('المفتاح مرفوض')
    unmount()
  })

  it('فشل شبكة في الاختبار يظهر رسالة الخطأ في Toast وفي النتيجة المضمّنة ولا يترك الزر عالقاً', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('شبكة معطلة')))
    const { host, unmount } = mountModal()
    setInputValue(getInput('مفتاح الذكاء الاصطناعي (API Key)'), 'KEY')
    setInputValue(getInput('اسم النموذج (Model)'), 'gemini-1.5-flash')
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال')))
    await act(async () => {})
    const btn = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('اختبار الاتصال'))
    expect(btn.textContent).toContain('اختبار الاتصال')
    expect(btn.disabled).toBe(false)
    expect(lastToast().message).toContain('تعذر الوصول إلى المزوّد')
    expect(document.body.querySelector('[data-testid="ai-test-result"]').textContent).toContain('تعذر الوصول إلى المزوّد')
    unmount()
  })
})

describe('CloudSyncModal — النسخ الاحتياطي المحلي (Excel/CSV) (V3.59)', () => {
  it('يعرض قسم التصدير/الاستيراد المحلي مع الأزرار', () => {
    const { unmount } = mountModal()
    expect(document.body.textContent).toContain('النسخ الاحتياطي المحلي (Excel/CSV)')
    const btns = Array.from(document.body.querySelectorAll('button'))
    expect(btns.some(b => b.textContent.includes('تصدير كل الجداول'))).toBe(true)
    expect(btns.some(b => b.textContent.includes('استيراد من ملف Excel/CSV'))).toBe(true)
    unmount()
  })

  it('الاستيراد من ملف يستدعي GoogleSheetsSync.importFromFile ويعرض Toast بالنتيجة', async () => {
    const importSpy = vi.fn(() => Promise.resolve({ rowsImported: 3, label: 'العملاء والأرصدة', sheet: 'Customers_Balances' }))
    window.GoogleSheetsSync = window.GoogleSheetsSync || {}
    const gs = window.GoogleSheetsSync
    const prevImport = gs.importFromFile
    gs.importFromFile = importSpy
    const { unmount } = mountModal()
    const input = document.body.querySelector('input[type="file"]')
    expect(input).toBeTruthy()
    const file = { name: 'customers.csv' }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(importSpy).toHaveBeenCalledTimes(1)
    expect(importSpy.mock.calls[0][0]).toBe(file)
    expect(lastToast().message).toContain('3 سجل')
    gs.importFromFile = prevImport
    unmount()
  })
})
