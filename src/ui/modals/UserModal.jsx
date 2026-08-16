// =============================================================================
// ui/modals/UserModal.jsx — نسخة React من openAddUserModal / openEditUserModal
// (users-view.js) — Phase 10
// -----------------------------------------------------------------------------
// إنشاء حساب موظف جديد (الاسم، البريد، كلمة المرور، الرتبة) أو تعديل بيانات
// حساب قائم مع إعادة ضبط كلمة المرور. صلاحية المدير العام الرئيسي (USR-1001)
// والحساب الجالس به لا يمكن تغييرها (قائمة معطلة + ملاحظة 🔒). عند تعديل حساب
// المستخدم الحالي تُعاد مزامنة رأس التطبيق فوراً عبر authStore.restore().
// =============================================================================
import { useState } from 'react'
import { UserPlus, UserCog, CheckCircle2 } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { useAuthStore } from '@/state/authStore'

const ROLE_OPTIONS = [
  { value: 'employee', label: 'كاشير / موظف مبيعات (Cashier / Sales)' },
  { value: 'storekeeper', label: 'أمين مخزن (Storekeeper)' },
  { value: 'accountant', label: 'محاسب / مالي (Accountant)' },
  { value: 'admin', label: 'مدير نظام كامل (Admin)' },
]

function UserModal() {
  const open = useUiStore(s => s.userModal.open)
  if (!open) return null
  return <UserModalInner />
}

function UserModalInner() {
  const { userId, onDone } = useUiStore(s => s.userModal)
  const close = useUiStore(s => s.closeUserModal)

  const [user] = useState(() => {
    if (!userId) return null
    if (typeof window === 'undefined' || !window.getUsers) return null
    return window.getUsers().find(u => u.id === userId) || null
  })
  const isEdit = !!user

  const currentUser =
    typeof window !== 'undefined' && window.getCurrentUser ? window.getCurrentUser() : null
  const isMainAdmin =
    !!user &&
    (user.id === 'USR-1001' ||
      (currentUser &&
        user.email &&
        ((currentUser.email || '')).toLowerCase() === ((user.email || '')).toLowerCase()))

  const [name, setName] = useState(user ? user.name : '')
  const [email, setEmail] = useState(user ? user.email : '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user ? user.role || 'employee' : 'employee')

  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()

    if (!name.trim()) {
      showToast('يرجى إدخال اسم الموظف', 'error')
      return
    }
    if (!email.trim()) {
      showToast('يرجى إدخال البريد الإلكتروني', 'error')
      return
    }
    if (!isEdit && (!password || password.trim().length < 6)) {
      showToast('كلمة المرور يجب ألا تقل عن 6 أحرف', 'error')
      return
    }
    if (isEdit && password && password.trim().length > 0 && password.trim().length < 6) {
      showToast('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف', 'error')
      return
    }

    setSubmitting(true)
    try {
      if (isEdit) {
        window.updateUserAccount(user.id, {
          name,
          email,
          password,
          role: isMainAdmin ? user.role : role,
        })

        // 🖥️ إذا كان الحساب المعدَّل هو حساب الجالس نفسه → مزامنة فورية لرأس
        // التطبيق (الاسم/البريد/الرتبة) بدون إعادة تحميل أو تسجيل دخول جديد.
        const currentSession = window.getCurrentUser ? window.getCurrentUser() : null
        const isSelf =
          currentSession &&
          ((user.id && currentSession.id && user.id === currentSession.id) ||
            (currentSession.email &&
              user.email &&
              ((currentSession.email || '')).toLowerCase() === ((user.email || '')).toLowerCase()))
        if (isSelf) useAuthStore.getState().restore()

        showToast(`تم تعديل بيانات ورمز حساب "${user.name}" بنجاح`, 'success')
      } else {
        await window.createNewUserAccount({ name, email, password, role })
        showToast('تم إنشاء حساب الموظف وتفعيل الصلاحية بنجاح', 'success')
      }
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast(err && err.message ? err.message : 'حدث خطأ أثناء الحفظ', 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title={isEdit ? `🔑 تعديل بيانات وكلمة سر: ${user.name}` : '👤 إضافة موظف وحساب جديد للسيستم'}
      icon={isEdit ? UserCog : UserPlus}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={isEdit ? 'اسم الموظف' : 'اسم الموظف الثلاثي'}
          required
          value={name}
          onChange={setName}
          placeholder="مثال: أحمد محمود علي"
        />

        <Input
          label="البريد الإلكتروني"
          type="email"
          required
          value={email}
          onChange={setEmail}
          placeholder="employee@store.com"
          className="text-left font-mono"
        />

        <Input
          label={isEdit ? 'إعادة ضبط كلمة المرور (Reset Password)' : 'كلمة المرور للدخول'}
          type="password"
          minLength={6}
          required={!isEdit}
          value={password}
          onChange={setPassword}
          placeholder={
            isEdit ? 'اكتب كلمة مرور جديدة أو اتركها فارغة بدون تغيير' : '••••••••'
          }
          className="text-left"
          hint={
            isEdit ? 'إذا أردت تغيير كلمة مرور الموظف، اكتب المرور الجديدة هنا' : undefined
          }
        />

        <div>
          <Select label="الصلاحية / الرتبة" value={role} onChange={setRole} options={ROLE_OPTIONS} disabled={!!isMainAdmin} />
          {isMainAdmin ? (
            <p className="text-[11px] text-amber-400 mt-1.5">🔒 لا يمكن تغيير صلاحية المدير العام الرئيسي</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            إلغاء
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={CheckCircle2}
            loading={submitting}
            disabled={submitting}
          >
            {submitting
              ? 'جاري الحفظ...'
              : isEdit
                ? 'حفظ التعديلات وكلمة المرور'
                : 'إنشاء الحساب وتفعيل الصلاحية'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default UserModal
