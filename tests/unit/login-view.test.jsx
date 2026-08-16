import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import LoginView from '@/ui/views/LoginView'
import App from '@/App'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { useToastStore } from '@/ui/components/toastStore'

const ADMIN = { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }

async function flushAsync() {
  // يُنهي سلاسل الوعود المرتبطة بالتحميل الكسول (React.lazy) داخل AppShell.
  for (let i = 0; i < 15; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

beforeAll(async () => {
  // تسخين وحدات AppShell الكسولة كي يتحلل import(...) فوراً من ذاكرة التخزين.
  await Promise.all([import('@/ui/views/Dashboard.jsx')])
})

function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
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
  const labels = Array.from(document.querySelectorAll('label'))
  const label =
    labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText)) ||
    labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function findButton(text) {
  return Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes(text))
}

function resetAuth() {
  useAuthStore.setState({ user: null, authed: false, role: null })
}

beforeEach(() => {
  // setup-session.js (setupFiles) يزرع جلسة افتراضية لكل اختبار؛ هذا الملف يريد
  // اختبار «بدون جلسة» للبوابة (App gate) فيمسحها هنا — بعد حُقنة الفيكسجر.
  sessionStorage.clear()
  resetAuth()
  useToastStore.setState({ toasts: [] })
  useSettingsStore.setState({ appName: 'Trendawy', tagline: 'لراحة بالك ناوي', logo: '2.png' })
  window.getOrders = vi.fn(() => [])
  window.getProducts = vi.fn(() => [])
  window.getSuppliers = vi.fn(() => [])
  window.getCustomers = vi.fn(() => [])
  window.getExpenses = vi.fn(() => [])
  window.getPayments = vi.fn(() => [])
  window.getUsers = vi.fn(() => [])
  window.isAdmin = vi.fn(() => false)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetAuth()
  useToastStore.setState({ toasts: [] })
})

describe('LoginView (ui/views/LoginView.jsx)', () => {
  it('يعرض الشعار واسم النظام والسطر التعريفي وحقول الدخول', () => {
    const { host, unmount } = mount(<LoginView />)
    expect(host.textContent).toContain('Trendawy')
    expect(host.textContent).toContain('لراحة بالك ناوي')
    expect(host.querySelector('img').getAttribute('src')).toBe('2.png')
    expect(host.textContent).toContain('البريد الإلكتروني')
    expect(host.textContent).toContain('كلمة المرور')
    expect(host.textContent).toContain('تسجيل الدخول')
    unmount()
  })

  it('تسجيل الدخول الناجح يستدعي login بالبيانات ويعرض تنبيهاً', async () => {
    const loginSpy = vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue(ADMIN)
    const { host, unmount } = mount(<LoginView />)
    setInputValue(getInput('البريد الإلكتروني'), 'admin@store.com')
    setInputValue(getInput('كلمة المرور'), 'secret')
    click(findButton('تسجيل الدخول'))
    await act(async () => {})
    expect(loginSpy).toHaveBeenCalledWith('admin@store.com', 'secret')
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم تسجيل الدخول بنجاح')
    unmount()
  })

  it('فشل تسجيل الدخول يعرض رسالة الخطأ ولا يغلق الشاشة', async () => {
    const loginSpy = vi
      .spyOn(useAuthStore.getState(), 'login')
      .mockRejectedValue(new Error('كلمة المرور غير صحيحة'))
    const { host, unmount } = mount(<LoginView />)
    setInputValue(getInput('البريد الإلكتروني'), 'admin@store.com')
    setInputValue(getInput('كلمة المرور'), 'wrong')
    click(findButton('تسجيل الدخول'))
    await act(async () => {})
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('كلمة المرور غير صحيحة')
    expect(host.textContent).toContain('تسجيل الدخول')
    unmount()
  })

  it('زر إظهار/إخفاء كلمة السر يبدّل نوع الحقل ويظهر على الجهة اليمنى بلا أيقونة مفتاح', () => {
    const { host, unmount } = mount(<LoginView />)
    const passwordInput = getInput('كلمة المرور')
    expect(passwordInput.type).toBe('password')
    const toggle = Array.from(host.querySelectorAll('button')).find(
      b => b.getAttribute('aria-label') === 'إظهار / إخفاء كلمة السر'
    )
    expect(toggle.className).toContain('right-2.5')
    expect(toggle.className).not.toContain('left-2.5')
    // لا يوجد أيقونة مفتاح في حقل كلمة السر — العين هي بديلها الوحيد.
    expect(host.querySelector('.lucide-key-round')).toBeNull()
    click(toggle)
    expect(passwordInput.type).toBe('text')
    unmount()
  })

  it('زر نسيت كلمة السر يفتح نافذة إرشاد التواصل مع المدير', () => {
    const { host, unmount } = mount(<LoginView />)
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('نسيت كلمة السر')))
    expect(document.body.textContent).toContain('نسيت كلمة السر؟')
    expect(document.body.textContent).toContain('يرجى التواصل مع المدير العام')
    unmount()
  })

  it('لا تظهر أيقونة المايك إطلاقاً في حقول صفحة تسجيل الدخول', () => {
    const { host, unmount } = mount(<LoginView />)
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    unmount()
  })
})

describe('App gate (src/App.jsx)', () => {
  it('بدون جلسة يعرض شاشة تسجيل الدخول، وبعد الدخول يعرض الهيكل الرئيسي', async () => {
    const { host, unmount } = mount(<App />)
    expect(host.textContent).toContain('تسجيل الدخول')
    act(() => {
      useAuthStore.setState({ user: ADMIN, authed: true, role: 'admin' })
    })
    await flushAsync()
    expect(host.textContent).toContain('لوحة التحكم والرصد اليومي')
    expect(host.textContent).toContain('Trendawy')
    unmount()
  })

  it('تسجيل الخروج يعيد شاشة تسجيل الدخول', async () => {
    sessionStorage.setItem('bms_trendawy_user_session', JSON.stringify(ADMIN))
    const { host, unmount } = mount(<App />)
    await flushAsync()
    expect(host.textContent).toContain('لوحة التحكم والرصد اليومي')
    act(() => {
      useAuthStore.setState({ user: null, authed: false, role: null })
    })
    expect(host.textContent).toContain('تسجيل الدخول')
    unmount()
  })
})
