// =============================================================================
// ui/components/Card.jsx — بطاقة بنمط .card القديم (سطح مع ترويسة اختيارية)
// -----------------------------------------------------------------------------
// تستخدم class .card من الثيم (CSS vars) + ترويسة flex بسيطة عند تمرير title.
// =============================================================================
function Card({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className = '',
  bodyClassName = '',
  ...rest
}) {
  const hasHeader = title !== undefined || actions !== undefined || Icon
  return (
    <section className={['card ui-card p-5', className].filter(Boolean).join(' ')} {...rest}>
      {hasHeader ? (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon ? (
              <span className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? <h3 className="text-sm font-bold text-theme-strong truncate">{title}</h3> : null}
              {subtitle ? <p className="text-xs text-theme-muted truncate">{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export default Card
