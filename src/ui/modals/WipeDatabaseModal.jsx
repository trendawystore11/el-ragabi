// =============================================================================
// ui/modals/WipeDatabaseModal.jsx — نافذة مسح القواعد السحابية — نسخة React من
// window.promptWipeDatabase (js/components/reports-view.js)
// -----------------------------------------------------------------------------
// تأكيد صارم بكلمة مرور المدير: تحقق من verifyAdminPassword ثم forceWipeDatabase
// مع نفس رسائل الحظر/الإلغاء في القديم (بدون prompt، عبر نموذج حقيقي).
// =============================================================================
import { useState } from 'react'
import { Lock, Trash2, AlertTriangle } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { useReportsStore } from '@/state/reportsStore'
import { showToast } from '../components/toastStore.js'

function WipeDatabaseModal() {
  const open = useUiStore(s => s.wipeDatabaseModal.open)
  if (!open) return null
  return <WipeDatabaseModalInner />
}

function WipeDatabaseModalInner() {
  const close = useUiStore(s => s.closeWipeDatabaseModal)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    if (submitting) return
    // V3.40 — فحص صريح للحقل المطلوب: لا فشل صامت ولا تجميد — رسالة توضح السبب.
    if (!password.trim()) {
      setError('يرجى إدخال كلمة مرور المدير للمتابعة')
      showToast('تم إلغاء العملية. يرجى إدخال كلمة المرور لتنفيذ مسح القواعد', 'warning')
      return
    }

    let isValid = false
    try {
      isValid = window.verifyAdminPassword ? await window.verifyAdminPassword(password) : false
    } catch {
      isValid = false
    }
    if (!isValid) {
      const msg = window.adminPasswordConfigured && !window.adminPasswordConfigured()
        ? 'لا توجد كلمة سر مسجلة للمدير — سجّلها أولاً من (القائمة ▾ ← تغيير كلمة السر) ثم أعد المحاولة'
        : 'كلمة المرور غير صحيحة! تم حظر وإيقاف عملية مسح القواعد السحابية 🛑'
      setError(msg)
      showToast(msg, 'error')
      return
    }
    setError('')

    setSubmitting(true)
    try {
      const success = window.forceWipeDatabase ? await window.forceWipeDatabase(password) : false
      if (success) {
        showToast('تم مسح القواعد السحابية وتصفير البيانات نهائياً', 'success')
        close()
        useReportsStore.getState().refresh()
      } else {
        setError('لم تُنفَّذ عملية المسح — راجع حالة النظام وأعد المحاولة')
      }
    } catch (err) {
      const msg = (err && err.message) || String(err)
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title="تصفير ومسح القواعد السحابية 🔒" icon={Lock} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-rose-950/30 rounded-xl border border-rose-800/40 text-xs text-rose-300 leading-relaxed flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <span>
            إجراء أمني صارم: سيتم حذف مسودات البيانات التجريبية نهائياً من القواعد السحابية ولا يمكن التراجع.
            أدخل كلمة مرور المدير الحالية لتأكيد العملية.
          </span>
        </div>

        <Input
          label="كلمة مرور المدير *"
          type="password"
          value={password}
          onChange={v => { setPassword(v); if (error) setError('') }}
          placeholder="••••••••"
          error={error}
          autoFocus
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button
            type="submit"
            variant="danger"
            icon={Trash2}
            loading={submitting}
            disabled={submitting}
            className="px-6"
          >
            {submitting ? 'جاري المسح...' : 'تأكيد مسح القواعد نهائياً'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default WipeDatabaseModal
