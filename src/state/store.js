// =============================================================================
// state/store.js — قلب بيانات النظام (Zustand) — Phase 0 skeleton
// -----------------------------------------------------------------------------
// يُملأ في Phase 2 بعد نقل خدمات Firestore. هنا إطار عمل فقط:
//   - firestoreCache بديل window.firestoreCache
//   - الاشتراك اللحظي عبر useSyncExternalStore يتم عبر repository.subscribe()
// =============================================================================
import { create } from 'zustand'

export const useStore = create((set) => ({
  cache: {},
  ready: false,
  syncing: false,
  lastSyncAt: null,
  lastSyncSource: null,
  pendingCount: 0,
  offline: false,
  sandbox: false,

  setCacheKey(key, items) {
    set((s) => ({ cache: { ...s.cache, [key]: items } }))
  },
  setReady(v) { set({ ready: v }) },
  setSyncing(v) { set({ syncing: v }) },
  setLastSync(meta) { set({ lastSyncAt: meta.at, lastSyncSource: meta.source }) },
  setPendingCount(n) { set({ pendingCount: n }) },
  setOffline(v) { set({ offline: v }) },
  setSandbox(v) { set({ sandbox: v }) },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('bms-sync-status-changed', (e) => {
    const detail = e && e.detail;
    if (detail) {
      if (detail.connectionState === 'online') {
        useStore.getState().setOffline(false);
        useStore.getState().setSyncing(false);
      } else if (detail.connectionState === 'reconnecting') {
        useStore.getState().setSyncing(true);
      } else if (detail.connectionState === 'error') {
        useStore.getState().setOffline(true);
        useStore.getState().setSyncing(false);
      }
    }
  });
}

