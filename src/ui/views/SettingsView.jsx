// =============================================================================
// ui/views/SettingsView.jsx — نسخة React من renderSettingsView + setupSettingsEvents
// (settings-view.js) — Phase 11
// -----------------------------------------------------------------------------
// صفحة الإعدادات العامة فقط (بدون كلمة سر): اسم النظام، الشعار (رابط/رفع صورة)،
// اللون الأساسي (ألوان جاهزة + لون مخصص)، ومظهر النظام (8 ثيمات). الحفظ عبر
// settingsStore.save (تطبيق + كتابة + نسخة سحابية) مع إشعار المزامنة. إعدادات
// الربط والسحابة 🔐 تبقى من قائمة الحساب (نافذة legacy openSyncCloudModal).
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { Settings as SettingsIcon, Palette, Lock, Minimize2, ShieldCheck } from 'lucide-react'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import { useSettingsStore } from '@/state/settingsStore'
import { useAuthStore } from '@/state/authStore'
import { CLIENT } from '@/client/config.js'
import { showToast } from '../components/toastStore.js'


// خيارات الثيمات (القيمة → التسمية + اللون المميز الذي يُطبَّق فورياً).
const THEME_META = {
  graphite: { label: 'جرافيت', accent: '#8B7CFF' },
  midnight: { label: 'منتصف الليل', accent: '#6D7CFF' },
  'deep-purple': { label: 'بنفسجي عميق', accent: '#B83DFF' },
  'light-professional': { label: 'فاتح احترافي', accent: '#635BFF' },
  emerald: { label: 'زمردي', accent: '#16C79A' },
  ocean: { label: 'محيطي', accent: '#06b6d4' },
  royal: { label: 'ملكي', accent: '#8b5cf6' },
  coffee: { label: 'قهوة', accent: '#d97706' },
  'luxury-gold': { label: 'ذهبي فاخر', accent: '#d4af37' },
  mint: { label: 'نعناعي', accent: '#22c55e' },
  dark: { label: 'داكن', accent: '#0284c7' },
  light: { label: 'فاتح', accent: '#0284c7' },
}

const THEME_OPTIONS = [
  { value: 'graphite', label: '⚫ جرافيت (افتراضي)' },
  { value: 'midnight', label: '🌌 منتصف الليل' },
  { value: 'deep-purple', label: '🟣 بنفسجي عميق' },
  { value: 'light-professional', label: '💼 فاتح احترافي' },
  { value: 'emerald', label: '💎 زمردي' },
  { value: 'ocean', label: '🌊 محيطي' },
  { value: 'royal', label: '👑 ملكي' },
  { value: 'coffee', label: '☕ قهوة' },
  { value: 'luxury-gold', label: '✨ ذهبي فاخر' },
  { value: 'mint', label: '🌿 نعناعي' },
  { value: 'dark', label: '🌙 داكن' },
  { value: 'light', label: '☀️ فاتح' },
]

const PRESET_COLORS = ['#0284c7', '#0ea5e9', '#7c3aed', '#16a34a', '#dc2626', '#f59e0b', '#db2777', '#0f172a']

const DEFAULT_SETTINGS = {
  appName: CLIENT.appName,
  tagline: CLIENT.tagline,
  logo: CLIENT.logo,
  primaryColor: CLIENT.primaryColor,
  theme: CLIENT.theme,
  compactNumbers: false,
}

// تصغير صور الشعار قبل الحفظ — dataURL صغير (≤160px) يمنع تجاوز سعة localStorage
// التي كانت تُفشل الحفظ بصمت فيظهر وكأن الإعدادات «ترجع» بعد إعادة الفتح.
const MAX_LOGO_SIZE = 160

function readLogoFile(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_LOGO_SIZE / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve('')
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('')
    }
    img.src = url
  })
}

function SettingsView({ onNavigate }) {
  const authed = useAuthStore(s => s.authed)
  const role = useAuthStore(s => s.role)
  // V3.63 — هوية النظام (اسم/شعار) للمدير فقط؛ الثيم واللون ووضع الاختصار
  // تفضيلات شخصية لكل مستخدم على جهازه.
  const isAdmin = role === 'admin'

  const initial = useSettingsStore.getState()
  const [appName, setAppName] = useState(initial.appName)
  const [logo, setLogo] = useState(initial.logo)
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor)
  const [theme, setTheme] = useState(initial.theme)
  const compactNumbers = useSettingsStore(s => s.compactNumbers)
  const [saving, setSaving] = useState(false)
  // Keep the latest typed value available synchronously for save handlers.
  // This preserves the original save behavior even when a test/browser event
  // dispatches a click immediately after an input event.
  const appNameRef = useRef(initial.appName)
  // V3.62 — مؤقّت debounce لتغيير الثيم: الضغط المتكرر السريع يجمّع حفظاً
  // واحداً فقط بدلاً من إغراق شاشة الإشعارات برسالة لكل نقرة.
  const themeDebounceRef = useRef(null)

  useEffect(() => () => clearTimeout(themeDebounceRef.current), [])

  // سحب نسخة الهوية من السحابة عند فتح الشاشة (تغييرات أجراها المدير على
  // جهاز آخر). لا تُمس التفضيلات الشخصية (ثيم/لون) من هنا أبداً.
  useEffect(() => {
    let mounted = true
    const hydrate = () => {
      if (window.generalSettings && typeof window.generalSettings.hydrateFromCloud === 'function') {
        window.generalSettings
          .hydrateFromCloud()
          .then(adopted => {
            if (!adopted || !mounted) return
            const d = useSettingsStore.getState()
            setAppName(d.appName)
            appNameRef.current = d.appName
            setLogo(d.logo)
          })
          .catch(() => {})
      }
    }
    hydrate()
    return () => {
      mounted = false
    }
  }, [])

  if (!authed) {
    return (
      <div className="settings-locked animate-fadeIn">
        <div className="settings-locked-icon"><Lock className="w-7 h-7" /></div>
        <h2 className="settings-locked-title">سجّل الدخول أولاً</h2>
        <p className="settings-locked-copy">
          الإعدادات العامة متاحة بعد تسجيل الدخول — وإعدادات الربط والسحابة 🔐 من قائمة الحساب للمدير فقط
        </p>
      </div>
    )
  }

  // V3.63 — حفظ التفضيلات الشخصية (ثيم/لون/اختصار) محلياً للمستخدم الجالس فقط:
  // تطبيق فوري + كتابة للجهاز، بلا أي رفع للسحابة (لا تؤثر على زملائك).
  const savePersonal = (extra = {}, opts = {}) => {
    const current = useSettingsStore.getState()
    const obj = Object.assign(
      { primaryColor, theme, compactNumbers: current.compactNumbers },
      extra || {}
    )
    const saved = useSettingsStore.getState().save(obj, { noCloudPush: true })
    setPrimaryColor(saved.primaryColor)
    setTheme(saved.theme)
    if (!opts.silent) showToast('✓ تم حفظ تفضيلاتك على هذا الجهاز', 'success')
  }

  // حفظ هوية النظام (اسم/شعار) — للمدير فقط، ويظهر للجميع عبر السحابة.
  const saveIdentity = () => {
    const current = useSettingsStore.getState()
    const obj = {
      appName: appNameRef.current.trim() || current.appName,
      logo: logo.trim() || current.logo,
    }
    const saved = useSettingsStore.getState().save(obj, { noCloudPush: true })
    setAppName(saved.appName)
    appNameRef.current = saved.appName
    setLogo(saved.logo)
    if (window.generalSettings && typeof window.generalSettings.pushToCloud === 'function') {
      setSaving(true)
      window.generalSettings
        .pushToCloud()
        .then(ok => {
          showToast(ok ? '☁️ وتزامنت مع السحابة ✓' : '⚠️ سجّل الدخول لرفع الإعدادات للسحابة', ok ? 'success' : 'warning')
        })
        .catch(err => {
          showToast('⚠️ حُفظت محلياً فقط — تعذر رفع السحابة: ' + (err && err.message ? err.message : String(err)), 'error')
        })
        .finally(() => setSaving(false))
    }
  }

  const pickColor = (c, opts = {}) => {
    setPrimaryColor(c)
    useSettingsStore.getState().setPrimary(c)
    // اللون تفضيل شخصي — يُحفظ فوراً على الجهاز بلا سحابة.
    useSettingsStore.getState().save({ primaryColor: c }, { noCloudPush: true })
    if (!opts.silent) showToast('✓ تم تغيير اللون الأساسي على جهازك', 'info', 1500)
  }

  const changeTheme = value => {
    const meta = THEME_META[value] || THEME_META.dark
    setPrimaryColor(meta.accent)
    useSettingsStore.getState().setPrimary(meta.accent)
    showToast(`✓ تم التبديل إلى ثيم ${meta.label}`, 'success')
    // V3.62 — debounce: التبديل السريع بين الثيمات يُطبَّق فوراً لكن الحفظ
    // (المحلي الشخصي فقط) يحدث مرة واحدة بعد هدوء النقرات.
    clearTimeout(themeDebounceRef.current)
    themeDebounceRef.current = setTimeout(() => {
      savePersonal({ theme: value, primaryColor: meta.accent }, { silent: true })
    }, 300)
  }

  const reset = () => {
    if (!window.confirm('هل أنت متأكد من استعادة الإعدادات الافتراضية؟ سيتم التراجع عن جميع التعديلات الحالية.')) return
    const saved = useSettingsStore.getState().save(DEFAULT_SETTINGS)
    setAppName(saved.appName)
    appNameRef.current = saved.appName
    setLogo(saved.logo)
    setPrimaryColor(saved.primaryColor)
    setTheme(saved.theme)
    showToast('تم استعادة الإعدادات الافتراضية', 'success')
  }

  const toggleCompactNumbers = () => {
    const next = !useSettingsStore.getState().compactNumbers
    // وضع الاختصار تفضيل شخصي — يُحفظ محلياً بلا سحابة.
    useSettingsStore.getState().save({ compactNumbers: next }, { noCloudPush: true })
    showToast(next ? '✓ وضع الاختصار مفعّل — الأرقام تظهر مثل 1.4K وتُكتمل عند الوقوف بالماوس' : '✓ وضع الاختصار متوقف — الأرقام كاملة دائماً', 'success')
  }

  const onLogoFile = async e => {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    const dataUrl = await readLogoFile(f)
    if (dataUrl) setLogo(dataUrl)
    e.target.value = ''
  }

  return (
    <div className="settings-view space-y-6 animate-fadeIn v7-view">
      <div className="settings-hero">
        <div className="settings-hero-icon"><SettingsIcon className="w-5 h-5" /></div>
        <div className="min-w-0">
          <div className="settings-eyebrow">تخصيص النظام</div>
          <h1 className="settings-title">إعدادات النظام</h1>
          <p className="settings-subtitle">خصص الهوية البصرية والمظهر العام ليظهر النظام بالشكل المناسب لك.</p>
        </div>
      </div>

      <div className="settings-panel">
        <h2 className="sr-only">إعدادات النظام العامة</h2>
        <div className="settings-section-head">
          <div className="settings-section-icon"><Palette className="w-5 h-5" /></div>
          <div>
            <h3>الهوية والمظهر</h3>
            <p>
              {isAdmin
                ? 'اسم النظام والشعار يظهران لكل الموظفين ويتزامنان مع السحابة — أما المظهر واللون فتفضيلات شخصية على جهازك.'
                : 'الهوية (الاسم والشعار) يتحكم فيها المدير وتظهر كما هي على كل الأجهزة — أما المظهر واللون فتفضيلاتك الشخصية على هذا الجهاز.'}
            </p>
          </div>
        </div>

        <div className="settings-grid">
          <div className="settings-field settings-field-wide">
            <Input label="اسم النظام / التطبيق" value={appName} onChange={value => { appNameRef.current = value; setAppName(value) }} placeholder="علاء الدين" disabled={!isAdmin} />
            {!isAdmin && (
              <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-slate-400" /> التعديل متاح للمدير فقط</p>
            )}
          </div>

          <div className="settings-field settings-field-wide">
            <label className="settings-label">الشعار</label>
            <div className="settings-logo-row">
              <div className="settings-logo-preview">
                <img src={logo || '2.png'} alt="logo" />
              </div>
              <div className="settings-logo-controls">
                <input
                  type="text"
                  value={logo}
                  onChange={e => setLogo(e.target.value)}
                  placeholder="رابط صورة (URL) أو اختر ملفاً…"
                  className="settings-text-input"
                  disabled={!isAdmin}
                />
                {isAdmin && (
                  <label className="settings-upload-btn">
                    رفع صورة
                    <input type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
                  </label>
                )}
              </div>
            </div>
            {!isAdmin && (
              <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-slate-400" /> الشعار يتحكم فيه المدير ويظهر لكل الموظفين</p>
            )}
          </div>

          <div className="settings-field settings-field-wide">
            <div className="settings-label-row">
              <label className="settings-label">اللون الأساسي</label>
              <span className="settings-color-value">{primaryColor}</span>
            </div>
            <p className="settings-personal-hint">شخصي على جهازك — لا يتغير عند زملائك.</p>
            <div className="settings-color-row">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  data-color={c}
                  onClick={() => pickColor(c)}
                  title={c}
                  style={{ background: c, boxShadow: c.toLowerCase() === primaryColor.toLowerCase() ? '0 0 0 3px var(--ui-surface-1), 0 0 0 5px var(--brand-500)' : 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}
                  className="settings-color-swatch"
                />
              ))}
              <label className="settings-custom-color">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={e => pickColor(e.target.value, { silent: true })}
                  title="لون مخصص"
                />
                <span>مخصص</span>
              </label>
            </div>
          </div>

          <div className="settings-field settings-field-wide">
            <div className="settings-label-row">
              <label className="settings-label">مظهر النظام</label>
              <span className="settings-color-value">{THEME_META[theme]?.label || 'داكن'}</span>
            </div>
            <p className="settings-personal-hint">شخصي على جهازك — لا يؤثر على مظهر زملائك.</p>
            <label className="sr-only">
              مظهر النظام
              <select
                value={theme}
                onChange={e => changeTheme(e.target.value)}
                aria-label="مظهر النظام"
                tabIndex={-1}
              >
                {THEME_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="theme-grid">
              {THEME_OPTIONS.map(option => {
                const meta = THEME_META[option.value] || THEME_META.dark
                const selected = theme === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => changeTheme(option.value)}
                    className={`theme-card ${selected ? 'is-selected' : ''}`}
                    aria-pressed={selected}
                  >
                    <span className="theme-preview" style={{ '--theme-accent': meta.accent }}>
                      <span className="theme-preview-top" />
                      <span className="theme-preview-body"><i /><i /><i /></span>
                    </span>
                    <span className="theme-card-copy">
                      <strong>{option.label.replace(/^\S+\s/, '')}</strong>
                      {selected && <span className="theme-selected-dot" style={{ background: meta.accent }} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="settings-field settings-field-wide">
            <div className="settings-label-row">
              <label className="settings-label inline-flex items-center gap-1.5"><Minimize2 className="w-4 h-4 text-slate-400" /> وضع الاختصار للأرقام (K/M)</label>
              <span className="settings-color-value">{compactNumbers ? 'مضغوط' : 'رقم كامل'}</span>
            </div>
            <p className="settings-personal-hint">شخصي على جهازك — لا يؤثر على طريقة عرض زملائك.</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={compactNumbers}
                onClick={toggleCompactNumbers}
                className="inline-flex items-center gap-2 cursor-pointer select-none"
              >
                <span
                  className={`inline-flex w-11 h-6 rounded-full transition-colors ${compactNumbers ? 'bg-emerald-500' : 'bg-slate-700'}`}
                >
                  <span
                    className={`inline-block w-5 h-5 rounded-full bg-white shadow transition-transform ${compactNumbers ? 'translate-x-5' : ''}`}
                  />
                </span>
              </button>
              <span className="text-xs text-slate-400">{compactNumbers ? 'مفعل — الداشبورد والتقارير تعرض 1.4K بدلاً من 4,101,227' : 'متوقف — تظهر الأرقام كاملة'}</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
              عند التفعيل: الأرقام الإنجليزية المختصرة (K / M) في الداشبورد والتقارير، والقيمة
              الكاملة تظهر عند الوقوف بالماوس على الرقم. عند التعطيل: الرقم الكامل دائماً.
            </p>
          </div>
        </div>

        <div className="settings-actions">
          {isAdmin ? (
            <>
              <Button variant="primary" onClick={saveIdentity} loading={saving} disabled={saving}>
                {saving ? 'جارٍ المزامنة مع السحابة...' : 'حفظ اسم النظام والشعار'}
              </Button>
              <Button variant="secondary" onClick={reset}>
                استعادة الافتراضي
              </Button>
            </>
          ) : (
            <p className="settings-actions-note text-xs text-slate-400">
              تُحفظ تغييراتك الشخصية (المظهر واللون والاختصار) تلقائياً على هذا الجهاز.
            </p>
          )}
        </div>
      </div>
    </div>
  )}

export default SettingsView
