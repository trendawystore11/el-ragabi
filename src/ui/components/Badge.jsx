// =============================================================================
// ui/components/Badge.jsx — شارة/وسم بنمط .badge / .status-chip القديم
// -----------------------------------------------------------------------------
// الأنماط تعتمد على الثيم (CSS vars) عبر class .badge + ألوان حسب الحالة.
// =============================================================================
const VARIANTS = {
  brand: 'ui-badge-brand bg-brand-600 text-white',
  success: 'ui-badge-success bg-emerald-600 text-white emerald',
  error: 'ui-badge-error bg-rose-600 text-white rose',
  warning: 'ui-badge-warning bg-amber-500 text-white amber',
  info: 'ui-badge-info bg-cyan-600 text-white cyan',
  purple: 'ui-badge-purple bg-violet-600 text-white purple',
  neutral: 'ui-badge-neutral bg-slate-600 text-white slate',
}

function Badge({ variant = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={['badge ui-badge inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold whitespace-nowrap', VARIANTS[variant] || VARIANTS.neutral, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </span>
  )
}

export default Badge
