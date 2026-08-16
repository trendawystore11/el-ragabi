// =============================================================================
// ui/modals/ChangePasswordModal.jsx — نافذة تغيير كلمة السر — نسخة React من
// modal تغيير كلمة السر legacy (js/app.js:262-310)
// -----------------------------------------------------------------------------
// نفس التدفق الحرفي للقديم: عند غياب كلمة سر مسجلة (adminPasswordConfigured ===
// false) يُعرض banner amber «لا توجد كلمة سر مسجلة...» ولا يظهر حقل «كلمة السر
// الحالية» إطلاقاً، والحفظ عبر window.changeOwnPassword(current, fresh) ثم
// toast «تم تغيير كلمة السر بنجاح». أخطاء الخدمة (الحد الأدنى 6 أحرف / تطابق
// التأكيد / جلسة منتهية) تُعرض كما هي عبر toast.
// =============================================================================
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { useAuthStore } from '../../state/authStore.js'
import { showToast } from '../components/toastStore.js'

function ChangePasswordModalInner() {
  const close = useUiStore(s => s.closeChangePasswordModal)
  const [noPassSet] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.adminPasswordConfigured === 'function' &&
      !window.adminPasswordConfigured()
  )
  const [current, setCurrent] = useState('')
  const [fresh, setFresh] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const submit = async e => {
    e.preventDefault()
    if (submitting) return

    const nextErrors = {}
    if (!noPassSet && !current) {
      nextErrors.current = 'يرجى إدخال كلمة السر الحالية'
    }
    if (!fresh || fresh.length < 6) {
      nextErrors.fresh = 'كلمة السر الجديدة يجب ألا تقل عن 6 أحرف'
    }
    if (fresh !== confirm) {
      nextErrors.confirm = 'كلمة السر الجديدة وتأكيدها غير متطابقتين'
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }
    setErrors({})

    setSubmitting(true)
    try {
      if (typeof window.changeOwnPassword !== 'function') {
        throw new Error('خدمة تغيير كلمة السر غير متوفرة حالياً')
      }
      await window.changeOwnPassword(current, fresh)
      // 🔄 تحديث فوري لحالة كلمة سر المدير في المخزن بعد الحفظ الناجح.
      if (typeof useAuthStore.getState().refreshAdminPasswordState === 'function') {
        useAuthStore.getState().refreshAdminPasswordState()
      }
      showToast('تم تغيير كلمة السر بنجاح', 'success')
      close()
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setSubmitting(false)
    }
  }


  return (
    <Modal
      open
      onClose={close}
      title="تغيير كلمة السر"
      icon={KeyRound}
      maxWidth="max-w-md"
    >
      {noPassSet ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400 font-medium">
          ⚠️ لا توجد كلمة سر مسجلة لهذا الحساب — أدخل كلمة السر الجديدة فقط لتسجيلها
          لأول مرة.
        </div>
      ) : null}
      <form onSubmit={submit} noValidate className="space-y-4">
        {!noPassSet ? (
          <Input
            label="كلمة السر الحالية"
            type="password"
            required
            autoFocus
            placeholder="••••••••"
            value={current}
            onChange={v => { setCurrent(v); clearError('current') }}
            error={errors.current}
          />
        ) : null}
        <Input
          label="كلمة السر الجديدة"
          type="password"
          required
          autoFocus={noPassSet}
          minLength={6}
          placeholder="6 أحرف على الأقل"
          value={fresh}
          onChange={v => { setFresh(v); clearError('fresh') }}
          error={errors.fresh}
        />
        <Input
          label="تأكيد كلمة السر الجديدة"
          type="password"
          required
          placeholder="أعد إدخال كلمة السر الجديدة"
          value={confirm}
          onChange={v => { setConfirm(v); clearError('confirm') }}
          error={errors.confirm}
        />
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            إلغاء
          </Button>
          <Button type="submit" variant="primary" icon={KeyRound} loading={submitting} disabled={submitting}>
            {submitting ? 'جارٍ الحفظ...' : '✓ حفظ'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ChangePasswordModal() {
  const open = useUiStore(s => s.changePasswordModal.open)
  if (!open) return null
  return <ChangePasswordModalInner />
}

export default ChangePasswordModal
