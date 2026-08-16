// =============================================================================
// services/aiAssistant.js — مساعد التحليلات السريع (AI Assistant)
// -----------------------------------------------------------------------------
// دوال تحليل نقية 100% (بدون DOM/لا شبكة) تُبني فوق نفس مصادر بيانات النظام
// (window.getProducts/getCustomers/getOrders/getExpenses عبر الجسر): اقتراح
// إعادة طلب النواقص، أكثر العملاء شراءً، أكثر المنتجات مبيعاً، وصف منتج تلقائي،
// وملخص يومي سريع، ومحرك إجابات الشات (answerQuestion) الذي يفسّر السؤال
// بالعربية ويبني الإجابة من بيانات النظام — يُستخدم كبديل داخلي سلس عند غياب
// مفتاح API الخارجي. تُستخدم من نافذة المساعد السريع ويمكن إعادة استخدامها
// في أي واجهة مستقبلاً.
//
// V3.35 — التعبئة الذكية للنماذج (Smart Form Fill): لم يعد المساعد ينفّذ أي
// تغيير في النظام إطلاقاً. عند طلب إضافة بيانات (مورد/عميل/منتج/مصروف/طلب)
// يستخرج المساعد البيانات ويجهّز نموذجاً معبأً (initialData) يفتحه النظام
// للمراجعة — والمستخدم وحده يضغط الحفظ. لا تُستدعى أي من دوال الجسر
// (createProduct/createCustomer/createSupplier/createExpense/createOrder)
// من داخل هذا الملف إطلاقاً؛ ولا تبقى أي مسودة معلّقة للتأكيد أو التعديل.
// =============================================================================
import { formatCurrency, getCairoDate, currencySuffix } from '../utils/formatters.js'

function toNum(v) {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/** المنتجات الناقصة (المخزون ≤ الحد الأدنى) مع كمية مقترحة لإعادة الطلب. */
export function getLowStockProducts(products = []) {
  return products
    .filter(p => toNum(p.stock) <= toNum(p.minStock))
    .map(p => ({
      ...p,
      suggestedReorderQty: Math.max(1, toNum(p.minStock) * 2 - toNum(p.stock)),
    }))
    .sort((a, b) => toNum(a.stock) - toNum(b.stock))
}

/** أكثر العملاء شراءً حسب إجمالي المشتريات. */
export function getTopCustomers(customers = [], limit = 5) {
  return [...customers]
    .sort((a, b) => toNum(b.totalPurchases) - toNum(a.totalPurchases))
    .slice(0, limit)
}

/** أكثر المنتجات مبيعاً حسب الكمية المباعة في الطلبات. */
export function getTopProducts(orders = [], limit = 5) {
  const counts = {}
  orders.forEach(o => {
    ;(o.items || []).forEach(it => {
      const key = it.productName || it.productId || 'غير معروف'
      counts[key] = counts[key] || { name: key, quantity: 0, revenue: 0 }
      counts[key].quantity += toNum(it.quantity)
      counts[key].revenue += toNum(it.subtotal)
    })
  })
  return Object.values(counts)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit)
}

/** وصف عربي تلقائي للمنتج من بياناته المتاحة. */
export function generateProductDescription(product = {}) {
  const name = (product.name || '').trim() || 'المنتج'
  const parts = [name]
  const notes = (product.notes || '').trim()
  if (notes) parts.push(notes)
  if (product.supplierName) parts.push(`من توريد ${product.supplierName}`)
  if (product.code) parts.push(`كود المنتج: ${product.code}`)
  const stock = toNum(product.stock)
  const min = toNum(product.minStock)
  if (stock <= min) parts.push('المخزون منخفض — يُنصح بسرعة توفيره')
  parts.push(`سعر البيع ${toNum(product.sellingPrice)}${currencySuffix()}`)
  return parts.join(' — ')
}

/** ملخص يومي سريع لمبيعات اليوم + النواقص + أفضل العملاء/المنتجات. */
export function buildAiSummary({ products = [], customers = [], orders = [], expenses = [] } = {}) {
  const today = getCairoDate()
  const todayOrders = orders.filter(o => String(o.createdAt || '').slice(0, 10) === today)
  const todaySales = todayOrders.reduce((sum, o) => sum + toNum(o.totalAmount), 0)
  const todayExpenses = expenses.filter(e => String(e.date || e.createdAt || '').slice(0, 10) === today)
  const todayExpensesTotal = todayExpenses.reduce((sum, e) => sum + toNum(e.amount), 0)

  return {
    today,
    todayOrdersCount: todayOrders.length,
    todaySales,
    todayExpenses: todayExpensesTotal,
    lowStock: getLowStockProducts(products),
    topCustomers: getTopCustomers(customers, 3),
    topProducts: getTopProducts(orders, 3),
  }
}

// =============================================================================
// محرك إجابات الشات (Context-Aware Q&A) — نقي 100% ولا يحتاج شبكة.
// =============================================================================

/** تطبيع عربي: إزالة التشكيل + توحيد الهمزات/الياء/التاء المربوطة. */
export function normalizeArabic(text) {
  return String(text || '')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
}

/** إجمالي الأرباح الفعلية (هامش البنود) لطلبات اليوم إن توفرت التكاليف. */
function computeTodayProfit(orders, products, today) {
  const costById = {}
  const costByName = {}
  products.forEach(p => {
    if (p.id) costById[String(p.id)] = toNum(p.purchasePrice)
    if (p.name) costByName[String(p.name)] = toNum(p.purchasePrice)
  })
  let gross = 0
  let matched = 0
  orders
    .filter(o => String(o.createdAt || '').slice(0, 10) === today)
    .forEach(o => {
      ;(o.items || []).forEach(it => {
        const qty = toNum(it.quantity)
        const subtotal = toNum(it.subtotal)
        const cost = costById[String(it.productId)] != null
          ? costById[String(it.productId)]
          : costByName[String(it.productName)] != null
            ? costByName[String(it.productName)]
            : null
        if (cost != null) {
          gross += subtotal - cost * qty
          matched += 1
        }
      })
    })
  return { gross, matched }
}

function topCustomerAnswer(customers) {
  const top = getTopCustomers(customers, 3)
  if (top.length === 0) return 'لا يوجد عملاء مسجلون بعد — أضف عميلاً أولاً. 📋'
  const lines = top.map((c, i) => `#${i + 1} ${c.name} — إجمالي المشتريات ${formatCurrency(c.totalPurchases)}`).join('\n')
  return `أكثر العملاء شراءً:\n${lines}`
}

function topProductsAnswer(orders) {
  const top = getTopProducts(orders, 3)
  if (top.length === 0) return 'لا توجد مبيعات مسجلة بعد. 🛒'
  const lines = top.map((p, i) => `#${i + 1} ${p.name} — ${p.quantity} قطعة (${formatCurrency(p.revenue)})`).join('\n')
  return `أكثر المنتجات مبيعاً:\n${lines}`
}

function lowStockAnswer(products) {
  const low = getLowStockProducts(products)
  if (low.length === 0) return 'لا توجد منتجات ناقصة حالياً — المخزون بحالة جيدة. ✅'
  const lines = low.slice(0, 3)
    .map(p => `• ${p.name}: المخزون ${toNum(p.stock)} / الحد الأدنى ${toNum(p.minStock)} — يُقترح إضافة ${p.suggestedReorderQty}`)
    .join('\n')
  return `منتجات تحتاج إعادة طلب (${low.length}):\n${lines}`
}

function todaySalesAnswer(orders) {
  const today = getCairoDate()
  const todayOrders = orders.filter(o => String(o.createdAt || '').slice(0, 10) === today)
  const total = todayOrders.reduce((s, o) => s + toNum(o.totalAmount), 0)
  if (todayOrders.length === 0) return 'لا توجد مبيعات مسجلة اليوم. 📊'
  const lines = todayOrders.map(o => {
    const items = (o.items || [])
      .map(it => `${it.productName || it.productId || 'منتج'} × ${toNum(it.quantity)}`)
      .join('، ')
    return `• طلب ${o.id || ''}: ${o.customerName || 'عميل معرض'} — ${formatCurrency(o.totalAmount)}${items ? ` (${items})` : ''}`
  }).join('\n')
  return `مبيعات اليوم: ${formatCurrency(total)} عبر ${todayOrders.length} ${todayOrders.length === 1 ? 'طلب' : 'طلبات'}:\n${lines}`
}

function todayExpensesAnswer(expenses) {
  const today = getCairoDate()
  const todayList = expenses.filter(e => String(e.date || e.createdAt || '').slice(0, 10) === today)
  const total = todayList.reduce((s, e) => s + toNum(e.amount), 0)
  if (todayList.length === 0) return 'لا توجد مصروفات مسجلة اليوم. 💸'
  const lines = todayList
    .map(e => `• ${e.title || e.name || 'مصروف'}: ${formatCurrency(e.amount)} (${e.category || 'عام'})`)
    .join('\n')
  return `مصروفات اليوم: ${formatCurrency(total)} عبر ${todayList.length} ${todayList.length === 1 ? 'بند' : 'بنود'}:\n${lines}`
}

// =============================================================================
// إجابات تفصيلية (عبارة عن إيه / التفاصيل / القوائم الكاملة) — V3.28
// بدلاً من التلخيص الإجمالي نعرض كل البنود بأسمائها ومبالغها واحداً واحداً.
// =============================================================================

function expensesDetailAnswer(expenses = []) {
  if (expenses.length === 0) return 'لا توجد مصروفات مسجلة بعد. 📋'
  const lines = expenses
    .map((e, i) => {
      const parts = [`مصروف ${i + 1}: ${e.title || e.name || 'مصروف بلا بيان'} — ${formatCurrency(e.amount)}`]
      if (e.category) parts.push(`فئة: ${e.category}`)
      if (e.date) parts.push(`تاريخ ${String(e.date).slice(0, 10)}`)
      if (e.notes) parts.push(`ملاحظات: ${e.notes}`)
      return parts.join('، ')
    })
    .join('\n')
  const total = expenses.reduce((s, e) => s + toNum(e.amount), 0)
  return `كل المصروفات المسجلة (${expenses.length}) بإجمالي ${formatCurrency(total)}:\n${lines}`
}

function ordersDetailAnswer(orders = []) {
  if (orders.length === 0) return 'لا توجد طلبات مسجلة بعد. 🧾'
  const lines = orders
    .map(o => {
      const head = [`- طلب ${o.id || ''} (${String(o.createdAt || '').slice(0, 10)})`]
      if (o.customerName) head.push(`عميل ${o.customerName}`)
      if (o.status) head.push(`حالة ${o.status}`)
      head.push(`إجمالي ${formatCurrency(o.totalAmount)}`)
      head.push(`مدفوع ${formatCurrency(o.downPayment)}`)
      const items = (o.items || []).map(it =>
        `«${it.productName || it.productId || 'منتج'}» × ${toNum(it.quantity)} = ${formatCurrency(it.subtotal)}`
      )
      return `${head.join(' — ')}${items.length ? ' — البنود: ' + items.join('؛ ') : ''}`
    })
    .join('\n')
  return `تفاصيل كل الطلبات (${orders.length}):\n${lines}`
}

function productsDetailAnswer(products = []) {
  if (products.length === 0) return 'لا توجد منتجات مسجلة بعد. 📦'
  const lines = products
    .map(p => {
      const parts = [`- ${p.name || 'منتج بلا اسم'}${p.code ? ` (كود ${p.code})` : ''}`]
      parts.push(`مخزون ${toNum(p.stock)} / حد أدنى ${toNum(p.minStock)}`)
      parts.push(`شراء ${formatCurrency(p.purchasePrice)}`)
      parts.push(`بيع ${formatCurrency(p.sellingPrice)}`)
      if (p.supplierName) parts.push(`مورد ${p.supplierName}`)
      return parts.join(' — ')
    })
    .join('\n')
  return `تفاصيل كل المنتجات (${products.length}):\n${lines}`
}

function customersDetailAnswer(customers = []) {
  if (customers.length === 0) return 'لا توجد عملاء مسجلون بعد. 👥'
  const lines = customers
    .map(c => {
      const parts = [`- ${c.name || 'عميل بلا اسم'}${c.phone ? ` (هاتف ${c.phone})` : ''}`]
      if (c.category) parts.push(`تصنيف ${c.category}`)
      parts.push(`إجمالي مشتريات ${formatCurrency(c.totalPurchases)}`)
      if (c.balance) parts.push(`رصيد ${formatCurrency(c.balance)}`)
      if (c.address) parts.push(`عنوان: ${c.address}`)
      return parts.join(' — ')
    })
    .join('\n')
  return `تفاصيل كل العملاء (${customers.length}):\n${lines}`
}

function profitAnswer(orders, products, expenses) {
  const today = getCairoDate()
  const { gross, matched } = computeTodayProfit(orders, products, today)
  if (matched > 0) {
    return `أرباح اليوم (هامش البنود): ${formatCurrency(gross)} محسوبة من أسعار الشراء المسجلة. 💰`
  }
  const todaySales = orders
    .filter(o => String(o.createdAt || '').slice(0, 10) === today)
    .reduce((s, o) => s + toNum(o.totalAmount), 0)
  const todayExpenses = expenses
    .filter(e => String(e.date || e.createdAt || '').slice(0, 10) === today)
    .reduce((s, e) => s + toNum(e.amount), 0)
  return `صافي اليوم التقديري: ${formatCurrency(todaySales - todayExpenses)} (مبيعات ${formatCurrency(todaySales)} − مصروفات ${formatCurrency(todayExpenses)}). ⚖️`
}

function overviewAnswer({ products = [], customers = [], orders = [], expenses = [] } = {}) {
  const summary = buildAiSummary({ products, customers, orders, expenses })
  const lines = [
    `📊 ملخص سريع:`,
    `• مبيعات اليوم: ${formatCurrency(summary.todaySales)} (${summary.todayOrdersCount} طلب)`,
    `• مصروفات اليوم: ${formatCurrency(summary.todayExpenses)}`,
    `• النواقص: ${summary.lowStock.length ? `${summary.lowStock.length} منتج` : 'لا يوجد'}`,
    `• العملاء: ${customers.length} — المنتجات: ${products.length}`,
  ]
  if (summary.topCustomers[0]) lines.push(`• الأعلى شراءً: ${summary.topCustomers[0].name}`)
  if (summary.topProducts[0]) lines.push(`• الأكثر مبيعاً: ${summary.topProducts[0].name}`)
  lines.push(`\nيمكنك السؤال عن: النواقص، الأعلى شراءً، مبيعات/أرباح اليوم، المصروفات، أو وصف منتج.`)
  return lines.join('\n')
}

const HELP_TEXT = `أسئلة يمكنني الإجابة عنها: 🤖\n• «ما هي المنتجات الناقصة؟»\n• «من هو العميل الأعلى شراءً؟»\n• «ما هي مبيعات / أرباح اليوم؟»\n• «كم طلب اليوم؟» أو «عدد العملاء؟»\n• «اكتب وصفاً لاسم المنتج»\n• «عبارة عن إيه المصروفات؟» أو «تفاصيل الطلبات / قائمة المنتجات» لإجابات تفصيلية كاملة`

// V3.39 — دليل النظام السريع: يفسّر شاشات النظام وميزاته عند سؤال «إزاي/بتعمل إيه/
// يعني إيه/شرح» — بديل داخلي كامل لا يحتاج مفتاح API (المزوّد الخارجي يحصل على
// نسخة أوسع في buildContextForPrompt).
const SYSTEM_GUIDE_TEXT = `دليل النظام سريع: 🤖
• الشاشات (من القائمة الجانبية): لوحة التحكم (ملخص اليوم: مبيعات/مصروفات/نواقص/الأعلى شراءً)، سجل الطلبات (فواتير البيع وحالاتها وتفاصيلها)، العملاء، المنتجات (المخزون/الأسعار/الحد الأدنى)، الموردون، المصروفات، إدارة المدفوعات، التقارير، المستخدمون (أدوار: مدير/موظف مبيعات/أمين مخزن)، الإعدادات (المظهر + مفتاح الذكاء الاصطناعي + المزامنة).
• أزرار سريعة أعلى الشاشة: «طلب جديد / فاتورة بيع»، «وضع الكاشير» (بيع فوري)، «مساعد AI» (هذه النافذة)، «مزامنة Google Sheets» (تصدير/استيراد/بالاتجاهين)، «وضع الاختبار» (بيانات تجريبية بلا مساس بالبيانات الحقيقية).
• النماذج: إنشاء طلب/عميل/منتج/مورد/مصروف وتعديل منتج — تفتح معبأةً بالبيانات لتراجعها وتحفظها بنفسك؛ لا يُسجَّل شيء تلقائياً أبداً.
• التخزين: البيانات محفوظة محلياً في متصفحك مع مزامنة اختيارية مع Google Sheets.
يمكنك أيضاً أن تسألني عن: النواقص، الأعلى شراءً، مبيعات/أرباح اليوم، تفاصيل أي قائمة، أو وصف منتج. 📝`

function descriptionAnswer(question, products) {
  const norm = normalizeArabic(question)
  const product = products.find(p => {
    const name = normalizeArabic(p.name)
    return name && norm.includes(name) && name.length >= 2
  })
  if (!product) return 'أي منتج تقصد؟ اذكر اسم المنتج كاملاً مع كلمة «وصف». 📝'
  return `وصف «${product.name}»:\n${generateProductDescription(product)}`
}

/**
 * محرك الإجابات السياقي: يفسّر السؤال بالعربية ويبني إجابة من بيانات النظام.
 * نقي 100% — يعمل دون شبكة ويُستخدم كبديل داخلي عند غياب مفتاح API.
 * V3.35: إن كان السؤال طلب إضافة بيانات يُجهّز نموذجاً معبأً للمراجعة —
 * لا يُنفَّذ أي تغيير في النظام.
 * V3.37: معلمة scope (عام/منتجات/موردين/عملاء/تقارير) تلميح أولوية يفكك
 * الغموض عند طلب إضافة دون ذكر النوع — الصريح يسبقه دائماً، والقسم لا يقفل.
 * V3.38: قسم «إنشاء طلب» (orders) يوجّه أي بيانات فاتورة لنموذج الطلب مباشرةً.
 */
export function answerQuestion(question = '', data = {}, scope = 'general') {
  const q = normalizeArabic(question)
  const { products = [], customers = [], orders = [], expenses = [], suppliers = [] } = data

  const has = (...words) => words.some(w => q.includes(w))

  // جسر فحوص من بيانات اللحظة الحية — هكذا تعمل التعبئة الذكية دون الاعتماد على window.
  const liveBridge = {
    getProducts: () => products,
    getCustomers: () => customers,
    getSuppliers: () => suppliers,
    getOrders: () => orders,
    getExpenses: () => expenses,
  }

  // تحيات
  if (has('مرحبا', 'اهلا', 'أهلا', 'السلام عليكم', 'هاي', 'hello', 'مساء', 'صباح')) {
    return 'مرحباً بك! أنا مساعد متجرك الذكي 🤖 — اسألني عن المبيعات، النواقص، العملاء أو أي شيء في بياناتك.'
  }
  if (has('مساعدة', 'تساعدني', 'اسألك', 'قادر')) return HELP_TEXT

  // V3.35 — التعبئة الذكية: طلب إضافة (مورد/عميل/منتج/مصروف/طلب) → نموذج معبأ.
  if (/^(اضف|اضيف|سجل|اعمل|اسجل|ضيف|انشا|ادخل|عايز|عاوز|ممكن|اريد|نفسي|اطلب|احجز)\s/.test(q)) {
    const intent = detectFormFillIntent(question, data, scope)
    if (intent) {
      const prepared = prepareFormFill(intent.name, intent.args, liveBridge)
      if (prepared.ok) return buildFormFillMessage(prepared)
      return buildBlockedMessage(prepared)
    }
  }

  // V3.36 — طلب تعديل منتج مسجل → نموذج تعديل معبأ؛ لا تنفيذ ولا ادعاء إتمام.
  if (/(عدل|تعديل|غيره|غير|حدث|حدد)/.test(q)) {
    const intent = detectEditIntent(question, data)
    if (intent) {
      const prepared = prepareFormFill(intent.name, intent.args, liveBridge)
      if (prepared.ok) return buildFormFillMessage(prepared)
      return buildBlockedMessage(prepared)
    }
  }

  // النواقص (قبل المنتجات/المبيعات عموماً)
  if (has('ناقص', 'النواقص', 'مخزون', 'اعاده طلب', 'اعادة طلب', 'منخفض', 'نفد', 'طلب مخزون')) {
    return lowStockAnswer(products)
  }

  // العميل الأعلى شراءً
  if (has('اعلي عميل', 'الاعلي عميل', 'اكثر عميل', 'افضل عميل', 'الاعلي شراء', 'الاكثر شراء', 'اكبر عميل', 'اول عميل', 'العميل الاوحد')) {
    return topCustomerAnswer(customers)
  }

  // أكثر المنتجات مبيعاً
  if (has('الاكثر مبيعا', 'الاكثر مبيع', 'اكثر منتج', 'افضل منتج', 'المنتجات الاكثر', 'اعلي منتج')) {
    return topProductsAnswer(orders)
  }

  // V3.28 — الأسئلة التفصيلية: «عبارة عن إيه / التفاصيل / بالتفصيل» تجيب بقائمة
  // كاملة بأسماء البنود ومبالغها بدلاً من رد عام؛ وإن وُجدت فئة مذكورة تُفصَّل وحدها.
  if (has('عباره عن ايه', 'التفاصيل', 'تفاصيل', 'بالتفصيل')) {
    if (has('مصروف', 'مصاريف', 'مصروفات')) return expensesDetailAnswer(expenses)
    if (has('طلب', 'طلبات', 'فاتوره', 'فواتير')) return ordersDetailAnswer(orders)
    if (has('منتج', 'منتجات')) return productsDetailAnswer(products)
    if (has('عميل', 'عملاء')) return customersDetailAnswer(customers)
    return [
      expensesDetailAnswer(expenses),
      ordersDetailAnswer(orders),
      productsDetailAnswer(products),
      customersDetailAnswer(customers),
    ].join('\n\n')
  }

  // طلبات صريحة بعرض قائمة/لائحة كاملة (قائمة/لائحة/اذكر/اعرض/عرض).
  if (has('قائمة', 'لائحه', 'اذكر', 'اعرض', 'عرض')) {
    if (has('مصروف', 'مصاريف', 'مصروفات')) return expensesDetailAnswer(expenses)
    if (has('طلب', 'طلبات', 'فاتوره', 'فواتير')) return ordersDetailAnswer(orders)
    if (has('منتج', 'منتجات')) return productsDetailAnswer(products)
    if (has('عميل', 'عملاء')) return customersDetailAnswer(customers)
  }

  // أرباح اليوم
  if (has('ارباح اليوم', 'ربح اليوم', 'صافي اليوم', 'صافي الربح', 'الربحية', 'الربح')) {
    return profitAnswer(orders, products, expenses)
  }

  // مبيعات اليوم
  if (has('مبيعات اليوم', 'ايراد اليوم', 'ايرادات اليوم', 'دخل اليوم', 'بعنا اليوم', 'مبيعات')) {
    return todaySalesAnswer(orders)
  }

  // مصروفات اليوم
  if (has('مصروفات اليوم', 'مصاريف اليوم', 'مصروف', 'مصاريف')) {
    return todayExpensesAnswer(expenses)
  }

  // عدد طلبات اليوم
  if (has('طلبات اليوم', 'عدد الطلبات', 'كم طلب', 'عدد طلب')) {
    const today = getCairoDate()
    const count = orders.filter(o => String(o.createdAt || '').slice(0, 10) === today).length
    return `عدد طلبات اليوم: ${count}. 🧾`
  }

  // عدد العملاء
  if (has('عدد العملاء', 'كم عميل', 'العملاء الكلي', 'اجمالي العملاء')) {
    return `عدد العملاء المسجلين: ${customers.length}. 👥`
  }

  // عدد المنتجات
  if (has('عدد المنتجات', 'كم منتج', 'اجمالي المنتجات', 'المنتجات المسجله')) {
    return `عدد المنتجات المسجلة: ${products.length}. 📦`
  }

  // وصف منتج
  if (has('وصف', 'اكتب وصف', 'صغ وصف')) {
    return descriptionAnswer(q, products)
  }

  // V3.39 — سؤال شرح/دليل استخدام: يفسّر شاشات النظام وميزاته (أخيراً حتى لا
  // يزاحم أسئلة البيانات الصريحة مثل المبيعات/المصروفات/الطلبات).
  if (has('ازاي', 'ازاى', 'كيف', 'بتعمل', 'يعني', 'شرح', 'اشرح', 'استخدام', 'مميزات', 'ميزات', 'دليل', 'شاشات', 'عامل ايه', 'في النظام')) {
    return SYSTEM_GUIDE_TEXT
  }

  return overviewAnswer(data)
}

// =============================================================================
// التعبئة الذكية للنماذج (Smart Form Fill) — V3.35
// -----------------------------------------------------------------------------
// تُرسل تعريفات الأدوات (AI_TOOLS) مع طلب المزوّد الخارجي (Gemini) فيصدر المزوّد
// functionCall باسم أداة ومعاملاتها؛ لا ننفّذ الأداة إطلاقاً بل نجهّز منها نموذجاً
// معبأً (initialData) يُفتح للمراجعة والحفظ بواسطة المستخدم. نفس المسار يعمل
// داخلياً عبر detectFormFillIntent عند غياب مفتاح API. كل أداة تتضمن فحوصاً
// وقائية (تضارب هواتف/تكرار أسماء/توفر مخزون/منطقية مبالغ) لا تمنع شيئاً —
// بل تظهر كتنبيهات في النموذج المعدّ للرواجعة.
// =============================================================================

/** تعريفات الأدوات وفق مخطط JSON Schema لنموذج Gemini (functionDeclarations). */
export const AI_TOOLS = [
  {
    name: 'createOrder',
    description: 'تجهيز نموذج طلب بيع معبأ للمراجعة — لا يُنفَّذ أي تغيير في النظام. استدعِ الأداة بعد اكتمال البيانات الأساسية (اسم العميل، رقم الهاتف، العنوان، البنود مع الكميات)؛ وإن نقص أي منها فاطلب البيانات من المستخدم ولا تستدعِها ولا تفرض قيماً افتراضية. سيفتح النظام نموذج الطلب معبأً بالبيانات، ويقوم المستخدم بمراجعتها وحفظها بنفسه. بند الطلب إن لم يكن مسجلاً في النظام يحتاج سعر بيع صريحاً في البند',
    parameters: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'اسم العميل (إلزامي — لا تستخدم قيماً افتراضية)' },
        phone: { type: 'string', description: 'رقم هاتف العميل (إلزامي — 11 رقماً يبدأ بـ 01)' },
        address: { type: 'string', description: 'عنوان العميل/التوصيل (إلزامي)' },
        items: {
          type: 'array',
          description: 'بنود الطلب: اسم المنتج (كما مسجل في النظام) + الكمية + سعر بيع اختياري',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'اسم المنتج كما في النظام' },
              quantity: { type: 'number', description: 'الكمية (الافتراضي 1)' },
              price: { type: 'number', description: 'سعر بيع القطعة — اختياري إن كان المنتج مسجلاً' },
            },
            required: ['name'],
          },
        },
        shippingCost: { type: 'number', description: 'مصاريف الشحن بالمبلغ — تُضاف تلقائياً على إجمالي الطلب (الافتراضي 0)' },
        extraExpenses: { type: 'number', description: 'النثريات/المصاريف الإضافية بالمبلغ — تُضاف تلقائياً على إجمالي الطلب (الافتراضي 0)' },
        paymentType: {
          type: 'string',
          enum: ['full', 'advance', 'credit'],
          description: 'طريقة الدفع: full = دفع كامل، advance = عربون/دفعة مقدمة، credit = آجل',
        },
        advanceAmount: { type: 'number', description: 'مبلغ العربون/الدفعة المقدمة عند الدفع المسبق (advance). إذا قال المستخدم إن العربون يغطي الشحن والنثريات فاجعل قيمته مجموعهما وحدد depositType = shipping_extra' },
        downPayment: { type: 'number', description: 'الاسم القديم لمبلغ الدفعة المقدمة — استخدم advanceAmount بدلاً منه' },
        depositType: { type: 'string', enum: ['custom', 'shipping', 'shipping_extra'], description: 'نوع العربون: custom = عربون عادي، shipping = عربون بقيمة الشحن، shipping_extra = عربون الشحن + المصروفات' },
      },
      required: ['customerName', 'phone', 'address', 'items'],
    },
  },
  {
    name: 'addProduct',
    description: 'تجهيز نموذج منتج جديد معبأ للمراجعة — لا يُنفَّذ أي تغيير في النظام. المورد المصنع إلزامي. استدعِ الأداة بعد اكتمال الحقول name و price و supplierName (اختر المورد من قائمة الموردين أعلاه)، وسيفتح النظام النموذج معبأً بها ليراجعها المستخدم ويحفظها بنفسه. إن لم يذكر المستخدم المورد فاطلبه منه ولا تستدعِ الأداة بدونه',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم المنتج (إلزامي)' },
        price: { type: 'number', description: 'سعر البيع بالمبلغ (إلزامي — أكبر من صفر)' },
        stock: { type: 'number', description: 'الكمية المتاحة بالمخزون (الافتراضي 0)' },
        purchasePrice: { type: 'number', description: 'سعر الشراء بالمبلغ (اختياري — يُسجل إن ذكره المستخدم)' },
        minStock: { type: 'number', description: 'الحد الأدنى للمخزون (الافتراضي 5)' },
        code: { type: 'string', description: 'كود SKU (اختياري)' },
        supplierId: { type: 'string', description: 'معرّف المورد المصنع (اختياري إن عرفته من قائمة الموردين)' },
        supplierName: { type: 'string', description: 'اسم المورد المصنع (إلزامي — انسخه حرفياً من قائمة الموردين أعلاه)' },
      },
      required: ['name', 'price', 'supplierName'],
    },
  },
  {
    name: 'updateProduct',
    description: 'تجهيز نموذج تعديل منتج مسجل معبأً للمراجعة — لا يُنفَّذ أي تغيير في النظام ولا تُدَّعى إتماماً أبداً. حدّد المنتج بالاسم الرسمي من قائمة المنتجات أعلاه مع البيانات الجديدة فقط (سعر/كمية/مورد...)، وسيفتح النظام نافذة تعديل المنتج معبأةً بها ليراجعها المستخدم ويحفظها بنفسه. إن لم يحدّد المستخدم المنتج بوضوح فاطلبه منه ولا تستدعِ الأداة بدونه',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج المسجل إن عرفته (اختياري — الاسم كافٍ)' },
        name: { type: 'string', description: 'الاسم الرسمي للمنتج من قائمة المنتجات أعلاه (إلزامي)' },
        price: { type: 'number', description: 'سعر البيع الجديد بالمبلغ (أكبر من صفر)' },
        purchasePrice: { type: 'number', description: 'سعر الشراء الجديد بالمبلغ' },
        stock: { type: 'number', description: 'الكمية الجديدة بالمخزون' },
        minStock: { type: 'number', description: 'الحد الأدنى الجديد للمخزون' },
        supplierName: { type: 'string', description: 'اسم المورد المصنع الجديد (انسخه حرفياً من قائمة الموردين أعلاه)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'addExpense',
    description: 'تجهيز نموذج مصروف جديد معبأ للمراجعة — لا يُنفَّذ أي تغيير في النظام. استدعِ الأداة بعد اكتمال الحقلين الإلزاميين description و amount، وسيفتح النظام النموذج معبأً بها ليراجعها المستخدم ويحفظها بنفسه',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'بيان المصروف (إلزامي)' },
        amount: { type: 'number', description: 'المبلغ بالمبلغ (إلزامي — أكبر من صفر)' },
        category: { type: 'string', description: 'فئة المصروف (اختياري — الافتراضي عام)' },
      },
      required: ['description', 'amount'],
    },
  },
  {
    name: 'addSupplier',
    description: 'تجهيز نموذج مورد جديد معبأ للمراجعة — لا يُنفَّذ أي تغيير في النظام. استدعِ الأداة بعد اكتمال الحقل الإلزامي name؛ وسيفتح النظام النموذج معبأً بها ليراجعها المستخدم ويحفظها بنفسه. إن ذكر المستخدم «مورد» فلا حاجة لكلمة «مصنع» في الاسم',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم المورد (إلزامي)' },
        phone: { type: 'string', description: 'رقم هاتف المورد (اختياري)' },
        secondaryPhone: { type: 'string', description: 'رقم هاتف ثانوي للمورد (اختياري)' },
        address: { type: 'string', description: 'عنوان المورد (اختياري)' },
        notes: { type: 'string', description: 'ملاحظات إضافية عن المورد (اختياري)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'addCustomer',
    description: 'تجهيز نموذج عميل جديد معبأ للمراجعة — لا يُنفَّذ أي تغيير في النظام. استدعِ الأداة بعد اكتمال الحقلين الإلزاميين name و phone (11 رقماً يبدأ بـ 01)؛ وسيفتح النظام النموذج معبأً بها ليراجعها المستخدم ويحفظها بنفسه. إن كان الرقم مسجلاً لعميل آخر أبلغ المستخدم قبل تجهيز النموذج',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل (إلزامي)' },
        phone: { type: 'string', description: 'رقم هاتف العميل (إلزامي — 11 رقماً يبدأ بـ 01)' },
        address: { type: 'string', description: 'عنوان العميل (اختياري)' },
      },
      required: ['name', 'phone'],
    },
  },
]

/** جسر دوال النظام (window.* المعرّفة في compat.js) داخل بيئة المتصفح. */
function getBridge() {
  return typeof window !== 'undefined' && window ? window : {}
}

const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }

/** تنظيف رقم الهاتف: تحويل الأرقام العربية إلى إنجليزية وحذف كل ما ليس رقماً (مسافات/واصلات/أقواس). */
function cleanPhoneNumber(value) {
  return String(value || '').replace(/[٠-٩]/g, d => ARABIC_DIGITS[d]).replace(/[^0-9]/g, '')
}

/**
 * تطبيع معاملات الأداة قبل تجهيز النموذج:
 * - تنظيف أرقام الهواتف (أرقام عربية/مسافات/واصلات).
 * - فصل الاسم عن العنوان عند اندماجهما في نص واحد («محمد احمد - الغربية - المحلة
 *   الكبرى ...») لمنع تسجيل سجلات مدمجة (اسم+عنوان في حقل name وحقل address فارغ)
 *   ونتيجةً لذلك منع سجلات مكررة لا يطابقها فحص الاسم.
 */
export function normalizeActionArgs(name = '', args = {}) {
  const out = Object.assign({}, args)
  if (out.phone != null) out.phone = cleanPhoneNumber(out.phone)
  if (out.secondaryPhone != null) out.secondaryPhone = cleanPhoneNumber(out.secondaryPhone)
  if ((name === 'addSupplier' || name === 'addCustomer') && !String(out.address || '').trim()) {
    const rawName = String(out.name || '')
    if (/-/.test(rawName)) {
      const parts = rawName.split(/\s*-\s*/).map(s => String(s).trim()).filter(Boolean)
      if (parts.length >= 2) {
        out.name = parts[0]
        out.address = parts.slice(1).join(' - ')
      }
    }
  }
  return out
}

/** الجزء الأساسي من الاسم (قبل أول «-») لمطابقة السجلات المدمجة من النصوص المركبة. */
function baseName(name) {
  return normName(String(name || '').split(/\s*-\s*/)[0])
}

/** مطابقة اسم منتج مع بيانات النظام (تجاهل التشكيل/الهمزات والتطبيع). */
function findProductByName(products, name) {
  const target = normalizeArabic(String(name || '').trim())
  if (!target) return null
  return products.find(p => normalizeArabic(p.name) === target)
    || products.find(p => {
      const norm = normalizeArabic(p.name)
      return norm && (norm.includes(target) || target.includes(norm))
    })
}

/** تحويل بنود الطلب (اسم/كمية/سعر) إلى بنود النموذج مع حل أسعار المنتجات المسجلة. */
function resolvePrefillItems(items, bridge) {
  const products = typeof bridge.getProducts === 'function' ? bridge.getProducts() : []
  return items.map((item, index) => {
    const raw = typeof item === 'string' ? { name: item } : (item || {})
    const product = findProductByName(products, raw.name)
    const productName = String(raw.name || (product && product.name) || '').trim()
    if (!productName) throw new Error(`البند رقم ${index + 1} بلا اسم منتج`)
    return {
      name: productName,
      productId: product ? product.id : '',
      productName,
      quantity: toNum(raw.quantity) || 1,
      purchasePrice: product ? toNum(product.purchasePrice) : 0,
      sellingPrice: raw.price != null ? toNum(raw.price) : (product ? toNum(product.sellingPrice) : 0),
      price: raw.price != null ? toNum(raw.price) : (product ? toNum(product.sellingPrice) : undefined),
      supplierId: product ? product.supplierId || '' : '',
      supplierName: product ? product.supplierName || '' : '',
    }
  })
}

/** تحويل طريقة الدفع إلى حالة الطلب ومبلغ الدفعة في النظام. */
function mapPaymentType(paymentType, args) {
  const p = String(paymentType || '').trim().toLowerCase()
  const advanceAmount = args.advanceAmount != null ? toNum(args.advanceAmount) : toNum(args.downPayment)
  if (p === 'full' || p === 'paid' || p === 'cash' || p === 'نقدي' || p === 'دفع كامل' || p === 'كاش') {
    return { status: 'completed', downPayment: 0 }
  }
  if (p === 'advance' || p === 'partial' || p === 'deposit' || p === 'عربون' || p === 'مقدم' || p === 'دفعه مقدمه') {
    return { status: 'delivered', downPayment: advanceAmount }
  }
  if (p === 'credit' || p === 'deferred' || p === 'اجل' || p === 'آجل' || p === 'بالاجل') {
    return { status: 'delivered', downPayment: 0 }
  }
  return { status: 'delivered', downPayment: advanceAmount }
}

/**
 * حسابات الطلب المالية: الإجمالي = البنود + الشحن + النثريات، ثم مبلغ العربون
 * والمتبقي. عند ذكر المستخدم أن العربون يغطي الشحن والنثريات (depositType =
 * shipping_extra) يُضبط advanceAmount تلقائياً على مجموعهما، وبنفس المنطق
 * shipping = العربون بقيمة الشحن.
 */
function computeOrderFinances(args, itemsSubtotal) {
  const shipping = Math.max(toNum(args.shippingCost), 0)
  const extra = Math.max(toNum(args.extraExpenses), 0)
  const total = itemsSubtotal + shipping + extra
  const payment = mapPaymentType(args.paymentType, args)
  const depositType = String(args.depositType || '').trim() || 'custom'
  let advanceAmount = payment.downPayment
  if (depositType === 'shipping_extra') advanceAmount = shipping + extra
  else if (depositType === 'shipping') advanceAmount = shipping
  const remaining = Math.max(total - advanceAmount, 0)
  return { shipping, extra, total, advanceAmount, remaining, status: payment.status, depositType }
}

/** تطبيع رقم هاتف للمقارنة: أرقام فقط + آخر 11 خانة (يستوعب +20/٠١٠...). */
function normPhone(p) {
  const digits = String(p || '').replace(/\D/g, '')
  return digits.length > 11 ? digits.slice(-11) : digits
}

/** تطبيع اسم للمقارنة: إزالة التشكيل/الهمزات والمسافات. */
function normName(name) {
  return normalizeArabic(name).replace(/\s+/g, '')
}

/** البحث عن أي عميل/مورد مسجل برقم الهاتف (لمراجعة تضارب البيانات). */
function findPhoneOwner(bridge, cleanPhone) {
  if (!cleanPhone) return null
  const lists = []
  if (typeof bridge.getCustomers === 'function') lists.push(bridge.getCustomers())
  if (typeof bridge.getSuppliers === 'function') lists.push(bridge.getSuppliers())
  for (const list of lists) {
    const found = (Array.isArray(list) ? list : []).find(c => {
      const primary = normPhone(c.phone)
      const secondary = normPhone(c.secondaryPhone)
      return (primary && primary === cleanPhone) || (secondary && secondary === cleanPhone)
    })
    if (found) return found
  }
  return null
}

/**
 * الفحوص الوقائية قبل تجهيز النموذج — تعيد { errors, warnings }:
 * errors تُمنع تجهيز النموذج حتى إصلاحها، warnings تُعرض كتنبيهات على النموذج.
 * أ) تضارب رقم الهاتف مع عميل/مورد مسجل باسم مختلف.
 * ب) توفر الكميات بالمخزون.
 * ج) تكرار منتج/مورد بالاسم (تطبيع يتجاهل المسافات/الهمزات).
 * د) منطقية المبالغ والأسعار (لا سالب/صفر/قيم غير منطقية).
 */
export function runPreventiveChecks(name = '', args = {}, bridge = getBridge()) {
  const errors = []
  const warnings = []
  const cleanPhone = cleanPhoneNumber(args.phone)
  const explicitName = String(
    name === 'createOrder' ? (args.customerName || '') : (args.name || '')
  ).trim()
  const explicitNameNorm = normName(explicitName)

  if (name === 'createOrder') {
    // البيانات الناقصة الأساسية: لا يُجهَّز النموذج إلا باكتمالها (لا قيم افتراضية).
    if (!explicitName) errors.push('إنشاء الطلب يحتاج اسم العميل')
    if (!cleanPhone) errors.push('إنشاء الطلب يحتاج رقم هاتف صحيح للعميل (11 رقماً يبدأ بـ 01)')
    else if (cleanPhone.length !== 11 || !/^01/.test(cleanPhone)) {
      errors.push(`رقم هاتف العميل «${String(args.phone).trim()}» غير صحيح — يجب أن يكون 11 رقماً يبدأ بـ 01`)
    }
    if (!String(args.address || '').trim()) errors.push('إنشاء الطلب يحتاج عنوان العميل (عنوان التوصيل)')
    if (!Array.isArray(args.items) || args.items.length === 0) errors.push('إنشاء الطلب يحتاج بنداً واحداً على الأقل')
    // د) منطقية الشحن والنثريات والعربون.
    if (toNum(args.shippingCost) < 0) errors.push('مصاريف الشحن لا يمكن أن تكون سالبة')
    if (toNum(args.extraExpenses) < 0) errors.push('النثريات/المصاريف الإضافية لا يمكن أن تكون سالبة')
    if (toNum(args.advanceAmount) < 0) errors.push('مبلغ العربون لا يمكن أن يكون سالباً')

    // أ) تضارب رقم الهاتف مع عميل/مورد مسجل باسم مختلف.
    if (cleanPhone && explicitNameNorm) {
      const owner = findPhoneOwner(bridge, cleanPhone)
      if (owner && normName(owner.name) !== explicitNameNorm) {
        errors.push(`تنبيه: رقم الهاتف ${String(args.phone).trim()} مسجل بالفعل باسم «${owner.name}». هل تقصد الإضافة لنفس الحساب أم تحديث البيانات؟`)
      }
    }
    // ب + د) مراجعة البنود: المخزون المتاح، المنتج غير المسجل، الكميات والأسعار.
    const products = typeof bridge.getProducts === 'function' ? bridge.getProducts() : []
    ;(Array.isArray(args.items) ? args.items : []).forEach((item, index) => {
      const raw = typeof item === 'string' ? { name: item } : (item || {})
      const product = findProductByName(products, raw.name)
      const itemName = String(raw.name || '').trim()
      const qty = toNum(raw.quantity)
      if (qty < 1) {
        errors.push(`الكمية في البند ${index + 1} يجب أن تكون 1 على الأقل`)
        return
      }
      if (raw.price != null && toNum(raw.price) <= 0) {
        errors.push(`سعر البند ${index + 1} يجب أن يكون أكبر من صفر`)
      }
      if (!product && (raw.price == null || toNum(raw.price) <= 0)) {
        errors.push(`المنتج «${itemName || `بند ${index + 1}`}» غير مسجل في النظام — سجّله أولاً أو حدد سعر البيع في البند`)
      }
      if (product && qty > toNum(product.stock)) {
        warnings.push(`المنتج «${product.name}»: الكمية المطلوبة ${qty} أكبر من المتاح بالمخزون (${toNum(product.stock)} فقط)`)
      }
    })
  }

  if (name === 'addProduct') {
    const productName = explicitName
    if (!productName) errors.push('إضافة المنتج تحتاج اسم منتج')
    const price = toNum(args.price)
    if (price <= 0) errors.push('سعر البيع يجب أن يكون أكبر من صفر')
    if (toNum(args.stock) < 0) errors.push('الكمية بالمخزون لا يمكن أن تكون سالبة')
    if (toNum(args.purchasePrice) < 0) errors.push('سعر الشراء لا يمكن أن يكون سالباً')
    // المورد المصنع إلزامي للمنتج الجديد — لا يُجهَّز النموذج بدونه.
    const supplierName = String(args.supplierName || '').trim()
    if (!supplierName) {
      errors.push('إضافة المنتج تحتاج المورد المصنع — اذكر اسمه (من قائمة الموردين) لأفتح لك النموذج')
    } else {
      const suppliers = typeof bridge.getSuppliers === 'function' ? bridge.getSuppliers() : []
      const known = suppliers.some(s => baseName(s.name) === baseName(supplierName))
      if (!known) {
        errors.push(`المورد «${supplierName}» غير مسجل في قائمة الموردين — سجّله أولاً أو اذكر مورداً مسجلاً`)
      }
    }
    if (price > 0 && toNum(args.purchasePrice) > price) {
      warnings.push(`سعر البيع (${formatCurrency(price)}) أقل من سعر الشراء (${formatCurrency(toNum(args.purchasePrice))})`)
    }
    // ج) منتج مكرر بالاسم.
    if (productName) {
      const products = typeof bridge.getProducts === 'function' ? bridge.getProducts() : []
      if (products.some(p => normName(p.name) === normName(productName))) {
        errors.push(`هذا المنتج «${productName}» مسجل بالفعل — هل ترغب في تحديث سِعره/كميته بدلاً من إضافة عنصر جديد؟`)
      }
    }
  }

  if (name === 'updateProduct') {
    // تعديل منتج مسجل (V3.36): لا تنفيذ هنا — يُجهَّز نموذج تعديل معبأً.
    const products = typeof bridge.getProducts === 'function' ? bridge.getProducts() : []
    const product = args.productId
      ? (Array.isArray(products) ? products.find(p => String(p.id) === String(args.productId)) : null)
      : findProductByName(products, args.name)
    if (!product) {
      errors.push(`المنتج «${String(args.name || '').trim() || 'المطلوب'}» غير مسجل في النظام — لا يمكن تجهيز تعديله`)
    } else {
      const price = toNum(args.price)
      if (args.price != null && price <= 0) errors.push('سعر البيع يجب أن يكون أكبر من صفر')
      if (args.stock != null && toNum(args.stock) < 0) errors.push('الكمية بالمخزون لا يمكن أن تكون سالبة')
      if (args.purchasePrice != null && toNum(args.purchasePrice) < 0) errors.push('سعر الشراء لا يمكن أن يكون سالباً')
      if (args.price != null && args.purchasePrice != null && price > 0 && toNum(args.purchasePrice) > price) {
        warnings.push(`سعر البيع (${formatCurrency(price)}) أقل من سعر الشراء (${formatCurrency(toNum(args.purchasePrice))})`)
      }
      const supplierName = String(args.supplierName || '').trim()
      if (supplierName) {
        const suppliers = typeof bridge.getSuppliers === 'function' ? bridge.getSuppliers() : []
        const known = suppliers.some(s => baseName(s.name) === baseName(supplierName))
        if (!known) {
          errors.push(`المورد «${supplierName}» غير مسجل في قائمة الموردين — سجّله أولاً أو اذكر مورداً مسجلاً`)
        }
      }
    }
  }

  if (name === 'addExpense') {
    const description = String(args.description || '').trim()
    if (!description) errors.push('تسجيل المصروف يحتاج بياناً (وصفاً)')
    const amount = toNum(args.amount)
    if (amount <= 0) errors.push('مبلغ المصروف يجب أن يكون أكبر من صفر')
    if (amount > 100000000) warnings.push('المبلغ كبير جداً بشكل غير منطقي — راجع القيمة')
  }

  if (name === 'addSupplier') {
    const supplierName = explicitName
    if (!supplierName) errors.push('إضافة المورد تحتاج اسم مورد')
    // أ) تضارب رقم الهاتف مع عميل/مورد مسجل باسم مختلف (مقارنة بالاسم الأساسي
    //    قبل «-» كي يطابق السجلات المدمجة من النصوص المركبة مثل «محمد احمد - ...»).
    if (cleanPhone && explicitNameNorm) {
      const owner = findPhoneOwner(bridge, cleanPhone)
      if (owner && baseName(owner.name) !== baseName(explicitName)) {
        errors.push(`تنبيه: رقم الهاتف ${String(args.phone).trim()} مسجل بالفعل باسم «${owner.name}» — راجع البيانات قبل المتابعة`)
      } else if (owner) {
        warnings.push(`رقم الهاتف ${String(args.phone).trim()} مسجل بالفعل لنفس المورد «${owner.name}» — لن تُنشأ نسخة مكررة`)
      }
    }
    // ج) مورد مكرر بالاسم (بالمقارنة الأساسية).
    if (supplierName) {
      const suppliers = typeof bridge.getSuppliers === 'function' ? bridge.getSuppliers() : []
      if (suppliers.some(s => baseName(s.name) === baseName(supplierName))) {
        errors.push(`هذا المورد «${supplierName}» مسجل بالفعل — هل ترغب في تحديث بياناته بدلاً من إضافة عنصر جديد؟`)
      }
    }
  }

  if (name === 'addCustomer') {
    const customerName = explicitName
    if (!customerName) errors.push('إضافة العميل تحتاج اسم عميل')
    if (!cleanPhone) errors.push('إضافة العميل تحتاج رقم هاتف صحيحاً (11 رقماً يبدأ بـ 01)')
    else if (cleanPhone.length !== 11 || !/^01/.test(cleanPhone)) {
      errors.push(`رقم هاتف العميل «${String(args.phone).trim()}» غير صحيح — يجب أن يكون 11 رقماً يبدأ بـ 01`)
    }
    // أ) الرقم مسجل بالفعل: لعميل آخر باسم مختلف → خطأ مانع؛ لنفس العميل → تنبيه.
    if (cleanPhone && explicitNameNorm) {
      const owner = findPhoneOwner(bridge, cleanPhone)
      if (owner && baseName(owner.name) !== baseName(explicitName)) {
        errors.push(`رقم الهاتف ${String(args.phone).trim()} مسجل بالفعل باسم «${owner.name}» — راجع البيانات قبل المتابعة`)
      } else if (owner) {
        warnings.push(`رقم الهاتف ${String(args.phone).trim()} مسجل بالفعل للعميل «${owner.name}» — لن تُنشأ نسخة مكررة`)
      }
    }
    // تنبيه لا مانع: اسم عميل مطابق موجود بالفعل (بالمقارنة الأساسية).
    if (customerName) {
      const customers = typeof bridge.getCustomers === 'function' ? bridge.getCustomers() : []
      if (customers.some(c => baseName(c.name) === baseName(customerName))) {
        warnings.push(`يوجد عميل مسجل بالفعل باسم «${customerName}»`)
      }
    }
  }

  return { errors, warnings }
}

/** ملخص عربي مقروء لنموذج جاهز — يُعرض مع رسالة «تم تجهيز البيانات للمراجعة». */
export function buildActionSummary(name = '', args = {}, bridge = getBridge()) {
  const lines = []
  if (name === 'createOrder') {
    const items = Array.isArray(args.items) ? args.items : []
    const products = typeof bridge.getProducts === 'function' ? bridge.getProducts() : []
    const subtotal = items.reduce((s, item) => {
      const raw = typeof item === 'string' ? { name: item } : (item || {})
      const product = findProductByName(products, raw.name)
      const price = raw.price != null ? toNum(raw.price) : (product ? toNum(product.sellingPrice) : 0)
      return s + (price * (toNum(raw.quantity) || 1))
    }, 0)
    const f = computeOrderFinances(args, subtotal)
    lines.push('إنشاء طلب بيع جديد')
    lines.push(`العميل: ${String(args.customerName || '').trim() || '—'}${args.phone ? ` (${String(args.phone).trim()})` : ''}`)
    if (args.address && String(args.address).trim()) lines.push(`العنوان: ${String(args.address).trim()}`)
    lines.push('البنود:')
    items.forEach((item, i) => {
      const raw = typeof item === 'string' ? { name: item } : (item || {})
      const qty = toNum(raw.quantity) || 1
      const product = findProductByName(products, raw.name)
      const price = raw.price != null ? toNum(raw.price) : (product ? toNum(product.sellingPrice) : null)
      const itemName = String(raw.name || '').trim() || `بند ${i + 1}`
      lines.push(`  ${i + 1}) ${itemName} × ${qty}${price != null ? ` بسعر ${formatCurrency(price)}` : ''}`)
    })
    lines.push(`إجمالي البنود: ${formatCurrency(subtotal)}`)
    if (f.shipping > 0) lines.push(`مصاريف الشحن: ${formatCurrency(f.shipping)}`)
    if (f.extra > 0) lines.push(`النثريات/مصاريف إضافية: ${formatCurrency(f.extra)}`)
    lines.push(`الإجمالي النهائي: ${formatCurrency(f.total)}`)
    const payLabel = f.status === 'completed'
      ? 'دفع كامل'
      : (f.advanceAmount > 0 ? `دفعة مقدمة/عربون (${formatCurrency(f.advanceAmount)})` : 'آجل / عند الاستلام')
    lines.push(`طريقة الدفع: ${payLabel}`)
    if (f.advanceAmount > 0) lines.push(`المتبقي بعد العربون: ${formatCurrency(f.remaining)}`)
  }
  if (name === 'addProduct') {
    lines.push('إضافة منتج جديد')
    lines.push(`الاسم: ${String(args.name || '').trim()}`)
    if (args.supplierName && String(args.supplierName).trim()) lines.push(`المورد المصنع: ${String(args.supplierName).trim()}`)
    lines.push(`سعر البيع: ${formatCurrency(toNum(args.price))}`)
    if (args.purchasePrice != null) lines.push(`سعر الشراء: ${formatCurrency(toNum(args.purchasePrice))}`)
    lines.push(`الكمية بالمخزون: ${toNum(args.stock)}`)
    if (args.code && String(args.code).trim()) lines.push(`الكود: ${String(args.code).trim()}`)
  }
  if (name === 'updateProduct') {
    lines.push('تعديل بيانات منتج مسجل')
    lines.push(`المنتج: ${String(args.name || '').trim() || '—'}`)
    if (args.price != null) lines.push(`سعر البيع الجديد: ${formatCurrency(toNum(args.price))}`)
    if (args.purchasePrice != null) lines.push(`سعر الشراء: ${formatCurrency(toNum(args.purchasePrice))}`)
    if (args.stock != null) lines.push(`الكمية بالمخزون: ${toNum(args.stock)}`)
    if (args.minStock != null) lines.push(`الحد الأدنى للمخزون: ${toNum(args.minStock)}`)
    if (args.supplierName && String(args.supplierName).trim()) lines.push(`المورد المصنع: ${String(args.supplierName).trim()}`)
  }
  if (name === 'addExpense') {
    lines.push('تسجيل مصروف جديد')
    lines.push(`البيان: ${String(args.description || '').trim()}`)
    lines.push(`المبلغ: ${formatCurrency(toNum(args.amount))}`)
    if (args.category && String(args.category).trim()) lines.push(`الفئة: ${String(args.category).trim()}`)
  }
  if (name === 'addSupplier') {
    lines.push('إضافة مورد جديد')
    lines.push(`الاسم: ${String(args.name || '').trim()}`)
    if (args.phone && String(args.phone).trim()) lines.push(`الهاتف: ${String(args.phone).trim()}`)
    if (args.secondaryPhone && String(args.secondaryPhone).trim()) lines.push(`هاتف ثانوي: ${String(args.secondaryPhone).trim()}`)
    if (args.address && String(args.address).trim()) lines.push(`العنوان: ${String(args.address).trim()}`)
    if (args.notes && String(args.notes).trim()) lines.push(`ملاحظات: ${String(args.notes).trim()}`)
  }
  if (name === 'addCustomer') {
    lines.push('إضافة عميل جديد')
    lines.push(`الاسم: ${String(args.name || '').trim()}`)
    if (args.phone && String(args.phone).trim()) lines.push(`رقم الهاتف: ${String(args.phone).trim()}`)
    if (args.address && String(args.address).trim()) lines.push(`العنوان: ${String(args.address).trim()}`)
  }
  return lines.join('\n')
}

// =============================================================================
// استخراج البيانات من الشات (Extraction) — V3.35
// -----------------------------------------------------------------------------
// أدوات مساعدة داخلية (تُستخدم عند غياب مفتاح API) لاستخراج اسم/هاتف/عنوان/
// مبلغ/بنود من جملة عربية، بنفس تقسيم الحقول المتفق عليه: الاسم منفصل عن
// العنوان، الهواتف قائمة، والملاحظات منفصلة. إن تعذّر فهم البيانات يُطلب من
// المستخدم توضيح مباشر بدلاً من التخمين.
// =============================================================================

/** تحويل الأرقام الهندية/العربية (٠١٢...) إلى أرقام غربية وإزالة الفواصل والمسافات. */
function toDigits(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[,\s]/g, '')
}

/** استخراج أول عدد صحيح/عشري من نص عربي (يدعم الأرقام الغربية والهندية). */
function extractNumber(text) {
  const m = toDigits(text).match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** أفعال طلب الإضافة (بعد التطبيع: أضف→اضف، أنشئ→انشا، اريد→اريد...). */
const FORM_VERBS = [
  'اضف', 'اضيف', 'سجل', 'اعمل', 'اسجل', 'ضيف', 'انشا', 'ادخل', 'عايز', 'عاوز',
  'ممكن', 'اريد', 'نفسي', 'اطلب', 'احجز',
]

const FORM_START_RE = new RegExp(`^(${FORM_VERBS.join('|')})\\s`)

/** إزالة كل أفعال طلب الإضافة من النص (تُستبدل بمسافات). */
function stripFormVerbs(text) {
  let out = String(text || '')
  FORM_VERBS.forEach(v => {
    out = out.split(v).join(' ')
  })
  return out
}

/** إزالة أول كلمة نوع فقط (مورد/مصنع/عميل/منتج/مصروف...) من بداية الوصف. */
function removeFirstKindWord(text, words) {
  for (const w of words) {
    const idx = text.indexOf(w)
    if (idx !== -1) {
      return text.slice(0, idx) + text.slice(idx + w.length)
    }
  }
  return text
}

const PHONE_MARKERS = ['الهاتف', 'التليفون', 'الموبايل', 'تليفون', 'تيليفون', 'موبايل', 'محمول', 'تلفون', 'رقم', 'هاتف']
const PHONE_CLEAN_RE = /هاتف|تليفون|تيليفون|موبايل|محمول|تلفون|رقم|الهاتف|التليفون|الموبايل|الرقم/g

/** استخراج رقم هاتف (بعد علامة مثل «هاتف») أو أول رقم مباشر من النص. */
function extractPhone(text) {
  let out = String(text || '')
  for (const marker of PHONE_MARKERS) {
    const idx = out.indexOf(marker)
    if (idx === -1) continue
    const m = out.slice(idx + marker.length).match(/([0-9٠-٩۰-۹][0-9٠-٩۰-۹\s-]{6,14})/)
    if (m) {
      const digits = toDigits(m[1])
      if (digits.length >= 8) return digits
    }
  }
  const direct = out.match(/([0-9٠-٩۰-۹][0-9٠-٩۰-۹\s-]{9,14})/)
  if (direct) {
    const digits = toDigits(direct[1])
    if (/^01[0-9]{9}$/.test(digits)) return digits
  }
  return ''
}

/** فصل العنوان بعد كلمة «عنوان/العنوان» عن بقية النص. */
function splitAddress(text) {
  const split = String(text || '').split(/عنوان|العنوان/g)
  if (split.length > 1) {
    const address = split.slice(1).join(' ').replace(/\s+/g, ' ').trim()
    const rest = split[0].replace(/\s+/g, ' ').trim()
    return { rest, address }
  }
  return { rest: String(text || '').replace(/\s+/g, ' ').trim(), address: '' }
}

/** إزالة أي رقم هاتف مفقود/متصل بالنص بعد الاستخراج (كي لا يتسرب للأسماء/العناوين). */
function stripPhonesFromText(text) {
  return String(text || '')
    .replace(/[0٠][1١][0-9٠-٩۰-۹][0-9٠-٩۰-۹\s-]{8,12}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** استخراج اسم + هاتف + عنوان لمورد/عميل («اضف مورد مصنع النور هاتف 011...»). */
function extractContactFormFill(q, kindWords) {
  let rest = stripFormVerbs(q)
  rest = removeFirstKindWord(rest, kindWords)
  const phone = extractPhone(rest)
  rest = stripPhonesFromText(rest.replace(PHONE_CLEAN_RE, ' '))
  const { rest: namePart, address } = splitAddress(rest)
  const name = namePart.replace(/^(جديد|اسمه|الاسم|اسم)\s*/, '').replace(/\s+/g, ' ').trim()
  return { name, phone, address }
}

/** إيجاد المورد الأكثر تطابقاً (الأطول اسماً) من قائمة الموردين داخل النص. */
function extractSupplierFromText(text, suppliers = []) {
  const list = Array.isArray(suppliers) ? suppliers : []
  const best = list
    .filter(s => s && s.name && text.includes(normalizeArabic(s.name)))
    .sort((a, b) => String(b.name).length - String(a.name).length)[0]
  if (!best) return null
  return { supplierId: String(best.id || ''), supplierName: String(best.name || '').trim() }
}

/** استخراج اسم + سعر + كمية مخزون + مورد لمنتج («اضف منتج غطاء من مصنع النور بسعر 200»). */
function extractProductFormFill(q, data) {
  let rest = stripFormVerbs(q)
  rest = removeFirstKindWord(rest, ['منتج', 'صنف'])
  const amount = extractNumber(rest)
  const stockMatch = rest.match(/مخزون\s*([0-9٠-٩۰-۹]+)/)
  const supplier = extractSupplierFromText(rest, (data && data.suppliers) || [])
  const supplierNorm = supplier ? normalizeArabic(supplier.supplierName) : '__nomatch__'
  let name = rest
    .replace(/بسعر|بقيمه|قيمته|سعره|بسعر بيع|بسعر الشراء|بسعر البيع|بمخزون|بكميه|بسعر الجملة/g, ' ')
    .replace(/مخزون\s*[0-9٠-٩۰-۹]+/g, ' ')
    .replace(/^(من|من عند|مورد)\s+/, ' ')
    .replace(supplierNorm, ' ')
    .replace(/\s*من\s+/g, ' ')
    .replace(/[0-9٠-٩۰-۹]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return null
  const args = { name }
  if (supplier) {
    args.supplierId = supplier.supplierId
    args.supplierName = supplier.supplierName
  }
  if (amount != null) args.price = amount
  if (stockMatch) args.stock = Number(toDigits(stockMatch[1]))
  return args
}

/** استخراج بيان + مبلغ لمصروف («سجل مصروف كهرباء 300»). */
function extractExpenseFormFill(q) {
  let rest = stripFormVerbs(q)
  rest = removeFirstKindWord(rest, ['مصروف', 'مصاريف', 'مصروفات'])
  const amount = extractNumber(rest)
  const title = rest
    .replace(/بـ|بقيمه/g, ' ')
    .replace(/[0-9٠-٩۰-۹]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return null
  const args = { description: title }
  if (amount != null) args.amount = amount
  return args
}

/** استخراج بيانات العميل (اسم/هاتف/عنوان) من بقية نص الطلب (V3.38). */
function extractOrderCustomerFrom(rest) {
  const phone = extractPhone(rest)
  let r = stripPhonesFromText(String(rest || '').replace(PHONE_CLEAN_RE, ' '))
  const { rest: namePart, address } = splitAddress(r)
  let customerName = stripFormVerbs(namePart).replace(/\s+/g, ' ').trim()
  customerName = customerName
    .replace(/^(ل|لل)\s*/, '')
    .replace(/^طلب\s*/, '')
    .replace(/^(ل|لل)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { customerName, phone, address }
}

/** استخراج بنود الطلب من المنتجات المسجلة («اعمل طلب بطانية محسن عدد 2 لاحمد»). */
function extractOrderFormFill(q, data) {
  const products = (data && Array.isArray(data.products)) ? data.products : []
  const matched = products.filter(p => p && p.name && q.includes(normalizeArabic(p.name)))
  if (matched.length === 0) return null
  const items = matched.map(p => {
    const pn = normalizeArabic(p.name)
    const after = q.slice(q.indexOf(pn) + pn.length)
    const m = after.match(/عدد\s*([0-9٠-٩۰-۹]+)|بعدد\s*([0-9٠-٩۰-۹]+)|كميه\s*([0-9٠-٩۰-۹]+)|كمية\s*([0-9٠-٩۰-۹]+)/)
    const qty = m ? Number(toDigits(m[1] || m[2] || m[3] || m[4])) : 1
    return { name: p.name, quantity: qty }
  })
  let rest = q
  matched.forEach(p => {
    rest = rest.split(normalizeArabic(p.name)).join(' ')
  })
  const { customerName, phone, address } = extractOrderCustomerFrom(rest)
  if (!customerName) return null
  return { customerName, phone, address, items }
}

/**
 * التعرّف الداخلي على طلب إضافة بيانات وتحويله إلى أداة + معاملات مجهّزة.
 * يعيد { name, args } أو null إن لم يكن السؤال طلب إضافة واضحاً.
 * V3.37: scope (القسم المختار من شريط الأقسام) تلميح أولوية — إذا لم تذكر
 * الجملة نوعاً صريحاً لكن المستخدم اختار قسماً، يُعرَف الطلب من هذا القسم.
 * النوع الصريح في الجملة يسبق القسم دائماً، والقسم لا يقفل ولا يحجب.
 * V3.38: قسم «إنشاء طلب» (orders) — أي طلب فاتورة بلا بنود مذكورة يُوجَّه
 * لنموذج الطلب مباشرةً مع بيانات العميل (لا نموذج عميل منفصل).
 */
export function detectFormFillIntent(question = '', data = {}, scope = 'general') {
  const q = normalizeArabic(String(question || '').trim())
  if (!q || !FORM_START_RE.test(q)) return null

  // الطلبات تُعرَف أولاً (جملة «اعمل طلب ... لعميل/مورد» قد تحتوي كلمة عميل).
  if (/اطلب|اعمل طلب|طلب جديد|احجز/.test(q)) {
    const extracted = extractOrderFormFill(q, data)
    if (extracted) return { name: 'createOrder', args: extracted }
  }
  // المنتجات تُفحص قبل الموردين: «منتج ... من مصنع ...» تعني إضافة منتج وليس مورداً.
  if (/منتج|صنف/.test(q)) {
    const extracted = extractProductFormFill(q, data)
    if (extracted) return { name: 'addProduct', args: extracted }
  }
  if (/مورد|مصنع/.test(q)) {
    const { name, phone, address } = extractContactFormFill(q, ['مورد', 'مصنع'])
    if (name) return { name: 'addSupplier', args: { name, phone, address } }
  }
  if (/عميل|زبون/.test(q)) {
    const { name, phone, address } = extractContactFormFill(q, ['عميل', 'زبون'])
    if (name) return { name: 'addCustomer', args: { name, phone, address } }
  }
  if (/مصروف|مصاريف|مصروفات/.test(q)) {
    const extracted = extractExpenseFormFill(q)
    if (extracted) return { name: 'addExpense', args: extracted }
  }

  // V3.37 — القسم المختار: طلب إضافة دون نوع صريح داخل قسم محدد → قسم المستخدم.
  if (scope === 'suppliers') {
    const { name, phone, address } = extractContactFormFill(q, ['مورد', 'مصنع'])
    if (name) return { name: 'addSupplier', args: { name, phone, address } }
  }
  if (scope === 'customers') {
    const { name, phone, address } = extractContactFormFill(q, ['عميل', 'زبون'])
    if (name) return { name: 'addCustomer', args: { name, phone, address } }
  }
  if (scope === 'products') {
    const extracted = extractProductFormFill(q, data)
    if (extracted) return { name: 'addProduct', args: extracted }
  }
  // V3.38 — قسم «إنشاء طلب»: أي طلب إضافة بلا نوع صريح (أو طلب فاتورة بلا
  // بنود مذكورة) يُوجَّه لنموذج الطلب مباشرةً — بيانات العميل تخص الطلب ولا
  // يُفتح نموذج عميل منفصل عند إنشاء طلب.
  if (scope === 'orders') {
    const extracted = extractOrderFormFill(q, data)
    if (extracted) return { name: 'createOrder', args: extracted }
    const { customerName, phone, address } = extractOrderCustomerFrom(q)
    if (customerName || phone || address) {
      return { name: 'createOrder', args: { customerName, phone, address, items: [] } }
    }
  }
  return null
}

/** أفعال طلب التعديل («عدل سعر...»، «غيّر مخزون...»، «حدّث مورد...»). */
const EDIT_VERBS = ['عدل', 'تعديل', 'غير', 'غيره', 'حدث', 'حدد', 'اعدل', 'اتعدل', 'نعدل']

/**
 * التعرّف الداخلي على طلب تعديل منتج مسجل (V3.36):
 * يعيد { name: 'updateProduct', args } بمعرف المنتج والبيانات الجديدة فقط، أو null.
 * لا يُنفَّذ ولا يُدَّعى إتمام هنا — يُفتح نموذج التعديل معبأً للمراجعة.
 */
export function detectEditIntent(question = '', data = {}) {
  const q = normalizeArabic(String(question || '').trim())
  if (!q || !EDIT_VERBS.some(v => q.includes(v))) return null

  // الرقم المذكور: إذا ورد «مخزون» بلا «سعر» نعتبره مخزوناً، وإلا سعر البيع.
  const numbers = [...q.matchAll(/([0-9٠-٩۰-۹]+(?:\.[0-9٠-٩۰-۹]+)?)/g)]
  const last = numbers.length ? numbers[numbers.length - 1][1] : null
  if (last == null) return null
  const isStock = q.includes('مخزون') && !q.includes('سعر')
  const value = Number(toDigits(last))

  const products = (data && Array.isArray(data.products)) ? data.products : []
  const product = products.find(p => p && p.name && q.includes(normalizeArabic(p.name)))

  if (product) {
    const args = { name: product.name, productId: product.id }
    if (isStock) args.stock = value
    else args.price = value
    const supplier = extractSupplierFromText(q, (data && data.suppliers) || [])
    if (supplier) {
      args.supplierId = supplier.supplierId
      args.supplierName = supplier.supplierName
    }
    return { name: 'updateProduct', args }
  }

  // منتج غير مسجل — نعيد اسمه المذكور ليُعرض سبب المنع «غير مسجل» بدل رد عام.
  const name = q
    .replace(/(?:عدل|تعديل|غير|غيره|حدث|حدد|اعدل|اتعدل|نعدل|سعره|سعر|بسعر|مخزون|منتج|صنف|الي|الى|ل)/g, ' ')
    .replace(/[0-9٠-٩۰-۹]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return null
  const args = { name }
  if (isStock) args.stock = value
  else args.price = value
  return { name: 'updateProduct', args }
}

// =============================================================================
// إشارة نموذج التعبئة (Form-Fill Signal) — V3.35
// -----------------------------------------------------------------------------
// عند تجهيز نموذج معبأ بنجاح تُخزَّن إشارة (pendingFormFill) في حالة الوحدة
// ويستهلكها أسلوب AiAssistantModal لفتح النافذة المناسبة — لا تنفيذ ولا
// تأكيد ولا مسودة معلقة؛ المستخدم وحده يحفظ من داخل النموذج المفتوح.
// =============================================================================

let pendingFormFill = null
let formFillVersion = 0

/** رقم نسخة نموذج التعبئة الحالي (يُستخدم لإظهار «تم تجهيز البيانات للمراجعة»). */
export function getFormFillVersion() {
  return formFillVersion
}

/** النموذج المعبأ المعلّق حالياً (إن وُجد) — لا يُنفَّذ شيء منه. */
export function getFormFill() {
  return pendingFormFill
}

/** استهلاك إشارة نموذج التعبئة بعد فتح النافذة. */
export function consumeFormFill() {
  pendingFormFill = null
}

/**
 * تجهيز نموذج معبأ من اسم أداة ومعاملاتها: تطبيع + فحوص وقائية فقط —
 * لا يُنفَّذ أي تغيير في النظام إطلاقاً. عند النجاح يُخزَّن النموذج في
 * pendingFormFill ويعيد { ok: true, form, data }. عند وجود أخطاء مانعة
 * يعيد { ok: false, blocked: true, errors } ليُطلب من المستخدم البيانات.
 */
export function prepareFormFill(name = '', args = {}, bridge = getBridge()) {
  const safe = normalizeActionArgs(name, args)
  let entityId = null
  if (name === 'updateProduct') {
    // حلّ معرف المنتج من الاسم الرسمي المسجل وتمرير اسمه الرسمي للنموذج.
    const products = typeof bridge.getProducts === 'function' ? bridge.getProducts() : []
    const product = safe.productId
      ? (Array.isArray(products) ? products.find(p => String(p.id) === String(safe.productId)) : null)
      : findProductByName(products, safe.name)
    if (product) {
      entityId = product.id
      safe.name = product.name
    }
  }
  if (name === 'addProduct' && safe.supplierName && !safe.supplierId) {
    const suppliers = typeof bridge.getSuppliers === 'function' ? bridge.getSuppliers() : []
    const sup = (Array.isArray(suppliers) ? suppliers : []).find(s => baseName(s.name) === baseName(safe.supplierName))
    if (sup) safe.supplierId = String(sup.id || '')
  }
  if (name === 'createOrder' && Array.isArray(safe.items)) {
    try {
      safe.items = resolvePrefillItems(safe.items, bridge)
    } catch (err) {
      return { ok: false, form: name, entityId, data: safe, blocked: true, errors: [String((err && err.message) || err)], warnings: [] }
    }
  }
  const { errors, warnings } = runPreventiveChecks(name, safe, bridge)
  if (errors.length > 0) {
    return { ok: false, form: name, entityId, data: safe, blocked: true, errors, warnings }
  }
  formFillVersion += 1
  pendingFormFill = { form: name, entityId, data: safe, version: formFillVersion }
  return { ok: true, form: name, entityId, data: safe, blocked: false, errors: [], warnings }
}

/** رسالة نجاح تجهيز النموذج (تُعرض في الشات مع إشارة فتح النافذة). */
export function buildFormFillMessage(result = {}) {
  const { form = '', data = {}, warnings = [] } = result
  const summary = buildActionSummary(form, data)
  const isEdit = /^update/.test(form)
  const lines = [isEdit
    ? 'تم تجهيز بيانات التعديل للمراجعة — لا شيء تغيّر في النظام بعد. أكمل التعديل من النموذج ثم اضغط حفظ.'
    : 'تم تجهيز البيانات للمراجعة، يمكنك التأكد منها وضغط حفظ.']
  if (summary) lines.push(summary)
  if (Array.isArray(warnings) && warnings.length) {
    lines.push('')
    lines.push('تنبيهات:')
    warnings.forEach(w => lines.push(`- ${w}`))
  }
  return lines.join('\n')
}

/** رسالة تعذّر تجهيز النموذج (بيانات ناقصة/غير صحيحة) مع طلب إكمالها. */
export function buildBlockedMessage(result = {}) {
  const { errors = [] } = result
  const lines = ['لا يمكن تجهيز نموذج التعبئة الآن لأن بعض البيانات ناقصة أو غير صحيحة:']
  ;(Array.isArray(errors) ? errors : []).forEach(e => lines.push(`- ${e}`))
  lines.push('أكمل البيانات المطلوبة ثم أعد طلب الإضافة، أو اطلب مني توضيح ما استخرجته.')
  return lines.join('\n')
}
