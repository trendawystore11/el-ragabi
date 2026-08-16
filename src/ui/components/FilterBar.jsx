// =============================================================================
// ui/components/FilterBar.jsx — الشريط الأفقي الموحد للبحث والفلترة
// -----------------------------------------------------------------------------
// شريط موحد يمتد عبر عرض الشاشة بدل التكديس العمودي السابق في هيدرات الشاشات:
// صف علوي يجمع (العنوان + أزرار الإجراءات مثل إضافة/إعادة ضبط) وصف سفلي عبارة
// عن شبكة مستجيبة RTL تضم عناصر الفلترة (خانة البحث + القوائم المنسدلة +
// حقول التاريخ من/إلى). يُستخدم في شاشات الطلبات/العملاء/المنتجات/الموردين/
// المصروفات. cols يضبط أعمدة الشبكة حسب كثافة عناصر كل شاشة.
// =============================================================================
function FilterBar({ icon, title, subtitle, actions, cols = 'sm:grid-cols-2', children }) {
  const hasHeader = title || actions

  return (
    <div className="page-filter-bar v7-filterbar bg-slate-900/70 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
      {hasHeader ? (
        <div
          className={`flex flex-col md:flex-row md:items-center gap-3 ${
            title ? 'justify-between' : 'md:justify-end'
          }`}
        >
          {title ? (
            <div className="flex items-center gap-2.5 min-w-0">
              {icon ? <span className="shrink-0">{icon}</span> : null}
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-white leading-tight">{title}</h1>
                {subtitle ? <p className="text-xs text-slate-400 mt-1">{subtitle}</p> : null}
              </div>
            </div>
          ) : null}
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={`grid grid-cols-1 ${cols} gap-3 items-end`}>{children}</div>
    </div>
  )
}

export default FilterBar
