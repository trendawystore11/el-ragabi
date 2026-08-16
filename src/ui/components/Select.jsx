// =============================================================================
// ui/components/Select.jsx — قائمة منسدلة بنمط النظام
// -----------------------------------------------------------------------------
// options يمكن أن تكون مصفوفة سلاسل أو مصفوفة {value,label}. تمرير
// children:node بدلاً من options للاستخدامات المتقدمة (كخيارات المجموعات).
// =============================================================================
import { useId } from 'react'

function Select({
  label,
  value,
  onChange,
  options = [],
  placeholder,
  id,
  name,
  error,
  hint,
  required = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const autoId = useId()
  const selectId = id || autoId

  const list = options.map(opt =>
    typeof opt === 'string' || typeof opt === 'number'
      ? { value: String(opt), label: String(opt) }
      : { value: String(opt.value), label: opt.label != null ? opt.label : String(opt.value) }
  )

  return (
    <div className="space-y-1.5 w-full">
      {label ? (
        <label htmlFor={selectId} className="block text-xs font-semibold text-slate-300">
          {label}
          {required ? <span className="text-rose-400 mr-1">*</span> : null}
        </label>
      ) : null}
      <select
        id={selectId}
        name={name}
        value={value}
        disabled={disabled}
        className={[
          'ui-input ui-select w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none transition-all cursor-pointer',
          error ? 'border-rose-500/70' : 'border-slate-700',
          disabled ? 'opacity-60 cursor-not-allowed' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        onChange={e => onChange && onChange(e.target.value, e)}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {children !== undefined
          ? children
          : list.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
      </select>
      {error ? <p className="text-xs text-rose-400 font-medium">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default Select
