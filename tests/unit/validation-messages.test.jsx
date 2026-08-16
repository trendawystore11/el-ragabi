import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AppShell from '@/ui/layout/AppShell'
import LoginView from '@/ui/views/LoginView'
import AddSupplierModal from '@/ui/modals/AddSupplierModal'
import AddCustomerModal from '@/ui/modals/AddCustomerModal'
import AddProductModal from '@/ui/modals/AddProductModal'
import ChangePasswordModal from '@/ui/modals/ChangePasswordModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useAuthStore } from '@/state/authStore'
import { useToastStore } from '@/ui/components/toastStore'

const ADMIN = { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }

async function flushAsync() {
  // يُنهي سلاسل الوعود المرتبطة بالتحميل الكسول (React.lazy) داخل AppShell.
  for (let i = 0; i < 15; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

beforeAll(async () => {
  // تسخين وحدات AppShell الكسولة (الشاشة والنوافذ التي تفتح في سيناريو الربط).
  await Promise.all([
    import('@/ui/views/Dashboard.jsx'),
    import('@/ui/modals/AdminPasswordModal.jsx'),
    import('@/ui/modals/CloudSyncModal.jsx'),
  ])
})

const RESET_UI = {
  orderModal: { open: false, onSuccess: null },
  orderDetailsModal: { open: false, orderId: null },
  orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null },
  customerModal: { open: false, customerId: null, onDone: null },
  productModal: { open: false, productId: null, onDone: null },
  shipmentModal: { open: false, productId: null, onDone: null },
  supplierModal: { open: false, supplierId: null, onDone: null },
  supplierReturnModal: { open: false, supplierId: null, onDone: null },
  expenseModal: { open: false, expenseId: null, onDone: null },
  wipeDatabaseModal: { open: false },
  paymentModal: { open: false, defaults: null, onDone: null },
  userModal: { open: false, userId: null, onDone: null },
  adminPasswordModal: { open: false, note: null, onOk: null },
  changePasswordModal: { open: false },
  syncCloudModal: { open: false },
  statementModal: { open: false, entityType: null, entityId: null },
}

function body() {
  return document.body
}

function mountComponent(Component) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Component />)
  })
  return {
    host,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
      document.getElementById('modal-container')?.remove()
    },
  }
}

function click(el) {
  act(() => {
    el.click()
  })
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, String(value))
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

function getInput(labelText) {
  const labels = Array.from(body().querySelectorAll('label'))
  const label =
    labels.find(l => l.hasAttribute('for') && l.textContent.includes(labelText)) ||
    labels.find(l => l.textContent.includes(labelText))
  if (!label) throw new Error(`label not found: ${labelText}`)
  const id = label.getAttribute('for')
  return id ? document.getElementById(id) : label.querySelector('input,select,textarea')
}

function getSelect(labelText) {
  const el = getInput(labelText)
  if (el.tagName !== 'SELECT') throw new Error(`expected select for: ${labelText}`)
  return el
}

function findButton(text) {
  return Array.from(body().querySelectorAll('button')).find(b => b.textContent.includes(text))
}

function findByTitle(title) {
  return Array.from(body().querySelectorAll('button')).find(b => b.getAttribute('title') === title)
}

function submitForm() {
  act(() => {
    body().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function lastToastMessage() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1].message : ''
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  useAuthStore.setState({ user: null, authed: false, role: null })
  window.getOrders = vi.fn(() => [])
  window.getProducts = vi.fn(() => [])
  window.getSuppliers = vi.fn(() => [])
  window.getCustomers = vi.fn(() => [])
  window.getExpenses = vi.fn(() => [])
  window.getPayments = vi.fn(() => [])
  window.getUsers = vi.fn(() => [])
  window.getProductById = vi.fn(() => null)
  window.getSupplierById = vi.fn(() => null)
  window.getCustomerById = vi.fn(() => null)
  window.getCustomerAddresses = vi.fn(() => [])
  window.createSupplier = vi.fn(() => ({ id: 'SUP-NEW' }))
  window.updateSupplier = vi.fn(() => ({}))
  window.createCustomer = vi.fn(() => ({ id: 'CUST-NEW' }))
  window.updateCustomer = vi.fn(() => ({}))
  window.createProduct = vi.fn(() => ({ id: 'PRD-NEW' }))
  window.updateProduct = vi.fn(() => ({}))
  window.isAdmin = vi.fn(() => true)
  window.adminPasswordConfigured = vi.fn(() => true)
  window.changeOwnPassword = vi.fn()
  window.verifyAdminPassword = vi.fn(() => false)
  window.getCurrentUser = vi.fn(() => ADMIN)
  window.syncWithGoogleSheets = vi.fn(() => Promise.resolve())
})

afterEach(() => {
  useToastStore.setState({ toasts: [] })
  useUiStore.setState(RESET_UI)
  useAuthStore.setState({ user: null, authed: false, role: null })
})

describe('AddSupplierModal — رسائل الخطأ المضمّنة', () => {
  it('الحقول الإجبارية الفارغة تمنع الحفظ وتعرض خطأ أسفل كل حقل + toast', () => {
    useUiStore.getState().openAddSupplierModal(null, null)
    const { unmount } = mountComponent(AddSupplierModal)
    submitForm()
    expect(body().textContent).toContain('يرجى إدخال اسم المورد / المصنع')
    expect(body().textContent).toContain('يرجى إدخال رقم الهاتف')
    expect(lastToastMessage()).toContain('يرجى إدخال اسم المورد / المصنع')
    expect(window.createSupplier).not.toHaveBeenCalled()
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    unmount()
  })

  it('رقم هاتف غير صحيح يظهر خطأ أحمر أسفل الحقل ويمنع الحفظ', () => {
    useUiStore.getState().openAddSupplierModal(null, null)
    const { unmount } = mountComponent(AddSupplierModal)
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع النور')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01234')
    submitForm()
    expect(body().textContent).toContain('يرجى إدخال رقم هاتف صحيح')
    expect(window.createSupplier).not.toHaveBeenCalled()
    unmount()
  })

  it('تصحيح الحقل يزيل رسالة الخطأ ويعيد الحفظ الناجح', () => {
    useUiStore.getState().openAddSupplierModal(null, null)
    const { unmount } = mountComponent(AddSupplierModal)
    submitForm()
    expect(body().textContent).toContain('يرجى إدخال اسم المورد / المصنع')
    setInputValue(getInput('اسم المورد / المصنع'), 'مصنع النور')
    expect(body().textContent).not.toContain('يرجى إدخال اسم المورد / المصنع')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    submitForm()
    expect(window.createSupplier).toHaveBeenCalled()
    unmount()
  })
})

describe('AddCustomerModal — رسائل الخطأ المضمّنة', () => {
  it('اسم العميل الفارغ ورقم الهاتف الفارغ يمنعان الحفظ ويعرضان الخطأ', () => {
    useUiStore.getState().openAddCustomerModal(null, null)
    const { unmount } = mountComponent(AddCustomerModal)
    submitForm()
    expect(body().textContent).toContain('يرجى إدخال اسم العميل')
    expect(body().textContent).toContain('يرجى إدخال رقم الهاتف')
    expect(window.createCustomer).not.toHaveBeenCalled()
    unmount()
  })

  it('هاتف ثانوي غير صحيح يظهر خطأ أسفل الحقل', () => {
    useUiStore.getState().openAddCustomerModal(null, null)
    const { unmount } = mountComponent(AddCustomerModal)
    setInputValue(getInput('اسم العميل'), 'أحمد محمد')
    setInputValue(getInput('رقم الهاتف (11 رقماً يبدأ بـ 01)'), '01012345678')
    setInputValue(getInput('رقم هاتف ثانوي (اختياري)'), '09999')
    submitForm()
    expect(body().textContent).toContain('يرجى إدخال رقم هاتف صحيح')
    expect(window.createCustomer).not.toHaveBeenCalled()
    unmount()
  })
})

describe('AddProductModal — رسائل الخطأ المضمّنة', () => {
  it('اسم المنتج والمورد الإجباريان يمنعان الحفظ ويعرضان الخطأ', () => {
    useUiStore.getState().openAddProductModal(null, null)
    const { unmount } = mountComponent(AddProductModal)
    submitForm()
    expect(body().textContent).toContain('يرجى إدخال اسم المنتج')
    expect(body().textContent).toContain('يرجى اختيار المورد المصنع للمنتج')
    expect(window.createProduct).not.toHaveBeenCalled()
    unmount()
  })
})

describe('LoginView — رسائل الخطأ المضمّنة', () => {
  it('الحقول الفارغة تمنع تسجيل الدخول وتعرض خطأ أسفل كل حقل', async () => {
    const loginSpy = vi.spyOn(useAuthStore.getState(), 'login')
    const { host, unmount } = mountComponent(LoginView)
    click(findButton('تسجيل الدخول'))
    expect(host.textContent).toContain('يرجى إدخال البريد الإلكتروني')
    expect(host.textContent).toContain('يرجى إدخال كلمة المرور')
    expect(loginSpy).not.toHaveBeenCalled()
    unmount()
  })

  it('بريد إلكتروني غير صحيح يظهر رسالة تنسيق', () => {
    const loginSpy = vi.spyOn(useAuthStore.getState(), 'login')
    const { host, unmount } = mountComponent(LoginView)
    setInputValue(getInput('البريد الإلكتروني'), 'not-an-email')
    setInputValue(getInput('كلمة المرور'), 'secret')
    click(findButton('تسجيل الدخول'))
    expect(host.textContent).toContain('يرجى إدخال بريد إلكتروني صحيح')
    expect(loginSpy).not.toHaveBeenCalled()
    unmount()
  })
})

describe('ChangePasswordModal — رسائل الخطأ المضمّنة', () => {
  function open() {
    useUiStore.setState({ changePasswordModal: { open: true } })
  }

  it('كلمة سر جديدة قصيرة تمنع الحفظ وتعرض خطأ أسفل الحقل', () => {
    open()
    const { unmount } = mountComponent(ChangePasswordModal)
    setInputValue(getInput('كلمة السر الحالية'), 'oldpass')
    setInputValue(getInput('كلمة السر الجديدة'), '123')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), '123')
    click(findButton('حفظ'))
    expect(body().textContent).toContain('كلمة السر الجديدة يجب ألا تقل عن 6 أحرف')
    expect(window.changeOwnPassword).not.toHaveBeenCalled()
    unmount()
  })

  it('عدم تطابق التأكيد يمنع الحفظ ويعرض خطأ أسفل حقل التأكيد', () => {
    open()
    const { unmount } = mountComponent(ChangePasswordModal)
    setInputValue(getInput('كلمة السر الحالية'), 'oldpass')
    setInputValue(getInput('كلمة السر الجديدة'), '123456')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), '654321')
    click(findButton('حفظ'))
    expect(body().textContent).toContain('كلمة السر الجديدة وتأكيدها غير متطابقتين')
    expect(window.changeOwnPassword).not.toHaveBeenCalled()
    unmount()
  })
})

describe('سيناريو: تغيير كلمة السر ← فتح إعدادات الربط والسحابة', () => {
  it('بعد تسجيل كلمة سر المدير تُقبل مباشرة في نافذة الربط دون رسالة «سجّلها أولاً»', async () => {
    useAuthStore.setState({ user: ADMIN, authed: true, role: 'admin' })
    window.adminPasswordConfigured = vi.fn(() => false)
    window.changeOwnPassword = vi.fn(() => {
      window.adminPasswordConfigured.mockReturnValue(true)
      return Promise.resolve(true)
    })
    window.verifyAdminPassword = vi.fn(() => Promise.resolve(true))

    const { unmount } = mountComponent(AppShell)
    await flushAsync()

    // 1) قائمة الحساب ← تغيير كلمة السر (لا كلمة سر مسجلة بعد)
    click(findByTitle('قائمة الحساب'))
    await flushAsync()
    click(findButton('تغيير كلمة السر'))
    await flushAsync()
    expect(useUiStore.getState().changePasswordModal.open).toBe(true)
    setInputValue(getInput('كلمة السر الجديدة'), 'newpass6')
    setInputValue(getInput('تأكيد كلمة السر الجديدة'), 'newpass6')
    click(findButton('حفظ'))
    await flushAsync()
    expect(window.changeOwnPassword).toHaveBeenCalledWith('', 'newpass6')
    expect(useAuthStore.getState().adminPasswordConfigured).toBe(true)

    // 2) قائمة الحساب ← إعدادات الربط والسحابة → تُقبل كلمة السر الجديدة مباشرة
    click(findByTitle('قائمة الحساب'))
    await flushAsync()
    click(findButton('إعدادات الربط والسحابة'))
    await flushAsync()
    expect(useUiStore.getState().adminPasswordModal.open).toBe(true)
    expect(body().textContent).not.toContain('لا توجد كلمة سر مسجلة')
    setInputValue(getInput('كلمة السر'), 'newpass6')
    click(findButton('تأكيد'))
    await flushAsync()
    expect(useUiStore.getState().syncCloudModal.open).toBe(true)
    expect(body().textContent).toContain('إعدادات الربط والسحابة 🔐')
    unmount()
  })

})
