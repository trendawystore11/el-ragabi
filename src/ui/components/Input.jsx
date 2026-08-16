// =============================================================================
// ui/components/Input.jsx — حقل إدخال بنمط النظام (RTL-aware)
// -----------------------------------------------------------------------------
// بنية مطابقة لحقول js/components: تسمية فوقية + حقل + أيقونة/خطأ/تلميح.
// اليسار الاختياري textLeft للحقول الرقمية (النصوص/الأرقام تُقرأ LTR).
//
// 🎤 الإدخال الصوتي الشامل: يُدمج زر المايك (VoiceInput) تلقائياً في حقول
// النص العادية افتراضياً — النتيجة الصوتية تُكتب مباشرة داخل الحقل عبر
// onChange. يُمنع المايك نهائياً عن:
//   1) الحقول الرقمية type="number" (تُدخل أرقاماً عبر لوحة المفاتيح مباشرة).
//   2) الحقول الرقمية الصارمة numeric (هاتف/باركود/أكواد) — ويضيف inputMode
//      numeric للوحة أرقام على الجوال.
//   3) الحقول الحساسة/التقنية voice={false} (مفاتيح API والكويفجات التقنية).
//   4) حقول كلمة المرور type="password" (خصوصية — لا إملاء صوتي لكلمات السر).
// =============================================================================
import { useId } from 'react'
import VoiceInput from './VoiceInput.jsx'

function Input({
  label,
  value,
  onChange,
  onInput,
  type = 'text',
  placeholder,
  icon: Icon,
  suffix,
  error,
  hint,
  id,
  name,
  textLeft = false,
  required = false,
  disabled = false,
  voice = true,
  numeric = false,
  voiceLabel,
  className = '',
  onKeyDown,
  ...rest
}) {
  const autoId = useId()
  const inputId = id || autoId

  const voiceEnabled = voice !== false && !disabled && type !== 'number' && type !== 'password' && !numeric
  const hasLeftSlot = voiceEnabled || !!suffix

  const handleVoiceResult = text => {
    if (!text || typeof onChange !== 'function') return
    const base = (typeof value === 'string' ? value : '').trimEnd()
    onChange(base ? base + ' ' + text : text)
  }

  const fieldClass = [
    'ui-input w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none transition-all',
    Icon ? 'pr-11' : '',
    hasLeftSlot ? 'pl-11' : '',
    error ? 'border-rose-500/70' : 'border-slate-700',
    textLeft ? 'text-left' : '',
    disabled ? 'opacity-60 cursor-not-allowed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const voiceAriaLabel = voiceLabel || `الإدخال الصوتي لـ ${label || placeholder || 'الحقل'}`

  return (
    <div className="space-y-1.5 w-full">
      {label ? (
        <label htmlFor={inputId} className="block text-xs font-semibold text-slate-300">
          {label}
          {required ? <span className="text-rose-400 mr-1">*</span> : null}
        </label>
      ) : null}
      <div className="relative">
        {Icon ? (
          <Icon className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        ) : null}
        {voiceEnabled ? (
          <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center shrink-0">
            <VoiceInput onResult={handleVoiceResult} ariaLabel={voiceAriaLabel} title={voiceAriaLabel} />
          </div>
        ) : suffix ? (
          <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center shrink-0">{suffix}</div>
        ) : null}
        <input
          id={inputId}
          name={name}
          type={type}
          value={value}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          inputMode={numeric ? 'numeric' : undefined}
          className={fieldClass}
          onKeyDown={onKeyDown}
          onChange={onInput || (e => onChange && onChange(e.target.value, e))}
          {...rest}
        />
      </div>
      {error ? <p className="text-xs text-rose-400 font-medium">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default Input
