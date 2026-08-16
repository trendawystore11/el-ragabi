import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import SuppliersView from '@/ui/views/SuppliersView'
import { useSuppliersStore } from '@/state/suppliersStore'
import { useUiStore } from '@/ui/state/uiStore'
import { useAuthStore } from '@/state/authStore'
import { formatCurrency } from '@/utils/formatters'

const SUPPLIERS = [
  {
    id: 'SUP-1',
    name: 'مصنع النور للأقمشة',
    phone: '01012345678',
    secondaryPhone: '01111111111',
    address: 'القاهرة - مدينة نصر - المنطقة الصناعية',
    totalPurchases: 5000,
    paid: 3000,
    remainingBalance: 2000,
  },
  {
    id: 'SUP-2',
    name: 'شركة الأمل للأكسسوار',
    phone: '01234567890',
    secondaryPhone: '',
    address: 'الجيزة - المهندسين',
    totalPurchases: 1000,
    paid: 1000,
    remainingBalance: 0,
  },
  {
    id: 'SUP-3',
    name: 'مصنع النسيج الحديث',
    phone: '01099999999',
    secondaryPhone: '',
    address: 'المنصورة',
    totalPurchases: 4000,
    paid: 9000,
    remainingBalance: -5000,
  },
]

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<SuppliersView />)
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
    el.click()
  })
}

function setSearch(host, value) {
  const input = host.querySelector('input[placeholder*="بحث بالاسم"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const RESET_UI = {
  supplierModal: { open: false, supplierId: null, onDone: null },
  supplierReturnModal: { open: false, supplierId: null, onDone: null },
  paymentModal: { open: false, defaults: null, onDone: null },
  statementModal: { open: false, entityType: null, entityId: null },
}

beforeEach(() => {
  useSuppliersStore.setState({ suppliers: [], ready: false, search: '' })
  useUiStore.setState(RESET_UI)
  useAuthStore.setState({ user: { id: 'USR-1001', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }, authed: true, role: 'admin' })
  window.getSuppliers = vi.fn(() => SUPPLIERS)
  window.openPaymentModal = vi.fn()
  window.getCurrentUser = vi.fn(() => ({ id: 'USR-1001', email: 'admin@store.com', role: 'admin' }))
  window.isAdmin = vi.fn(() => true)
})

afterEach(() => {
  useSuppliersStore.setState({ suppliers: [], ready: false, search: '' })
  useUiStore.setState(RESET_UI)
})

describe('SuppliersView (ui/views/SuppliersView.jsx)', () => {
  it('يعرض جدول الموردين بجميع الأعمدة والقيم المالية المنسقة', () => {
    const { host, unmount } = mount()
    expect(host.textContent).toContain('دليل الموردين والمصانع')
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(host.textContent).toContain('مصنع النور للأقمشة')
    expect(host.textContent).toContain('01012345678 / 01111111111')
    expect(host.textContent).toContain(formatCurrency(2000))
    expect(host.textContent).toContain(formatCurrency(3000))
    expect(host.textContent).toContain(formatCurrency(5000))
    expect(host.textContent).toContain(formatCurrency(-5000))
    unmount()
  })

  it('البحث بالاسم يفلتر الجدول ويعرض حالة عدم التطابق', () => {
    const { host, unmount } = mount()
    setSearch(host, 'الأمل')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('شركة الأمل للأكسسوار')
    expect(host.textContent).not.toContain('مصنع النور للأقمشة')
    setSearch(host, 'غير موجود')
    expect(host.textContent).toContain('لا يوجد موردين مسجلين المطابقين للبحث')
    unmount()
  })

  it('يعرض رسالة فارغة عند عدم وجود موردين', () => {
    window.getSuppliers = vi.fn(() => [])
    const { host, unmount } = mount()
    expect(host.textContent).toContain('لا يوجد موردين مسجلين المطابقين للبحث')
    unmount()
  })

  it('زر إضافة مورد جديد يفتح نافذة إضافة المورد', () => {
    const { host, unmount } = mount()
    const addBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إضافة مورد جديد'))
    click(addBtn)
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    unmount()
  })

  it('V3.42 — لغير المدير: يُخفى رقم الهاتف والعنوان وزر الإضافة وزر التعديل مع بقاء الاسم والأرصدة', () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'أمين المخزن', email: 's@x.com', role: 'storekeeper' }, authed: true, role: 'storekeeper' })
    window.isAdmin = vi.fn(() => false)
    const { host, unmount } = mount()
    expect(host.textContent).toContain('مصنع النور للأقمشة')
    expect(host.textContent).not.toContain('01012345678')
    expect(host.textContent).not.toContain('مدينة نصر')
    expect(host.textContent).not.toContain('إضافة مورد جديد')
    const editBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))
    expect(editBtn).toBeUndefined()
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تسديد دفعة'))).toBeUndefined()
    expect(host.textContent).toContain(formatCurrency(2000))
    unmount()
  })

  it('V3.43 — المحاسب يرى بيانات الاتصال والأرصدة وزر تسديد دفعة لكن لا يرى إضافة/تعديل مورد', () => {
    useAuthStore.setState({ user: { id: 'USR-3', name: 'المحاسب', email: 'acc@x.com', role: 'accountant' }, authed: true, role: 'accountant' })
    const { host, unmount } = mount()
    expect(host.textContent).toContain('مصنع النور للأقمشة')
    expect(host.textContent).toContain('01012345678 / 01111111111')
    expect(host.textContent).toContain(formatCurrency(2000))
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تسديد دفعة'))).toBeTruthy()
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('مرتجع مشتريات'))).toBeTruthy()
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إضافة مورد جديد'))).toBeUndefined()
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))).toBeUndefined()
    unmount()
  })

  it('زر تسديد دفعة يفتح نافذة الدفعة بنوع المورد والمعرف', () => {
    const { host, unmount } = mount()
    const payBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تسديد دفعة'))
    click(payBtn)
    expect(useUiStore.getState().paymentModal).toMatchObject({ open: true, defaults: { entityType: 'supplier', entityId: 'SUP-1' } })
    unmount()
  })

  it('V3.62 — زر تحصيل نقدية يظهر فقط للمورد المدين لنا (رصيد سالب) ويفتح وضع supplier_collect', () => {
    const { host, unmount } = mount()
    const collectBtns = Array.from(host.querySelectorAll('button')).filter(b => b.textContent.includes('تحصيل نقدية'))
    expect(collectBtns).toHaveLength(1)
    click(collectBtns[0])
    expect(useUiStore.getState().paymentModal).toMatchObject({ open: true, defaults: { entityType: 'supplier_collect', entityId: 'SUP-3' } })
    unmount()
  })

  it('زر كشف حساب يفتح نافذة الكشف بنوع المورد والمعرف', () => {
    const { host, unmount } = mount()
    const stmtBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('كشف حساب'))
    click(stmtBtn)
    expect(useUiStore.getState().statementModal).toMatchObject({ open: true, entityType: 'supplier', entityId: 'SUP-1' })
    unmount()
  })

  it('زر مرتجع مشتريات يفتح نافذة المرتجع للمورد المعني', () => {
    const { host, unmount } = mount()
    const returnBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('مرتجع مشتريات'))
    click(returnBtn)
    expect(useUiStore.getState().supplierReturnModal.open).toBe(true)
    expect(useUiStore.getState().supplierReturnModal.supplierId).toBe('SUP-1')
    unmount()
  })

  it('زر تعديل يفتح نافذة تعديل المورد بالمعرف', () => {
    const { host, unmount } = mount()
    const editBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))
    click(editBtn)
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    expect(useUiStore.getState().supplierModal.supplierId).toBe('SUP-1')
    unmount()
  })
})
