import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AppShell from '@/ui/layout/AppShell'
import { useOrdersStore } from '@/state/ordersStore'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { useUiStore } from '@/ui/state/uiStore'

beforeAll(async () => {
  // تسخين وحدات React.lazy قبل الاختبارات: استيراد ثابت للوحدات نفسها يجعل
  // import(...) داخل AppShell يتحلل فوراً من ذاكرة التخزين المؤقت بدل الانتظار
  // لبناء مخطط الوحدات في vitest (يمنع تماوج السباق في أول الاختبارات).
  await Promise.all([
    import('@/ui/views/Dashboard.jsx'),
    import('@/ui/views/OrdersView.jsx'),
    import('@/ui/views/CustomersView.jsx'),
    import('@/ui/views/ProductsView.jsx'),
    import('@/ui/views/SuppliersView.jsx'),
    import('@/ui/views/ExpensesView.jsx'),
    import('@/ui/views/ReportsView.jsx'),
    import('@/ui/views/PaymentsView.jsx'),
    import('@/ui/views/UsersView.jsx'),
    import('@/ui/views/SettingsView.jsx'),
    import('@/ui/modals/OrderModal.jsx'),
    import('@/ui/modals/PosModal.jsx'),
    import('@/ui/modals/AiAssistantModal.jsx'),
    import('@/ui/modals/OrderDetailsModal.jsx'),
    import('@/ui/modals/OrderStatusModal.jsx'),
    import('@/ui/modals/AddCustomerModal.jsx'),
    import('@/ui/modals/AddProductModal.jsx'),
    import('@/ui/modals/ShipmentModal.jsx'),
    import('@/ui/modals/AddSupplierModal.jsx'),
    import('@/ui/modals/SupplierReturnModal.jsx'),
    import('@/ui/modals/AddExpenseModal.jsx'),
    import('@/ui/modals/WipeDatabaseModal.jsx'),
    import('@/ui/modals/PaymentModal.jsx'),
    import('@/ui/modals/UserModal.jsx'),
    import('@/ui/modals/AdminPasswordModal.jsx'),
    import('@/ui/modals/ChangePasswordModal.jsx'),
    import('@/ui/modals/CloudSyncModal.jsx'),
    import('@/ui/modals/StatementModal.jsx'),
    import('@/ui/modals/ContentModal.jsx'),
  ])
})

const SEED = [
  { id: 'ORD-001', customerName: 'أحمد محمد', customerPhone: '01012345678', totalAmount: 1000, downPayment: 400, shippingCost: 50, status: 'new', depositType: 'shipping', createdAt: '2026-01-01T10:00:00' },
  { id: 'ORD-002', customerName: 'سارة علي', customerPhone: '01198765432', totalAmount: 2500, downPayment: 2500, shippingCost: 100, status: 'completed', depositType: 'cash', createdAt: '2026-01-02T10:00:00' },
]

async function flushAsync() {
  // يُنهي سلاسل الوعود المرتبطة بالتحميل الكسول (React.lazy / dynamic import) —
  // دورات متعددة لأن استيراد الوحدة في vitest قد يستغرق أكثر من دورة واحدة.
  for (let i = 0; i < 15; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

async function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  await flushAsync()
  return {
    host,
    root,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

async function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flushAsync()
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  useOrdersStore.setState({ orders: [], ready: false, search: '', status: '' })
  useAuthStore.setState({ user: null, authed: false, role: 'admin' })
  useUiStore.setState({
    orderModal: { open: false, onSuccess: null },
    posModal: { open: false, onSuccess: null },
    aiAssistantModal: { open: false },
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
  })
  window.getOrders = vi.fn(() => SEED)
  window.getProducts = vi.fn(() => [])
  window.getSuppliers = vi.fn(() => [])
  window.getCustomers = vi.fn(() => [])
  window.getExpenses = vi.fn(() => [])
  window.getPayments = vi.fn(() => [])
  window.openPaymentModal = vi.fn()
  window.getUsers = vi.fn(() => [])
  window.isAdmin = vi.fn(() => false)
})

describe('AppShell (ui/layout/AppShell.jsx)', () => {
  it('يعرض الشريط الجانبي ورأس التطبيق ولوحة التحكم كافتراضية', async () => {
    const { host, unmount } = await mount(<AppShell />)
    const appName = useSettingsStore.getState().appName
    expect(host.textContent).toContain(appName)
    expect(host.textContent).toContain('سجل الطلبات')
    expect(host.textContent).toContain('لوحة التحكم')
    expect(host.textContent).toContain('لوحة التحكم والرصد اليومي')
    expect(host.textContent).toContain('إجمالي المبيعات')
    expect(host.textContent).toContain('زائر')
    unmount()
  })

  it('النقر على سجل الطلبات يعرض شاشة الطلبات', async () => {
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    const ordersNav = navButtons.find(b => b.textContent.includes('سجل الطلبات'))
    await click(ordersNav)
    expect(host.textContent).toContain('سجل الطلبات والفواتير')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
    unmount()
  })

  it('النقر على التقارير يعرض شاشة التقارير اليومية', async () => {
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    const reports = navButtons.find(b => b.textContent.includes('التقارير'))
    await click(reports)
    expect(host.textContent).toContain('التقارير اليومية، صافي الأرباح ومصاريف التشغيل')
    expect(host.textContent).toContain('إعادة احتساب الأرباح والتقارير')
    unmount()
  })

  it('النقر على إدارة المدفوعات يعرض شاشة التحصيلات والمدفوعات', async () => {
    window.getPayments = vi.fn(() => [
      { id: 'PAY-001', entityType: 'customer', entityId: 'CUST-1', entityName: 'أحمد محمد', amount: 1000, paymentMethod: 'cash', notes: '', createdAt: '2026-08-01T10:00:00' },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('إدارة المدفوعات')))
    expect(host.textContent).toContain('إدارة التحصيلات والمدفوعات')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('أحمد محمد')
    unmount()
  })

  it('النقر على المستخدمون يعرض لوحة الموظفين للمدير', async () => {
    window.isAdmin = vi.fn(() => true)
    window.getUsers = vi.fn(() => [
      { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin', createdAt: '2026-07-01T10:00:00Z' },
      { id: 'USR-2001', name: 'أحمد محمود علي', email: 'ahmed@store.com', role: 'storekeeper', createdAt: '2026-07-05T10:00:00Z' },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('المستخدمون')))
    expect(host.textContent).toContain('إدارة الحسابات وصلاحيات الموظفين')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(host.textContent).toContain('المدير العام')
    expect(host.textContent).toContain('أحمد محمود علي')
    unmount()
  })

  it('النقر على الإعدادات يعرض شاشة إعدادات النظام للمسجّل', async () => {
    useAuthStore.setState({ user: { id: 'USR-1', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }, authed: true, role: 'admin' })
    window.generalSettings.pushToCloud = vi.fn(() => Promise.resolve(false))
    window.generalSettings.hydrateFromCloud = vi.fn(() => Promise.resolve(false))
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('الإعدادات')))
    expect(host.textContent).toContain('إعدادات النظام')
    expect(host.textContent).toContain('إعدادات النظام العامة')
    expect(host.textContent).toContain('اسم النظام / التطبيق')
    unmount()
  })

  it('زر إنشاء طلب جديد في سجل الطلبات يفتح نافذة فاتورة البيع الجديدة', async () => {
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'منتج أ', stock: 5, purchasePrice: 100, sellingPrice: 150 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('سجل الطلبات')))
    const createBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent.includes('إنشاء طلب جديد')
    )
    await click(createBtn)
    expect(document.body.textContent).toContain('إنشاء طلب جديد / فاتورة بيع')
    expect(document.body.textContent).toContain('بيانات العميل')
    expect(document.body.textContent).toContain('حفظ وتأكيد الطلب')
    unmount()
  })

  it('النقر على العملاء يعرض شاشة دليل العملاء', async () => {
    window.getCustomers = vi.fn(() => [
      { id: 'CUST-1', name: 'أحمد محمد', phone: '01012345678', category: 'تاجر جملة', address: 'القاهرة - مدينة نصر', totalPurchases: 1000, paid: 400, remainingBalance: 600, ordersCount: 2 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('العملاء')))
    expect(host.textContent).toContain('دليل العملاء وحسابات الديون')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('أحمد محمد')
    unmount()
  })

  it('النقر على المنتجات يعرض شاشة دليل المنتجات', async () => {
    window.getProducts = vi.fn(() => [
      { id: 'PRD-1', name: 'بطانية مورا', code: 'SKU-1', stock: 5, minStock: 5, supplierId: 'SUP-1', supplierName: 'مصنع النور', purchasePrice: 1000, sellingPrice: 1400 },
    ])
    window.getSuppliers = vi.fn(() => [{ id: 'SUP-1', name: 'مصنع النور', phone: '01012345678' }])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('المنتجات')))
    expect(host.textContent).toContain('دليل المنتجات وإدارة المخزون')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('بطانية مورا')
    unmount()
  })

  it('النقر على الموردين يعرض شاشة دليل الموردين', async () => {
    window.getSuppliers = vi.fn(() => [
      { id: 'SUP-1', name: 'مصنع النور', phone: '01012345678', secondaryPhone: '', address: 'القاهرة - مدينة نصر', totalPurchases: 1000, paid: 400, remainingBalance: 600 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('الموردون')))
    expect(host.textContent).toContain('دليل الموردين والمصانع')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('مصنع النور')
    unmount()
  })

  it('النقر على المصروفات يعرض شاشة دليل المصروفات', async () => {
    window.getExpenses = vi.fn(() => [
      { id: 'EXP-1', title: 'إيجار المحل', amount: 5000, category: 'إيجارات', date: '2026-08-01', notes: '', recurring: false, dueDay: null },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    await click(navButtons.find(b => b.textContent.includes('المصروفات')))
    expect(host.textContent).toContain('دليل مصاريف التشغيل والمصروفات الإدارية')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('إيجار المحل')
    unmount()
  })

  it('زر تبديل المظهر يقلّب الثيم في المخزن', async () => {
    const { host, unmount } = await mount(<AppShell />)
    const before = useSettingsStore.getState().theme
    const header = host.querySelector('header')
    const toggle = Array.from(header.querySelectorAll('button')).find(b => b.title === 'تبديل المظهر')
    await click(toggle)
    const after = useSettingsStore.getState().theme
    expect(after).not.toBe(before)
    expect(after).toBe(before === 'light-professional' ? 'graphite' : 'light-professional')
    unmount()
  })

  it('يعرض بيانات المستخدم المسجّل في الرأس', async () => {
    useAuthStore.setState({ user: { id: 'USR-1', name: 'أحمد المصري', email: 'a@x.com', role: 'admin' }, authed: true, role: 'admin' })
    const { host, unmount } = await mount(<AppShell />)
    expect(host.textContent).toContain('أحمد المصري')
    expect(host.textContent).toContain('admin')
    unmount()
  })

  it('قائمة الحساب تعرض خيارات الربط والسحابة وتغيير كلمة السر وتسجيل الخروج للمدير', async () => {
    useAuthStore.setState({ user: { id: 'USR-1', name: 'أحمد المصري', email: 'a@x.com', role: 'admin' }, authed: true, role: 'admin' })
    window.getCurrentUser = vi.fn(() => ({ id: 'USR-1', name: 'أحمد المصري', email: 'a@x.com', role: 'admin' }))
    const { host, unmount } = await mount(<AppShell />)
    const trigger = Array.from(host.querySelectorAll('header button')).find(b => b.title === 'قائمة الحساب')
    await click(trigger)
    expect(host.textContent).toContain('إعدادات الربط والسحابة 🔐')
    expect(host.textContent).toContain('تغيير كلمة السر')
    expect(host.textContent).toContain('تسجيل الخروج')
    unmount()
  })

  it('الحساب غير المدير لا يرى خيار إعدادات الربط والسحابة في قائمة الحساب', async () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'موظف', email: 'e@x.com', role: 'employee' }, authed: true, role: 'employee' })
    const { host, unmount } = await mount(<AppShell />)
    const trigger = Array.from(host.querySelectorAll('header button')).find(b => b.title === 'قائمة الحساب')
    await click(trigger)
    expect(host.textContent).not.toContain('إعدادات الربط والسحابة')
    expect(host.textContent).toContain('تغيير كلمة السر')
    unmount()
  })

  it('اختيار تغيير كلمة السر من قائمة الحساب يفتح النافذة', async () => {
    useAuthStore.setState({ user: { id: 'USR-1', name: 'أحمد المصري', email: 'a@x.com', role: 'admin' }, authed: true, role: 'admin' })
    window.getCurrentUser = vi.fn(() => ({ id: 'USR-1', name: 'أحمد المصري', email: 'a@x.com', role: 'admin' }))
    window.adminPasswordConfigured = vi.fn(() => true)
    window.changeOwnPassword = vi.fn()
    const { host, unmount } = await mount(<AppShell />)
    const trigger = Array.from(host.querySelectorAll('header button')).find(b => b.title === 'قائمة الحساب')
    await click(trigger)
    await click(Array.from(host.querySelectorAll('header button')).find(b => b.textContent.includes('تغيير كلمة السر')))
    expect(useUiStore.getState().changePasswordModal.open).toBe(true)
    expect(document.body.textContent).toContain('كلمة السر الحالية')
    unmount()
  })

  it('تسلسل إعدادات الربط والسحابة: تأكيد هوية المدير ثم فتح النافذة', async () => {
    useAuthStore.setState({ user: { id: 'USR-1', name: 'أحمد المصري', email: 'a@x.com', role: 'admin' }, authed: true, role: 'admin' })
    window.adminPasswordConfigured = vi.fn(() => true)
    window.verifyAdminPassword = vi.fn(() => Promise.resolve(true))
    window.GoogleSheetsSync = { renderSyncPanel: vi.fn(), openSheetUrl: vi.fn() }
    const { host, unmount } = await mount(<AppShell />)
    const trigger = Array.from(host.querySelectorAll('header button')).find(b => b.title === 'قائمة الحساب')
    await click(trigger)
    await click(Array.from(host.querySelectorAll('header button')).find(b => b.textContent.includes('إعدادات الربط والسحابة')))
    expect(useUiStore.getState().adminPasswordModal.open).toBe(true)
    const passwordLabel = Array.from(document.querySelectorAll('label')).find(
      l => l.hasAttribute('for') && l.textContent.trim().startsWith('كلمة السر')
    )
    const passwordInput = document.getElementById(passwordLabel.getAttribute('for'))
    setInputValue(passwordInput, 'secret')
    const confirmBtn = Array.from(document.body.querySelectorAll('button')).find(b =>
      b.textContent.includes('✓ تأكيد')
    )
    await click(confirmBtn)
    expect(useUiStore.getState().syncCloudModal.open).toBe(true)
    expect(document.body.textContent).toContain('إعدادات الربط والسحابة 🔐')
    unmount()
  })

  it('أمين المخزن يرى شاشة المنتجات كافتراضية وقائمة المنتجات فقط في التنقل', async () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'أمين المخزن', email: 's@x.com', role: 'storekeeper' }, authed: true, role: 'storekeeper' })
    window.getProducts = vi.fn(() => [
      { id: 'PRD-1', name: 'بطانية مورا', code: 'SKU-1', stock: 5, minStock: 5, supplierId: 'SUP-1', supplierName: 'مصنع النور', purchasePrice: 1000, sellingPrice: 1400 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    expect(host.textContent).toContain('دليل المنتجات وإدارة المخزون')
    const navButtons = Array.from(host.querySelectorAll('aside nav button'))
    expect(navButtons.map(b => b.textContent.trim())).toEqual(['المنتجات'])
    unmount()
  })

  it('أمين المخزن لا يرى أزرار الهيدر (إنشاء طلب/كاشير/مزامنة/وضع اختبار) ولا زر مساعد AI', async () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'أمين المخزن', email: 's@x.com', role: 'storekeeper' }, authed: true, role: 'storekeeper' })
    const { host, unmount } = await mount(<AppShell />)
    const headerButtons = Array.from(host.querySelectorAll('header button'))
    expect(headerButtons.find(b => b.title === 'إنشاء طلب جديد / فاتورة بيع')).toBeUndefined()
    expect(headerButtons.find(b => b.title === 'وضع الكاشير — بيع سريع فوري')).toBeUndefined()
    expect(headerButtons.find(b => b.title === 'خيارات المزامنة السريعة')).toBeUndefined()
    expect(headerButtons.find(b => b.title.startsWith('وضع الاختبار'))).toBeUndefined()
    expect(host.querySelector('button[title="مساعد AI — ملخصات واقتراحات سريعة"]')).toBeNull()
    unmount()
  })

  it('موظف المبيعات (الكاشير) يرى طلبات/عملاء/منتجات فقط ولا يرى الشاشات المالية والإدارية', async () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'موظف', email: 'e@x.com', role: 'employee' }, authed: true, role: 'employee' })
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button')).map(b => b.textContent.trim())
    expect(navButtons).toContain('سجل الطلبات')
    expect(navButtons).toContain('العملاء')
    expect(navButtons).toContain('المنتجات')
    expect(navButtons).not.toContain('لوحة التحكم')
    expect(navButtons).not.toContain('المصروفات')
    expect(navButtons).not.toContain('الإعدادات')
    expect(navButtons).not.toContain('المستخدمون')
    expect(navButtons).not.toContain('التقارير')
    expect(navButtons).not.toContain('الموردون')
    expect(navButtons).not.toContain('إدارة المدفوعات')
    unmount()
  })

  it('الكاشير يبدأ على شاشة سجل الطلبات كافتراضية ولا يرى زر مساعد AI', async () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'موظف', email: 'e@x.com', role: 'employee' }, authed: true, role: 'employee' })
    window.getOrders = vi.fn(() => [
      { id: 'ORD-1', customerName: 'أحمد محمد', customerPhone: '01012345678', totalAmount: 1000, downPayment: 0, shippingCost: 0, status: 'new', createdAt: '2026-08-01T10:00:00' },
    ])
    const { host, unmount } = await mount(<AppShell />)
    expect(host.textContent).toContain('سجل الطلبات والفواتير')
    expect(host.querySelector('button[title="مساعد AI — ملخصات واقتراحات سريعة"]')).toBeNull()
    const headerButtons = Array.from(host.querySelectorAll('header button'))
    expect(headerButtons.find(b => b.title === 'إنشاء طلب جديد / فاتورة بيع')).toBeTruthy()
    unmount()
  })

  it('المحاسب يرى الشاشات المالية (لوحة/طلبات/عملاء/منتجات/موردون/مصروفات/مدفوعات/تقارير) ولا يرى المستخدمون/الإعدادات', async () => {
    useAuthStore.setState({ user: { id: 'USR-3', name: 'المحاسب', email: 'acc@x.com', role: 'accountant' }, authed: true, role: 'accountant' })
    const { host, unmount } = await mount(<AppShell />)
    const navButtons = Array.from(host.querySelectorAll('aside nav button')).map(b => b.textContent.trim())
    ;['لوحة التحكم', 'سجل الطلبات', 'العملاء', 'المنتجات', 'الموردون', 'المصروفات', 'إدارة المدفوعات', 'التقارير']
      .forEach(label => expect(navButtons, label).toContain(label))
    expect(navButtons).not.toContain('المستخدمون')
    expect(navButtons).not.toContain('الإعدادات')
    unmount()
  })
})

describe('Header Quick Sync & Sandbox (وضع الاختبار)', () => {
  afterEach(() => {
    if (window.isSandboxMode) window.exitSandboxMode()
  })

  it('زر المزامنة السريعة يفتح قائمة بمزامنة الآن وفتح ورقة البيانات', async () => {
    const { host, unmount } = await mount(<AppShell />)
    const syncBtn = Array.from(host.querySelectorAll('header button')).find(b => b.title === 'خيارات المزامنة السريعة')
    expect(syncBtn).toBeTruthy()
    await click(syncBtn)
    expect(host.textContent).toContain('مزامنة الآن')
    expect(host.textContent).toContain('فتح ورقة البيانات')
    unmount()
  })

  it('النقر على مزامنة الآن يستدعي syncWithGoogleSheets ويعرض نجاحاً', async () => {
    window.syncWithGoogleSheets = vi.fn(() => Promise.resolve())
    const { host, unmount } = await mount(<AppShell />)
    await click(Array.from(host.querySelectorAll('header button')).find(b => b.title === 'خيارات المزامنة السريعة'))
    await click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('مزامنة الآن')))
    await act(async () => {})
    expect(window.syncWithGoogleSheets).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('النقر على فتح ورقة البيانات يستدعي openSheetUrl', async () => {
    window.GoogleSheetsSync = { openSheetUrl: vi.fn(), getConfig: vi.fn(() => null), setQuickDirection: vi.fn() }
    const { host, unmount } = await mount(<AppShell />)
    await click(Array.from(host.querySelectorAll('header button')).find(b => b.title === 'خيارات المزامنة السريعة'))
    await click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('فتح ورقة البيانات')))
    expect(window.GoogleSheetsSync.openSheetUrl).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('تغيير نوع المزامنة يستدعي setQuickDirection', async () => {
    window.GoogleSheetsSync = { openSheetUrl: vi.fn(), getConfig: vi.fn(() => null), setQuickDirection: vi.fn() }
    const { host, unmount } = await mount(<AppShell />)
    await click(Array.from(host.querySelectorAll('header button')).find(b => b.title === 'خيارات المزامنة السريعة'))
    const sel = host.querySelector('select')
    expect(sel).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    act(() => {
      setter.call(sel, 'both')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(window.GoogleSheetsSync.setQuickDirection).toHaveBeenCalledWith('both')
    unmount()
  })

  it('تبديل وضع الاختبار يعرض الشارة ثم ينهيها ويرد البيانات الأصلية', async () => {
    const { host, unmount } = await mount(<AppShell />)
    const toggle = Array.from(host.querySelectorAll('header button')).find(b => b.title.startsWith('وضع الاختبار'))
    await click(toggle)
    expect(host.textContent).toContain('وضع الاختبار نشط')
    expect(host.textContent).toContain('إنهاء الاختبار')
    await click(Array.from(host.querySelectorAll('header button')).find(b => b.title.startsWith('وضع الاختبار')))
    expect(host.textContent).not.toContain('وضع الاختبار نشط')
    expect(window.isSandboxMode).toBe(false)
    unmount()
  })
})

describe('Header quick actions & Sidebar logo (ميزات جديدة)', () => {
  it('زر «+ إنشاء طلب جديد» في الهيدر يفتح نافذة فاتورة البيع الجديدة', async () => {
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'منتج أ', stock: 5, purchasePrice: 100, sellingPrice: 150 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const headerBtn = Array.from(host.querySelectorAll('header button')).find(b =>
      b.title === 'إنشاء طلب جديد / فاتورة بيع'
    )
    expect(headerBtn).toBeTruthy()
    await click(headerBtn)
    expect(document.body.textContent).toContain('إنشاء طلب جديد / فاتورة بيع')
    expect(useUiStore.getState().orderModal.open).toBe(true)
    unmount()
  })

  it('زر الكاشير السريع في الهيدر يفتح نافذة البيع الفوري', async () => {
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'منتج أ', stock: 5, minStock: 2, purchasePrice: 100, sellingPrice: 150 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const headerBtn = Array.from(host.querySelectorAll('header button')).find(b =>
      b.title === 'وضع الكاشير — بيع سريع فوري'
    )
    expect(headerBtn).toBeTruthy()
    await click(headerBtn)
    expect(document.body.textContent).toContain('كاشير سريع (بيع فوري)')
    expect(useUiStore.getState().posModal.open).toBe(true)
    unmount()
  })

  it('زر مساعد AI العائم (FAB) يفتح نافذة الشات الذكي ويرد على الأسئلة من بيانات النظام', async () => {
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    ])
    const { host, unmount } = await mount(<AppShell />)
    const aiBtn = Array.from(host.querySelectorAll('button')).find(b =>
      b.title === 'مساعد AI — ملخصات واقتراحات سريعة'
    )
    expect(aiBtn).toBeTruthy()
    expect(host.querySelectorAll('header button[title="مساعد AI — ملخصات واقتراحات سريعة"]')).toHaveLength(0)
    await click(aiBtn)
    expect(document.body.textContent).toContain('مساعد AI السريع')
    expect(document.body.textContent).not.toContain('ما هي المنتجات الناقصة؟')
    // سؤال مكتوب يدوياً يبني إجابة سياقية من بيانات النظام
    const input = document.querySelector('input[placeholder*="اكتب سؤالك"]')
    setInputValue(input, 'ما هي المنتجات الناقصة؟')
    await click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.trim() === 'إرسال'))
    expect(document.body.textContent).toContain('بطانية مورا')
    unmount()
  })

  it('النقر على شعار التطبيق في الشريط الجانبي يعيد إلى لوحة التحكم', async () => {
    const { host, unmount } = await mount(<AppShell />)
    await click(Array.from(host.querySelectorAll('aside nav button')).find(b => b.textContent.includes('سجل الطلبات')))
    expect(host.textContent).toContain('سجل الطلبات والفواتير')
    const logo = host.querySelector('aside button[aria-label="العودة للوحة التحكم"]')
    expect(logo).toBeTruthy()
    await click(logo)
    expect(host.textContent).toContain('لوحة التحكم والرصد اليومي')
    unmount()
  })

  it('V3.43 — الكاشير عند النقر على الشعار لا ينتقل للوحة التحكم المالية ويبقى في سجل الطلبات', async () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'الكاشير', email: 'cash@x.com', role: 'employee' }, authed: true, role: 'employee' })
    const { host, unmount } = await mount(<AppShell />)
    const logo = host.querySelector('aside button[aria-label="العودة للوحة التحكم"]')
    expect(logo).toBeTruthy()
    await click(logo)
    expect(host.textContent).not.toContain('لوحة التحكم والرصد اليومي')
    expect(host.textContent).not.toContain('إجمالي المبيعات')
    expect(host.textContent).toContain('سجل الطلبات والفواتير')
    unmount()
  })
})
