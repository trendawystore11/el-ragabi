import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import ProductsView from '@/ui/views/ProductsView'
import { useProductsStore } from '@/state/productsStore'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { useAuthStore } from '@/state/authStore'
import { formatCurrency } from '@/utils/formatters'

const SEED = [
  { id: 'PRD-001', code: 'SKU-001', name: 'بطانية مورا إسباني', supplierId: 'SUP-1', supplierName: 'مصنع النور', stock: 5, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
  { id: 'PRD-002', code: 'SKU-002', name: 'مفرش سرير ملكي', supplierId: 'SUP-2', supplierName: 'شركة الأمل', stock: -3, minStock: 5, purchasePrice: 300, sellingPrice: 450 },
  { id: 'PRD-003', code: 'SKU-003', name: 'وسادة مخدة', supplierId: '', supplierName: '', stock: 50, minStock: 5, purchasePrice: 80, sellingPrice: 120 },
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
    root,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function selectChange(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function rowsOf(host) {
  return Array.from(host.querySelectorAll('tbody tr'))
}

function lastToastMessage() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1].message : ''
}

beforeEach(() => {
  useProductsStore.setState({ products: [], ready: false, search: '', supplier: '', lowStockOnly: false })
  useAuthStore.setState({ user: { id: 'USR-1', name: 'المدير العام', email: 'admin@store.com', role: 'admin' }, authed: true, role: 'admin' })
  useUiStore.setState({
    productModal: { open: false, productId: null, onDone: null },
    shipmentModal: { open: false, productId: null, onDone: null },
  })
  useToastStore.setState({ toasts: [] })
  window.getProducts = vi.fn(() => SEED)
  window.getSuppliers = vi.fn(() => [
    { id: 'SUP-1', name: 'مصنع النور' },
    { id: 'SUP-2', name: 'شركة الأمل' },
  ])
  window.confirm = vi.fn(() => true)
  window.deleteProduct = vi.fn(() => Promise.resolve(true))
})

describe('ProductsView (ui/views/ProductsView.jsx)', () => {
  it('يعرض الهيدر والجدول بكل المنتجات والشارات والأسعار', () => {
    const { host, unmount } = mount(<ProductsView />)
    expect(host.textContent).toContain('دليل المنتجات وإدارة المخزون')
    expect(host.textContent).toContain('إضافة منتج جديد')

    const rows = rowsOf(host)
    expect(rows).toHaveLength(3)

    expect(rows[0].textContent).toContain('SKU-001')
    expect(rows[0].textContent).toContain('بطانية مورا إسباني')
    expect(rows[0].textContent).toContain('مصنع النور')
    expect(rows[0].textContent).toContain(formatCurrency(1000))
    expect(rows[0].textContent).toContain(formatCurrency(1400))
    expect(rows[0].textContent).toContain('مخزون منخفض')

    expect(rows[1].textContent).toContain('SKU-002')
    expect(rows[1].textContent).toContain('عجز مخزون (-3)')

    expect(rows[2].textContent).toContain('متوفر في المخزن')
    unmount()
  })

  it('البحث بالاسم أو كود الـ SKU يفلتر الصفوف فوراً', () => {
    const { host, unmount } = mount(<ProductsView />)
    type(host.querySelector('input'), 'بطانية')
    let rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('بطانية مورا إسباني')

    type(host.querySelector('input'), 'SKU-003')
    rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('وسادة مخدة')
    unmount()
  })

  it('البحث باسم المورد يعمل أيضاً', () => {
    const { host, unmount } = mount(<ProductsView />)
    type(host.querySelector('input'), 'شركة الأمل')
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('مفرش سرير ملكي')
    unmount()
  })

  it('فلتر المورد يعزل منتجات مورد واحد', () => {
    const { host, unmount } = mount(<ProductsView />)
    const select = host.querySelector('select')
    selectChange(select, 'SUP-1')
    const rows = rowsOf(host)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('مصنع النور')
    unmount()
  })

  it('فلتر النواقص فقط يعرض المنتجات المنخفضة والعاجزة فقط', () => {
    const { host, unmount } = mount(<ProductsView />)
    const toggle = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('النواقص فقط'))
    click(toggle)
    const rows = rowsOf(host)
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('بطانية مورا إسباني')
    expect(rows[1].textContent).toContain('مفرش سرير ملكي')
    unmount()
  })

  it('يظهر رسالة فارغة عند عدم وجود منتجات', () => {
    window.getProducts = vi.fn(() => [])
    const { host, unmount } = mount(<ProductsView />)
    expect(rowsOf(host)).toHaveLength(1)
    expect(host.textContent).toContain('لا توجد منتجات مسجلة في المخزن')
    unmount()
  })

  it('زر إضافة منتج جديد يفتح نافذة الإضافة عبر uiStore', () => {
    const { host, unmount } = mount(<ProductsView />)
    const addBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('إضافة منتج جديد'))
    click(addBtn)
    expect(useUiStore.getState().productModal).toMatchObject({ open: true, productId: null })
    useUiStore.setState({ productModal: { open: false, productId: null, onDone: null } })
    unmount()
  })

  it('زر تعديل يفتح نافذة الإضافة بوضع التعديل بمعرّف المنتج', () => {
    const { host, unmount } = mount(<ProductsView />)
    const rows = rowsOf(host)
    const editBtn = Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))
    click(editBtn)
    expect(useUiStore.getState().productModal).toMatchObject({ open: true, productId: 'PRD-001' })
    useUiStore.setState({ productModal: { open: false, productId: null, onDone: null } })
    unmount()
  })

  it('زر إضافة شحنة يفتح نافذة التوريد بمعرّف المنتج', () => {
    const { host, unmount } = mount(<ProductsView />)
    const rows = rowsOf(host)
    const shipBtn = Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('إضافة شحنة'))
    click(shipBtn)
    expect(useUiStore.getState().shipmentModal).toMatchObject({ open: true, productId: 'PRD-001' })
    useUiStore.setState({ shipmentModal: { open: false, productId: null, onDone: null } })
    unmount()
  })

  it('زر حذف يؤكد ثم يحذف المنتج ويحدّث القائمة ويعرض تنبيهاً', async () => {
    const { host, unmount } = mount(<ProductsView />)
    const rows = rowsOf(host)
    const delBtn = Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('حذف'))
    click(delBtn)
    await flush()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('بطانية مورا إسباني'))
    expect(window.deleteProduct).toHaveBeenCalledWith('PRD-001')
    expect(lastToastMessage()).toContain('تم حذف المنتج "بطانية مورا إسباني" بنجاح')
    unmount()
  })

  it('الكاشير يرى المنتجات عرضاً فقط: بلا سعر شراء وبلا أزرار إدارة/توريد/حذف', () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'كاشير', email: 'e@x.com', role: 'employee' }, authed: true, role: 'employee' })
    const { host, unmount } = mount(<ProductsView />)
    expect(rowsOf(host)).toHaveLength(3)
    const buttons = Array.from(host.querySelectorAll('button')).map(b => b.textContent)
    expect(buttons.find(b => b.includes('إضافة منتج جديد'))).toBeUndefined()
    expect(buttons.find(b => b.includes('تعديل'))).toBeUndefined()
    expect(buttons.find(b => b.includes('إضافة شحنة'))).toBeUndefined()
    expect(buttons.find(b => b.includes('حذف'))).toBeUndefined()
    expect(host.textContent).not.toContain(formatCurrency(1000))
    expect(rowsOf(host).every(row => row.textContent.includes('عرض فقط'))).toBe(true)
    unmount()
  })

  it('أمين المخزن يرى سعر الشراء وأزرار التعديل والتوريد لكن لا يرى زر حذف (للمدير فقط)', () => {
    useAuthStore.setState({ user: { id: 'USR-2', name: 'أمين المخزن', email: 's@x.com', role: 'storekeeper' }, authed: true, role: 'storekeeper' })
    const { host, unmount } = mount(<ProductsView />)
    expect(host.textContent).toContain(formatCurrency(1000))
    expect(host.textContent).toContain('إضافة منتج جديد')
    const rows = rowsOf(host)
    expect(Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('تعديل'))).toBeTruthy()
    expect(Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('إضافة شحنة'))).toBeTruthy()
    expect(Array.from(rows[0].querySelectorAll('button')).find(b => b.textContent.includes('حذف'))).toBeUndefined()
    unmount()
  })
})
