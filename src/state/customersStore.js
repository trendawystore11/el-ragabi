// =============================================================================
// state/customersStore.js — طبقة بيانات شاشة العملاء — Phase 4
// -----------------------------------------------------------------------------
// يحمل قائمة العملاء + مرشّحات البحث/التصنيف، ويقرأ المصدر الخام من التخزين
// عبر window.getCustomers (الجسر) أو يُحقن مباشرة عبر setCustomers.
// التصفية دالة نقية تعتمد على searchCustomers المنقول. يُحدِّث المخزن نفسه
// عند أحداث bms-data-synced (حقيقة لحظية مثل القديم).
// =============================================================================
import { create } from 'zustand'
import { searchCustomers } from '@/domain/customers/customers'

export const useCustomersStore = create((set, get) => ({
  customers: [],
  ready: false,
  search: '',
  category: '',

  refresh() {
    const src = typeof window !== 'undefined' && window.getCustomers ? window.getCustomers() : get().customers
    set({ customers: Array.isArray(src) ? [...src] : [], ready: true })
    return get().customers
  },

  setCustomers(list) {
    if (!Array.isArray(list)) return
    set({ customers: [...list], ready: true })
  },

  setSearch(q) {
    set({ search: q || '' })
  },

  setCategory(c) {
    set({ category: c || '' })
  },

  resetFilters() {
    set({ search: '', category: '' })
  },
}))

/**
 * خط التصفية الوحيد (بحث حر + تصنيف) — نفس منطق V3.26 في customers-view القديم.
 */
export function applyCustomerFilters(customers, search, category) {
  let list = searchCustomers(Array.isArray(customers) ? customers : [], search)
  if (category) list = list.filter(c => String(c.category || '') === category)
  return list
}

// حقيقة لحظية: عند وصول لقطة مخزن العملاء (STORAGE_KEYS.CUSTOMERS = 'customers')
// أو تحديث يدوي شامل → إعادة القراءة.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (!key || key === '*' || key === 'customers') useCustomersStore.getState().refresh()
  })
}
