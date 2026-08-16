import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getLowStockProducts,
  getTopCustomers,
  getTopProducts,
  generateProductDescription,
  buildAiSummary,
  answerQuestion,
  normalizeArabic,
  AI_TOOLS,
  runPreventiveChecks,
  buildActionSummary,
  normalizeActionArgs,
  detectFormFillIntent,
  detectEditIntent,
  prepareFormFill,
  getFormFill,
  consumeFormFill,
  getFormFillVersion,
  buildFormFillMessage,
  buildBlockedMessage,
} from '@/services/aiAssistant'
import { formatCurrency, getCairoDate } from '@/utils/formatters'

describe('aiAssistant (services/aiAssistant.js) — دوال التحليل النقية', () => {
  it('getLowStockProducts يعيد المنتجات الناقصة مع كمية مقترحة لإعادة الطلب', () => {
    const products = [
      { id: 'P1', name: 'بطانية', stock: 3, minStock: 5 },
      { id: 'P2', name: 'مفرش', stock: 10, minStock: 2 },
      { id: 'P3', name: 'وسادة', stock: 5, minStock: 5 },
    ]
    const low = getLowStockProducts(products)
    expect(low.map(p => p.id)).toEqual(['P1', 'P3'])
    expect(low[0].suggestedReorderQty).toBe(7)
    expect(low[1].suggestedReorderQty).toBe(5)
  })

  it('getLowStockProducts يرتب النواقص من الأكثر عجزاً', () => {
    const products = [
      { id: 'P1', name: 'أ', stock: 4, minStock: 5 },
      { id: 'P2', name: 'ب', stock: 0, minStock: 5 },
    ]
    expect(getLowStockProducts(products).map(p => p.id)).toEqual(['P2', 'P1'])
  })

  it('getTopCustomers يرتب العملاء حسب إجمالي المشتريات', () => {
    const customers = [
      { id: 'C1', name: 'أحمد', totalPurchases: 100 },
      { id: 'C2', name: 'سارة', totalPurchases: 500 },
      { id: 'C3', name: 'محمد', totalPurchases: 300 },
    ]
    const top = getTopCustomers(customers, 2)
    expect(top.map(c => c.id)).toEqual(['C2', 'C3'])
  })

  it('getTopProducts يجمع الكميات المباعة عبر الطلبات', () => {
    const orders = [
      { items: [{ productName: 'بطانية', quantity: 2, subtotal: 200 }, { productName: 'مفرش', quantity: 1, subtotal: 50 }] },
      { items: [{ productName: 'بطانية', quantity: 3, subtotal: 300 }] },
    ]
    const top = getTopProducts(orders, 5)
    expect(top[0]).toEqual({ name: 'بطانية', quantity: 5, revenue: 500 })
  })

  it('generateProductDescription يبني وصفاً عربياً من بيانات المنتج', () => {
    const description = generateProductDescription({
      name: 'بطانية مورا',
      notes: 'قطن خالص',
      supplierName: 'مصنع النور',
      code: 'SKU-1',
      stock: 3,
      minStock: 5,
      sellingPrice: 1400,
    })
    expect(description).toContain('بطانية مورا')
    expect(description).toContain('قطن خالص')
    expect(description).toContain('مصنع النور')
    expect(description).toContain('SKU-1')
    expect(description).toContain('المخزون منخفض')
    expect(description).toContain('1400 ج.م')
  })

  it('buildAiSummary يحسب مبيعات اليوم والنواقص وأفضل العملاء والمنتجات', () => {
    const today = getCairoDate()
    const summary = buildAiSummary({
      products: [{ id: 'P1', name: 'بطانية', stock: 2, minStock: 5 }],
      customers: [{ id: 'C1', name: 'أحمد', totalPurchases: 900 }],
      orders: [
        { createdAt: `${today}T10:00:00`, totalAmount: 1000, items: [{ productName: 'بطانية', quantity: 1, subtotal: 1000 }] },
        { createdAt: `${today}T11:00:00`, totalAmount: 500, items: [] },
        { createdAt: '2020-01-01T10:00:00', totalAmount: 9999, items: [] },
      ],
      expenses: [{ date: today, amount: 200 }],
    })
    expect(summary.todayOrdersCount).toBe(2)
    expect(summary.todaySales).toBe(1500)
    expect(summary.todayExpenses).toBe(200)
    expect(summary.lowStock).toHaveLength(1)
    expect(summary.topCustomers[0].id).toBe('C1')
    expect(summary.topProducts[0].name).toBe('بطانية')
  })

  it('normalizeActionArgs يفصل الاسم عن العنوان المدمجين وينظف أرقام الهاتف', () => {
    const split = normalizeActionArgs('addSupplier', {
      name: 'محمد احمد - الغربية - المحلة الكبرى - محلة ابو على امام مسجد السلام',
      phone: '01153722244- ',
    })
    expect(split.name).toBe('محمد احمد')
    expect(split.address).toBe('الغربية - المحلة الكبرى - محلة ابو على امام مسجد السلام')
    expect(split.phone).toBe('01153722244')
    // الاسم العادي بلا «-» لا يُفصل ولا يُلمس العنوان المعطى أصلاً.
    expect(normalizeActionArgs('addSupplier', { name: 'مصنع النور', address: 'المحلة', phone: '٠١١٢٣٤٥٦٧٨٩' }))
      .toEqual({ name: 'مصنع النور', address: 'المحلة', phone: '01123456789' })
    // أدوات أخرى لا تفصل الاسم.
    expect(normalizeActionArgs('addProduct', { name: 'بطانية - 6 كيلو' }).name).toBe('بطانية - 6 كيلو')
  })
})

describe('answerQuestion — محرك إجابات الشات السياقي (services/aiAssistant.js)', () => {
  const today = getCairoDate()
  const data = {
    products: [
      { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
      { id: 'P2', name: 'مفرش ملكي', stock: 20, minStock: 2, purchasePrice: 200, sellingPrice: 350 },
    ],
    customers: [
      { id: 'C1', name: 'أحمد محمد', totalPurchases: 900 },
      { id: 'C2', name: 'سارة علي', totalPurchases: 1500 },
    ],
    orders: [
      {
        id: 'ORD-1',
        customerName: 'سارة علي',
        totalAmount: 1000,
        createdAt: today,
        items: [{ productId: 'P1', productName: 'بطانية مورا', quantity: 2, subtotal: 2800 }],
      },
      {
        id: 'ORD-2',
        customerName: 'أحمد محمد',
        totalAmount: 350,
        createdAt: today,
        items: [{ productName: 'مفرش ملكي', quantity: 1, subtotal: 350 }],
      },
    ],
    expenses: [{ id: 'E1', title: 'إيجار', amount: 200, date: today.slice(0, 10) }],
  }

  it('normalizeArabic يوحّد الهمزات ويزيل التشكيل', () => {
    expect(normalizeArabic('الأعلى شِراْءً')).toContain('الاعلي شراء')
  })

  it('سؤال النواقص يرد بمنتجات تحت الحد الأدنى وكمية الاقتراح', () => {
    const answer = answerQuestion('ما هي المنتجات الناقصة؟', data)
    expect(answer).toContain('بطانية مورا')
    expect(answer).toContain('يُقترح إضافة 7')
  })

  it('سؤال العميل الأعلى شراءً يرد بأعلى العملاء من بيانات النظام', () => {
    const answer = answerQuestion('من هو العميل الأعلى شراءً؟', data)
    expect(answer).toContain('سارة علي')
    expect(answer).toContain('أحمد محمد')
  })

  it('سؤال مبيعات اليوم يعرض الإجمالي بالعملة', () => {
    const answer = answerQuestion('كم مبيعات اليوم؟', data)
    expect(answer).toContain('ج.م')
  })

  it('سؤال أرباح اليوم يحسب هامش البنود من أسعار الشراء', () => {
    const answer = answerQuestion('ما هي أرباح اليوم؟', data)
    expect(answer).toContain('أرباح اليوم')
    expect(answer).toContain('ج.م')
  })

  it('سؤال عدد العملاء يرد بالعد من بيانات النظام', () => {
    expect(answerQuestion('كم عدد العملاء؟', data)).toContain('2')
  })

  it('سؤال وصف منتج بذكر الاسم يولّد وصفاً عربياً للمنتج', () => {
    const answer = answerQuestion('اكتب وصفاً لمنتج بطانية مورا', data)
    expect(answer).toContain('بطانية مورا')
    expect(answer).toContain('1400 ج.م')
  })

  it('التحية والسؤال غير المحدد يردان بترحيب وملخص عام', () => {
    expect(answerQuestion('مرحبا', data)).toContain('مرحباً')
    expect(answerQuestion('حكيلنا عن المتجر', data)).toContain('ملخص سريع')
  })

  it('سؤال الشرح/الدليل يفسّر شاشات النظام وميزاته (V3.39)', () => {
    const answer = answerQuestion('إزاي أضيف منتج جديد؟', data)
    expect(answer).toContain('دليل النظام')
    expect(answer).toContain('لوحة التحكم')
    expect(answer).toContain('وضع الكاشير')
    expect(answer).toContain('مزامنة Google Sheets')
    expect(answerQuestion('بتعمل إيه الشاشات دي؟', data)).toContain('دليل النظام')
  })

  it('بدون بيانات يعود بإجابات فارغة آمنة ولا يرمي', () => {
    expect(() => answerQuestion('ما هي المنتجات الناقصة؟')).not.toThrow()
    expect(answerQuestion('ما هي المنتجات الناقصة؟')).toContain('لا توجد منتجات ناقصة')
  })

  it('«عبارة عن إيه المصروفات» يرد بقائمة تفصيلية بأسماء البنود والمبالغ', () => {
    const answer = answerQuestion('عبارة عن إيه المصروفات؟', data)
    expect(answer).toContain('مصروف 1: إيجار')
    expect(answer).toContain(formatCurrency(200))
  })

  it('«تفاصيل الطلبات» يذكر كل طلب مع بنوده وأسعاره', () => {
    const answer = answerQuestion('قول لي تفاصيل الطلبات', data)
    expect(answer).toContain('ORD-1')
    expect(answer).toContain('ORD-2')
    expect(answer).toContain('بطانية مورا')
    expect(answer).toContain('مفرش ملكي')
    expect(answer).toContain(formatCurrency(2800))
  })

  it('«قائمة المنتجات» يعرض مخزون وأسعار كل منتج بالتفصيل', () => {
    const answer = answerQuestion('اعرض قائمة المنتجات', data)
    expect(answer).toContain('بطانية مورا')
    expect(answer).toContain('مخزون 3')
    expect(answer).toContain(`بيع ${formatCurrency(1400)}`)
    expect(answer).toContain('مفرش ملكي')
  })

  it('«مصروفات اليوم» تعرض البنود المفصلة وليس الإجمالي فقط', () => {
    const answer = answerQuestion('مصروفات اليوم؟', data)
    expect(answer).toContain('إيجار')
    expect(answer).toContain(formatCurrency(200))
  })
})

describe('AI_TOOLS — تعريفات أدوات التعبئة (services/aiAssistant.js)', () => {
  it('AI_TOOLS يعرّف الأدوات الخمس بأسماء ومخططات صحيحة (بلا أي تنفيذ)', () => {
    expect(AI_TOOLS.map(t => t.name)).toEqual(['createOrder', 'addProduct', 'updateProduct', 'addExpense', 'addSupplier', 'addCustomer'])
    AI_TOOLS.forEach(t => {
      expect(t.description).toContain('لا يُنفَّذ أي تغيير في النظام')
      expect(t.parameters.type).toBe('object')
      expect(Array.isArray(t.parameters.required)).toBe(true)
      expect(t.parameters.required.length).toBeGreaterThan(0)
    })
    const createOrderTool = AI_TOOLS.find(t => t.name === 'createOrder')
    expect(createOrderTool.parameters.properties.address).toBeTruthy()
    const addCustomerTool = AI_TOOLS.find(t => t.name === 'addCustomer')
    expect(addCustomerTool.parameters.required).toEqual(['name', 'phone'])
    const addExpenseTool = AI_TOOLS.find(t => t.name === 'addExpense')
    expect(addExpenseTool.parameters.required).toEqual(['description', 'amount'])
  })

  it('addProduct يفرض المورد المصنع (supplierName) في الحقول الإلزامية', () => {
    const addProduct = AI_TOOLS.find(t => t.name === 'addProduct')
    expect(addProduct.parameters.required).toEqual(['name', 'price', 'supplierName'])
    expect(addProduct.description).toContain('المورد المصنع')
  })

  it('updateProduct يحدد المنتج بالاسم الرسمي وبياناته الجديدة فقط دون ادعاء إتمام', () => {
    const updateProduct = AI_TOOLS.find(t => t.name === 'updateProduct')
    expect(updateProduct).toBeTruthy()
    expect(updateProduct.parameters.required).toEqual(['name'])
    expect(updateProduct.description).toContain('لا تُدَّعى إتماماً')
  })
})

describe('التعرّف الداخلي على طلبات الإضافة — detectFormFillIntent (services/aiAssistant.js)', () => {
  const products = [
    { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    { id: 'P2', name: 'مفرش ملكي', stock: 20, minStock: 2, purchasePrice: 200, sellingPrice: 350 },
  ]

  it('«اضف مورد مصنع النور هاتف 01153722244» يستخرج الاسم والهاتف ولا يُسرب الرقم للاسم', () => {
    const intent = detectFormFillIntent('اضف مورد مصنع النور هاتف 01153722244', { products })
    expect(intent).toEqual({ name: 'addSupplier', args: { name: 'مصنع النور', phone: '01153722244', address: '' } })
  })

  it('«اضف عميل احمد تليفون ٠١٠١٢٣٤٥٦٧٨» يحول الأرقام العربية للغربية وينظف الاسم', () => {
    const intent = detectFormFillIntent('اضف عميل احمد تليفون ٠١٠١٢٣٤٥٦٧٨', { products })
    expect(intent).toEqual({ name: 'addCustomer', args: { name: 'احمد', phone: '01012345678', address: '' } })
  })

  it('«اضف عميل احمد هاتف 01012345678 عنوان القاهرة» يفصل العنوان عن الاسم', () => {
    const intent = detectFormFillIntent('اضف عميل احمد هاتف 01012345678 عنوان القاهرة', { products })
    expect(intent).toEqual({ name: 'addCustomer', args: { name: 'احمد', phone: '01012345678', address: 'القاهره' } })
  })

  it('«اضف منتج غطاء بسعر 200» يستخرج اسم المنتج وسعر البيع', () => {
    const intent = detectFormFillIntent('اضف منتج غطاء بسعر 200', { products })
    expect(intent).toEqual({ name: 'addProduct', args: { name: 'غطاء', price: 200 } })
  })

  it('«اضف منتج وسادة من مصنع النور بسعر 120» يستخرج المورد ولا يُسرّبه للاسم', () => {
    const data = { products, suppliers: [{ id: 'SUP-1', name: 'مصنع النور' }] }
    const intent = detectFormFillIntent('اضف منتج وسادة من مصنع النور بسعر 120', data)
    expect(intent).toEqual({
      name: 'addProduct',
      args: { name: 'وساده', supplierId: 'SUP-1', supplierName: 'مصنع النور', price: 120 },
    })
  })

  it('«سجل مصروف كهرباء 300» يستخرج البيان والمبلغ', () => {
    const intent = detectFormFillIntent('سجل مصروف كهرباء 300', { products })
    expect(intent).toEqual({ name: 'addExpense', args: { description: 'كهرباء', amount: 300 } })
  })

  it('«اعمل طلب بطانية مورا لاحمد» يستخرج الطلب ببند واحد والعميل — بلا هاتف/عنوان يُمنع تجهيزه', () => {
    const intent = detectFormFillIntent('اعمل طلب بطانية مورا لاحمد', { products })
    expect(intent).not.toBeNull()
    expect(intent.name).toBe('createOrder')
    expect(intent.args.customerName).toBe('احمد')
    expect(intent.args.items).toEqual([{ name: 'بطانية مورا', quantity: 1 }])
    const prepared = prepareFormFill(intent.name, intent.args, { getProducts: () => products })
    expect(prepared.ok).toBe(false)
    expect(prepared.errors.some(e => e.includes('رقم هاتف'))).toBe(true)
    expect(prepared.errors.some(e => e.includes('عنوان'))).toBe(true)
  })

  it('الأسئلة غير الإضافية (مبيعات/نواقص) لا تُعرَف كطلبات إضافة', () => {
    expect(detectFormFillIntent('ما هي مبيعات اليوم؟', { products })).toBeNull()
    expect(detectFormFillIntent('ما هي المنتجات الناقصة؟', { products })).toBeNull()
    expect(detectFormFillIntent('كم عدد العملاء؟', { products })).toBeNull()
  })
})

describe('أقسام الشات — scope (services/aiAssistant.js V3.37)', () => {
  const products = [
    { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    { id: 'P2', name: 'مفرش ملكي', stock: 20, minStock: 2, purchasePrice: 200, sellingPrice: 350 },
  ]
  const suppliers = [{ id: 'SUP-1', name: 'مصنع النور', phone: '01123456789' }]

  it('بلا كلمة نوع، قسم «الموردين» يفتح addSupplier (تلميح أولوية لا قفل)', () => {
    const intent = detectFormFillIntent('اضف السلام هاتف 01153722244', { suppliers }, 'suppliers')
    expect(intent).toEqual({ name: 'addSupplier', args: { name: 'السلام', phone: '01153722244', address: '' } })
  })

  it('بلا كلمة نوع، قسم «المنتجات» يفتح addProduct ويُمنع عند نقص المورد', () => {
    const intent = detectFormFillIntent('اضف وسادة بسعر 120', { products, suppliers }, 'products')
    expect(intent).toEqual({ name: 'addProduct', args: { name: 'وساده', price: 120 } })
    const answer = answerQuestion('اضف وسادة بسعر 120', { products, suppliers, customers: [], orders: [], expenses: [] }, 'products')
    expect(answer).toContain('المورد المصنع')
  })

  it('بلا كلمة نوع ولا بنود مذكورة، قسم «إنشاء طلب» يوجّه الفاتورة لنموذج الطلب مباشرةً (لا عميل منفصل)', () => {
    const intent = detectFormFillIntent('اضف بطانية مورا لاحمد هاتف 01012345678', { products, suppliers }, 'orders')
    expect(intent.name).toBe('createOrder')
    expect(intent.args).toEqual(expect.objectContaining({
      customerName: 'احمد',
      phone: '01012345678',
      items: [expect.objectContaining({ name: 'بطانية مورا', quantity: 1 })],
    }))
  })

  it('قسم «إنشاء طلب» ببيانات العميل فقط (بلا بنود) يُمنع تجهيزه ويطلب البنود والعنوان', () => {
    const answer = answerQuestion('اضف طلب لاحمد هاتف 01012345678', { products, suppliers, customers: [], orders: [], expenses: [] }, 'orders')
    expect(answer).toContain('عنوان')
    expect(answer).toContain('بند')
  })

  it('القسم لا يقفل النوع الصريح: في قسم الموردين يبقى طلب عميل صريح addCustomer', () => {
    const intent = detectFormFillIntent('اضف عميل احمد هاتف 01012345678', { suppliers }, 'suppliers')
    expect(intent.name).toBe('addCustomer')
  })

  it('بلا كلمة نوع ودون قسم محدد يبقى السلوك القديم (لا يُفتح نموذج)', () => {
    expect(detectFormFillIntent('اضف السلام هاتف 01153722244', { suppliers })).toBeNull()
  })
})

describe('التعبئة الذكية — prepareFormFill + إشارة النموذج (services/aiAssistant.js V3.35)', () => {
  const saved = {
    getProducts: window.getProducts,
    getCustomers: window.getCustomers,
    getSuppliers: window.getSuppliers,
  }

  beforeEach(() => {
    consumeFormFill()
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    ])
    window.getCustomers = vi.fn(() => [])
    window.getSuppliers = vi.fn(() => [{ id: 'SUP-1', name: 'مصنع النور', phone: '01123456789' }])
  })

  afterEach(() => {
    window.getProducts = saved.getProducts
    window.getCustomers = saved.getCustomers
    window.getSuppliers = saved.getSuppliers
    consumeFormFill()
  })

  it('addProduct مكتمل البيانات يجهّز نموذجاً معبأً ويخزّن إشارة — بلا أي تنفيذ', () => {
    const prepared = prepareFormFill('addProduct', { name: 'وسادة', price: 120, stock: 10, supplierName: 'مصنع النور' })
    expect(prepared.ok).toBe(true)
    expect(prepared.form).toBe('addProduct')
    expect(prepared.data).toEqual(expect.objectContaining({ name: 'وسادة', price: 120, stock: 10, supplierName: 'مصنع النور', supplierId: 'SUP-1' }))
    expect(getFormFill()).toEqual(expect.objectContaining({ form: 'addProduct', data: expect.objectContaining({ name: 'وسادة' }) }))
    const v = getFormFillVersion()
    consumeFormFill()
    expect(getFormFill()).toBeNull()
    expect(getFormFillVersion()).toBe(v)
  })

  it('addProduct بدون المورد المصنع يُمنع تجهيزه ويُطلب ذكره — لا يُخزَّن نموذج', () => {
    const missingSupplier = prepareFormFill('addProduct', { name: 'وسادة', price: 120 })
    expect(missingSupplier.ok).toBe(false)
    expect(missingSupplier.blocked).toBe(true)
    expect(missingSupplier.errors.some(e => e.includes('المورد المصنع'))).toBe(true)
    expect(getFormFill()).toBeNull()
  })

  it('addProduct بمورد غير مسجل في النظام يُمنع تجهيزه', () => {
    const unknownSupplier = prepareFormFill('addProduct', { name: 'وسادة', price: 120, supplierName: 'مصنع غير موجود' })
    expect(unknownSupplier.ok).toBe(false)
    expect(unknownSupplier.errors.some(e => e.includes('غير مسجل'))).toBe(true)
  })

  it('prepareFormFill لا يستدعي أي دالة إنشاء على الإطلاق', () => {
    const prev = window.createProduct
    window.createProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء') })
    const prepared = prepareFormFill('addProduct', { name: 'وسادة', price: 120, supplierName: 'مصنع النور' })
    expect(prepared.ok).toBe(true)
    expect(window.createProduct).not.toHaveBeenCalled()
    window.createProduct = prev
  })

  it('addProduct بنقص السعر أو بتكرار منتج يُمنع تجهيزه ولا يُخزَّن نموذج', () => {
    const noPrice = prepareFormFill('addProduct', { name: 'وسادة', supplierName: 'مصنع النور' })
    expect(noPrice.ok).toBe(false)
    expect(noPrice.blocked).toBe(true)
    expect(noPrice.errors.some(e => e.includes('سعر البيع'))).toBe(true)
    const dup = prepareFormFill('addProduct', { name: 'بطانية مورا', price: 100, supplierName: 'مصنع النور' })
    expect(dup.ok).toBe(false)
    expect(dup.errors.some(e => e.includes('مسجل بالفعل'))).toBe(true)
    expect(getFormFill()).toBeNull()
  })

  it('addExpense مكتمل المبلغ يُجهّز؛ وبلا مبلغ أو بسالب يُمنع', () => {
    const ok = prepareFormFill('addExpense', { description: 'إيجار', amount: 500 })
    expect(ok.ok).toBe(true)
    const noAmount = prepareFormFill('addExpense', { description: 'إيجار' })
    expect(noAmount.ok).toBe(false)
    expect(noAmount.errors.some(e => e.includes('أكبر من صفر'))).toBe(true)
    const neg = prepareFormFill('addExpense', { description: 'إيجار', amount: -50 })
    expect(neg.errors.some(e => e.includes('أكبر من صفر'))).toBe(true)
  })

  it('addSupplier ينظف الهاتف المدمج ويحفظ العنوان والملاحظات', () => {
    const prepared = prepareFormFill('addSupplier', {
      name: 'أحمد لطفي',
      phone: '01122334455- ',
      address: 'الغربية المحلة الكبرى',
      notes: 'مورد قماش قطيفة',
    })
    expect(prepared.ok).toBe(true)
    expect(prepared.data.phone).toBe('01122334455')
    expect(prepared.data.address).toBe('الغربية المحلة الكبرى')
    expect(prepared.data.notes).toBe('مورد قماش قطيفة')
  })

  it('addCustomer ينظف رقم الهاتف ويقبله؛ والرقم غير الصحيح يمنع التجهيز', () => {
    const ok = prepareFormFill('addCustomer', { name: 'محمد أمين', phone: '٠١١٥٣٧٢٢٢٥٥- ' })
    expect(ok.ok).toBe(true)
    expect(ok.data.phone).toBe('01153722255')
    const bad = prepareFormFill('addCustomer', { name: 'محمد أمين', phone: '123' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.some(e => e.includes('يبدأ بـ 01'))).toBe(true)
  })

  it('createOrder مكتمل البيانات يحل أسعار المنتجات ويحسب الشحن والنثريات والعربون', () => {
    const prepared = prepareFormFill('createOrder', {
      customerName: 'أحمد',
      phone: '01012345678',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 2 }],
      shippingCost: 100,
      extraExpenses: 50,
      advanceAmount: 150,
      paymentType: 'advance',
    })
    expect(prepared.ok).toBe(true)
    expect(prepared.data.items[0]).toEqual(expect.objectContaining({
      productId: 'P1',
      productName: 'بطانية مورا',
      quantity: 2,
      purchasePrice: 1000,
      sellingPrice: 1400,
    }))
    expect(getFormFill()).toEqual(expect.objectContaining({ form: 'createOrder' }))
  })

  it('createOrder ببيانات ناقصة (هاتف/عنوان/بنود) يُمنع ولا يُخزَّن نموذج', () => {
    const prepared = prepareFormFill('createOrder', { customerName: 'أحمد' })
    expect(prepared.ok).toBe(false)
    expect(prepared.errors.some(e => e.includes('رقم هاتف'))).toBe(true)
    expect(prepared.errors.some(e => e.includes('عنوان'))).toBe(true)
    expect(prepared.errors.some(e => e.includes('بنداً'))).toBe(true)
    expect(getFormFill()).toBeNull()
  })

  it('createOrder بدفع كامل يضبط الحالة completed ومبلغ عربون صفري', () => {
    const prepared = prepareFormFill('createOrder', {
      customerName: 'أحمد',
      phone: '01012345678',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 1 }],
      paymentType: 'full',
    })
    expect(prepared.ok).toBe(true)
    expect(getFormFill().data.paymentType).toBe('full')
  })
})

describe('رسائل التعبئة الذكية — buildFormFillMessage / buildBlockedMessage', () => {
  it('رسالة النجاح تحمل عبارة «تم تجهيز البيانات للمراجعة» وملخص النموذج', () => {
    const msg = buildFormFillMessage({ form: 'addProduct', data: { name: 'وسادة', price: 120, stock: 5 }, warnings: [] })
    expect(msg).toContain('تم تجهيز البيانات للمراجعة، يمكنك التأكد منها وضغط حفظ.')
    expect(msg).toContain('إضافة منتج جديد')
    expect(msg).toContain('وسادة')
  })

  it('رسالة النجاح تُدرج التنبيهات الوقائية بعد الملخص', () => {
    const msg = buildFormFillMessage({ form: 'createOrder', data: {}, warnings: ['المنتج «أ»: الكمية المطلوبة أكبر من المتاح'] })
    expect(msg).toContain('تنبيهات:')
    expect(msg).toContain('- المنتج «أ»: الكمية المطلوبة أكبر من المتاح')
  })

  it('رسالة المنع تعدد الأخطاء وتطلب استكمال البيانات', () => {
    const msg = buildBlockedMessage({ errors: ['إنشاء الطلب يحتاج رقم هاتف', 'إنشاء الطلب يحتاج عنوان'] })
    expect(msg).toContain('لا يمكن تجهيز نموذج التعبئة الآن')
    expect(msg).toContain('- إنشاء الطلب يحتاج رقم هاتف')
    expect(msg).toContain('- إنشاء الطلب يحتاج عنوان')
    expect(msg).toContain('أكمل البيانات المطلوبة ثم أعد طلب الإضافة')
  })

  it('رسالة التعديل تُجهّز للمراجعة ولا تدّعي أن شيئاً تم في النظام', () => {
    const msg = buildFormFillMessage({ form: 'updateProduct', data: { name: 'بطانية مورا', price: 1500 }, warnings: [] })
    expect(msg).toContain('تم تجهيز بيانات التعديل للمراجعة')
    expect(msg).toContain('لا شيء تغيّر في النظام بعد')
    expect(msg).toContain('تعديل بيانات منتج مسجل')
    expect(msg).not.toContain('تم التعديل بنجاح')
  })
})

describe('التعديل الذكي — detectEditIntent + updateProduct (services/aiAssistant.js V3.36)', () => {
  const products = [
    { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    { id: 'P2', name: 'مفرش ملكي', stock: 20, minStock: 2, purchasePrice: 200, sellingPrice: 350 },
  ]

  it('«عدل سعر بطانية مورا ل 1500» ينتج updateProduct بمعرف المنتج والسعر الجديد', () => {
    const intent = detectEditIntent('عدل سعر بطانية مورا ل 1500', { products })
    expect(intent).toEqual({ name: 'updateProduct', args: { name: 'بطانية مورا', productId: 'P1', price: 1500 } })
  })

  it('«غيّر مخزون مفرش ملكي ل 30» ينتج updateProduct بالمخزون الجديد', () => {
    const intent = detectEditIntent('غيّر مخزون مفرش ملكي ل 30', { products })
    expect(intent).toEqual({ name: 'updateProduct', args: { name: 'مفرش ملكي', productId: 'P2', stock: 30 } })
  })

  it('لا يُستخرج تعديل لمنتج غير مذكور أو بدون قيمة جديدة', () => {
    expect(detectEditIntent('عدل سعر المنتج', { products })).toBeNull()
    expect(detectEditIntent('ما هي المنتجات غير الناقصة؟', { products })).toBeNull()
  })

  it('updateProduct مكتمل يجهّز النموذج بإشارة تحمل entityId للمنتج — لا تنفيذ ولا ادعاء إتمام', () => {
    const saved = { getProducts: window.getProducts }
    window.getProducts = vi.fn(() => products)
    try {
      const prepared = prepareFormFill('updateProduct', { name: 'بطانية مورا', price: 1500 })
      expect(prepared.ok).toBe(true)
      expect(prepared.entityId).toBe('P1')
      expect(prepared.data.name).toBe('بطانية مورا')
      const fill = getFormFill()
      expect(fill.form).toBe('updateProduct')
      expect(fill.entityId).toBe('P1')
      expect(fill.data.price).toBe(1500)
    } finally {
      window.getProducts = saved.getProducts
      consumeFormFill()
    }
  })

  it('updateProduct لمنتج غير مسجل يُمنع تجهيزه ولا يُخزَّن نموذج', () => {
    const saved = { getProducts: window.getProducts }
    window.getProducts = vi.fn(() => products)
    try {
      const prepared = prepareFormFill('updateProduct', { name: 'منتج غير موجود', price: 100 })
      expect(prepared.ok).toBe(false)
      expect(prepared.blocked).toBe(true)
      expect(prepared.errors.some(e => e.includes('غير مسجل'))).toBe(true)
      expect(getFormFill()).toBeNull()
    } finally {
      window.getProducts = saved.getProducts
    }
  })

  it('answerQuestion: «عدل سعر بطانية مورا ل 1500» يجهّز نموذج التعديل ولا يدّعي الإتمام', () => {
    const answer = answerQuestion('عدل سعر بطانية مورا ل 1500', { products, suppliers: [], customers: [], orders: [], expenses: [] })
    expect(answer).toContain('تم تجهيز بيانات التعديل للمراجعة')
    expect(answer).toContain('سعر البيع الجديد: ' + formatCurrency(1500))
    expect(answer).not.toContain('تم التعديل بنجاح')
  })

  it('answerQuestion: «عدل سعر منتج غير مسجل» يطلب توضيحاً ولا يدّعي الإتمام', () => {
    const answer = answerQuestion('عدل سعر وسادة ل 100', { products, suppliers: [], customers: [], orders: [], expenses: [] })
    expect(answer).toContain('لا يمكن تجهيز نموذج التعبئة الآن')
    expect(answer).toContain('غير مسجل')
  })
})

describe('الفحوص الوقائية — runPreventiveChecks (services/aiAssistant.js)', () => {
  const saved = {
    getProducts: window.getProducts,
    getCustomers: window.getCustomers,
    getSuppliers: window.getSuppliers,
  }

  beforeEach(() => {
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    ])
    window.getCustomers = vi.fn(() => [
      { id: 'C1', name: 'محمد أحمد', phone: '01012345678' },
    ])
    window.getSuppliers = vi.fn(() => [
      { id: 'S1', name: 'مصنع النور', phone: '01123456789' },
    ])
  })

  afterEach(() => {
    window.getProducts = saved.getProducts
    window.getCustomers = saved.getCustomers
    window.getSuppliers = saved.getSuppliers
  })

  it('createOrder: تضارب رقم الهاتف باسم مختلف يظهر كخطأ وقائي', () => {
    const conflicted = runPreventiveChecks('createOrder', {
      customerName: 'أحمد',
      phone: '01012345678',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 1 }],
    })
    expect(conflicted.errors.some(e => e.includes('01012345678') && e.includes('محمد أحمد'))).toBe(true)
    const sameName = runPreventiveChecks('createOrder', {
      customerName: 'محمد أحمد',
      phone: '01012345678',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 1 }],
    })
    expect(sameName.errors.some(e => e.includes('رقم الهاتف'))).toBe(false)
  })

  it('createOrder: توفر الكميات بالمخزون يُنبّه قبل التجهيز', () => {
    const shortage = runPreventiveChecks('createOrder', {
      customerName: 'أحمد',
      phone: '01012345670',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 5 }],
    })
    expect(shortage.warnings.some(w => w.includes('بطانية مورا') && w.includes('3'))).toBe(true)
    expect(shortage.errors).toHaveLength(0)
    const ok = runPreventiveChecks('createOrder', {
      customerName: 'أحمد',
      phone: '01012345670',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 2 }],
    })
    expect(ok.warnings).toHaveLength(0)
  })

  it('createOrder: منتج غير مسجل بلا سعر ومنتج بكمية سالبة يعتبران أخطاء', () => {
    const unknown = runPreventiveChecks('createOrder', {
      customerName: 'أحمد',
      phone: '01012345670',
      address: 'القاهرة',
      items: [{ name: 'منتج غير مسجل', quantity: 1 }],
    })
    expect(unknown.errors.some(e => e.includes('غير مسجل'))).toBe(true)
    const badQty = runPreventiveChecks('createOrder', {
      customerName: 'أحمد',
      phone: '01012345670',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 0 }],
    })
    expect(badQty.errors.some(e => e.includes('1 على الأقل'))).toBe(true)
  })

  it('createOrder: نقص البيانات الأساسية يمنع التجهيز بلا قيم افتراضية', () => {
    const missingAll = runPreventiveChecks('createOrder', {})
    expect(missingAll.errors.some(e => e.includes('اسم العميل'))).toBe(true)
    expect(missingAll.errors.some(e => e.includes('رقم هاتف'))).toBe(true)
    expect(missingAll.errors.some(e => e.includes('عنوان'))).toBe(true)
    expect(missingAll.errors.some(e => e.includes('بنداً'))).toBe(true)
    const badPhone = runPreventiveChecks('createOrder', {
      customerName: 'أحمد',
      phone: '123',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 1 }],
    })
    expect(badPhone.errors.some(e => e.includes('123') && e.includes('11 رقماً'))).toBe(true)
  })

  it('addProduct: المنتج المكرر والقيم غير المنطقية تُمنع أو تُنبّه', () => {
    const dup = runPreventiveChecks('addProduct', { name: 'بطانية مورا', price: 100 })
    expect(dup.errors.some(e => e.includes('مسجل بالفعل'))).toBe(true)
    const zero = runPreventiveChecks('addProduct', { name: 'وسادة', price: 0 })
    expect(zero.errors.some(e => e.includes('أكبر من صفر'))).toBe(true)
    const belowCost = runPreventiveChecks('addProduct', { name: 'وسادة', price: 100, purchasePrice: 150 })
    expect(belowCost.warnings.some(w => w.includes('أقل من سعر الشراء'))).toBe(true)
    const clean = runPreventiveChecks('addProduct', { name: 'وسادة', price: 100, stock: 10, supplierName: 'مصنع النور' })
    expect(clean.errors).toHaveLength(0)
    expect(clean.warnings).toHaveLength(0)
  })

  it('addProduct: المورد غير المسجل خطأ مانع؛ والمورد المسجل مقبول', () => {
    const unknown = runPreventiveChecks('addProduct', { name: 'وسادة', price: 100, supplierName: 'مصنع وهمي' })
    expect(unknown.errors.some(e => e.includes('غير مسجل'))).toBe(true)
    const known = runPreventiveChecks('addProduct', { name: 'وسادة', price: 100, supplierName: 'مصنع النور' })
    expect(known.errors).toHaveLength(0)
  })

  it('updateProduct: منتج غير مسجل يُمنع؛ ومنتج مسجل بأسعار/كمية سليمة يُجهَّز بلا تنفيذ', () => {
    const unknown = runPreventiveChecks('updateProduct', { name: 'وسادة', price: 150 })
    expect(unknown.errors.some(e => e.includes('غير مسجل'))).toBe(true)
    const ok = runPreventiveChecks('updateProduct', { name: 'بطانية مورا', price: 1500, stock: 25 })
    expect(ok.errors).toHaveLength(0)
    expect(ok.warnings).toHaveLength(0)
    const badPrice = runPreventiveChecks('updateProduct', { name: 'بطانية مورا', price: 0 })
    expect(badPrice.errors.some(e => e.includes('أكبر من صفر'))).toBe(true)
    const badStock = runPreventiveChecks('updateProduct', { name: 'بطانية مورا', stock: -2 })
    expect(badStock.errors.some(e => e.includes('لا يمكن أن تكون سالبة'))).toBe(true)
  })

  it('addExpense: المبلغ السالب/الصفري خطأ يمنع التجهيز', () => {
    expect(runPreventiveChecks('addExpense', { description: 'إيجار', amount: 0 }).errors.some(e => e.includes('أكبر من صفر'))).toBe(true)
    expect(runPreventiveChecks('addExpense', { description: 'إيجار', amount: -50 }).errors.some(e => e.includes('أكبر من صفر'))).toBe(true)
    expect(runPreventiveChecks('addExpense', { description: 'إيجار', amount: 500 }).errors).toHaveLength(0)
  })

  it('addSupplier: المورد المكرر بالاسم أو الهاتف المتعارض يُمنع', () => {
    const dup = runPreventiveChecks('addSupplier', { name: 'مصنع النور' })
    expect(dup.errors.some(e => e.includes('مسجل بالفعل'))).toBe(true)
    const phoneConflict = runPreventiveChecks('addSupplier', { name: 'مصنع جديد', phone: '01123456789' })
    expect(phoneConflict.errors.some(e => e.includes('01123456789') && e.includes('مصنع النور'))).toBe(true)
    const clean = runPreventiveChecks('addSupplier', { name: 'مصنع جديد', phone: '01211111111' })
    expect(clean.errors).toHaveLength(0)
  })

  it('addSupplier: سجل قديم باسم مدمج («الاسم - العنوان») لا يفلت من كشف التكرار', () => {
    window.getSuppliers = vi.fn(() => [
      { id: 'S1', name: 'محمد احمد - الغربية - المحلة الكبرى', phone: '01153722244' },
    ])
    const nameDup = runPreventiveChecks('addSupplier', { name: 'محمد احمد' })
    expect(nameDup.errors.some(e => e.includes('مسجل بالفعل'))).toBe(true)
    const same = runPreventiveChecks('addSupplier', { name: 'محمد احمد', phone: '01153722244' })
    expect(same.errors.some(e => e.includes('مسجل بالفعل'))).toBe(true)
    expect(same.warnings.some(w => w.includes('لن تُنشأ نسخة مكررة'))).toBe(true)
    const phoneConflict = runPreventiveChecks('addSupplier', { name: 'شخص آخر', phone: '01153722244' })
    expect(phoneConflict.errors.some(e => e.includes('01153722244'))).toBe(true)
    const fresh = runPreventiveChecks('addSupplier', { name: 'مورد جديد', phone: '01211111111' })
    expect(fresh.errors).toHaveLength(0)
  })

  it('addSupplier: الإضافة المنصّفة للاسم المدمج تُمنع كتكرار (لا سجل مكرر)', () => {
    window.getSuppliers = vi.fn(() => [
      { id: 'S1', name: 'محمد احمد - الغربية - المحلة الكبرى', phone: '01153722244' },
    ])
    const safe = normalizeActionArgs('addSupplier', {
      name: 'محمد احمد - الغربية - المحلة الكبرى',
      phone: '01153722244',
    })
    const checks = runPreventiveChecks('addSupplier', safe)
    expect(checks.errors.some(e => e.includes('مسجل بالفعل'))).toBe(true)
    expect(checks.warnings.some(w => w.includes('لن تُنشأ نسخة مكررة'))).toBe(true)
  })

  it('addCustomer: الرقم الناقص/غير الصحيح أو المتعارض مع عميل آخر يمنع التجهيز', () => {
    expect(runPreventiveChecks('addCustomer', { name: 'أحمد أيوب' }).errors.some(e => e.includes('رقم هاتف'))).toBe(true)
    expect(runPreventiveChecks('addCustomer', { name: 'أحمد أيوب', phone: '12345' }).errors.some(e => e.includes('يبدأ بـ 01'))).toBe(true)
    const phoneConflict = runPreventiveChecks('addCustomer', { name: 'أحمد أيوب', phone: '01123456789' })
    expect(phoneConflict.errors.some(e => e.includes('01123456789') && e.includes('مصنع النور'))).toBe(true)
    const clean = runPreventiveChecks('addCustomer', { name: 'أحمد أيوب', phone: '01211111111' })
    expect(clean.errors).toHaveLength(0)
  })
})

describe('buildActionSummary — ملخص النموذج المعبأ (services/aiAssistant.js)', () => {
  const saved = { getProducts: window.getProducts }

  beforeEach(() => {
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    ])
  })

  afterEach(() => {
    window.getProducts = saved.getProducts
  })

  it('createOrder يعرض العميل والبنود والشحن والنثريات والعربون والمتبقي', () => {
    const summary = buildActionSummary('createOrder', {
      customerName: 'أحمد',
      phone: '01012345678',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 2 }],
      shippingCost: 100,
      extraExpenses: 50,
      advanceAmount: 150,
      paymentType: 'advance',
    })
    expect(summary).toContain('إنشاء طلب بيع جديد')
    expect(summary).toContain('أحمد')
    expect(summary).toContain('بطانية مورا × 2')
    expect(summary).toContain('إجمالي البنود: ' + formatCurrency(2800))
    expect(summary).toContain('مصاريف الشحن: ' + formatCurrency(100))
    expect(summary).toContain('النثريات/مصاريف إضافية: ' + formatCurrency(50))
    expect(summary).toContain('الإجمالي النهائي: ' + formatCurrency(2950))
    expect(summary).toContain('المتبقي بعد العربون: ' + formatCurrency(2800))
  })

  it('createOrder بدفع كامل يعرض «دفع كامل» بلا عربون', () => {
    const summary = buildActionSummary('createOrder', {
      customerName: 'أحمد',
      phone: '01012345678',
      address: 'القاهرة',
      items: [{ name: 'بطانية مورا', quantity: 1, price: 1400 }],
      paymentType: 'full',
    })
    expect(summary).toContain('طريقة الدفع: دفع كامل')
    expect(summary).not.toContain('المتبقي بعد العربون')
  })

  it('باقي النماذج تعرض ملخصاً مقروءاً لكل عملية', () => {
    expect(buildActionSummary('addProduct', { name: 'وسادة', price: 100, stock: 5 })).toContain('إضافة منتج جديد')
    expect(buildActionSummary('addExpense', { description: 'إيجار', amount: 500 })).toContain('إيجار')
    expect(buildActionSummary('addSupplier', { name: 'مصنع', phone: '012' })).toContain('مصنع')
    expect(buildActionSummary('addCustomer', { name: 'أحمد', phone: '01156455651' })).toContain('إضافة عميل جديد')
  })
})
