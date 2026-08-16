// =============================================================================
// ui/components/Modal.jsx — نافذة حوار بنمط js/utils/modal.js القديم
// -----------------------------------------------------------------------------
// نفس البنية الحرفية للقديم: حاوية #modal-container + خلفية مموهة + رأس بأيقونة
// وعنوان وزر إغلاق + جسم قابل للتمرير. الإغلاق عند النقر على الخلفية أو X.
// تُعادل openModal({title, icon, contentHTML, maxWidth, onClose}).
// =============================================================================
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

function ensureContainer() {
  let container = document.getElementById('modal-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'modal-container'
    document.body.appendChild(container)
  }
  return container
}

function Modal({
  open,
  onClose,
  title,
  icon: Icon,
  maxWidth = 'max-w-2xl',
  children,
  footer,
  bodyClassName = '',
}) {
  const [container] = useState(() => ensureContainer())

  const handleBackdrop = useCallback(
    e => {
      if (e.target === e.currentTarget && onClose) onClose()
    },
    [onClose]
  )

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 ui-modal-backdrop backdrop-blur-sm overflow-y-auto modal-animate"
      onClick={handleBackdrop}
    >
      <div
        className={`relative w-full ${maxWidth} ui-modal-panel border rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b ui-modal-header sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            {Icon ? (
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
            ) : null}
            <h3 className="text-lg font-bold text-theme-strong">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 ui-icon-button text-slate-400 rounded-xl transition-all"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className={`p-6 overflow-y-auto flex-1 space-y-4 ${bodyClassName}`}>{children}</div>

        {footer ? (
          <div className="px-6 py-4 border-t ui-modal-footer flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    container
  )
}

export default Modal
