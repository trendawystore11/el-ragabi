// =============================================================================
// state/paymentsStore.js — طبقة بيانات شاشة المدفوعات — Phase 9
// -----------------------------------------------------------------------------
// يحمل قائمة الدفعات + نص البحث. المصدر الخام من window.getPayments (الجسر)
// أو يُحقن عبر setPayments. الترتيب والبحث يتمان عبر domain/accounting/payments
// (searchPayments يرتّب تنازلياً ثم يفلتر بالاسم/الإيصال/الملاحظات). يُحدِّث
// المخزن نفسه عند أحداث bms-data-synced (حقيقة لحظية مثل بقية الشاشات).
// =============================================================================
import { create } from 'zustand'

export const usePaymentsStore = create((set, get) => ({
  payments: [],
  ready: false,
  search: '',

  refresh() {
    const src = typeof window !== 'undefined' && window.getPayments ? window.getPayments() : get().payments
    set({ payments: Array.isArray(src) ? [...src] : [], ready: true })
    return get().payments
  },

  setPayments(list) {
    if (!Array.isArray(list)) return
    set({ payments: [...list], ready: true })
  },

  setSearch(q) {
    set({ search: q || '' })
  },

  resetSearch() {
    set({ search: '' })
  },
}))

// حقيقة لحظية: عند وصول لقطة مخزن الدفعات (STORAGE_KEYS.PAYMENTS = 'payments')
// أو تحديث يدوي شامل → إعادة القراءة.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-data-synced', e => {
    const key = e && e.detail && e.detail.key
    if (!key || key === '*' || key === 'payments') usePaymentsStore.getState().refresh()
  })
}
