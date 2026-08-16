import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import UsersView from '@/ui/views/UsersView'
import UserModal from '@/ui/modals/UserModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { formatDate } from '@/utils/formatters'

const USERS = [
  { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin', createdAt: '2026-07-01T10:00:00Z' },
  { id: 'USR-2001', name: 'أحمد محمود علي', email: 'ahmed@store.com', role: 'storekeeper', createdAt: '2026-07-05T10:00:00Z' },
  { id: 'USR-2002', name: 'سارة محمد حسن', email: 'sara@store.com', role: 'employee', createdAt: '2026-07-10T10:00:00Z' },
]

const ADMIN = { id: 'USR-1001', email: 'admin@store.com', role: 'admin' }

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
}

beforeEach(() => {
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
  window.getUsers = vi.fn(() => USERS)
  window.isAdmin = vi.fn(() => true)
  window.getCurrentUser = vi.fn(() => ADMIN)
  window.createNewUserAccount = vi.fn(() => Promise.resolve())
  window.updateUserAccount = vi.fn(() => Promise.resolve())
  window.deleteUserAccount = vi.fn(() => Promise.resolve(true))
})

afterEach(() => {
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
})

describe('UsersView (ui/views/UsersView.jsx)', () => {
  it('يعرض الهيدر والجدول بكل الموظفين وشارات الرتب وأزرار الإجراءات', () => {
    const { host, unmount } = mount(<UsersView />)
    expect(host.textContent).toContain('إدارة الحسابات وصلاحيات الموظفين')
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)

    expect(rows[0].textContent).toContain('USR-1001')
    expect(rows[0].textContent).toContain('المدير العام')
    expect(rows[0].textContent).toContain('مدير النظام (Admin)')
    expect(rows[0].textContent).toContain('admin@store.com')
    expect(rows[0].textContent).toContain(formatDate('2026-07-01T10:00:00Z'))
    expect(rows[0].textContent).toContain('تعديل والرمز 🔑')
    expect(rows[0].textContent).not.toContain('إزالة الحساب')

    expect(rows[1].textContent).toContain('USR-2001')
    expect(rows[1].textContent).toContain('أحمد محمود علي')
    expect(rows[1].textContent).toContain('أمين مخزن (Storekeeper)')
    expect(rows[1].textContent).toContain('إزالة الحساب')

    expect(rows[2].textContent).toContain('سارة محمد حسن')
    expect(rows[2].textContent).toContain('كاشير / موظف مبيعات (Cashier / Sales)')
    unmount()
  })

  it('غير المدير يرى شاشة المنع ولا يرى الجدول', () => {
    window.isAdmin = vi.fn(() => false)
    const { host, unmount } = mount(<UsersView />)
    expect(host.textContent).toContain('عفواً! الصفحة خاصة بالمدير فقط')
    expect(host.textContent).toContain('ليس لديك الصلاحية الكافية')
    expect(host.textContent).not.toContain('إدارة الحسابات وصلاحيات الموظفين')
    unmount()
  })

  it('زر إضافة موظف / حساب جديد يفتح نافذة إنشاء الحساب', () => {
    const { host, unmount } = mount(<UsersView />)
    const addBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent.includes('إضافة موظف / حساب جديد')
    )
    click(addBtn)
    expect(useUiStore.getState().userModal.open).toBe(true)
    expect(useUiStore.getState().userModal.userId).toBeNull()
    unmount()
  })

  it('زر تعديل والرمز يفتح نافذة التعديل بمعرف المستخدم', () => {
    const { host, unmount } = mount(<UsersView />)
    const editBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent.includes('تعديل والرمز')
    )
    click(editBtn)
    expect(useUiStore.getState().userModal.open).toBe(true)
    expect(useUiStore.getState().userModal.userId).toBe('USR-1001')
    unmount()
  })

  it('زر إزالة الحساب يستدعي deleteUserAccount بعد التأكيد ويحدّث القائمة', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { host, unmount } = mount(<UsersView />)
    const deleteBtns = Array.from(host.querySelectorAll('button')).filter(b =>
      b.textContent.includes('إزالة الحساب')
    )
    expect(deleteBtns).toHaveLength(2)
    const delBtn = deleteBtns.find(b => b.closest('tr').textContent.includes('أحمد محمود علي'))
    click(delBtn)
    expect(window.deleteUserAccount).toHaveBeenCalledWith('USR-2001')
    await act(async () => {})
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم إزالة حساب "أحمد محمود علي" بنجاح')
    unmount()
  })

  it('يعرض رسالة فارغة عند عدم وجود موظفين', () => {
    window.getUsers = vi.fn(() => [])
    const { host, unmount } = mount(<UsersView />)
    expect(host.textContent).toContain('لا يوجد موظفين مسجلين')
    unmount()
  })

  it('بوابة uiStore تمنع غير المدير من فتح نافذة المستخدمين', () => {
    window.getCurrentUser = vi.fn(() => ({ id: 'USR-9', email: 'emp@store.com', role: 'employee' }))
    useUiStore.getState().openUserModal()
    expect(useUiStore.getState().userModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('مخصصة للمدير العام فقط')
  })
})

describe('UserModal (ui/modals/UserModal.jsx)', () => {
  function openModal(userId = null) {
    useUiStore.setState({ userModal: { open: true, userId, onDone: null } })
  }

  // النافذة تُعرض عبر createPortal في #modal-container (داخل document.body)
  function modalButtons() {
    return Array.from(document.body.querySelectorAll('button'))
  }

  it('يعرض نموذج الإنشاء ويحفظ عبر createNewUserAccount بالبيانات الصحيحة', async () => {
    openModal()
    const { host, unmount } = mount(<UserModal />)
    expect(document.body.textContent).toContain('إضافة موظف وحساب جديد للسيستم')

    setInputValue(getInput('اسم الموظف الثلاثي', document), 'خالد إبراهيم')
    setInputValue(getInput('البريد الإلكتروني', document), 'khaled@store.com')
    setInputValue(getInput('كلمة المرور للدخول', document), '123456')
    setSelectValue(getSelect('الصلاحية / الرتبة', document), 'storekeeper')
    click(modalButtons().find(b => b.textContent.includes('إنشاء الحساب وتفعيل الصلاحية')))

    // V3.41 — createNewUserAccount is async (creates the Firebase Auth account
    // too), so flush the microtask queue before asserting the toast/close.
    await act(async () => { await Promise.resolve(); })

    expect(window.createNewUserAccount).toHaveBeenCalledWith({
      name: 'خالد إبراهيم',
      email: 'khaled@store.com',
      password: '123456',
      role: 'storekeeper',
    })
    expect(useUiStore.getState().userModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم إنشاء حساب الموظف وتفعيل الصلاحية بنجاح')
    unmount()
  })

  it('كلمة المرور أقل من 6 أحرف تمنع الإنشاء', () => {
    openModal()
    const { host, unmount } = mount(<UserModal />)
    setInputValue(getInput('اسم الموظف الثلاثي', document), 'خالد إبراهيم')
    setInputValue(getInput('البريد الإلكتروني', document), 'khaled@store.com')
    setInputValue(getInput('كلمة المرور للدخول', document), '123')
    click(modalButtons().find(b => b.textContent.includes('إنشاء الحساب وتفعيل الصلاحية')))

    expect(window.createNewUserAccount).not.toHaveBeenCalled()
    expect(useUiStore.getState().userModal.open).toBe(true)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('كلمة المرور يجب ألا تقل عن 6 أحرف')
    unmount()
  })

  it('وضع التعديل يعبّئ الحقول وقائمة الرتبة معطلة للمدير العام الرئيسي', () => {
    openModal('USR-1001')
    const { host, unmount } = mount(<UserModal />)
    expect(document.body.textContent).toContain('تعديل بيانات وكلمة سر: المدير العام')
    expect(getInput('اسم الموظف', document).value).toBe('المدير العام')
    expect(getInput('البريد الإلكتروني', document).value).toBe('admin@store.com')

    const roleSelect = getSelect('الصلاحية / الرتبة', document)
    expect(roleSelect.disabled).toBe(true)
    expect(roleSelect.value).toBe('admin')
    expect(document.body.textContent).toContain('لا يمكن تغيير صلاحية المدير العام الرئيسي')

    setInputValue(getInput('اسم الموظف', document), 'المدير العام (معدل)')
    click(modalButtons().find(b => b.textContent.includes('حفظ التعديلات وكلمة المرور')))
    expect(window.updateUserAccount).toHaveBeenCalledWith(
      'USR-1001',
      expect.objectContaining({ name: 'المدير العام (معدل)', role: 'admin' })
    )
    unmount()
  })

  it('وضع التعديل لموظف عادي يسمح بتغيير الرتبة ويحفظها', () => {
    openModal('USR-2002')
    const { host, unmount } = mount(<UserModal />)
    const roleSelect = getSelect('الصلاحية / الرتبة', document)
    expect(roleSelect.disabled).toBe(false)
    expect(roleSelect.value).toBe('employee')

    setSelectValue(roleSelect, 'storekeeper')
    click(modalButtons().find(b => b.textContent.includes('حفظ التعديلات وكلمة المرور')))
    expect(window.updateUserAccount).toHaveBeenCalledWith(
      'USR-2002',
      expect.objectContaining({ role: 'storekeeper' })
    )
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم تعديل بيانات ورمز حساب "سارة محمد حسن" بنجاح')
    unmount()
  })
})
