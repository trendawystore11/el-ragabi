import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/domain/inventory/supplierReturns', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, recalculateTotals: vi.fn(repo => (repo && repo.getSupplierReturns ? repo.getSupplierReturns().length : 0)) }
})

import ReportsView from '@/ui/views/ReportsView'
import WipeDatabaseModal from '@/ui/modals/WipeDatabaseModal'
import { recalculateTotals } from '@/domain/inventory/supplierReturns'
import { useReportsStore } from '@/state/reportsStore'
import { useExpensesStore } from '@/state/expensesStore'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { formatCompactCurrency, formatCurrencyEn, getCairoFormattedDate } from '@/utils/formatters'

const TODAY = getCairoFormattedDate().slice(0, 10)

const ORDERS = [
  {
    id: 'ORD-001',
    customerName: 'أحمد محمد',
    customerPhone: '01012345678',
    items: [{ sellingPrice: 500, purchasePrice: 300, quantity: 2 }],
    shippingCost: 100,
    shippingPayer: 'customer',
    totalAmount: 1100,
    downPayment: 1100,
    status: 'delivered',
    createdAt: `${TODAY}T10:00:00`,
  },
  {
    id: 'ORD-002',
    customerName: 'سارة علي',
    customerPhone: '01198765432',
    items: [],
    totalAmount: 900,
    downPayment: 200,
    status: 'new',
    createdAt: `${TODAY}T10:00:00`,
  },
  {
    id: 'ORD-OLD',
    customerName: 'عميل قديم',
    customerPhone: '01000000000',
    items: [{ sellingPrice: 100, purchasePrice: 50, quantity: 1 }],
    totalAmount: 100,
    downPayment: 100,
    status: 'delivered',
    createdAt: '2020-01-01T10:00:00',
  },
]

const PAYMENTS = [
  { entityType: 'customer', amount: 1100, isDownPayment: true, refOrderId: 'ORD-001' },
  { entityType: 'customer', amount: 200, isDownPayment: true, refOrderId: 'ORD-002' },
  { entityType: 'customer', amount: 100, isDownPayment: true, refOrderId: 'ORD-OLD' },
  { entityType: 'customer', amount: 50 },
  { entityType: 'supplier', amount: -300 },
  { entityType: 'supplier', amount: 400 },
  { entityType: 'customer', amount: -120 },
]

const EXPENSES = [
  { id: 'EXP-1', title: 'إيجار المحل', amount: 5000, category: 'إيجارات', date: TODAY, notes: '', recurring: false, dueDay: null },
]

const CUSTOMERS = [
  { id: 'CUST-1', name: 'أحمد محمد', phone: '01012345678' },
  { id: 'CUST-2', name: 'سارة علي', phone: '01198765432' },
]

const SUPPLIERS = [
  { id: 'SUP-1', name: 'مصنع النور' },
  { id: 'SUP-2', name: 'مصنع الأمل' },
]

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
}

const RESET_REPORTS = { tab: 'sales', dateFrom: '', dateTo: '', customerId: '', supplierId: '', orders: [], payments: [], expenses: [], customers: [], suppliers: [], ready: false }

beforeEach(() => {
  useReportsStore.setState(RESET_REPORTS)
  useExpensesStore.setState({ expenses: [], ready: false, category: '', dateFrom: '', dateTo: '' })
  useAuthStore.setState({ user: { id: 'USR-1', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }, authed: true, role: 'admin' })
  useUiStore.setState(RESET_UI)
  useToastStore.setState({ toasts: [] })
  vi.mocked(recalculateTotals).mockClear()
  window.getOrders = vi.fn(() => ORDERS)
  window.getPayments = vi.fn(() => PAYMENTS)
  window.getExpenses = vi.fn(() => EXPENSES)
  window.getCurrentOperatingExpenses = vi.fn(() => ({ oneTime: 100, recurringThisMonth: 0, recurringFuture: 0, total: 100 }))
  window.getSupplierReturns = vi.fn(() => [])
  window.getCustomers = vi.fn(() => CUSTOMERS)
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.getCustomerById = vi.fn(id => CUSTOMERS.find(c => c.id === id) || null)
  window.getSupplierById = vi.fn(id => SUPPLIERS.find(s => s.id === id) || null)
  window.getPaymentsByEntity = vi.fn(() => [])
  window.getSupplierTransactionsBySupplier = vi.fn(() => [])
  window.round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100
  window.STORAGE_KEYS = {
    PAYMENTS: 'payments',
    SUPPLIERS: 'suppliers',
    SUPPLIER_RETURNS: 'supplierReturns',
    SUPPLIER_TRANSACTIONS: 'supplierTransactions',
  }
  window.getCollection = vi.fn(key => {
    if (key === 'supplierReturns') return [{ id: 'RET-1' }, { id: 'RET-2' }]
    return []
  })
  window.createPaymentRecord = vi.fn()
  window.logSupplierTransaction = vi.fn()
  window.updateSupplier = vi.fn()
  window.verifyAdminPassword = vi.fn(p => p === 'admin123')
  window.adminPasswordConfigured = vi.fn(() => true)
  window.forceWipeDatabase = vi.fn(() => Promise.resolve(true))
  window.XLSX = {
    utils: {
      json_to_sheet: vi.fn(() => ({})),
      book_new: vi.fn(() => ({})),
      book_append_sheet: vi.fn(),
    },
    writeFile: vi.fn(),
  }
  window.formatDate = vi.fn(() => '2024-01-01')
  window.getOrderShippingRevenue = vi.fn(() => 0)
  window.getOrderRemainingAmount = vi.fn(() => 0)
  window.getOrderStatusLabel = vi.fn(() => 'مكتمل')
  window.getUsers = vi.fn(() => [])
  window.getProducts = vi.fn(() => [])
  window.showToast = vi.fn()
})

afterEach(() => {
  useReportsStore.setState(RESET_REPORTS)
  useExpensesStore.setState({ expenses: [], ready: false, category: '', dateFrom: '', dateTo: '' })
  useUiStore.setState(RESET_UI)
})

describe('ReportsView (ui/views/ReportsView.jsx)', () => {
  beforeEach(() => { useSettingsStore.setState({ compactNumbers: true }) })
  afterEach(() => { useSettingsStore.setState({ compactNumbers: false }) })

  it('يعرض الهيدر والتبويبات وبطاقات الأرباح والخزينة وجدول المبيعات', () => {
    const { host, unmount } = mount(<ReportsView />)
    expect(host.textContent).toContain('التقارير اليومية، صافي الأرباح ومصاريف التشغيل')
    expect(host.textContent).toContain('الأرباح والمبيعات')
    expect(host.textContent).toContain('مصاريف التشغيل')
    expect(host.textContent).toContain('كشف حساب عميل')
    expect(host.textContent).toContain('كشف حساب مورد')
    // بطاقات P&L (V3.61: عرض مضغوط K/M بأرقام إنجليزية — القيم كاملة عند الوقوف)
    expect(host.textContent).toContain(formatCompactCurrency(1000))
    expect(host.textContent).toContain(formatCompactCurrency(1100))
    expect(host.textContent).toContain(formatCompactCurrency(600))
    expect(host.textContent).toContain(formatCompactCurrency(100))
    expect(host.textContent).toContain(formatCompactCurrency(300))
    // ملخص الخزينة
    expect(host.textContent).toContain(formatCompactCurrency(1750))
    expect(host.textContent).toContain(formatCompactCurrency(120))
    expect(host.textContent).toContain(formatCompactCurrency(400))
    expect(host.textContent).toContain(formatCompactCurrency(1230))
    expect(host.textContent).toContain(formatCompactCurrency(700))
    // جدول المبيعات: آخر 30 يوم فقط (ORD-001 + ORD-002)
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(host.textContent).toContain('ORD-001')
    expect(host.textContent).toContain('أحمد محمد')
    expect(host.textContent).toContain('عدد المعاملات: 2')
    expect(host.textContent).not.toContain('عميل قديم')
    unmount()
  })

  it('الوضع الافتراضي (رقم كامل): عند إيقاف الاختصار تُعرض البطاقات أرقاماً إنجليزية كاملة', () => {
    useSettingsStore.setState({ compactNumbers: false })
    const { host, unmount } = mount(<ReportsView />)
    expect(host.textContent).toContain(formatCurrencyEn(1000))
    expect(host.textContent).toContain(formatCurrencyEn(1750))
    expect(host.textContent).toContain(formatCurrencyEn(1230))
    unmount()
  })

  it('زر إعادة احتساب الأرباح يستدعي recalculateTotals من الدومين ويعرض رسالة النجاح', () => {
    const { host, unmount } = mount(<ReportsView />)
    const recalcBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إعادة احتساب الأرباح والتقارير'))
    click(recalcBtn)
    expect(vi.mocked(recalculateTotals)).toHaveBeenCalled()
    const repoArg = vi.mocked(recalculateTotals).mock.calls[0][0]
    expect(repoArg.getSupplierReturns()).toHaveLength(2)
    expect(repoArg.getPayments()).toEqual([])
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تمت إعادة احتساب الأرباح والتقارير بنجاح — تم ترميم 2 قيد')
    unmount()
  })

  it('زر تصدير كافة البيانات إلى Excel يبني الدفتر ويستدعي writeFile', async () => {
    const { host, unmount } = mount(<ReportsView />)
    const exportBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تصدير كافة بيانات النظام إلى Excel موحد'))
    click(exportBtn)
    // التصدير أصبح async (تحميل xlsx ديناميكياً) — ننتظر اكتمال سلسلة الوعود بالكامل.
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(window.XLSX.writeFile).toHaveBeenCalled()
    expect(window.XLSX.utils.book_append_sheet).toHaveBeenCalled()
    expect(window.showToast).toHaveBeenCalledWith('تم تصدير قاعدة البيانات بالكامل إلى ملف Excel موحد بنجاح', 'success')
    unmount()
  })

  it('زر تصفير القواعد يفتح نافذة كلمة مرور المدير', () => {
    const { host, unmount } = mount(<ReportsView />)
    const wipeBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تصفير ومسح القواعد السحابية'))
    click(wipeBtn)
    expect(useUiStore.getState().wipeDatabaseModal.open).toBe(true)
    unmount()
  })

  it('فلتر التاريخ يستبعد الفواتير خارج النطاق ثم إعادة الضبط تستعيدها', () => {
    const { host, unmount } = mount(<ReportsView />)
    setInputValue(getInput('من:'), '2030-01-01')
    expect(host.textContent).toContain('لا توجد مبيعات في النطاق المحدد')
    expect(host.textContent).not.toContain('ORD-001')
    const resetBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إعادة ضبط'))
    click(resetBtn)
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
    unmount()
  })

  it('أزرار تفاصيل وتحديث في جدول المبيعات تفتح النوافذ الصحيحة', () => {
    const { host, unmount } = mount(<ReportsView />)
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تفاصيل')))
    expect(useUiStore.getState().orderDetailsModal.open).toBe(true)
    expect(useUiStore.getState().orderDetailsModal.orderId).toBe('ORD-001')
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تحديث')))
    expect(useUiStore.getState().orderStatusModal.open).toBe(true)
    expect(useUiStore.getState().orderStatusModal.orderId).toBe('ORD-001')
    unmount()
  })

  it('تبويب مصاريف التشغيل يعرض دليل المصروفات', () => {
    const { host, unmount } = mount(<ReportsView />)
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('مصاريف التشغيل')))
    expect(host.textContent).toContain('دليل مصاريف التشغيل والمصروفات الإدارية')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('إيجار المحل')
    unmount()
  })

  it('تبويب كشف حساب عميل يعرض كشف أول عميل تلقائياً ويُحدّث عند تغيير العميل', () => {
    const { host, unmount } = mount(<ReportsView />)
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('كشف حساب عميل')))
    expect(host.textContent).toContain('الرصيد المتبقي على العميل')
    expect(host.textContent).toContain('أحمد محمد')
    expect(host.textContent).toContain('لا توجد فواتير أو دفعات مسجلة لهذا العميل')
    setSelectValue(getSelect('اختر العميل:'), 'CUST-2')
    expect(host.textContent).toContain('سارة علي')
    expect(host.textContent).toContain('لا توجد فواتير أو دفعات مسجلة لهذا العميل')
    unmount()
  })

  it('تبويب كشف حساب مورد يعرض كشف أول مورد تلقائياً ويُحدّث عند تغيير المورد', () => {
    const { host, unmount } = mount(<ReportsView />)
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('كشف حساب مورد')))
    expect(host.textContent).toContain('الرصيد المستحق للمورد')
    expect(host.textContent).toContain('مصنع النور')
    expect(host.textContent).toContain('لا توجد حركات مسجلة لهذا المورد')
    setSelectValue(getSelect('اختر المورد / المصنع:'), 'SUP-2')
    expect(host.textContent).toContain('مصنع الأمل')
    expect(host.textContent).toContain('لا توجد حركات مسجلة لهذا المورد')
    unmount()
  })
})

describe('WipeDatabaseModal (ui/modals/WipeDatabaseModal.jsx)', () => {
  it('كلمة مرور فارغة تُظهر تحذير الإلغاء ولا تنفذ المسح', () => {
    useUiStore.setState({ wipeDatabaseModal: { open: true } })
    const { host, unmount } = mount(<WipeDatabaseModal />)
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('تأكيد مسح القواعد نهائياً')))
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم إلغاء العملية')
    expect(window.forceWipeDatabase).not.toHaveBeenCalled()
    unmount()
  })

  it('كلمة مرور خاطئة تُظهر رسالة الحظر ولا تنفذ المسح', async () => {
    useUiStore.setState({ wipeDatabaseModal: { open: true } })
    const { host, unmount } = mount(<WipeDatabaseModal />)
    setInputValue(getInput('كلمة مرور المدير', document), 'wrong')
    await act(async () => { click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('تأكيد مسح القواعد نهائياً'))) })
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('كلمة المرور غير صحيحة')
    expect(window.forceWipeDatabase).not.toHaveBeenCalled()
    unmount()
  })


  it('كلمة مرور صحيحة تنفذ المسح وتغلق النافذة وتُظهر رسالة النجاح', async () => {
    useUiStore.setState({ wipeDatabaseModal: { open: true } })
    const { host, unmount } = mount(<WipeDatabaseModal />)
    setInputValue(getInput('كلمة مرور المدير', document), 'admin123')
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('تأكيد مسح القواعد نهائياً')))
    await act(async () => {})
    expect(window.forceWipeDatabase).toHaveBeenCalledWith('admin123')
    expect(useUiStore.getState().wipeDatabaseModal.open).toBe(false)
    const toasts = useToastStore.getState().toasts
    expect(toasts[toasts.length - 1].message).toContain('تم مسح القواعد السحابية وتصفير البيانات نهائياً')
    unmount()
  })
})
