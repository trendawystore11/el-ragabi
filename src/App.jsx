// Phase 3 — هيكل التطبيق: بوابة الجلسة (LoginView) ثم AppShell.
// يُهيّئ المخازن (المظهر/الجلسة) عند الإقلاع؛ البيانات تمر عبر الجسر (compat).
import { useEffect } from 'react'
import AppShell from '@/ui/layout/AppShell'
import LoginView from '@/ui/views/LoginView'
import ToastContainer from '@/ui/components/ToastContainer'
import { useSettingsStore } from '@/state/settingsStore'
import { useAuthStore } from '@/state/authStore'
import { initDB } from '@/services/db.js'

import { isUsingFallbackConfig } from '@/services/db.js'

function ProductionConfigWarningBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-lg dir-rtl">
      <span>⚠️ تنبيه الإنتاج (Production Guard): التطبيق يعمل بمشروع Firebase الافتراضي الاحتياطي. يُوصى بضبط إعدادات مشروعك السحابي من معالج الإعداد (Config Wizard).</span>
    </div>
  )
}

function App() {
  const user = useAuthStore(s => s.user)
  const isProdFallback = Boolean(import.meta.env && import.meta.env.PROD && isUsingFallbackConfig())

  useEffect(() => {
    initDB()
    if (typeof window !== 'undefined' && typeof window.postDueRecurringExpenses === 'function') {
      window.postDueRecurringExpenses()
    }
    useSettingsStore.getState().hydrate()
    useAuthStore.getState().restore()
  }, [])

  useEffect(() => {
    if (user) {
      useSettingsStore.getState().hydrate()
      // V3.55 — ثيم المتصفح الآخر يعود فور الدخول (قراءة فقط، بلا رفع تلقائي).
      useSettingsStore.getState().hydrateCloudTheme()
    }
  }, [user])

  return (
    <>
      {isProdFallback && <ProductionConfigWarningBanner />}
      {user ? <AppShell /> : <LoginView />}
      <ToastContainer />
    </>
  )
}

export default App

