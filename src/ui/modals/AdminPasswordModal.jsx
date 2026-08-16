// =============================================================================
// ui/modals/AdminPasswordModal.jsx — نافذة تأكيد هوية المدير (🔐)
// -----------------------------------------------------------------------------
// معادل React لـ requireAdminPassword في legacy: تُطلب كلمة سر المدير العام قبل
// فتح الإعدادات الحساسة. عند النجاح تُستدعى onOk، وعند الفشل تُعرض رسالة خطأ
// (بما فيها حالة عدم تسجيل كلمة سر أصلاً). بوابة المدير تتم داخل uiStore.
// =============================================================================
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { showToast } from '../components/toastStore.js'
import { useUiStore } from '../state/uiStore.js'
import { useAuthStore } from '../../state/authStore.js'

function AdminPasswordModalInner() {
  const { note, onOk } = useUiStore(s => s.adminPasswordModal)
  const close = useUiStore(s => s.closeAdminPasswordModal)
  // 🔑 تُقرأ عند فتح النافذة فقط: عند أول استخدام (لا كلمة سر مسجلة) تتحول
  // النافذة إلى وضع تسجيل كلمة سر جديدة بدلاً من الانغلاق في رسالة
  // «لا توجد كلمة سر مسجلة» (حلقة التنقل القديمة).
  const [configured] = useState(() =>
    typeof window !== 'undefined' && typeof window.adminPasswordConfigured === 'function'
      ? window.adminPasswordConfigured()
      : true
  )
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (submitting) return

    // V3.40 — لا فشل صامت للحقل المطلوب: رسالة واضحة قبل أي تحقق.
    if (!password.trim()) {
      setError('يرجى إدخال كلمة السر أولاً')
      showToast('يرجى إدخال كلمة السر أولاً', 'error')
      return
    }

    // ✅ أول استخدام: لا كلمة سر مسجلة — سجّل كلمة السر الجديدة مباشرة ثم تابع.
    if (!configured) {
      setSubmitting(true)
      try {
        if (typeof window.changeOwnPassword !== 'function') {
          throw new Error('خدمة تسجيل كلمة السر غير متوفرة حالياً')
        }
        await window.changeOwnPassword('', password)
        if (typeof useAuthStore.getState().refreshAdminPasswordState === 'function') {
          useAuthStore.getState().refreshAdminPasswordState()
        }
        showToast('تم تسجيل كلمة سر المدير بنجاح', 'success')
        close()
        if (typeof onOk === 'function') onOk()
      } catch (err) {
        const msg = (err && err.message) || String(err)
        setError(msg)
        showToast(msg, 'error')
      } finally {
        setSubmitting(false)
      }
      return
    }


    setSubmitting(true)
    let ok = false
    try {
      ok = typeof window.verifyAdminPassword === 'function' ? await window.verifyAdminPassword(password) : false
    } catch {
      ok = false
    } finally {
      setSubmitting(false)
    }
    if (ok) {
      close()
      if (typeof onOk === 'function') onOk()
      return
    }
    setError('عفواً، كلمة السر غير صحيحة!')
    showToast('عفواً، كلمة السر غير صحيحة!', 'error')
  }


  return (
    <Modal
      open
      onClose={close}
      title={configured ? 'تأكيد هوية المدير' : 'تسجيل كلمة سر المدير'}
      icon={ShieldCheck}
      maxWidth="max-w-md"
    >
      {!configured ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400 font-medium">
          ⚠️ لا توجد كلمة سر مسجلة للمدير بعد — أدخل كلمة سر جديدة (6 أحرف على
          الأقل) لتسجيلها أولاً ثم تابع العملية.
        </div>
      ) : null}
      <p className="text-sm text-slate-300 leading-relaxed">{note}</p>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Input
          label={configured ? 'كلمة السر' : 'كلمة السر الجديدة'}
          type="password"
          required
          autoFocus
          minLength={configured ? undefined : 6}
          placeholder="••••••••"
          value={password}
          onChange={v => { setPassword(v); if (error) setError('') }}
          error={error}
        />
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            إلغاء
          </Button>
          <Button type="submit" variant="primary" icon={ShieldCheck} loading={submitting} disabled={submitting}>
            {submitting ? 'جارٍ التحقق...' : (configured ? '✓ تأكيد' : '✓ تسجيل والمتابعة')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function AdminPasswordModal() {
  const open = useUiStore(s => s.adminPasswordModal.open)
  if (!open) return null
  return <AdminPasswordModalInner />
}

export default AdminPasswordModal
