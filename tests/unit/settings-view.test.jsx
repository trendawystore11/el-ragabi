import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import SettingsView from '@/ui/views/SettingsView'
import { useSettingsStore } from '@/state/settingsStore'
import { useAuthStore } from '@/state/authStore'
import { useToastStore } from '@/ui/components/toastStore'

const DEFAULT_SETTINGS = {
  appName: 'علاء الدين',
  tagline: 'للبطاطين والمفروشات',
  logo: '2.png',
  primaryColor: '#0284c7',
  theme: 'dark',
}

const ADMIN = { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<SettingsView />)
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

function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function getInput(labelText, root = document) {
  const labels = Array.from(root.querySelectorAll('label'))
  const label =
    labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText)) ||
    labels.find(l => l.querySelector('input,select,textarea') && l.textContent.includes(labelText)) ||
    labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function getSelect(labelText, root = document) {
  const el = getInput(labelText, root)
  if (el.tagName !== 'SELECT') throw new Error(`expected select for: ${labelText}`)
  return el
}

function lastToast() {
  const toasts = useToastStore.getState().toasts
  return toasts[toasts.length - 1]
}

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  useAuthStore.setState({ user: ADMIN, authed: true, role: 'admin' })
  useToastStore.setState({ toasts: [] })
  window.generalSettings.pushToCloud = vi.fn(() => Promise.resolve(true))
  window.generalSettings.hydrateFromCloud = vi.fn(() => Promise.resolve(false))
})

afterEach(() => {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  useAuthStore.setState({ user: null, authed: false, role: null })
  useToastStore.setState({ toasts: [] })
})

describe('SettingsView (ui/views/SettingsView.jsx)', () => {
  it('غير المسجل يرى شاشة «سجّل الدخول أولاً» دون نموذج', () => {
    useAuthStore.setState({ user: null, authed: false, role: null })
    const { host, unmount } = mount()
    expect(host.textContent).toContain('سجّل الدخول أولاً')
    expect(host.textContent).not.toContain('إعدادات النظام العامة')
    unmount()
  })

  it('يعرض النموذج العام بالقيم الافتراضية والثيمات والألوان', () => {
    const { host, unmount } = mount()
    expect(host.textContent).toContain('إعدادات النظام')
    expect(host.textContent).toContain('إعدادات النظام العامة')
    expect(getInput('اسم النظام / التطبيق').value).toBe('علاء الدين')
    expect(getSelect('مظهر النظام').value).toBe('dark')
    const swatches = Array.from(host.querySelectorAll('[data-color]'))
    expect(swatches).toHaveLength(8)
    const colorInput = host.querySelector('input[type="color"]')
    expect(colorInput.value).toBe('#0284c7')
    expect(host.textContent).toContain('حفظ الإعدادات العامة')
    expect(host.textContent).toContain('استعادة الافتراضي')
    unmount()
  })

  it('تعديل اسم النظام ثم الحفظ يحدّث المخزن ويعرض إشعارَي الحفظ والمزامنة', async () => {
    const { host, unmount } = mount()
    setInputValue(getInput('اسم النظام / التطبيق'), 'متجر علاء')
    const saveBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent.includes('حفظ الإعدادات العامة')
    )
    click(saveBtn)
    expect(useSettingsStore.getState().appName).toBe('متجر علاء')
    expect(lastToast().message).toContain('✓ تم حفظ الإعدادات العامة محلياً')

    await act(async () => {})
    expect(window.generalSettings.pushToCloud).toHaveBeenCalled()
    expect(lastToast().message).toContain('☁️ وتزامنت مع السحابة ✓')
    unmount()
  })

  it('تغيير الثيم يطبّق لونه المميز ويحفظ فوراً مع إشعار التبديل', () => {
    const { host, unmount } = mount()
    setSelectValue(getSelect('مظهر النظام'), 'ocean')
    expect(useSettingsStore.getState().theme).toBe('ocean')
    expect(useSettingsStore.getState().primaryColor).toBe('#06b6d4')
    expect(lastToast().message).toContain('✓ تم التبديل إلى ثيم محيطي')
    unmount()
  })

  it('النقر على لون جاهز يطبّقه فوراً ويحدّث المخزن', () => {
    const { host, unmount } = mount()
    const swatch = Array.from(host.querySelectorAll('[data-color]')).find(b => b.getAttribute('data-color') === '#7c3aed')
    click(swatch)
    expect(useSettingsStore.getState().primaryColor).toBe('#7c3aed')
    expect(host.textContent).toContain('#7c3aed')
    unmount()
  })

  it('زر استعادة الافتراضي يعيد القيم الأصلية', () => {
    window.confirm = vi.fn(() => true)
    const { host, unmount } = mount()
    useSettingsStore.setState({ appName: 'اسم معدل', primaryColor: '#dc2626', theme: 'coffee' })
    setInputValue(getInput('اسم النظام / التطبيق'), 'اسم معدل')

    const resetBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent.includes('استعادة الافتراضي')
    )
    click(resetBtn)
    expect(useSettingsStore.getState().appName).toBe('علاء الدين')
    expect(useSettingsStore.getState().primaryColor).toBe('#0284c7')
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(lastToast().message).toContain('تم استعادة الإعدادات الافتراضية')
    unmount()
  })

  it('عند تعذر رفع السحابة يعرض إشعار التحذير بضرورة تسجيل الدخول', async () => {
    window.generalSettings.pushToCloud = vi.fn(() => Promise.resolve(false))
    const { host, unmount } = mount()
    const saveBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent.includes('حفظ الإعدادات العامة')
    )
    click(saveBtn)
    await act(async () => {})
    expect(lastToast().message).toContain('⚠️ سجّل الدخول لرفع الإعدادات للسحابة')
    unmount()
  })

  it('بعد الحفظ ثم إعادة فتح الصفحة تبقى القيم المحفوظة — لا ترجع لقيمتها القديمة', () => {
    window.localStorage.removeItem('bms_aladdin_general_settings')
    useSettingsStore.setState({ ...DEFAULT_SETTINGS })
    const first = mount()
    setInputValue(getInput('اسم النظام / التطبيق'), 'متجر علاء')
    const saveBtn = Array.from(first.host.querySelectorAll('button')).find(b =>
      b.textContent.includes('حفظ الإعدادات العامة')
    )
    click(saveBtn)
    first.unmount()

    const second = mount()
    expect(getInput('اسم النظام / التطبيق').value).toBe('متجر علاء')
    expect(useSettingsStore.getState().appName).toBe('متجر علاء')
    second.unmount()
  })

  it('في وضع الاختبار يُطبَّق الحفظ بصرياً على الجلسة دون الكتابة للتخزين — لا يرتد فورياً', () => {
    window.localStorage.removeItem('bms_aladdin_general_settings')
    useSettingsStore.setState({ ...DEFAULT_SETTINGS })
    const prevSandbox = window.isSandboxMode
    window.isSandboxMode = true
    try {
      const { unmount } = mount()
      setInputValue(getInput('اسم النظام / التطبيق'), 'تجربة الاختبار')
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.includes('حفظ الإعدادات العامة')
      )
      click(saveBtn)
      expect(useSettingsStore.getState().appName).toBe('تجربة الاختبار')
      expect(getInput('اسم النظام / التطبيق').value).toBe('تجربة الاختبار')
      expect(window.localStorage.getItem('bms_aladdin_general_settings')).toBeNull()
      unmount()
    } finally {
      window.isSandboxMode = prevSandbox
    }
  })
})
