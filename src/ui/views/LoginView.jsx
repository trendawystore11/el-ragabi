// =============================================================================
// ui/views/LoginView.jsx — شاشة تسجيل الدخول العامة — نسخة React من #login-screen
// -----------------------------------------------------------------------------
// نسخة حرفية من legacy (index.html + js/app.js): البطاقة بالشعار/اسم النظام/
// السطر التعريفي من general settings، حقلا البريد وكلمة المرور مع زر إظهار/
// إخفاء، تسليم عبر authStore.login (نفس التحقق الصارم والرسائل)، زر «نسيت كلمة
// السر؟» يفتح نافذة إرشاد التواصل مع المدير. تُعرض فقط عند غياب الجلسة (App.jsx).
// =============================================================================
import { useState } from 'react'
import { Mail, Eye, EyeOff, Store, Info } from 'lucide-react'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import { useAuthStore } from '@/state/authStore'
import { useSettingsStore } from '@/state/settingsStore'
import { showToast } from '../components/toastStore.js'

function LoginView() {
  const appName = useSettingsStore(s => s.appName)
  const tagline = useSettingsStore(s => s.tagline)
  const logo = useSettingsStore(s => s.logo)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const submit = async e => {
    e.preventDefault()
    if (submitting) return

    const nextErrors = {}
    if (!email.trim()) {
      nextErrors.email = 'يرجى إدخال البريد الإلكتروني'
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      nextErrors.email = 'يرجى إدخال بريد إلكتروني صحيح'
    }
    if (!password) {
      nextErrors.password = 'يرجى إدخال كلمة المرور'
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }
    setErrors({})

    setSubmitting(true)
    try {
      await useAuthStore.getState().login(email.trim(), password)
      showToast('تم تسجيل الدخول بنجاح', 'success')
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div dir="rtl" className="login-page min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="login-card w-full max-w-md p-8 bg-slate-900 rounded-2xl border border-slate-800 shadow-md relative overflow-hidden">

        <div className="text-center mb-8 relative z-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl overflow-hidden bg-slate-800 border border-brand-500/30 mb-4 shadow-sm">
            {logo ? (
              <img src={logo} alt={appName} className="w-full h-full object-contain" />
            ) : (
              <Store className="w-10 h-10 text-brand-400" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{appName}</h1>
          {tagline ? <p className="text-sm text-slate-400">{tagline}</p> : null}
        </div>

        <form onSubmit={submit} noValidate className="space-y-5 relative z-10">
          <Input
            label="البريد الإلكتروني"
            type="email"
            required
            autoComplete="off"
            placeholder="name@store.com"
            value={email}
            onChange={v => { setEmail(v); clearError('email') }}
            icon={Mail}
            textLeft
            voice={false}
            error={errors.email}
          />
          <div className="relative">
            <Input
              label="كلمة المرور"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={v => { setPassword(v); clearError('password') }}
              textLeft
              voice={false}
              error={errors.password}
              className="pr-11"
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label="إظهار / إخفاء كلمة السر"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2.5 top-9 p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <Button type="submit" fullWidth size="lg" loading={submitting} icon={Mail}>
            تسجيل الدخول
          </Button>

          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="w-full text-center text-xs text-slate-400 hover:text-brand-300 transition-colors mt-1"
          >
            نسيت كلمة السر؟
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-slate-500 border-t border-slate-800/80 pt-4">
          <span>الحسابات والإنشاء محصورة بمدير النظام فقط لضمان الأمان الكامل</span>
        </div>
      </div>

      <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} title="نسيت كلمة السر؟" icon={Info} maxWidth="max-w-md">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Info className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            يرجى التواصل مع المدير العام (Admin) لإعادة تعيين كلمة السر الخاصة بك من شاشة الموظفين.
          </p>
        </div>
      </Modal>
    </div>
  )
}

export default LoginView
