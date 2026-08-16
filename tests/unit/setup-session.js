import { beforeEach } from 'vitest'
import { storageKey } from '@/client/storage'

// V3.57 — test fixture: uiStore.hasPermission now FAILS CLOSED when no session
// exists (a real audit finding). Modal/UI tests run without a real login, so we
// plant a default admin session BEFORE each test using the SAME session key that
// services/auth.js getCurrentUser() reads (bms_<clientId>_user_session). This
// must go through the real session storage — a window.getCurrentUser stub is
// clobbered when compat.js wires the real auth service onto window at import.
// Tests that assert specific roles or a denied (null) session clear or overwrite
// the session in their own beforeEach, which runs after this one.
beforeEach(() => {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(storageKey('user_session'), JSON.stringify({
      id: 'USR-1001',
      email: 'admin@store.com',
      name: 'المدير العام',
      role: 'admin',
    }))
  } catch {
    /* ignore storage errors */
  }
})
