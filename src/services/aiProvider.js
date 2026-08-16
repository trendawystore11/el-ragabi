// =============================================================================
// services/aiProvider.js — إعدادات مزوّد الذكاء الاصطناعي (Gemini / OpenAI)
// -----------------------------------------------------------------------------
// يخزن إعدادات مزوّد الـ AI (provider + apiKey + model) في localStorage بنفس
// نمط Firebase (bms_ai_config). read/write نقيان وقابلان للاختبار في jsdom.
// عند ضبط مفتاح صالح يُستدعى المزوّد عبر fetch لتوليد إجابات متقدمة؛ وأي فشل
// (شبكة / مفاتيح خاطئة / نموذج غير متاح) يعيد null فينتقل المتصل سلساً إلى
// محرك التحليل الداخلي المدمج (services/aiAssistant.js) — بلا أي انقطاع.
//
// مصدر المفتاح: إعدادات الواجهة (localStorage) أولاً، فإن لم يُضبط مفتاح بعد
// يُحاول import.meta.env.VITE_GEMINI_API_KEY (متاح عند البناء/النشر) كاحتياط
// — يعين نموذج gemini تلقائياً عندئذٍ.
//
// V3.35 — التعبئة الذكية للنماذج (Smart Form Fill): أي functionCall من المزوّد
// يُمرَّر عبر prepareFormFill (تطبيع + فحوص وقائية فقط) ولا يُنفَّذ إطلاقاً.
// عند النجاح يُفتح النموذج معبأً للمراجعة والحفظ بواسطة المستخدم، وعند نقص
// البيانات تُطلب من المستخدم مباشرة — بلا بوابة تأكيد ولا مسودات معلقة ولا
// تنفيذ فعلي من داخل هذا الملف إطلاقاً.
// =============================================================================
import { storageKey } from '../client/storage.js'
import { AI_CONFIG as CLIENT_AI, DEFAULT_CONFIG as CLIENT_DEFAULT } from '../client/config.js'
import { getCairoDate, currencySuffix } from '../utils/formatters.js'

import {
  AI_TOOLS,
  prepareFormFill,
  buildFormFillMessage,
  buildBlockedMessage,
  normalizeActionArgs,
} from './aiAssistant.js'

const AI_KEY = storageKey('ai_config')

// V3.50 — القيم الابتدائية تُقرأ من CLIENT_AI أو كاحتياط من CLIENT_DEFAULT (src/client/config.js)
/**
 * V3.62 — Finding H: مستويات تقنين البيانات الشخصية في سياق المزوّد الخارجي.
 * - full:        كل البيانات كما هي (السلوك الافتراضي الحالي).
 * - noSensitive: الاسم والتصنيف يبقيان، مع حجب الملاحظات وأرصدة العملاء ومبالغ مشترياتهم.
 * - minimal:     أسماء العملاء/الموردين وبيانات اتصالهم وأرصدتهم تُستبدل بعميل/مورد مرقّم.
 */
export const REDACT_LEVELS = ['full', 'noSensitive', 'minimal']

/** تطبيع مستوى التقنين إلى قيمة صالحة (غير معروف → full = لا تغيير عن الحالي). */
function normalizeRedactLevel(level) {
  const v = String(level || '').trim()
  return REDACT_LEVELS.includes(v) ? v : 'full'
}

const DEFAULT_CONFIG = {
  provider: CLIENT_AI.provider || (CLIENT_DEFAULT && CLIENT_DEFAULT.aiProvider) || 'gemini',
  apiKey:   CLIENT_AI.apiKey   || (CLIENT_DEFAULT && CLIENT_DEFAULT.geminiApiKey) || '',
  model:    CLIENT_AI.model    || (CLIENT_DEFAULT && CLIENT_DEFAULT.aiModel)    || '',
  redactLevel: normalizeRedactLevel((CLIENT_AI && CLIENT_AI.redactLevel) || (CLIENT_DEFAULT && CLIENT_DEFAULT.aiRedactLevel)),
}

/**
 * النموذج الافتراضي لمزوّد Gemini: يُضبط تلقائياً عندما يكون حقل اسم النموذج
 * فارغاً أو يحوي نص «Google Gemini» (اسم المزوّد بدل اسم نموذج) — يمنع إرسال
 * اسم نموذج باطل للمزوّد.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'

/** تطبيع اسم النموذج: فارغ أو «Google Gemini» → النموذج الافتراضي لـ Gemini. */
function normalizeModel(model) {
  const m = String(model || '').trim()
  if (!m || m === 'Google Gemini') return DEFAULT_GEMINI_MODEL
  return m
}

/** تطبيع كامل الإعدادات: تنظيف المفتاح من الفراغات الزائدة + تطبيع النموذج + مستوى التقنين. */
function normalizeAiConfig(cfg) {
  const provider = cfg.provider === 'openai' ? 'openai' : 'gemini'
  const apiKey = String(cfg.apiKey || '').trim()
  const model = provider === 'openai' ? String(cfg.model || '').trim() : normalizeModel(cfg.model)
  return { provider, apiKey, model, redactLevel: normalizeRedactLevel(cfg.redactLevel) }
}

/** تطبيق احتياط مفتاح البيئة VITE_GEMINI_API_KEY عند غياب إعدادات محفوظة. */
function applyEnvFallback(cfg) {
  if (cfg.apiKey) return cfg
  const envKey = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY
    ? String(import.meta.env.VITE_GEMINI_API_KEY).trim()
    : ''
  if (envKey) {
    return { ...cfg, provider: 'gemini', apiKey: envKey, model: cfg.model || DEFAULT_GEMINI_MODEL }
  }
  return cfg
}

/** قراءة إعدادات الـ AI المدمجة مع الافتراضيات (لا يرمي أبداً). */
export function getAiConfig() {
  const base = { ...DEFAULT_CONFIG }
  if (typeof window === 'undefined') return applyEnvFallback(base)
  try {
    const saved = JSON.parse(window.localStorage.getItem(AI_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      base.provider = saved.provider === 'openai' ? 'openai' : 'gemini'
      base.apiKey = String(saved.apiKey || '').trim()
      base.model = String(saved.model || '').trim()
      base.redactLevel = normalizeRedactLevel(saved.redactLevel)
    }
  } catch {
    /* ignore corrupted saved config */
  }
  return normalizeAiConfig(applyEnvFallback(base))
}

/** حفظ إعدادات الـ AI (تنظيف النصوص الفارغة + تطبيع النموذج الافتراضي) وإرجاع الكائن المحفوظ. */
export function saveAiConfig(config = {}) {
  const cleaned = normalizeAiConfig(config)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(AI_KEY, JSON.stringify(cleaned))
  }
  return cleaned
}

/** مسح إعدادات الـ AI المحفوظة. */
export function clearAiConfig() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(AI_KEY)
  }
}

/** هل يوجد مفتاح ونموذج جاهزان لاستدعاء المزوّد الخارجي؟ */
export function hasAiProvider(config = getAiConfig()) {
  return Boolean(config && config.apiKey && config.model)
}

/** أقسام الشات (V3.38) — مفتاح القسم → تسميته العربية. */
export function scopeLabel(scope = 'general') {
  const labels = {
    general: 'عام / الشامل',
    products: 'المنتجات',
    suppliers: 'الموردين',
    customers: 'العملاء',
    orders: 'إنشاء الطلبات والفواتير',
  }
  return labels[scope] || labels.general
}

/** سطر توجيهي يُحقن في سياق المزوّد عند اختيار قسم محدد (تلميح أولوية لا قفل). */
function buildScopeLine(scope) {
  if (!scope || scope === 'general') return ''
  return (
    '\n\nالقسم الحالي المحدد في الواجهة: «' + scopeLabel(scope) + '» — ركّز ردودك واستدعاءات الأدوات على هذا القسم: ' +
    (scope === 'products'
      ? 'افتح نموذج إضافة/تعديل منتج (addProduct/updateProduct) عند طلب بيانات منتج، وأجب عن النواقص والأكثر مبيعاً. إن تحدث المستخدم عن شيء خارج المنتجات فعد لقسم عام.'
      : scope === 'suppliers'
        ? 'افتح نموذج إضافة مورد (addSupplier) عند طلب بيانات مورد/مصنع، وأجب عن قائمة الموردين وديونهم. إن تحدث المستخدم عن شيء آخر فعد لقسم عام.'
        : scope === 'customers'
          ? 'افتح نموذج إضافة عميل (addCustomer) عند طلب بيانات عميل، وأجب عن العملاء والمشتريات. إن تحدث المستخدم عن شيء آخر فعد لقسم عام.'
          : 'افتح نموذج طلب بيع جديد (createOrder) مباشرةً عند أي طلب فاتورة/طلب بيع، أو عند ذكر اسم عميل مع منتجات أو كمية أو عنوان أو طريقة دفع — فكل هذه البيانات تخص الطلب وليس نموذجاً منفصلاً. أكمل بيانات العميل (الاسم، الهاتف، العنوان) والبنود (المنتجات والكميات) داخل بيانات الطلب نفسها، ولا تعرض نموذج إضافة عميل مفرداً عند إنشاء طلب. اسأل فقط عن الناقص: اسم العميل، رقم الهاتف (11 رقماً يبدأ بـ 01)، العنوان، وبند واحد على الأقل (اسم منتج + كمية) — ولا تفرض قيماً افتراضية ولا تستدعِ الأداة قبل اكتمالها. إن تحدث المستخدم عن شيء آخر فعد لقسم عام.')
  )
}

function toNum(v) {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/** تنسيق رقمي بسيط (بدون فواصل) مع تقريب لعددين. */
function num2(v) {
  return String(Math.round(toNum(v) * 100) / 100)
}

/**
 * V3.46 — PII Protection (Finding H5): Mask phone numbers for background AI context payloads.
 * Example: '01012345678' -> '010****5678', '01123456789' -> '011****6789'
 */
export function redactPhoneNumber(phone) {
  if (!phone) return ''
  const str = String(phone).trim()
  if (str.length <= 4) return str
  if (str.length >= 10) {
    const prefix = str.slice(0, 3)
    const suffix = str.slice(-4)
    return `${prefix}****${suffix}`
  }
  const prefix = str.slice(0, 2)
  const suffix = str.slice(-2)
  return `${prefix}****${suffix}`
}

/**
 * V3.46 — PII Protection (Finding H5): Sanitize specific building & apartment numbers in addresses.
 * Example: '12 شارع النصر شقة 4' -> '** شارع النصر شقة **'
 */
export function redactAddress(address) {
  if (!address) return ''
  const str = String(address).trim()
  if (!str) return ''
  return str.replace(/\b\d+\b/g, '**')
}

/** سطر مفصل لكل منتج: الاسم/الكود/المخزون/الأسعار/المورد/الملاحظات. */
function productLines(products = [], level = 'full') {
  const minimal = level === 'minimal'
  const noNotes = level !== 'full'
  return products.map(p => {
    const parts = [`- ${String(p.name || '').trim() || 'منتج بلا اسم'}`]
    if (p.code) parts.push(`كود ${p.code}`)
    parts.push(`مخزون ${num2(p.stock)} / حد أدنى ${num2(p.minStock)}`)
    parts.push(`شراء ${num2(p.purchasePrice)}${currencySuffix()}`)
    parts.push(`بيع ${num2(p.sellingPrice)}${currencySuffix()}`)
    // V3.34 — يذكر صراحةً غياب المورد كي لا يستنتجه النموذج من أسماء المحادثة.
    if (minimal) {
      if (p.supplierName) parts.push('مورد مسجل')
    } else {
      parts.push(p.supplierName ? `مورد ${p.supplierName}` : 'بلا مورد مسجل')
    }
    if (p.notes && !noNotes) parts.push(`ملاحظات: ${p.notes}`)
    return parts.join(' — ')
  })
}

/** سطر مفصل لكل عميل: الاسم/الهواتف/التصنيف/العنوان/المشتريات/الرصيد. */
function customerLines(customers = [], level = 'full') {
  return customers.map((c, i) => {
    const minimal = level === 'minimal'
    const noSensitive = level !== 'full'
    // V3.62 — Finding H: في «minimal» يُستبدل الاسم بعميل مرقّم.
    const parts = [minimal ? `- عميل ${i + 1}` : `- ${String(c.name || '').trim() || 'عميل بلا اسم'}`]
    if (c.phone && !minimal) parts.push(`هاتف ${redactPhoneNumber(c.phone)}`)
    if (c.secondaryPhone && !minimal) parts.push(`ثانوي ${redactPhoneNumber(c.secondaryPhone)}`)
    if (c.category) parts.push(`تصنيف ${c.category}`)
    if (c.address && !minimal) parts.push(`عنوان ${redactAddress(c.address)}`)
    // V3.62 — إخفاء الأرصدة والمشتريات في noSensitive/minimal.
    if (!noSensitive) {
      parts.push(`إجمالي مشتريات ${num2(c.totalPurchases)}${currencySuffix()}`)
      parts.push(`رصيد متبقي ${num2(c.balance)}${currencySuffix()}`)
    }
    if (c.notes && !noSensitive) parts.push(`ملاحظات: ${c.notes}`)
    return parts.join(' — ')
  })
}

/** سطر مفصل لكل مصروف: البند/الفئة/المبلغ/التاريخ/الملاحظات. */
function expenseLines(expenses = [], level = 'full') {
  const noNotes = level !== 'full'
  return expenses.map(e => {
    const parts = [`- ${String(e.title || e.name || '').trim() || 'مصروف بلا بيان'} (${String(e.category || 'عام').trim()})`]
    parts.push(`${num2(e.amount)}${currencySuffix()}`)
    if (e.date) parts.push(`تاريخ ${String(e.date).slice(0, 10)}`)
    if (e.recurring) parts.push('شهري متكرر')
    if (e.notes && !noNotes) parts.push(`ملاحظات: ${e.notes}`)
    return parts.join(' — ')
  })
}

/** سطر مفصل لكل مورد: الاسم/الهواتف/العنوان/الملاحظات. */
function supplierLines(suppliers = [], level = 'full') {
  return suppliers.map((s, i) => {
    const minimal = level === 'minimal'
    const noNotes = level !== 'full'
    // V3.62 — Finding H: في «minimal» يُستبدل الاسم بمورد مرقّم.
    const parts = [minimal ? `- مورد ${i + 1}` : `- ${String(s.name || '').trim() || 'مورد بلا اسم'}`]
    if (s.phone && !minimal) parts.push(`هاتف ${redactPhoneNumber(s.phone)}`)
    if (s.secondaryPhone && !minimal) parts.push(`ثانوي ${redactPhoneNumber(s.secondaryPhone)}`)
    if (s.address && !minimal) parts.push(`عنوان: ${redactAddress(s.address)}`)
    if (s.notes && !noNotes) parts.push(`ملاحظات: ${s.notes}`)
    return parts.join(' — ')
  })
}


/** سطر مفصل لكل طلب: رقم/تاريخ/عميل/حالة/إجمالي/مدفوع + بنوده كاملة. */
function orderLines(orders = [], level = 'full') {
  const minimal = level === 'minimal'
  return orders.map(o => {
    const head = [`- طلب ${o.id || ''}`, `تاريخ ${String(o.createdAt || '').slice(0, 10)}`]
    // V3.62 — اسم العميل داخل الطلب يُحجب في «minimal» (الاسم الشخصي).
    if (o.customerName && !minimal) head.push(`عميل ${o.customerName}`)
    if (o.status) head.push(`حالة ${o.status}`)
    head.push(`إجمالي ${num2(o.totalAmount)}${currencySuffix()}`)
    head.push(`مدفوع ${num2(o.downPayment)}${currencySuffix()}`)
    const items = (o.items || []).map(it =>
      `«${it.productName || it.productId || 'منتج'}» × ${num2(it.quantity)} بسعر ${num2(it.sellingPrice)} = ${num2(it.subtotal)}${currencySuffix()}`
    )
    return items.length ? `${head.join(' — ')} — بنوده: ${items.join('؛ ')}` : head.join(' — ')
  })
}

/**
 * نبذة السياق الكاملة (عربية) تُرسل مع السؤال للمزوّد الخارجي.
 * V3.28 — لا نكتفي بالتلخيص الإجمالي؛ نبعث القوائم الكاملة (المنتجات، العملاء،
 * المصروفات، الطلبات مع بنودها) بنفس التفاصيل المسجلة، مع تعليمات تحثّ المزوّد
 * على إجابات تفصيلية تذكر أسماء البنود والمبالغ عند السؤال عن التفاصيل.
 * V3.35 — التعليمات الخاصة بالتعبئة الذكية: لا تنفيذ إطلاقاً، تقسيم الحقول
 * (اسم/عنوان/هواتف/ملاحظات) بوضوح، وطلب توضيح مباشر عند الغموض.
 */
export function buildContextForPrompt({ products = [], customers = [], orders = [], expenses = [], suppliers = [] } = {}, opts = {}) {
  // V3.62 — Finding H: مستوى التقنين من إعدادات الـ AI (الافتراضي full = السلوك الحالي)،
  // مع إمكانية تمريره صراحةً في opts.redactLevel للاختبارات.
  const redactLevel = normalizeRedactLevel(opts && opts.redactLevel !== undefined ? opts.redactLevel : getAiConfig().redactLevel)
  const today = getCairoDate()
  const todayOrders = orders.filter(o => String(o.createdAt || '').slice(0, 10) === today)
  const todaySales = todayOrders.reduce((s, o) => s + toNum(o.totalAmount), 0)
  const todayExpenses = expenses
    .filter(e => String(e.date || e.createdAt || '').slice(0, 10) === today)
    .reduce((s, e) => s + toNum(e.amount), 0)
  const lowStock = products.filter(p => toNum(p.stock) <= toNum(p.minStock))

  return [
    `متجر قماش/منسوجات (نظام إدارة متكامل). تاريخ اليوم: ${today}.`,
    `الإجمالي: ${products.length} منتج — ${customers.length} عميل — ${orders.length} طلب — ${expenses.length} مصروف — ${suppliers.length} مورد.`,
    `طلبات اليوم: ${todayOrders.length} بقيمة ${todaySales}${currencySuffix()} — مصروفات اليوم: ${todayExpenses}${currencySuffix()} عبر ${todayExpenses.length} بند.`,
    `المنتجات الناقصة حالياً: ${lowStock.map(p => `${p.name} (مخزون ${toNum(p.stock)} / حد أدنى ${toNum(p.minStock)})`).join('، ') || 'لا شيء'}.`,
    '',
    `قائمة المنتجات كاملة (${products.length}):`,
    ...productLines(products, redactLevel),
    '',
    `قائمة العملاء كاملة (${customers.length}):`,
    ...customerLines(customers, redactLevel),
    '',
    `قائمة الموردين كاملة (${suppliers.length}):`,
    ...supplierLines(suppliers, redactLevel),
    '',
    `قائمة المصروفات كاملة (${expenses.length}):`,
    ...expenseLines(expenses, redactLevel),
    '',
    `قائمة الطلبات كاملة (${orders.length}):`,
    ...orderLines(orders, redactLevel),
    '',
    'تعليمات الإجابة:',
    '1) اعتمد على القوائم الكاملة أعلاه لا على الإجمالي وحده، واستخدم الأسماء والمبالغ الفعلية كما هي.',
    '2) عند السؤال بصيغة «عبارة عن إيه» أو «التفاصيل» أو «قائمة/لائحة/اذكر/اعرض» — اجعل الرد تفصيلياً وشاملاً: اذكر كل بند باسمه وقيمته واحداً واحداً (مثال المصروفات: «مصروف 1: إيجار - 300' + currencySuffix() + '، مصروف 2: كهرباء - 200' + currencySuffix() + '») بدلاً من رد عام أو إجمالي فقط.',
    '3) عند ذكر بنود الطلبات اذكر أسماء المنتجات والكميات والأسعار والإجماليات بوضوح.',
    '4) في الأسئلة السريعة (مبيعات/أرباح اليوم) اجمع بين الرقم الإجمالي وأهم البنود التفصيلية.',
    '5) أجب بالعربية المصرية المختصرة وبأرقام واضحة.',
    '6) لا تختلق بيانات أبداً — اعتمد فقط على القوائم أعلاه وعلى ما كتبه المستخدم في هذه المحادثة (بما فيها رسائله السابقة). إذا نقصت معلومة فاطلبها من المستخدم ولا تفترضها ولا تكملها من خيالك.',
    '7) الحقول الإلزامية/الاختيارية لكل أداة محددة في تعريفها (required). إذا سألك المستخدم «هل هذا الحقل إلزامي؟» فأجب بنعم/لا بدقة حسب تعريف الأداة ولا تصف حقلاً إلزامياً بأنه اختياري أو العكس.',
    '8) عند طلب المستخدم إضافة بيانات (إنشاء طلب، إضافة منتج/عميل/مصروف/مورد) استدعِ الأداة نفسها عبر functionCall بالبيانات المتاحة فوراً — ولا تنفّذ أنت أي شيء إطلاقاً ولا تطلب تأكيداً في نص عادي قبل استدعاء الأداة؛ النظام يفتح النموذج معبأً بالبيانات (initialData) ليراجعها المستخدم ويحفظها بنفسه من داخل النموذج. لا تستدعِ الأداة إلا بعد اكتمال البيانات الأساسية المحددة في تعريفها (required) — وإن نقصت بيانات أساسية فاطلبها من المستخدم بوضوح ولا تستدعِ الأداة ولا تفرض قيماً افتراضية.',
    '9) تقسيم الحقول عند الاستخراج: الاسم منفصل تماماً عن العنوان (لا تدمجهما في حقل واحد)، والهواتف أرقام نظيفة (11 رقماً تبدأ بـ 01)، والملاحظات/التفاصيل في حقلها الخاص. إذا كان الاسم أو رقم الهاتف غامضاً أو مدمجاً بما لا يمكن فصله بوضوح فاسأل المستخدم سؤالاً مباشراً لتوضيحه بدلاً من التخمين.',
    '10) إذا سألك المستخدم عن بيانات غير مسجلة في القوائم أعلاه (مثل مورد لمنتج مذكور في سطره أنه بلا مورد مسجل، أو عميل غير موجود، أو رصيد لم يُسجل) فقل بوضوح إنها غير مسجلة في النظام — ولا تستنتجها أو تخترعها من أسماء وردت في المحادثة.',
    '11) تتبّع موضوع المحادثة: عند سؤال مختصر مثل «رقمه ايه؟» أو «مين ده؟» أو «بتاع المورد/العميل» — راجع آخر تبادل في المحادثة وأجب عن نفس الكيان الذي كان الحديث عنه (المورد/العميل/المنتج) ولا تقفز إلى كيان آخر له بيانات أخرى.',
    '12) عند سؤال «هل اتسجّل/هل اتضاف/هل اتنفّذ الطلب؟» — تحقّق فعلياً من القوائم أعلاه: هل الطلب/البيانات المذكورة موجودة باسمه؟ إن لم تكن موجودة قل بوضوح إنها لم تُسجَّل بعد، ولا تعرض طلباً أو سجلاً آخر من القائمة كأنه هو المقصود. تذكّر أن تجهيز نموذج معبأ لا يسجّل أي شيء في النظام.',
    '13) عند تأكيد المستخدم (نعم/اكد/تمام) أو طلب تعديل (عدّل/غير) بعد تجهيز نموذج معبأ — لا حاجة لتأكيد إضافي ولا يحدث تنفيذ منك؛ راجع المحادثة: إن طلبتَ من المستخدم بيانات لاستكمال النموذج فاطلب فقط ما ينقص؛ وإن لم تُستدعَ أداة فقل ذلك بوضوح ولا تخترع نتائج.',
    '14) إذا تأكدتَ في هذه المحادثة من نجاح تجهيز نموذج معبأ (ورد في رسالتك السابقة «تم تجهيز البيانات للمراجعة») ثم سُئلت عنه — أجِب بما جهّزته وذكّر المستخدم بالضغط على حفظ في النموذج المفتوح، ولا تدَّعِ أبداً أن القائمة فارغة لمجرد أنه لم يظهر في سطور القوائم.',
    '15) عند طلب تعديل منتج مسجل (عدّل/غيّر/حدّث السعر أو المخزون أو المورد أو سعر الشراء) استدعِ أداة updateProduct بالاسم الرسمي للمنتج من قائمة المنتجات أعلاه مع البيانات الجديدة فقط. لا تُدَّعِ أبداً في الشات أن التعديل تم — النظام يفتح نافذة تعديل المنتج معبأةً بالبيانات (initialData) ليراجعها المستخدم ويحفظها بنفسه. إن لم يحدّد المستخدم المنتج أو القيمة الجديدة بوضوح فاطلبها منه ولا تستدعِ الأداة ولا تخترع قيماً.',
    '16) دليل الإلزامية لكل نموذج — التزم به حرفياً عند أي سؤال عن حقل إلزامي أو اختياري ولا تخمّن أبداً:',
    '   - createOrder (إنشاء طلب): إلزامي: اسم العميل، رقم الهاتف (11 رقماً يبدأ بـ 01)، عنوان العميل، وبند واحد على الأقل (اسم منتج + كمية). اختياري: سعر بيع كل بند، مصاريف الشحن، النثريات، طريقة الدفع (full/advance/credit)، مبلغ العربون، نوع العربون.',
    '   - addProduct (إضافة منتج): إلزامي: الاسم، سعر البيع، اسم المورد المصنع (من قائمة الموردين أعلاه). اختياري: المخزون، سعر الشراء، الحد الأدنى، الكود.',
    '   - updateProduct (تعديل منتج): إلزامي: الاسم الرسمي. اختياري: السعر، سعر الشراء، المخزون، الحد الأدنى، المورد.',
    '   - addExpense (تسجيل مصروف): إلزامي: البيان، المبلغ. اختياري: الفئة.',
    '   - addSupplier (إضافة مورد): إلزامي: الاسم. اختياري: الهاتف، هاتف ثانوي، العنوان، الملاحظات.',
    '   - addCustomer (إضافة عميل): إلزامي: الاسم، رقم الهاتف (11 رقماً يبدأ بـ 01). اختياري: العنوان.',
    '   عند طلب إنشاء طلب لا تعرض نموذج إضافة عميل منفصلاً — بيانات العميل جزء من بيانات الطلب.',
    '17) دليل النظام الكامل — إذا سألك المستخدم عن شاشة أو زر أو ميزة أو مصطلح في النظام (مثل «عامل إيه/بتعمل إيه/إزاي أستخدم/يعني إيه/في إيه هنا/شرح») فاشرح بوضوح من هذا الدليل بخطوات بسيطة موجزة، ولا تخترع ميزات غير موجودة إطلاقاً:',
    '   - الشاشات (من القائمة الجانبية): «لوحة التحكم» (ملخص اليوم: مبيعات ومصروفات اليوم، النواقص، الأعلى شراءً، الأكثر مبيعاً) — «سجل الطلبات» (كل فواتير البيع وحالاتها: new/completed، وفتح تفاصيل كل طلب وبنوده) — «العملاء» (السجل والمشتريات والرصيد) — «المنتجات» (المخزون وأسعار الشراء/البيع والحد الأدنى والمورد لكل منتج) — «الموردون» (الموردين وهواتفهم وعناوينهم وملاحظاتهم) — «المصروفات» (مصروفات اليوم وكل المصروفات بفئاتها) — «إدارة المدفوعات» (المدفوعات والمرتجعات والكشوف) — «التقارير» — «المستخدمون» (حسابات الموظفين وأدوارهم: مدير/موظف مبيعات/أمين مخزن) — «الإعدادات» (المظهر، مفتاح ونموذج الذكاء الاصطناعي، المزامنة).',
    '   - الأزرار السريعة أعلى الشاشة: «طلب جديد / فاتورة بيع» (نموذج إنشاء الطلب) — «وضع الكاشير» (بيع فوري سريع من كتالوج المنتجات) — «مساعد AI» (هذه النافذة) — «مزامنة Google Sheets» (تصدير/استيراد/بالاتجاهين للبيانات) — «وضع الاختبار» (تجربة النظام ببيانات تجريبية دون مساس بالبيانات الحقيقية).',
    '   - النماذج التي تجهّزها الأدوات (createOrder/addCustomer/addProduct/updateProduct/addSupplier/addExpense): تُفتح معبأةً بالبيانات التي ذكرها المستخدم ليراجعها ويحفظها بنفسه بضغط زر الحفظ من داخل النموذج — لا تُسجَّل أي بيانات تلقائياً أبداً.',
    '   - بيانات الطلب: العميل، الهاتف، العنوان، طريقة الدفع (نقدي full / عربون advance / آجل credit)، مبلغ ونوع العربون، مصاريف الشحن، النثريات، بنود المنتجات بكمياتها وأسعارها، والإجمالي.',
    '   - التخزين: البيانات تُحفظ محلياً في متصفح المستخدم مع مزامنة اختيارية مع Google Sheets (تصدير/استيراد/بالاتجاهين) من الإعدادات.',
    '   - إذا سأل المستخدم عن ميزة غير موجودة في الدليل أعلاه فاعترف ببساطة أنها غير موجودة في النظام واقترح بديلاً مما هو موجود، ولا تختلق شيئاً.',
  ].join('\n')
}

/** عدد مرات معالجة functionCall المسموحة ضمن جولة إجابة واحدة (حماية من الحلقات). */
const MAX_FUNCTION_TURNS = 6

/**
 * تطبيع سجل المحادثة السابقة لصيغة Gemini (user/model) — يدمج المتتاليات
 * المتكررة ويقصّ الجولات المفتوحة بصيغة model (Gemini يشترط بدءاً بـ user).
 */
function buildGeminiHistory(history = []) {
  const turns = []
  for (const m of Array.isArray(history) ? history : []) {
    const role = m && m.role === 'assistant' ? 'model' : 'user'
    const text = m && typeof m.text === 'string' ? m.text.trim() : ''
    if (!text) continue
    const prev = turns[turns.length - 1]
    if (prev && prev.role === role) prev.parts.push({ text })
    else turns.push({ role, parts: [{ text }] })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return turns
}

/** تطبيع سجل المحادثة السابقة لصيغة OpenAI (user/assistant). */
function buildOpenAIHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .map(m => {
      const role = m && m.role === 'assistant' ? 'assistant' : 'user'
      const content = m && typeof m.text === 'string' ? m.text.trim() : ''
      return content ? { role, content } : null
    })
    .filter(Boolean)
}

/** رسالة موجهة للمزوّد بعد استقبال functionCall (يُطلب منه عرضها حرفياً). */
function buildToolResponsePrompt(prepared, msg) {
  return prepared.ok
    ? `اعرض على المستخدم الرسالة التالية حرفياً (النموذج معبأ وتم فتحه للمراجعة — لا تطلب تأكيداً إضافياً):\n${msg}`
    : `اطلب من المستخدم استكمال البيانات التالية لاستكمال تجهيز النموذج (لا تنفّذ شيئاً ولا تخترع بيانات):\n${msg}`
}

/**
 * استدعاء Gemini (generateContent) — يعيد نص الإجابة أو null عند أي فشل.
 * V3.29 — مع Function Calling: تُرسل تعريفات الأدوات (AI_TOOLS) ويسمح للمزوّد
 * بطلب تجهيز نماذج (createOrder/addProduct/addExpense/addSupplier/addCustomer).
 * V3.35 — التعبئة الذكية: أي functionCall يُمرَّر عبر prepareFormFill (تطبيع +
 * فحوص وقائية فقط) ولا يُنفَّذ إطلاقاً؛ عند النجاح يُفتح النموذج معبأً للمراجعة
 * والحفظ بواسطة المستخدم، وعند نقص البيانات تُطلب من المستخدم مباشرة. لا
 * بوابة تأكيد، لا مسودات معلقة، ولا تنفيذ فعلي من هنا.
 * V3.34 — ذاكرة المحادثة: تُرسل الرسائل السابقة (history) مع السؤال كي لا ينسى
 * المزوّد بيانات سبق أن ذكرها المستخدم.
 */
async function askGemini(apiKey, model, question, context, tools = AI_TOOLS, history = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const q = String(question || '').trim()

  // سجل المحادثة السابق قبل السؤال الحالي — ذاكرة لا ينساها النموذج.
  const historyContents = buildGeminiHistory(history)
  const userText = `${context}\n\nسؤال المستخدم: ${q}`
  const contents = [...historyContents]
  const last = contents[contents.length - 1]
  if (last && last.role === 'user') last.parts.push({ text: userText })
  else contents.push({ role: 'user', parts: [{ text: userText }] })
  const payload = {
    contents,
    ...(tools && tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
  }

  // تتبّع الاقتراحات المتكررة من المزوّد (نفس functionCall بلا نص) لعرقلة الحلقة.
  let lastMessage = null
  let lastKey = null
  let repeatCount = 0
  const seen = new Set()

  for (let turn = 0; turn <= MAX_FUNCTION_TURNS; turn += 1) {
    const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const data = await res.json()
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts
      : []
    const calls = parts.filter(p => p && p.functionCall && p.functionCall.name)
    if (!calls.length) {
      const text = parts.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('\n').trim()
      return text || lastMessage || null
    }

    const handled = calls.map(call => {
      const name = call.functionCall.name
      // تطبيع المعاملات (فصل الاسم/العنوان + تنظيف الأرقام) قبل تجهيز النموذج.
      const args = normalizeActionArgs(name, call.functionCall.args || {})
      const prepared = prepareFormFill(name, args)
      return { functionCall: call.functionCall, prepared }
    })

    contents.push({
      role: 'model',
      parts: handled.map(t => ({ functionCall: t.functionCall })),
    })
    contents.push({
      role: 'user',
      parts: handled.map(t => ({
        functionResponse: {
          name: t.functionCall.name,
          response: t.prepared,
        },
      })),
    })
    payload.contents = contents.slice()

    // رسالة تُعرض للمستخدم: نجاح → «تم تجهيز البيانات للمراجعة...» مع فتح النافذة،
    // فشل → طلب استكمال البيانات. والتكرار المتطابق يُسلّم الرسالة دون حلقة.
    const first = handled[0]
    if (first) {
      const msg = first.prepared.ok
        ? buildFormFillMessage(first.prepared)
        : buildBlockedMessage(first.prepared)
      const key = `${first.functionCall.name}::${JSON.stringify(first.prepared.data || {})}`
      if (key === lastKey) {
        repeatCount += 1
      } else {
        lastKey = key
        repeatCount = 1
      }
      lastMessage = msg
      if (!seen.has(key)) {
        seen.add(key)
        contents.push({ role: 'user', parts: [{ text: buildToolResponsePrompt(first.prepared, msg) }] })
        payload.contents = contents.slice()
      } else if (repeatCount >= 2) {
        break
      }
    }
  }
  // إن لم يردّ المزوّد بنص رغم توجيهاتنا، نسلّم للمستخدم ما جهّزناه بدلاً من null.
  if (lastMessage) return lastMessage
  return null
}

/** استدعاء OpenAI (chat/completions) — يعيد نص الإجابة أو null عند أي فشل. */
async function askOpenAI(apiKey, model, question, context, history = []) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: context },
        ...buildOpenAIHistory(history),
        { role: 'user', content: question },
      ],
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

/** رسالة عربية توضح سبب فشل الاتصال حسب رمز حالة HTTP. */
function httpErrorMessage(provider, status) {
  const label = provider === 'openai' ? 'OpenAI' : 'Google Gemini'
  if (status === 400) return 'المفتاح أو النموذج غير صالح — راجعهما في إعدادات ' + label
  if (status === 401 || status === 403) return 'المفتاح مرفوض أو بلا صلاحية (' + status + ') — تأكد من صحته في إعدادات ' + label
  if (status === 404) return 'النموذج غير متاح في ' + label + ' — تحقق من اسم النموذج (Model)'
  if (status === 429) return 'تم تجاوز حد الاستخدام (' + status + ') — حاول لاحقاً أو راجع رصيد المزوّد'
  return 'فشل الاتصال بـ ' + label + ' (رمز ' + status + ') — تحقق من المفتاح والنموذج أو اتصالك بالإنترنت'
}

/**
 * اختبار اتصال حقيقي بالمزوّد الخارجي (Gemini/OpenAI) بالمفتاح والنموذج
 * المحفوظين. يعيد { ok: true, message } عند النجاح أو { ok: false, message }
 * مع رسالة عربية واضحة عن سبب الفشل (مفتاح غير صالح / نموذج غير متاح / شبكة).
 * للـ Gemini يُستدعى نفس مسار generateContent مع النموذج الفعلي ليتحقق من
 * صلاحية المفتاح والنموذج معاً.
 */
export async function testAiProviderConnection(rawConfig = getAiConfig()) {
  // V3.28 — نُطبِّع دائماً قبل الاستخدام: تنظيف المفتاح من الفراغات الزائدة
  // وتطبيع النموذج (فارغ/«Google Gemini» → gemini-3.1-flash-lite) حتى لو نقر
  // المستخدم «اختبار الاتصال» دون حفظ الإعدادات أولاً.
  const config = normalizeAiConfig(rawConfig)
  if (!config.apiKey) {
    return { ok: false, message: 'أضف مفتاح API أولاً ثم اختبر الاتصال' }
  }
  if (!config.model) {
    return { ok: false, message: 'أضف اسم النموذج (Model) أولاً ثم اختبر الاتصال' }
  }
  if (typeof fetch !== 'function') {
    return { ok: false, message: 'بيئة التصفح لا تدعم الاتصال الخارجي' }
  }
  try {
    if (config.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })
      if (res.ok) return { ok: true, message: 'الاتصال بـ OpenAI ناجح والمفتاح صالح ✓' }
      return { ok: false, message: httpErrorMessage('openai', res.status) }
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`
    const res = await fetch(`${url}?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'مرحباً' }] }] }),
    })
    if (res.ok) return { ok: true, message: 'الاتصال بـ Google Gemini ناجح والمفتاح والنموذج صالحان ✓' }
    return { ok: false, message: httpErrorMessage('gemini', res.status) }
  } catch {
    return { ok: false, message: 'تعذر الوصول إلى المزوّد — تحقق من اتصالك بالإنترنت' }
  }
}

/**
 * توليد إجابة متقدمة من المزوّد الخارجي عند توفر مفتاح صالح.
 * يعيد نص الإجابة العربية أو null (لا يرمي أبداً) — المتصل يستخدم
 * المحرك الداخلي كبديل سلس.
 * V3.29 — خيارات إضافية: { tools, history } لتفعيل Function Calling لدى Gemini.
 * V3.35 — لا يوجد خيار execute بعد الآن: الأدوات لا تُنفَّذ أبداً، بل تُجهَّز
 * نماذج معبأة للمراجعة.
 */
export async function askAiProvider(config = getAiConfig(), question = '', context = '', options = {}) {
  if (!hasAiProvider(config) || !question.trim() || typeof fetch !== 'function') return null
  const { tools = AI_TOOLS, history = [], scope } = options || {}
  // V3.37 — حقن القسم المختار في سياق المزوّد (تلميح أولوية لفتح النموذج الصحيح).
  const scopeLine = buildScopeLine(scope)
  const fullContext = scopeLine ? `${context}${scopeLine}` : context
  try {
    if (config.provider === 'openai') {
      return await askOpenAI(config.apiKey, config.model, question.trim(), fullContext, history)
    }
    return await askGemini(config.apiKey, config.model, question.trim(), fullContext, tools, history)
  } catch {
    return null
  }
}
