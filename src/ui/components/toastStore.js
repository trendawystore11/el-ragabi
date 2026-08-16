// =============================================================================
// ui/components/toastStore.js — نظام التنبيهات (React) — بديل js/utils/toast.js
// -----------------------------------------------------------------------------
// مخزن Zustand يحمل قائمة التنبيهات + showToast/dismissToast. الإخفاء التلقائي
// يحدث عبر مؤقّت في show() (نفس مدة الافتراضي 3500ms في القديم). أنواع
// التنبيهات: success | error | warning | info.
// =============================================================================
import { create } from 'zustand'

let nextId = 1

export const useToastStore = create(set => ({
  toasts: [],

  show(message, type = 'success', duration = 3500) {
    const id = `toast-${nextId++}`
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    if (duration > 0) {
      setTimeout(() => {
        set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
      }, duration)
    }
    return id
  },

  dismiss(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  },

  clear() {
    set({ toasts: [] })
  },
}))

export function showToast(message, type = 'success', duration = 3500) {
  return useToastStore.getState().show(message, type, duration)
}

export function dismissToast(id) {
  return useToastStore.getState().dismiss(id)
}
