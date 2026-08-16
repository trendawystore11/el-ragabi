import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getAiConfig,
  saveAiConfig,
  hasAiProvider,
  testAiProviderConnection,
  buildContextForPrompt,
  askAiProvider,
  scopeLabel,
  DEFAULT_GEMINI_MODEL,
  redactPhoneNumber,
  redactAddress,
} from '@/services/aiProvider'
import { getFormFill, consumeFormFill } from '@/services/aiAssistant'

describe('services/aiProvider.js — إعدادات مزوّد الـ AI', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete globalThis.fetch
  })

  it('redactPhoneNumber ينظّف ويقنّع أرقام الهواتف لحماية الخصوصية (Finding H5)', () => {
    expect(redactPhoneNumber('01012345678')).toBe('010****5678')
    expect(redactPhoneNumber('01122334455')).toBe('011****4455')
    expect(redactPhoneNumber('01234')).toBe('01****34')
    expect(redactPhoneNumber('')).toBe('')
  })

  it('redactAddress يزيل/يقنّع أرقام العمارات والشقق المحتملة لحماية الخصوصية (Finding H5)', () => {
    expect(redactAddress('12 شارع النصر شقة 4')).toBe('** شارع النصر شقة **')
    expect(redactAddress('الغربية المحلة الكبرى')).toBe('الغربية المحلة الكبرى')
    expect(redactAddress('')).toBe('')
  })

  it('مفتاح VITE_GEMINI_API_KEY من البيئة يُستخدم كاحتياط عند غياب الإعدادات المحفوظة', () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'env-secret-key')
    const cfg = getAiConfig()
    expect(cfg.apiKey).toBe('env-secret-key')
    expect(cfg.provider).toBe('gemini')
    expect(cfg.model).toBe(DEFAULT_GEMINI_MODEL)
  })

  it(`القيمة الافتراضية لاسم النموذج هي ${DEFAULT_GEMINI_MODEL} تلقائياً عند فراغ الحقل`, () => {
    const cfg = getAiConfig()
    expect(cfg.provider).toBe('gemini')
    expect(cfg.model).toBe(DEFAULT_GEMINI_MODEL)
  })

  it('حقل النموذج الذي يحوي النص «Google Gemini» يُطبع تلقائياً إلى النموذج الافتراضي', () => {
    saveAiConfig({ provider: 'gemini', apiKey: 'GKEY', model: 'Google Gemini' })
    const cfg = getAiConfig()
    expect(cfg.model).toBe(DEFAULT_GEMINI_MODEL)
  })

  it('مفتاح API يُنظَّف من الفراغات الزائدة قبل الحفظ والقراءة', () => {
    saveAiConfig({ provider: 'gemini', apiKey: '   AIza-SECRET   ', model: '' })
    const saved = JSON.parse(window.localStorage.getItem('bms_trendawy_ai_config'))
    expect(saved.apiKey).toBe('AIza-SECRET')
    expect(getAiConfig().apiKey).toBe('AIza-SECRET')
  })

  it('المفتاح الفارغ يمنع الاختبار قبل أي استدعاء شبكة (يعيد سبباً واضحاً)', async () => {
    const result = await testAiProviderConnection({ provider: 'gemini', apiKey: '', model: '' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('أضف مفتاح API أولاً')
  })

  it('testAiProviderConnection ينظف المفتاح ويطبع النموذج قبل إرسال الطلب', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const result = await testAiProviderConnection({
      provider: 'gemini',
      apiKey: '   GOODKEY   ',
      model: 'Google Gemini',
    })
    expect(result.ok).toBe(true)
    const calledUrl = globalThis.fetch.mock.calls[0][0]
    expect(calledUrl).toContain('?key=GOODKEY')
    expect(calledUrl).toContain(`${DEFAULT_GEMINI_MODEL}:generateContent`)
  })

  it('فشل الاتصال يعيد سبباً واضحاً حسب رمز الحالة (نموذج غير متاح)', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }))
    const result = await testAiProviderConnection({
      provider: 'gemini',
      apiKey: 'KEY',
      model: 'gemini-1.5-flash',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('النموذج غير متاح')
  })

  it('الإعدادات المحفوظة في localStorage تتفوق على مفتاح البيئة', () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'env-secret-key')
    saveAiConfig({ provider: 'openai', apiKey: 'local-key', model: 'gpt-4o' })
    const cfg = getAiConfig()
    expect(cfg.apiKey).toBe('local-key')
    expect(cfg.provider).toBe('openai')
    expect(cfg.model).toBe('gpt-4o')
  })

  it('بدون مفتاح محفوظ أو بيئة لا يوجد مزوّد جاهز', () => {
    expect(hasAiProvider(getAiConfig())).toBe(false)
  })

  it('buildContextForPrompt يبعث القوائم الكاملة (منتجات/عملاء/مصروفات/طلبات/موردين) مع تقنيع أرقام الهواتف (Finding H5)', () => {
    const context = buildContextForPrompt({
      products: [{ id: 'P1', name: 'بطانية مورا', code: 'SKU-1', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400, supplierName: 'مصنع النور' }],
      customers: [{ id: 'C1', name: 'أحمد محمد', phone: '01012345678', category: 'تجزئة', totalPurchases: 900, balance: 300 }],
      suppliers: [{ id: 'S1', name: 'مصنع النور', phone: '01123456789' }, { id: 'S2', name: 'مورد بلا رقم' }],
      expenses: [
        { id: 'E1', title: 'إيجار', category: 'إيجارات', amount: 300, notes: 'شهري' },
        { id: 'E2', title: 'كهرباء', category: 'خدمات', amount: 200 },
      ],
      orders: [
        { id: 'ORD-1', customerName: 'أحمد محمد', status: 'completed', totalAmount: 1400, downPayment: 1400, items: [{ productName: 'بطانية مورا', quantity: 1, sellingPrice: 1400, subtotal: 1400 }] },
      ],
    })
    expect(context).toContain('إيجار (إيجارات)')
    expect(context).toContain('300 ج.م')
    expect(context).toContain('كهرباء (خدمات)')
    expect(context).toContain('200 ج.م')
    expect(context).toContain('بطانية مورا')
    expect(context).toContain('كود SKU-1')
    expect(context).toContain('مصنع النور')
    expect(context).toContain('أحمد محمد')
    expect(context).toContain('ORD-1')
    expect(context).toContain('«بطانية مورا» × 1 بسعر 1400 = 1400 ج.م')
    expect(context).toContain('قائمة الموردين كاملة (2)')
    expect(context).toContain('مصنع النور — هاتف 011****6789')
    expect(buildContextForPrompt({ suppliers: [{ name: 'أحمد لطفي', phone: '01122334455', address: 'الغربية المحلة الكبرى' }] }))
      .toContain('أحمد لطفي — هاتف 011****4455 — عنوان: الغربية المحلة الكبرى')
    expect(buildContextForPrompt({ products: [{ name: 'ملاية سرير' }] })).toContain('بلا مورد مسجل')
    expect(context).toContain('عبارة عن إيه')
    expect(context).toContain('مصروف 1: إيجار - 300 ج.م')
    expect(context).toContain('قائمة المصروفات كاملة')
  })


  it('buildContextForPrompt يحوي تعليمات التعبئة الذكية V3.35 (لا تنفيذ، عبارة المراجعة، «هل اتسجّل»)', () => {
    const context = buildContextForPrompt({ products: [], customers: [], orders: [], expenses: [], suppliers: [] })
    expect(context).toContain('تم تجهيز البيانات للمراجعة')
    expect(context).toContain('functionCall')
    expect(context).toContain('لا تنفّذ أنت أي شيء إطلاقاً')
    expect(context).toContain('initialData')
    expect(context).toContain('هل اتسجّل')
    expect(context).toContain('11 رقماً تبدأ بـ 01')
    expect(context).toContain('الاسم منفصل تماماً عن العنوان')
  })

  it('buildContextForPrompt يعمل ببيانات فارغة بأمان', () => {
    const context = buildContextForPrompt()
    expect(context).toContain('قائمة المنتجات كاملة (0)')
    expect(context).toContain('قائمة الطلبات كاملة (0)')
    expect(context).toContain('قائمة الموردين كاملة (0)')
  })
})

describe('التعبئة الذكية عبر المزوّد (services/aiProvider.js — V3.35)', () => {
  const cfg = { provider: 'gemini', apiKey: 'KEY', model: 'gemini-1.5-flash' }
  const saved = {
    getProducts: window.getProducts,
    getCustomers: window.getCustomers,
    getSuppliers: window.getSuppliers,
    createProduct: window.createProduct,
    createOrder: window.createOrder,
  }

  beforeEach(() => {
    consumeFormFill()
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    ])
    window.getCustomers = vi.fn(() => [])
    window.getSuppliers = vi.fn(() => [{ id: 'SUP-1', name: 'مصنع النور', phone: '01123456789' }])
    window.createProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    window.createOrder = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
  })

  afterEach(() => {
    window.getProducts = saved.getProducts
    window.getCustomers = saved.getCustomers
    window.getSuppliers = saved.getSuppliers
    window.createProduct = saved.createProduct
    window.createOrder = saved.createOrder
    consumeFormFill()
    delete globalThis.fetch
  })

  it('functionCall ناجح يجهّز نموذجاً معبأً ويخزّن إشارة — لا تنفيذ ولا تأكيد', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ functionCall: { name: 'addProduct', args: { name: 'وسادة', price: 120, stock: 10, supplierName: 'مصنع النور' } } }] } }],
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'تم تجهيز البيانات للمراجعة، يمكنك التأكد منها وضغط حفظ.' }] } }],
        }),
      }))

    const reply = await askAiProvider(cfg, 'أضف منتج وسادة بسعر 120', '')
    expect(reply).toContain('تم تجهيز البيانات للمراجعة')
    expect(window.createProduct).not.toHaveBeenCalled()
    const fill = getFormFill()
    expect(fill).not.toBeNull()
    expect(fill.form).toBe('addProduct')
    expect(fill.data).toEqual(expect.objectContaining({ name: 'وسادة', price: 120, stock: 10 }))
    // الجولة الثانية حملت functionResponse بنتيجة التجهيز (ok:true) بلا needsConfirmation.
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body)
    const respPart = body.contents.flatMap(c => c.parts).find(p => p.functionResponse && p.functionResponse.response)
    expect(respPart.functionResponse.name).toBe('addProduct')
    expect(respPart.functionResponse.response.ok).toBe(true)
    expect(respPart.functionResponse.response.blocked).toBe(false)
    expect(respPart.functionResponse.response.needsConfirmation).toBeUndefined()
  })

  it('functionCall ناقص البيانات يُعرض كطلب استكمال ولا يُخزَّن نموذج ولا يُنفَّذ', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ functionCall: { name: 'addProduct', args: { name: 'وسادة' } } }] } }],
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'محتاج سعر البيع' }] } }],
        }),
      }))

    const reply = await askAiProvider(cfg, 'أضف منتج وسادة', '')
    expect(reply).toContain('محتاج سعر البيع')
    expect(getFormFill()).toBeNull()
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body)
    const respPart = body.contents.flatMap(c => c.parts).find(p => p.functionResponse && p.functionResponse.response)
    expect(respPart.functionResponse.response.ok).toBe(false)
    expect(respPart.functionResponse.response.blocked).toBe(true)
    expect(respPart.functionResponse.response.errors.some(e => e.includes('سعر البيع'))).toBe(true)
  })

  it('functionCall updateProduct يخزّن إشارة تعديل بإشارة entityId — لا تنفيذ ولا ادعاء إتمام', async () => {
    const prevUpdateProduct = window.updateProduct
    window.updateProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي تحديث من المساعد') })
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ functionCall: { name: 'updateProduct', args: { name: 'بطانية مورا', price: 1500 } } }] } }],
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'تم تجهيز بيانات التعديل للمراجعة' }] } }],
        }),
      }))

    const reply = await askAiProvider(cfg, 'عدل سعر بطانية مورا ل 1500', '')
    expect(reply).toContain('تم تجهيز بيانات التعديل للمراجعة')
    expect(window.updateProduct).not.toHaveBeenCalled()
    const fill = getFormFill()
    expect(fill.form).toBe('updateProduct')
    expect(fill.entityId).toBe('P1')
    expect(fill.data).toEqual(expect.objectContaining({ name: 'بطانية مورا', price: 1500 }))
    window.updateProduct = prevUpdateProduct
  })

  it('createOrder ببيانات ناقصة يُحظر تجهيزه ويُطلب استكمال الهاتف والعنوان — لا تنفيذ', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ functionCall: { name: 'createOrder', args: { customerName: 'أحمد', items: [{ name: 'بطانية مورا', quantity: 1 }] } } }] } }],
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'لتكملة الطلب بشكل صحيح، أرسل العنوان ورقم الهاتف' }] } }],
        }),
      }))

    const reply = await askAiProvider(cfg, 'اعمل طلب بطانية مورا لأحمد', '')
    expect(reply).toContain('لتكملة الطلب')
    expect(window.createOrder).not.toHaveBeenCalled()
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body)
    const resp = body.contents.flatMap(c => c.parts).find(p => p.functionResponse && p.functionResponse.response).functionResponse.response
    expect(resp.blocked).toBe(true)
    expect(resp.errors.some(e => e.includes('عنوان'))).toBe(true)
    expect(resp.errors.some(e => e.includes('رقم هاتف'))).toBe(true)
  })

  it('createOrder مكتمل البيانات يجهّز النموذج بحل الأسعار المالية بلا أي إنشاء', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ functionCall: { name: 'createOrder', args: { customerName: 'أحمد', phone: '01012345678', address: 'القاهرة', items: [{ name: 'بطانية مورا', quantity: 2 }], shippingCost: 100, extraExpenses: 50, depositType: 'shipping_extra' } } }] } }],
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'تم تجهيز البيانات للمراجعة' }] } }],
        }),
      }))

    const reply = await askAiProvider(cfg, 'اعمل طلب بطانية مورا لأحمد مع شحن 100 ونثريات 50', '')
    expect(reply).toBeTruthy()
    expect(window.createOrder).not.toHaveBeenCalled()
    const fill = getFormFill()
    expect(fill.form).toBe('createOrder')
    expect(fill.data.items[0]).toEqual(expect.objectContaining({
      productId: 'P1',
      productName: 'بطانية مورا',
      quantity: 2,
      sellingPrice: 1400,
      purchasePrice: 1000,
    }))
    expect(fill.data.shippingCost).toBe(100)
    expect(fill.data.extraExpenses).toBe(50)
  })

  it('المزوّد يُكرر نفس functionCall بلا نص — لا حلقة، تُسلَّم رسالة التجهيز ويُخزَّن النموذج', async () => {
    const orderCall = {
      name: 'createOrder',
      args: {
        customerName: 'أحمد',
        phone: '01153722266',
        address: 'القاهرة مدينة نصر',
        items: [{ name: 'بطانية مورا', quantity: 1 }],
        paymentType: 'full',
      },
    }
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ functionCall: orderCall }] } }] }),
    }))

    const reply = await askAiProvider(cfg, 'اعمل طلب بطانية مورا لأحمد', '')
    expect(reply).toBeTruthy()
    expect(String(reply)).toContain('تم تجهيز البيانات للمراجعة، يمكنك التأكد منها وضغط حفظ.')
    expect(String(reply)).toContain('١٬٤٠٠ ج.م')
    expect(globalThis.fetch.mock.calls.length).toBeLessThanOrEqual(6)
    expect(window.createOrder).not.toHaveBeenCalled()
    expect(getFormFill()).not.toBeNull()
  })

  it('V3.34: سجل المحادثة السابق يُرسل للمزوّد قبل السؤال الحالي (ذاكرة لا يُنساها)', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'رد' }] } }] }) })
    )
    await askAiProvider(cfg, 'سعر البيع 100', '', {
      history: [
        { role: 'user', text: 'أضف منتج ملاية بيضة' },
        { role: 'assistant', text: 'محتاج سعر البيع' },
      ],
    })
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    const texts = body.contents.map(c => c.parts.map(p => p.text || '').join(''))
    expect(texts[0]).toContain('أضف منتج ملاية بيضة')
    expect(texts[1]).toContain('محتاج سعر البيع')
    expect(texts[texts.length - 1]).toContain('سؤال المستخدم: سعر البيع 100')
  })

  it('V3.38: تسميات الأقسام النهائية — «إنشاء طلب» بدل «التقارير والمالية»', () => {
    expect(scopeLabel('general')).toBe('عام / الشامل')
    expect(scopeLabel('products')).toBe('المنتجات')
    expect(scopeLabel('suppliers')).toBe('الموردين')
    expect(scopeLabel('customers')).toBe('العملاء')
    expect(scopeLabel('orders')).toBe('إنشاء الطلبات والفواتير')
    expect(scopeLabel('reports')).toBe('عام / الشامل')
    expect(scopeLabel()).toBe('عام / الشامل')
  })

  it('V3.38: سياق قسم «إنشاء طلب» يُوجّه المزوّد لنموذج الطلب بلا شاشة عميل منفصلة', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'رد' }] } }] }) })
    )
    const cfg = { provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' }
    await askAiProvider(cfg, 'اعمل طلب لاحمد', '', { history: [], scope: 'orders' })
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    const userText = body.contents[body.contents.length - 1].parts.map(p => p.text || '').join('')
    expect(userText).toContain('إنشاء الطلبات والفواتير')
    expect(userText).toContain('تعرض نموذج إضافة عميل')
    expect(userText).toContain('createOrder')
  })

  it('V3.38: سياق المحادثة يحوي دليل الإلزامية لكل نموذج (إلزامي/اختياري بدقة)', () => {
    const ctx = buildContextForPrompt({ products: [], customers: [], orders: [], expenses: [], suppliers: [] })
    expect(ctx).toContain('دليل الإلزامية لكل نموذج')
    expect(ctx).toContain('createOrder (إنشاء طلب): إلزامي: اسم العميل')
    expect(ctx).toContain('addCustomer (إضافة عميل): إلزامي: الاسم، رقم الهاتف (11 رقماً يبدأ بـ 01). اختياري: العنوان')
    expect(ctx).toContain('addProduct (إضافة منتج): إلزامي: الاسم، سعر البيع')
  })

  it('V3.39: السياق يحوي دليل النظام الكامل لشرح أي شاشة/ميزة لا يعرفها المستخدم', () => {
    const ctx = buildContextForPrompt({ products: [], customers: [], orders: [], expenses: [], suppliers: [] })
    expect(ctx).toContain('دليل النظام الكامل')
    expect(ctx).toContain('لوحة التحكم')
    expect(ctx).toContain('سجل الطلبات')
    expect(ctx).toContain('وضع الكاشير')
    expect(ctx).toContain('مزامنة Google Sheets')
    expect(ctx).toContain('وضع الاختبار')
    expect(ctx).toContain('غير موجودة في النظام')
  })
})

describe('services/aiProvider.js — V3.62 Finding H: مستويات تقنين البيانات الشخصية في سياق المزوّد', () => {
  const sample = () => ({
    customers: [{ id: 'C1', name: 'أحمد محمد', phone: '01012345678', category: 'تجزئة', totalPurchases: 900, balance: 300, notes: 'يلزم الدفع' }],
    suppliers: [{ id: 'S1', name: 'مصنع النور', phone: '01123456789', notes: 'دفعة أولى' }],
    products: [{ id: 'P1', name: 'بطانية مورا', code: 'SKU-1', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400, supplierName: 'مصنع النور', notes: 'جودة عالية' }],
    expenses: [{ id: 'E1', title: 'إيجار', category: 'إيجارات', amount: 300, notes: 'شهري' }],
    orders: [{ id: 'ORD-1', customerName: 'أحمد محمد', status: 'completed', totalAmount: 1400, downPayment: 1400, items: [{ productName: 'بطانية مورا', quantity: 1, sellingPrice: 1400, subtotal: 1400 }] }],
  })

  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('الافتراضي full يبعث كل البيانات كما هي (السلوك الحالي بلا أي تغيير)', () => {
    const ctx = buildContextForPrompt(sample())
    expect(ctx).toContain('أحمد محمد')
    expect(ctx).toContain('إجمالي مشتريات 900 ج.م')
    expect(ctx).toContain('رصيد متبقي 300 ج.م')
    expect(ctx).toContain('ملاحظات: يلزم الدفع')
    expect(ctx).toContain('عميل أحمد محمد')
    expect(ctx).toContain('هاتف 010****5678')
  })

  it('noSensitive يبقي الأسماء ويحجب الملاحظات وأرصدة العملاء ومبالغ مشترياتهم', () => {
    const ctx = buildContextForPrompt(sample(), { redactLevel: 'noSensitive' })
    expect(ctx).toContain('أحمد محمد')
    expect(ctx).toContain('عميل أحمد محمد')
    expect(ctx).toContain('تصنيف تجزئة')
    expect(ctx).not.toContain('رصيد متبقي')
    expect(ctx).not.toContain('إجمالي مشتريات')
    expect(ctx).not.toContain('يلزم الدفع')
    expect(ctx).not.toContain('دفعة أولى')
    expect(ctx).not.toContain('جودة عالية')
    expect(ctx).not.toContain('شهري')
  })

  it('minimal يخفي أسماء العملاء/الموردين وبيانات اتصالهم وأرصدتهم ويستبدلها بعميل/مورد مرقّم', () => {
    const ctx = buildContextForPrompt(sample(), { redactLevel: 'minimal' })
    expect(ctx).not.toContain('أحمد محمد')
    expect(ctx).not.toContain('مصنع النور')
    expect(ctx).not.toContain('010')
    expect(ctx).not.toContain('رصيد متبقي')
    expect(ctx).not.toContain('إجمالي مشتريات')
    expect(ctx).toContain('عميل 1')
    expect(ctx).toContain('مورد 1')
    expect(ctx).toContain('بطانية مورا')
    expect(ctx).toContain('«بطانية مورا» × 1 بسعر 1400 = 1400 ج.م')
  })

  it('مستوى التقنين يُحفظ في الإعدادات ويُقرأ منها، والقيم غير الصالحة تُطبّع إلى full', () => {
    expect(getAiConfig().redactLevel).toBe('full')
    saveAiConfig({ provider: 'gemini', apiKey: 'K', model: '', redactLevel: 'noSensitive' })
    expect(getAiConfig().redactLevel).toBe('noSensitive')
    saveAiConfig({ provider: 'gemini', apiKey: 'K', model: '', redactLevel: 'bogus' })
    expect(getAiConfig().redactLevel).toBe('full')
    expect(buildContextForPrompt(sample()).length).toBeGreaterThan(0)
  })
})
