// =============================================================================
// state/suppliersStore.js — طبقة بيانات شاشة الموردين — Phase 6
// -----------------------------------------------------------------------------
// يحمل قائمة الموردين + مرشّح البحث الحر. المصدر الخام من window.getSuppliers
// (الجسر) أو يُحقن عبر setSuppliers. التصفية دالة نقية تعتمد على searchSuppliers
// المنقولة. يُحدِّث المخزن نفسه عند أحداث bms-data-synced (حقيقة لحظية).
// =============================================================================
import { create } from 'zustand'
import { searchSuppliers } from '@/domain/suppliers/suppliers'

export const useSuppliersStore = create((set, get) => ({
  suppliers: [],
  ready: false,
  search: '',

  refresh() {
    const src = typeof window !== 'undefined' && window.getSuppliers ? window.getSuppliers() : get().suppliers
    set({ suppliers: Array.isArray(src) ? [...src] : [], ready: true })
    return get().suppliers
  },

  setSuppliers(list) {
    if (!Array.isArray(list)) return
    set({ suppliers: [...list], ready: true })
  },

  setSearch(q) {
    set({ search: q || '' })
  },

  resetFilters() {
    set({ search: '' })
  },
}))

/**
 * خط التصفية الوحيد (بحث حر بالاسم/الهاتف/الكود) — نفس منطق suppliers-view القديم.
 */
export function applySupplierFilters(suppliers, search) {
  return searchSuppliers(Array.isArray(suppliers) ? suppliers : [], search)
}

// حقيقة لحظية: عند وصول لقطة مخزن الموردين (STORAGE_KEYS.SUPPLIERS = 'suppliers')
// أو تحديث يدوي شامل → إعادة القراءة.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (!key || key === '*' || key === 'suppliers') useSuppliersStore.getState().refresh()
  })
}
