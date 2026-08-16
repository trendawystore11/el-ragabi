// =============================================================================
// ui/components/ToastContainer.jsx — حاوية التنبيهات (React)
// -----------------------------------------------------------------------------
// تُركّب في #toast-container (أو تنشئها) وتعرض التنبيهات من toastStore بنفس
// تنسيق js/utils/toast.js القديم (ألوان حسب النوع + زر إغلاق + أيقونة).
// =============================================================================
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react'
import { useToastStore, dismissToast } from './toastStore.js'

const TYPE_META = {
  success: { Icon: CheckCircle2, cls: 'bg-emerald-950/90 text-emerald-200 border-emerald-800/80' },
  error: { Icon: AlertTriangle, cls: 'bg-rose-950/90 text-rose-200 border-rose-800/80' },
  warning: { Icon: AlertCircle, cls: 'bg-amber-950/90 text-amber-200 border-amber-800/80' },
  info: { Icon: Info, cls: 'bg-sky-950/90 text-sky-200 border-sky-800/80' },
}

function ensureContainer() {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    container.className =
      'fixed top-4 left-4 z-[60] flex flex-col gap-2 items-start pointer-events-none max-w-[calc(100vw-2rem)]'
    document.body.appendChild(container)
  }
  return container
}

function ToastContainer() {
  const toasts = useToastStore(s => s.toasts)
  const [container] = useState(() => ensureContainer())

  return createPortal(
    <>
      {toasts.map(toast => {
        const meta = TYPE_META[toast.type] || TYPE_META.success
        const Icon = meta.Icon
        return (
          <div
            key={toast.id}
            className={`toast-card pointer-events-auto flex items-center justify-between gap-3 p-4 rounded-xl text-sm font-semibold border w-fit max-w-full ${meta.cls}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="toast-icon-wrap shrink-0"><Icon className="w-5 h-5" /></span>
              <span className="toast-message break-words">{toast.message}</span>
            </div>
            <button
              type="button"
              className="toast-close-btn p-1"
              onClick={() => dismissToast(toast.id)}
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </>,
    container
  )
}

export default ToastContainer
