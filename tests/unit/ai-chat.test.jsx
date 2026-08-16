import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import AiAssistantModal from '@/ui/modals/AiAssistantModal'
import { useUiStore } from '@/ui/state/uiStore'
import { useToastStore } from '@/ui/components/toastStore'
import { getAiConfig } from '@/services/aiProvider'
import { consumeFormFill } from '@/services/aiAssistant'
import { formatCurrency, getCairoDate } from '@/utils/formatters'
import { cleanAiText } from '@/utils/cleanAiText'

const TODAY = getCairoDate()

function seedData() {
  window.getProducts = () => [
    { id: 'P1', name: 'بطانية مورا', stock: 3, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    { id: 'P2', name: 'مفرش ملكي', stock: 20, minStock: 2, purchasePrice: 200, sellingPrice: 350 },
  ]
  window.getCustomers = () => [
    { id: 'C1', name: 'أحمد محمد', totalPurchases: 900 },
    { id: 'C2', name: 'سارة علي', totalPurchases: 1500 },
  ]
  window.getOrders = () => [
    {
      id: 'ORD-1',
      customerName: 'سارة علي',
      totalAmount: 1000,
      createdAt: TODAY,
      items: [{ productId: 'P1', productName: 'بطانية مورا', quantity: 2, subtotal: 2800 }],
    },
    {
      id: 'ORD-2',
      customerName: 'أحمد محمد',
      totalAmount: 350,
      createdAt: TODAY,
      items: [{ productName: 'مفرش ملكي', quantity: 1, subtotal: 350 }],
    },
  ]
  window.getExpenses = () => [{ id: 'E1', title: 'إيجار', amount: 200, date: TODAY.slice(0, 10) }]
  window.getSuppliers = () => [{ id: 'SUP-1', name: 'مصنع النور', phone: '01123456789' }]
}

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<AiAssistantModal />)
  })
  return {
    host,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function composer() {
  return document.querySelector('input[placeholder*="اكتب سؤالك"]')
}

function sendButton() {
  return Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.trim() === 'إرسال')
}

function ask(question) {
  typeInto(composer(), question)
  click(sendButton())
}

function resetModals() {
  useUiStore.setState({
    aiAssistantModal: { open: false },
    orderModal: { open: false, onSuccess: null, initialData: null },
    customerModal: { open: false, customerId: null, onDone: null, initialData: null },
    productModal: { open: false, productId: null, onDone: null, initialData: null },
    supplierModal: { open: false, supplierId: null, onDone: null, initialData: null },
    expenseModal: { open: false, expenseId: null, onDone: null, initialData: null },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  consumeFormFill()
  resetModals()
  useUiStore.setState({ aiAssistantModal: { open: true } })
  seedData()
})

afterEach(() => {
  consumeFormFill()
  resetModals()
  delete globalThis.fetch
})

describe('cleanAiText (utils/cleanAiText.js) — تنظيف ردود الـ AI من «*»', () => {
  it('يزيل علامات التأكيد والميل والتسطير ويبقي النص', () => {
    expect(cleanAiText('**بولد** و*مائل* و_تحتي_')).toBe('بولد ومائل وتحتي')
  })

  it('يحوّل سطور النقاط والأرقام إلى «•» موحدة', () => {
    expect(cleanAiText('- أول\n* ثاني\n1. ثالث')).toBe('• أول\n• ثاني\n• ثالث')
  })

  it('يزيل رؤوس العناوين وعلامات الاقتباس مع إبقاء النص', () => {
    expect(cleanAiText('## ملخص\n> اقتباس')).toBe('ملخص\nاقتباس')
  })

  it('لا يمس الأرقام والمبالغ وأسماء البنود', () => {
    expect(cleanAiText('المبلغ 1,350 ج.م — 3 قطع')).toBe('المبلغ 1,350 ج.م — 3 قطع')
  })

  it('يمرر القيم غير النصية أو الفارغة كما هي', () => {
    expect(cleanAiText('')).toBe('')
    expect(cleanAiText(null)).toBeNull()
    expect(cleanAiText(undefined)).toBeUndefined()
  })
})

describe('AiAssistantModal — عرض نظيف للردود (بلا «*»)', () => {
  it('رد المزوّد الذي يحوي «*»/عناوين يُعرض منظفاً بلا نجوم وبنقاط «•»', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' }))
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: '**النتيجة**\n* مبيعات اليوم: 100\n- أرباح اليوم: 50' }] } }],
        }),
      })
    )
    const { unmount } = mount()
    ask('ما هي مبيعات اليوم؟')
    await act(async () => {})
    const body = document.body.textContent
    expect(body).toContain('النتيجة')
    expect(body).toContain('• مبيعات اليوم: 100')
    expect(body).toContain('• أرباح اليوم: 50')
    expect(body).not.toContain('**')
    unmount()
  })
})

describe('AiAssistantModal (ui/modals/AiAssistantModal.jsx) — الشات التفاعلي', () => {
  it('يعرض الترحيب وحقل الإرسال مع المايك المدمج — بلا شريط أسئلة سريعة (V3.38)', () => {
    const { host, unmount } = mount()
    expect(document.body.textContent).toContain('مساعد AI السريع')
    expect(document.body.textContent).toContain('مرحباً')
    expect(composer()).toBeTruthy()
    const mic = document.querySelector('button[aria-label="إملاء سؤال المساعد صوتياً"]')
    expect(mic).toBeTruthy()
    expect(document.body.textContent).not.toContain('ما هي المنتجات الناقصة؟')
    unmount()
  })

  it('حُذف شريط الأسئلة السريعة كلياً — لا تظهر أي اقتراحات جاهزة (V3.38)', () => {
    const { host, unmount } = mount()
    expect(document.body.textContent).not.toContain('ما هي مبيعات اليوم؟')
    expect(document.body.textContent).not.toContain('اكتب وصفاً لمنتج «بطانية مورا»')
    unmount()
  })

  it('لا يرسل سؤالاً فارغاً', () => {
    const { host, unmount } = mount()
    const before = document.body.textContent.length
    click(sendButton())
    expect(document.body.textContent.length).toBe(before)
    unmount()
  })

  it('سؤال «من هو العميل الأعلى شراءً؟» يجيب بأعلى العملاء من بيانات النظام', () => {
    const { host, unmount } = mount()
    ask('من هو العميل الأعلى شراءً؟')
    expect(document.body.textContent).toContain('سارة علي')
    expect(document.body.textContent).toContain('أحمد محمد')
    unmount()
  })

  it('سؤال «ما هي المنتجات الناقصة؟» يجيب بالمنتجات تحت الحد الأدنى وكمية الاقتراح', () => {
    const { host, unmount } = mount()
    ask('ما هي المنتجات الناقصة؟')
    expect(document.body.textContent).toContain('بطانية مورا')
    expect(document.body.textContent).toContain('يُقترح إضافة 7')
    unmount()
  })

  it('سؤال «ما هي مبيعات اليوم؟» يعرض الإجمالي المنسّق بالعملة', () => {
    const { host, unmount } = mount()
    ask('ما هي مبيعات اليوم؟')
    expect(document.body.textContent).toContain(formatCurrency(1350))
    unmount()
  })

  it('النقر على قسم من الشريط ينشّطه دون إرسال أي رسالة (V3.38)', () => {
    const { host, unmount } = mount()
    const LABELS = ['عام / الشامل', 'المنتجات', 'الموردين', 'العملاء', 'إنشاء طلب']
    const pills = Array.from(document.body.querySelectorAll('button[aria-pressed]'))
      .filter(b => LABELS.some(l => b.textContent.includes(l)))
    expect(pills.length).toBe(5)
    const general = pills.find(p => p.textContent.includes('عام / الشامل'))
    const orders = pills.find(p => p.textContent.includes('إنشاء طلب'))
    expect(general.getAttribute('aria-pressed')).toBe('true')
    expect(orders.getAttribute('aria-pressed')).toBe('false')
    const before = document.body.textContent.length
    click(orders)
    expect(orders.getAttribute('aria-pressed')).toBe('true')
    expect(general.getAttribute('aria-pressed')).toBe('false')
    expect(document.body.textContent.length).toBe(before)
    unmount()
  })

  it('السؤال غير المحدد يعرض ملخصاً عاماً لنشاط المتجر', () => {
    const { host, unmount } = mount()
    ask('حكيلنا عن المتجر')
    expect(document.body.textContent).toContain('ملخص سريع')
    unmount()
  })

  it('يقرأ بيانات النظام حية عند كل إرسال — أي تحديث بعد فتح النافذة يظهر فوراً', () => {
    const { host, unmount } = mount()
    window.getProducts = () => [
      { id: 'P9', name: 'وسادة جديدة', stock: 0, minStock: 5, purchasePrice: 50, sellingPrice: 100 },
    ]
    ask('ما هي المنتجات الناقصة؟')
    expect(document.body.textContent).toContain('وسادة جديدة')
    unmount()
  })
})

describe('AiAssistantModal — المزوّد الخارجي (Gemini/OpenAI) مع العودة للمحرك الداخلي', () => {
  it('عند ضبط مفتاح API ونموذج صالح ونجاح المزوّد تُعرض الإجابة المتقدمة', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' }))
    expect(getAiConfig().provider).toBe('gemini')
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'إجابة متقدمة من Gemini 🚀' }] } }] }),
      })
    )
    const { host, unmount } = mount()
    ask('ما هي مبيعات اليوم؟')
    await act(async () => {})
    expect(document.body.textContent).toContain('إجابة متقدمة من Gemini 🚀')
    unmount()
  })

  it('فشل استدعاء المزوّد يعيد بسلاسة إلى محرك التحليل الداخلي', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'openai', apiKey: 'OKEY', model: 'gpt-4o-mini' }))
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    const { host, unmount } = mount()
    ask('ما هي مبيعات اليوم؟')
    await act(async () => {})
    expect(document.body.textContent).toContain(formatCurrency(1350))
    unmount()
  })

  it('فشل الاتصال بالمزوّد يعرض Toast خطأ واضحاً ثم يجيب من المحرك الداخلي', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'BADKEY', model: 'gemini-1.5-flash' }))
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }))
    const { host, unmount } = mount()
    ask('ما هي مبيعات اليوم؟')
    await act(async () => {})
    const failed = useToastStore.getState().toasts.some(t => t.message.includes('تعذر الاتصال بمزوّد الذكاء الاصطناعي'))
    expect(failed).toBe(true)
    expect(document.body.textContent).toContain(formatCurrency(1350))
    unmount()
  })
})

describe('AiAssistantModal — استمرارية السجل + مسح السجل', () => {
  it('يحفظ سجل المحادثة في localStorage ويعيده عند إعادة فتح النافذة', () => {
    const first = mount()
    ask('كم عدد العملاء؟')
    first.unmount()

    const saved = JSON.parse(window.localStorage.getItem('bms_trendawy_ai_chat_history'))
    expect(saved.some(m => m.role === 'user' && m.text.includes('كم عدد العملاء؟'))).toBe(true)
    expect(saved.some(m => m.role === 'assistant' && m.text.includes('عدد العملاء المسجلين'))).toBe(true)

    const second = mount()
    expect(document.body.textContent).toContain('كم عدد العملاء؟')
    expect(document.body.textContent).toContain('عدد العملاء المسجلين')
    second.unmount()
  })

  it('زر «مسح السجل» يفرّغ المحادثة إلى الترحيب فقط في الواجهة والتخزين', () => {
    const { unmount } = mount()
    ask('كم عدد العملاء؟')
    expect(document.body.textContent).toContain('عدد العملاء المسجلين')

    const clearBtn = Array.from(document.body.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'مسح سجل المحادثة')
    expect(clearBtn).toBeTruthy()
    click(clearBtn)

    expect(document.body.textContent).toContain('مرحباً')
    expect(document.body.textContent).not.toContain('كم عدد العملاء؟')
    const saved = JSON.parse(window.localStorage.getItem('bms_trendawy_ai_chat_history'))
    expect(saved).toHaveLength(1)
    expect(saved[0].role).toBe('assistant')
    unmount()
  })
})

describe('AiAssistantModal — التعبئة الذكية عبر المزوّد (V3.35 Function Calling)', () => {
  it('functionCall يجهّز نموذجاً معبأً ويفتح نافذة الإدخال بلا أي تنفيذ', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' }))
    const prevCreateProduct = window.createProduct
    window.createProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })

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

    const { unmount } = mount()
    ask('أضف منتج وسادة بسعر 120')
    await act(async () => {})

    expect(window.createProduct).not.toHaveBeenCalled()
    // نافذة إضافة المنتج فُتحت معبأةً بالبيانات، والشات أُغلق — لا تأكيد ولا تنفيذ.
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(useUiStore.getState().productModal.initialData).toEqual(expect.objectContaining({ name: 'وسادة', price: 120, stock: 10 }))
    expect(useUiStore.getState().aiAssistantModal.open).toBe(false)
    // الجولة الثانية حملت functionResponse بنتيجة التجهيز (ok:true) بلا needsConfirmation.
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body)
    const respPart = body.contents.flatMap(c => c.parts).find(p => p.functionResponse && p.functionResponse.response)
    expect(respPart.functionResponse.name).toBe('addProduct')
    expect(respPart.functionResponse.response.ok).toBe(true)
    expect(respPart.functionResponse.response.blocked).toBe(false)
    expect(respPart.functionResponse.response.needsConfirmation).toBeUndefined()

    window.createProduct = prevCreateProduct
    unmount()
  })

  it('functionCall محظور (منتج مكرر) يعرض سبب المنع ولا يفتح نموذجاً', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' }))
    const prevCreateProduct = window.createProduct
    window.createProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })

    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ functionCall: { name: 'addProduct', args: { name: 'بطانية مورا', price: 100 } } }] } }],
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'هذا المنتج مسجل بالفعل، هل تريد تحديثه؟' }] } }],
        }),
      }))

    const { unmount } = mount()
    ask('أضف منتج بطانية مورا')
    await act(async () => {})

    expect(window.createProduct).not.toHaveBeenCalled()
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(useUiStore.getState().aiAssistantModal.open).toBe(true)
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body)
    const respPart = body.contents.flatMap(c => c.parts).find(p => p.functionResponse && p.functionResponse.response)
    expect(respPart.functionResponse.response.ok).toBe(false)
    expect(respPart.functionResponse.response.blocked).toBe(true)

    window.createProduct = prevCreateProduct
    unmount()
  })

  it('functionCall updateProduct يفتح نموذج تعديل المنتج معبأً بإشارة entityId — لا تنفيذ', async () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'GKEY', model: 'gemini-1.5-flash' }))
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

    const { unmount } = mount()
    ask('عدل سعر بطانية مورا ل 1500')
    await act(async () => {})

    expect(window.updateProduct).not.toHaveBeenCalled()
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(useUiStore.getState().productModal.productId).toBe('P1')
    expect(useUiStore.getState().productModal.initialData).toEqual(expect.objectContaining({ name: 'بطانية مورا', price: 1500 }))
    expect(useUiStore.getState().aiAssistantModal.open).toBe(false)

    window.updateProduct = prevUpdateProduct
    unmount()
  })
})

describe('AiAssistantModal — التعبئة الذكية عبر المحرك الداخلي (بلا مفتاح API)', () => {
  it('«اضف منتج وسادة من مصنع النور بسعر 120» يفتح نموذج منتج معبأً بالمورد بلا أي تنفيذ', () => {
    const prevCreateProduct = window.createProduct
    window.createProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    const { unmount } = mount()
    ask('اضف منتج وسادة من مصنع النور بسعر 120')
    expect(window.createProduct).not.toHaveBeenCalled()
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(useUiStore.getState().productModal.initialData).toEqual(expect.objectContaining({ name: 'وساده', price: 120, supplierName: 'مصنع النور', supplierId: 'SUP-1' }))
    expect(useUiStore.getState().aiAssistantModal.open).toBe(false)
    window.createProduct = prevCreateProduct
    unmount()
  })

  it('«اضف منتج وسادة بسعر 120» بلا مورد يُمنع ويُطلب ذكر المورد ولا يُفتح نموذج', () => {
    const { unmount } = mount()
    ask('اضف منتج وسادة بسعر 120')
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(useUiStore.getState().aiAssistantModal.open).toBe(true)
    expect(document.body.textContent).toContain('المورد المصنع')
    unmount()
  })

  it('«اضف مورد مصنع السلام هاتف 01153722244» يفتح نموذج مورد معبأً بالاسم والهاتف', () => {
    const prevCreateSupplier = window.createSupplier
    window.createSupplier = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    const { unmount } = mount()
    ask('اضف مورد مصنع السلام هاتف 01153722244')
    expect(window.createSupplier).not.toHaveBeenCalled()
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    expect(useUiStore.getState().supplierModal.initialData).toEqual(expect.objectContaining({ name: 'مصنع السلام', phone: '01153722244' }))
    window.createSupplier = prevCreateSupplier
    unmount()
  })

  it('شريط الأقسام النهائي: عام/منتجات/موردين/عملاء/إنشاء طلب — بلا «تقارير» وبلا أسئلة سريعة (V3.38)', () => {
    const { unmount } = mount()
    expect(document.body.textContent).toContain('عام / الشامل')
    expect(document.body.textContent).toContain('المنتجات')
    expect(document.body.textContent).toContain('الموردين')
    expect(document.body.textContent).toContain('العملاء')
    expect(document.body.textContent).toContain('إنشاء طلب')
    expect(document.body.textContent).not.toContain('التقارير والمالية')
    expect(document.body.textContent).not.toContain('ما هي قائمة الموردين؟')
    unmount()
  })

  it('قسم «إنشاء طلب»: «اضف بطانية مورا لاحمد هاتف 01012345678 عنوان القاهرة» يوجّه لنموذج الطلب معبأً — بلا شاشة عميل منفصلة', () => {
    const prevCreateOrder = window.createOrder
    window.createOrder = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    const { unmount } = mount()
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('إنشاء طلب')))
    ask('اضف بطانية مورا لاحمد هاتف 01012345678 عنوان القاهرة')
    expect(window.createOrder).not.toHaveBeenCalled()
    expect(useUiStore.getState().orderModal.open).toBe(true)
    expect(useUiStore.getState().orderModal.initialData).toEqual(expect.objectContaining({
      customerName: 'احمد',
      phone: '01012345678',
      address: 'القاهره',
      items: [expect.objectContaining({ name: 'بطانية مورا', quantity: 1 })],
    }))
    expect(useUiStore.getState().customerModal.open).toBe(false)
    expect(useUiStore.getState().aiAssistantModal.open).toBe(false)
    window.createOrder = prevCreateOrder
    unmount()
  })

  it('قسم «إنشاء طلب»: فاتورة ببيانات العميل الكاملة تفتح نموذج الطلب مباشرةً', () => {
    const prevCreateOrder = window.createOrder
    window.createOrder = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    const { unmount } = mount()
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('إنشاء طلب')))
    ask('اعمل طلب بطانية مورا لاحمد هاتف 01012345678 عنوان القاهرة')
    expect(window.createOrder).not.toHaveBeenCalled()
    expect(useUiStore.getState().orderModal.open).toBe(true)
    expect(useUiStore.getState().orderModal.initialData).toEqual(expect.objectContaining({
      customerName: 'احمد',
      phone: '01012345678',
      address: 'القاهره',
    }))
    expect(useUiStore.getState().customerModal.open).toBe(false)
    window.createOrder = prevCreateOrder
    unmount()
  })

  it('القسم المختار يفكك غموض «اضف السلام هاتف 01153722244» بلا كلمة نوع → يفتح نموذج مورد معبأً', () => {
    const prevCreateSupplier = window.createSupplier
    window.createSupplier = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    const { unmount } = mount()
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('الموردين')))
    ask('اضف السلام هاتف 01153722244')
    expect(window.createSupplier).not.toHaveBeenCalled()
    expect(useUiStore.getState().supplierModal.open).toBe(true)
    expect(useUiStore.getState().supplierModal.initialData).toEqual(expect.objectContaining({ name: 'السلام', phone: '01153722244' }))
    expect(useUiStore.getState().aiAssistantModal.open).toBe(false)
    window.createSupplier = prevCreateSupplier
    unmount()
  })

  it('القسم لا يقفل: في قسم الموردين يبقى طلب منتج ناقص المورد ممنوعاً بلا نموذج', () => {
    const { unmount } = mount()
    click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.includes('الموردين')))
    ask('اضف منتج وسادة بسعر 120')
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(useUiStore.getState().aiAssistantModal.open).toBe(true)
    expect(document.body.textContent).toContain('المورد المصنع')
    unmount()
  })

  it('طلب إضافة ببيانات مكررة يعرض سبب المنع ولا يفتح نموذجاً', () => {
    const { unmount } = mount()
    ask('اضف منتج بطانية مورا')
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(useUiStore.getState().aiAssistantModal.open).toBe(true)
    expect(document.body.textContent).toContain('مسجل بالفعل')
    unmount()
  })

  it('طلب إنشاء طلب ناقص الهاتف والعنوان يطلب استكمالها ولا يفتح نموذجاً', () => {
    const prevCreateOrder = window.createOrder
    window.createOrder = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
    const { unmount } = mount()
    ask('اعمل طلب بطانية مورا لاحمد')
    expect(window.createOrder).not.toHaveBeenCalled()
    expect(useUiStore.getState().orderModal.open).toBe(false)
    expect(document.body.textContent).toContain('رقم هاتف')
    expect(document.body.textContent).toContain('عنوان')
    window.createOrder = prevCreateOrder
    unmount()
  })

  it('«عدل سعر بطانية مورا ل 1500» يفتح نموذج تعديل المنتج معبأً — لا تنفيذ ولا ادعاء إتمام', () => {
    const prevUpdateProduct = window.updateProduct
    window.updateProduct = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي تحديث من المساعد') })
    const { unmount } = mount()
    ask('عدل سعر بطانية مورا ل 1500')
    expect(window.updateProduct).not.toHaveBeenCalled()
    expect(useUiStore.getState().productModal.open).toBe(true)
    expect(useUiStore.getState().productModal.productId).toBe('P1')
    expect(useUiStore.getState().productModal.initialData).toEqual(expect.objectContaining({ name: 'بطانية مورا', price: 1500 }))
    expect(useUiStore.getState().aiAssistantModal.open).toBe(false)
    expect(document.body.textContent).not.toContain('تم التعديل بنجاح')
    window.updateProduct = prevUpdateProduct
    unmount()
  })

  it('«عدل سعر منتج غير مسجل» يطلب توضيحاً ولا يفتح نموذجاً', () => {
    const { unmount } = mount()
    ask('عدل سعر وسادة ل 100')
    expect(useUiStore.getState().productModal.open).toBe(false)
    expect(document.body.textContent).toContain('غير مسجل')
    unmount()
  })
})
