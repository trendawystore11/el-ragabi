// =============================================================================
// ui/charts/themeColors.js — ألوان الرسوم البيانية (V4)
// -----------------------------------------------------------------------------
// يربط ألوان Recharts بمتغيرات CSS الخاصة بالثيم بدلاً من Hex ثابتة:
//   - المبيعات/الإيراد ← لون الهوية الأساسي (--brand-500 وما حوله).
//   - الربح ← emerald-500 (أخضر مريح للأرقام الإيجابية).
//   - الديون/الالتزامات ← amber-500 (تحذيري).
//   - الرسم الدائري ← تدرج مونوكروماتيك من نفس عائلة الهوية.
//   - شبكة الرسم ← خط خافت (slate-700) مع شرطات شفافة.
// القيم المقروءة تُأخذ من computed style في وقت الرسم، فتتبع تغيير اللون
// الأساسي والثيم فوراً دون إعادة بناء.
// =============================================================================

/** خط شبكة الرسم البياني — خافت جداً ليصمت عن الخلفية (فاصلة شفافية). */
export const CHART_GRID_DASH = '3 3'

/** الربح — أخضر مريح (Tailwind emerald-500). */
export const PROFIT_COLOR = '#10b981'

/** الديون/الالتزامات — تحذيري (Tailwind amber-500). */
export const DEBT_COLOR = '#f59e0b'

const FALLBACKS = {
  '--brand-100': '#e0effe',
  '--brand-300': '#7dd3fc',
  '--brand-400': '#38bdf8',
  '--brand-500': '#0284c7',
  '--brand-600': '#0369a1',
  '--brand-700': '#075985',
  '--t-text-400': '#7d8797',
  '--t-900': '#10151d',
  '--ui-border': '#1b2331',
  '--t-text-100': '#e5e9f0',
  '--ui-text': '#e5e9f0',
}

/** اقرأ متغير CSS من computed style (مع fallback آمن خارج المتصفح/قبل الهيدرة). */
export function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback !== undefined ? fallback : (FALLBACKS[name] || '')
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || (fallback !== undefined ? fallback : (FALLBACKS[name] || ''))
  } catch {
    return fallback !== undefined ? fallback : (FALLBACKS[name] || '')
  }
}

function hexToRgba(hex, alpha) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const n = parseInt(h, 16)
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${alpha})`
}

/** لون الهوية الأساسي الصريح (المستخدم فعلاً كمفتاح التخصيص). */
export function brandAccent() {
  return cssVar('--brand-500')
}

/** شبكة الرسم — نفس قاعدة التصميم v7-chart-grid: نص الثيم بشفافية 9%. */
export function chartGridColor() {
  return hexToRgba(cssVar('--ui-text'), 0.09) || 'rgba(51, 65, 85, 0.25)'
}

/** درجات أحادية العائلة للرسم الدائري — فاتح → غامق. */
export function brandPiePalette() {
  return ['--brand-100', '--brand-300', '--brand-400', '--brand-500', '--brand-600', '--brand-700']
    .map(name => cssVar(name))
}

/** لون محاور/تسميات الرسم — نص ثانوي خافت من الثيم. */
export function chartAxisColor() {
  return cssVar('--t-text-400')
}

/** خلفية/حدود نافذة التلميح — ألوان أسطح الثيم نفسها. */
export function tooltipSurface() {
  return {
    bg: cssVar('--t-900'),
    border: cssVar('--ui-border'),
    text: cssVar('--t-text-100'),
    dim: cssVar('--t-text-400'),
  }
}
