// =============================================================================
// state/sandboxStore.js — وضع الاختبار V3.25 — Phase 3
// -----------------------------------------------------------------------------
// يغلّف SandboxRepository المنقول داخل services/db (enter/exit/set/isActive).
// الوضع عزل تام: كل الكتابات تذهب إلى ذاكرة RAM فقط، والبيانات الأصلية تُستنسخ
// عند الدخول وتُستعاد كما هي عند الخروج. يستمع المخزن إلى حدث
// 'bms-sandbox-changed' حتى يبقى متزامناً مع أي مسار يفعّل الوضع مباشرة.
// =============================================================================
import { create } from 'zustand'
import * as dbService from '../services/db.js'

function current() {
  return typeof window !== 'undefined' ? dbService.isSandboxActive() : false
}

export const useSandboxStore = create((set) => ({
  active: current(),

  enter() {
    const ok = dbService.enterSandboxMode()
    set({ active: dbService.isSandboxActive() })
    return ok
  },

  exit() {
    const ok = dbService.exitSandboxMode()
    set({ active: dbService.isSandboxActive() })
    return ok
  },

  toggle() {
    // 🔒 store methods are usually destructured (`const { toggle } = useSandboxStore(...)`),
    // so `this` is never reliable — resolve the actions via getState() instead.
    const state = useSandboxStore.getState()
    return dbService.isSandboxActive() ? state.exit() : state.enter()
  },

  set(active) {
    const state = useSandboxStore.getState()
    return active ? state.enter() : state.exit()
  },
}))

// مزامنة الحالة مع أي تفعيل/إيقاف خارجي عبر الحدث القياسي.
if (typeof window !== 'undefined') {
  window.addEventListener('bms-sandbox-changed', (e) => {
    const active = !!(e && e.detail && e.detail.active)
    useSandboxStore.setState({ active })
  })
}
