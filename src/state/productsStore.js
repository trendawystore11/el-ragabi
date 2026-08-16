// =============================================================================
// state/productsStore.js — طبقة بيانات شاشة المنتجات والمخزون — Phase 5
// -----------------------------------------------------------------------------
// يحمل قائمة المنتجات + مرشّحات (بحث حر + مورد + نواقص فقط). المصدر الخام يأتي
// من window.getProducts (الجسر) أو يُحقن عبر setProducts. التصفية دالة نقية
// تعتمد على searchProducts/getLowStockProducts المنقولين. يُحدِّث المخزن نفسه
// عند أحداث bms-data-synced (حقيقة لحظية مثل القديم).
// =============================================================================
import { create } from 'zustand'
import { searchProducts, getLowStockProducts } from '@/domain/inventory/products'

export const useProductsStore = create((set, get) => ({
  products: [],
  ready: false,
  search: '',
  supplier: '',
  lowStockOnly: false,

  refresh() {
    const src = typeof window !== 'undefined' && window.getProducts ? window.getProducts() : get().products
    set({ products: Array.isArray(src) ? [...src] : [], ready: true })
    return get().products
  },

  setProducts(list) {
    if (!Array.isArray(list)) return
    set({ products: [...list], ready: true })
  },

  setSearch(q) {
    set({ search: q || '' })
  },

  setSupplier(s) {
    set({ supplier: s || '' })
  },

  setLowStockOnly(b) {
    set({ lowStockOnly: !!b })
  },

  resetFilters() {
    set({ search: '', supplier: '', lowStockOnly: false })
  },
}))

/**
 * خط التصفية الوحيد (بحث حر + مورد + النواقص فقط) — مطابق لمنطق products-view القديم.
 */
export function applyProductFilters(products, search, supplier, lowStockOnly) {
  let list = searchProducts(Array.isArray(products) ? products : [], search)
  if (supplier) list = list.filter(p => String(p.supplierId || '') === supplier)
  if (lowStockOnly) list = getLowStockProducts(list)
  return list
}

// حقيقة لحظية: عند وصول لقطة مخزن المنتجات (STORAGE_KEYS.PRODUCTS = 'products')
// أو تحديث يدوي شامل → إعادة القراءة.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (!key || key === '*' || key === 'products') useProductsStore.getState().refresh()
  })
}
