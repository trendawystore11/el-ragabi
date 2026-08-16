import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AdminPasswordModal from '@/ui/modals/AdminPasswordModal'
import ChangePasswordModal from '@/ui/modals/ChangePasswordModal'
import CloudSyncModal from '@/ui/modals/CloudSyncModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { useSandboxStore } from '@/state/sandboxStore'

const ADMIN = { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }

const RESET_UI = {
  adminPasswordModal: { open: false, note: null, onOk: null },
  changePasswordModal: { open: false },
  syncCloudModal: { open: false },
}

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

beforeEach(() => {
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
  useSandboxStore.setState({ active: false })
  window.isSandboxMode = false
  window.getCurrentUser = vi.fn(() => ADMIN)
  window.adminPasswordConfigured = vi.fn(() => true)
  window.verifyAdminPassword = vi.fn(() => false)
  window.changeOwnPassword = vi.fn()
  window.GoogleSheetsSync = {
    renderSyncPanel: vi.fn(),
    openSheetUrl: vi.fn(),
  }
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
  useSandboxStore.setState({ active: false })
  window.isSandboxMode = false
})

describe('AdminPasswordModal (ui/modals/AdminPasswordModal.jsx)', () => {
  it('كلمة سر صحيحة تُغلق النافذة وتستدعي onOk', async () => {
    const onOk = vi.fn()
    window.verifyAdminPassword = vi.fn(() => Promise.resolve(true))
    useUiStore.setState({ adminPasswordModal: { open: true, note: 'أدخل كلمة سر المدير للمتابعة.', onOk } })
    const { unmount } = mount(<AdminPasswordModal />)
    expect(document.body.textContent).toContain('تأكيد هوية المدير')
    setInputValue(getInput('كلمة السر'), '1234')
    await act(async () => { click(findButton('تأكيد')) })
    expect(window.verifyAdminPassword).toHaveBeenCalledWith('1234')
    expect(onOk).toHaveBeenCalled()
    expect(useUiStore.getState().adminPasswordModal.open).toBe(false)
    unmount()
  })

  it('كلمة سر خاطئة تُظهر رسالة خطأ ولا تُغلق النافذة', async () => {
    window.verifyAdminPassword = vi.fn(() => Promise.resolve(false))
    useUiStore.setState({ adminPasswordModal: { open: true, note: 'اختبار', onOk: vi.fn() } })
    const { unmount } = mount(<AdminPasswordModal />)
    setInputValue(getInput('كلمة السر'), 'bad')
    await act(async () => { click(findButton('تأكيد')) })
    expect(document.body.textContent).toContain('عفواً، كلمة السر غير صحيحة!')
    expect(useUiStore.getState().adminPasswordModal.open).toBe(true)
    unmount()
  })

  it('عند غياب كلمة سر مسجلة تسجّل كلمة سر جديدة مباشرة ثم تستدعي onOk', async () => {
    window.adminPasswordConfigured = vi.fn(() => false)
    window.changeOwnPassword = vi.fn(() => Promise.resolve(true))
    const onOk = vi.fn()
    useUiStore.setState({ adminPasswordModal: { open: true, note: 'اختبار', onOk } })
    const { unmount } = mount(<AdminPasswordModal />)
    expect(document.body.textContent).toContain('تسجيل كلمة سر المدير')
    setInputValue(getInput('كلمة السر الجديدة'), 'newpass6')
    await act(async () => { click(findButton('تسجيل والمتابعة')) })
    expect(window.changeOwnPassword).toHaveBeenCalledWith('', 'newpass6')
    expect(onOk).toHaveBeenCalled()
    expect(useUiStore.getState().adminPasswordModal.open).toBe(false)
    unmount()
  })

  it('كلمة سر أولى قصيرة تمنع المتابعة وتعرض رسالة خطأ وتبقي النافذة مفتوحة', async () => {
    window.adminPasswordConfigured = vi.fn(() => false)
    window.changeOwnPassword = vi.fn(() => {
      return Promise.reject(new Error('كلمة السر الجديدة يجب ألا تقل عن 6 أحرف'))
    })
    useUiStore.setState({ adminPasswordModal: { open: true, note: 'اختبار', onOk: vi.fn() } })
    const { unmount } = mount(<AdminPasswordModal />)
    setInputValue(getInput('كلمة السر الجديدة'), '123')
    await act(async () => { click(findButton('تسجيل والمتابعة')) })
    expect(document.body.textContent).toContain('كلمة السر الجديدة يجب ألا تقل عن 6 أحرف')
    expect(useUiStore.getState().adminPasswordModal.open).toBe(true)
    unmount()
  })

  it('حقل فارغ يظهر خطأ صريحاً ويمنع المتابعة', async () => {
    useUiStore.setState({ adminPasswordModal: { open: true, note: 'اختبار', onOk: vi.fn() } })
    const { unmount } = mount(<AdminPasswordModal />)
    await act(async () => { click(findButton('تأكيد')) })
    expect(document.body.textContent).toContain('يرجى إدخال كلمة السر أولاً')
    expect(useUiStore.getState().adminPasswordModal.open).toBe(true)
    unmount()
  })


  it('بوابة المدير في المخزن تمنع غير المدير وترمي تنبيهاً ولا تفتح النافذة', () => {
    window.getCurrentUser = vi.fn(() => ({ id: 'USR-2', role: 'employee' }))
    useUiStore.getState().openAdminPasswordModal()
    expect(useUiStore.getState().adminPasswordModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('للمدير فقط')
  })
})

describe('ChangePasswordModal (ui/modals/ChangePasswordModal.jsx)', () => {
  function open() {
    useUiStore.setState({ changePasswordModal: { open: true } })
  }

  it('عند غياب كلمة سر مسجلة يعرض banner ولا يظهر حقل الحالية', () => {
    window.adminPasswordConfigured = vi.fn(() => false)
    open()
    const { unmount } = mount(<ChangePasswordModal />)
    expect(document.body.textContent).toContain('لا توجد كلمة سر مسجلة')
    expect(document.body.textContent).not.toContain('كلمة السر الحالية')
    unmount()
  })

  it('تسجيل كلمة سر أولى يستدعي changeOwnPassword(\'\', fresh) ويغلق بنجاح', async () => {
    window.adminPasswordConfigured = vi.fn(() => false)
    window.changeOwnPassword = vi.fn(() => Promise.resolve(true))
    useUiStore.setState({ changePasswordModal: { open: true } })
    const { unmount } = mount(<ChangePasswordModal />)
    expect(document.body.textContent).toContain('لا توجد كلمة سر مسجلة لهذا الحساب')
    setInputValue(getInput('كلمة السر الجديدة'), '123456')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), '123456')
    await act(async () => { click(findButton('حفظ')) })
    expect(window.changeOwnPassword).toHaveBeenCalledWith('', '123456')
    expect(useUiStore.getState().changePasswordModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم تغيير كلمة السر بنجاح')
    unmount()
  })

  it('مع وجود كلمة سر يظهر حقل الحالية ويمرر القيمتين', () => {
    open()
    const { unmount } = mount(<ChangePasswordModal />)
    expect(document.body.textContent).toContain('كلمة السر الحالية')
    setInputValue(getInput('كلمة السر الحالية'), 'oldpass')
    setInputValue(getInput('كلمة السر الجديدة'), 'newpass6')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), 'newpass6')
    click(findButton('حفظ'))
    expect(window.changeOwnPassword).toHaveBeenCalledWith('oldpass', 'newpass6')
    unmount()
  })

  it('عدم تطابق التأكيد يمنع الحفظ ويظهر تنبيهاً', () => {
    open()
    const { unmount } = mount(<ChangePasswordModal />)
    setInputValue(getInput('كلمة السر الحالية'), 'oldpass')
    setInputValue(getInput('كلمة السر الجديدة'), 'newpass6')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), 'different')
    click(findButton('حفظ'))
    expect(window.changeOwnPassword).not.toHaveBeenCalled()
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('غير متطابقتين')
    expect(useUiStore.getState().changePasswordModal.open).toBe(true)
    unmount()
  })

  it('خطأ الخدمة يُعرض عبر toast ولا يُغلق النافذة', () => {
    window.changeOwnPassword = vi.fn(() => {
      throw new Error('يجب تسجيل الدخول أولاً لتغيير كلمة السر')
    })
    open()
    const { unmount } = mount(<ChangePasswordModal />)
    setInputValue(getInput('كلمة السر الحالية'), 'oldpass')
    setInputValue(getInput('كلمة السر الجديدة'), 'newpass6')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), 'newpass6')
    click(findButton('حفظ'))
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('يجب تسجيل الدخول أولاً')
    expect(useUiStore.getState().changePasswordModal.open).toBe(true)
    unmount()
  })
})

describe('CloudSyncModal (ui/modals/CloudSyncModal.jsx)', () => {
  it('يعرض حقول Firebase بقيم محمّلة ويستدعي saveFirebaseConfig عند الحفظ', () => {
    window.getFirebaseConfig = vi.fn(() => ({
      apiKey: 'AIzaSyTEST',
      projectId: 'proj-test',
      authDomain: 'proj.firebaseapp.com',
      storageBucket: 'proj.appspot.com',
      messagingSenderId: '123',
      appId: '1:123:web:abc',
      measurementId: 'G-TEST',
    }))
    window.saveFirebaseConfig = vi.fn()
    useUiStore.setState({ syncCloudModal: { open: true } })
    const { unmount } = mount(<CloudSyncModal />)
    expect(document.body.textContent).toContain('إعدادات الربط والسحابة 🔐')
    expect(getInput('API Key').value).toBe('AIzaSyTEST')
    click(findButton('حفظ إعدادات Firebase'))
    expect(window.saveFirebaseConfig).toHaveBeenCalled()
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم حفظ إعدادات اتصال Firebase بنجاح')
    unmount()
  })

  it('يركّب لوحة مزامنة Google Sheets عبر renderSyncPanel مع unlocked وردود التنبيهات', () => {
    useUiStore.setState({ syncCloudModal: { open: true } })
    const { unmount } = mount(<CloudSyncModal />)
    expect(window.GoogleSheetsSync.renderSyncPanel).toHaveBeenCalledTimes(1)
    const [el, opts] = window.GoogleSheetsSync.renderSyncPanel.mock.calls[0]
    expect(el).toBeTruthy()
    expect(opts.unlocked).toBe(true)
    expect(typeof opts.onSaved).toBe('function')
    expect(typeof opts.onSynced).toBe('function')
    expect(typeof opts.onError).toBe('function')
    unmount()
  })

  it('زر فتح الشيت يستدعي openSheetUrl', () => {
    useUiStore.setState({ syncCloudModal: { open: true } })
    const { unmount } = mount(<CloudSyncModal />)
    click(findButton('فتح الشيت'))
    expect(window.GoogleSheetsSync.openSheetUrl).toHaveBeenCalled()
    unmount()
  })

  it('في وضع الاختبار يعرض تحذيراً ويعطل الحفظ ولا يكتب إعدادات Firebase', () => {
    useSandboxStore.setState({ active: true })
    window.getFirebaseConfig = vi.fn(() => ({
      apiKey: 'AIzaSyTEST',
      projectId: 'proj-test',
      authDomain: 'proj.firebaseapp.com',
    }))
    window.saveFirebaseConfig = vi.fn()
    useUiStore.setState({ syncCloudModal: { open: true } })
    const { unmount } = mount(<CloudSyncModal />)
    expect(document.body.textContent).toContain('وضع الاختبار نشط')
    const saveBtn = findButton('حفظ إعدادات Firebase')
    expect(saveBtn).toBeTruthy()
    expect(saveBtn.disabled).toBe(true)
    expect(getInput('API Key').disabled).toBe(true)
    click(saveBtn)
    // محظور مزدوجاً: الزر معطّل + حارس saveFirebase يمنع الكتابة.
    expect(window.saveFirebaseConfig).not.toHaveBeenCalled()
    unmount()
  })

  it('بعد الخروج من وضع الاختبار يعود زر الحفظ متاحاً', () => {
    useSandboxStore.setState({ active: true })
    useUiStore.setState({ syncCloudModal: { open: true } })
    const { unmount } = mount(<CloudSyncModal />)
    expect(findButton('حفظ إعدادات Firebase').disabled).toBe(true)
    act(() => {
      useSandboxStore.setState({ active: false })
    })
    expect(findButton('حفظ إعدادات Firebase').disabled).toBe(false)
    expect(document.body.textContent).not.toContain('وضع الاختبار نشط')
    unmount()
  })

  it('بوابة uiStore تفتح النافذة للمدير', () => {
    useUiStore.getState().openSyncCloudModal()
    expect(useUiStore.getState().syncCloudModal.open).toBe(true)
    useUiStore.getState().closeSyncCloudModal()
    expect(useUiStore.getState().syncCloudModal.open).toBe(false)
  })
})
