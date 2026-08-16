import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { askAiProvider } from '@/services/aiProvider'
import { getFormFill, consumeFormFill } from '@/services/aiAssistant'

describe('regression: gemini يُعيد functionCall متطابقاً دون نص (حلقة التأكيد القديمة) — V3.35', () => {
  const cfg = { provider: 'gemini', apiKey: 'KEY', model: 'gemini-1.5-flash' }
  const saved = { getProducts: window.getProducts, getCustomers: window.getCustomers, getSuppliers: window.getSuppliers, createOrder: window.createOrder }

  beforeEach(() => {
    consumeFormFill()
    window.getProducts = vi.fn(() => [
      { id: 'P1', name: 'بطانية محسن أبيض', stock: 100, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
      { id: 'P2', name: 'بطانية مورا إسباني', stock: 100, minStock: 5, purchasePrice: 1000, sellingPrice: 1400 },
    ])
    window.getCustomers = vi.fn(() => [])
    window.getSuppliers = vi.fn(() => [])
    window.createOrder = vi.fn(() => { throw new Error('يجب ألا يُنفَّذ أي إنشاء من المساعد') })
  })

  afterEach(() => {
    window.getProducts = saved.getProducts
    window.getCustomers = saved.getCustomers
    window.getSuppliers = saved.getSuppliers
    window.createOrder = saved.createOrder
    consumeFormFill()
    delete globalThis.fetch
  })

  const orderCall = { name: 'createOrder', args: {
    customerName: 'أحمد محسن', phone: '01153722266', address: 'القاهرة مدينة نصر',
    items: [{ name: 'بطانية محسن أبيض', quantity: 10 }, { name: 'بطانية مورا إسباني', quantity: 4 }],
    paymentType: 'full',
  } }

  it('لا يعود null ويُسلَّم ملخص النموذج المعبأ بلا تنفيذ وبلا حلقة لا نهائية', async () => {
    // نموذج لا ينتج نصاً أبداً: يستدعي createOrder في كل جولة (سلوك إعادة المحاولة).
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ functionCall: orderCall }] } }] }),
    }))
    const reply = await askAiProvider(cfg, 'اعمل طلب: أحمد محسن 10 بطانية محسن أبيض و4 مورا إسباني العنوان مدينة نصر', '')
    expect(reply).toBeTruthy()
    expect(String(reply)).toContain('تم تجهيز البيانات للمراجعة، يمكنك التأكد منها وضغط حفظ.')
    expect(String(reply)).toContain('١٩٬٦٠٠ ج.م')
    expect(globalThis.fetch.mock.calls.length).toBeLessThanOrEqual(6)
    expect(window.createOrder.mock.calls.length).toBe(0)
    const fill = getFormFill()
    expect(fill).not.toBeNull()
    expect(fill.form).toBe('createOrder')
    expect(fill.data.items).toHaveLength(2)
    expect(fill.data.items[0]).toEqual(expect.objectContaining({
      productId: 'P1',
      productName: 'بطانية محسن أبيض',
      quantity: 10,
      sellingPrice: 1400,
    }))
  })
})
