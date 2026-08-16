// =============================================================================
// ui/components/Button.jsx — زر بنمط النظام (أنماط Tailwind مطابقة للقديم)
// -----------------------------------------------------------------------------
// الأنماط منقولة من العلامات المستخدمة في js/components (primary/خطر/ثانوي).
// يدعم أيقونة lucide-react، تحميل، تعطيل، وتمرير باقي الخصائص للزر.
// =============================================================================
import { Loader2 } from 'lucide-react'

const BASE =
  'ui-btn inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50 disabled:cursor-not-allowed'

const VARIANTS = {
  primary:
    'ui-btn-primary bg-brand-600 hover:bg-brand-700 text-white',
  secondary:
    'ui-btn-secondary bg-slate-700 hover:bg-slate-600 text-white',
  danger:
    'ui-btn-danger bg-rose-600 hover:bg-rose-700 text-white',
  success:
    'ui-btn-success bg-emerald-600 hover:bg-emerald-700 text-white',
  ghost:
    'ui-btn-ghost hover:bg-slate-700/50 text-slate-200',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-base',
}

function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  icon: Icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  className = '',
  onClick,
  ...rest
}) {
  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      className={[
        BASE,
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.md,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={isDisabled}
      onClick={onClick}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : Icon ? <Icon className="w-4 h-4 shrink-0" /> : null}
      {children}
    </button>
  )
}

export default Button
