import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import VoiceInput from '@/ui/components/VoiceInput'
import { useToastStore } from '@/ui/components/toastStore'

function mount(attrs) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<VoiceInput {...attrs} />)
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
    el.click()
  })
}

function lastToast() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1] : null
}

function fireResult(rec, transcript, { isFinal = true } = {}) {
  act(() => {
    rec.onresult({
      resultIndex: 0,
      results: {
        0: { isFinal, 0: { transcript } },
        length: 1,
      },
    })
  })
}

class MockRecognition {
  constructor() {
    this.onresult = null
    this.onerror = null
    this.onend = null
    this.lang = ''
    this.interimResults = false
    this.continuous = false
    this.maxAlternatives = 1
    this.started = false
    this.stopped = false
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
  }
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  delete window.webkitSpeechRecognition
  delete window.SpeechRecognition
})

describe('VoiceInput (ui/components/VoiceInput.jsx)', () => {
  it('يظهر زر ميكروفون، وبدون دعم المتصفح يعرض تنبيهاً دون تعطل', () => {
    const { host, unmount } = mount({ onResult: vi.fn(), ariaLabel: 'بحث صوتي' })
    const btn = host.querySelector('button[aria-label="بحث صوتي"]')
    expect(btn).toBeTruthy()
    click(btn)
    expect(lastToast().message).toContain('لا يدعم الإدخال الصوتي')
    unmount()
  })

  it('بدء الاستماع يفعّل التعرف بالعربية ويعرض تنبيه «جاري الاستماع...»', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ onResult: vi.fn(), ariaLabel: 'بحث صوتي' })
    const btn = host.querySelector('button[aria-label="بحث صوتي"]')
    click(btn)
    expect(window.webkitSpeechRecognition).toHaveBeenCalledTimes(1)
    expect(rec.started).toBe(true)
    expect(rec.lang).toBe('ar-EG')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(lastToast().message).toContain('جاري الاستماع')
    unmount()
  })

  it('النتيجة النهائية تُمرَّر إلى onResult', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const onResult = vi.fn()
    const { host, unmount } = mount({ onResult, ariaLabel: 'بحث صوتي' })
    click(host.querySelector('button[aria-label="بحث صوتي"]'))
    fireResult(rec, 'أحمد محمد')
    expect(onResult).toHaveBeenCalledWith('أحمد محمد')
    unmount()
  })

  it('النتيجة المؤقتة لا تُمرَّر — النتيجة النهائية فقط (لمنع تكرار النص)', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const onResult = vi.fn()
    const { host, unmount } = mount({ onResult, ariaLabel: 'بحث صوتي' })
    click(host.querySelector('button[aria-label="بحث صوتي"]'))
    fireResult(rec, 'بطانية', { isFinal: false })
    expect(onResult).not.toHaveBeenCalled()
    fireResult(rec, 'بطانية', { isFinal: true })
    expect(onResult).toHaveBeenCalledWith('بطانية')
    unmount()
  })

  it('النقر مرة أخرى أثناء الاستماع يوقف التعرف', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ onResult: vi.fn(), ariaLabel: 'بحث صوتي' })
    const btn = host.querySelector('button[aria-label="بحث صوتي"]')
    click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    click(btn)
    expect(rec.stopped).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    unmount()
  })

  it('فشل بدء التعرف لا يكسر التطبيق ويعرض تنبيهاً', () => {
    window.webkitSpeechRecognition = vi.fn(function () {
      throw new Error('permission denied')
    })
    const { host, unmount } = mount({ onResult: vi.fn(), ariaLabel: 'بحث صوتي' })
    click(host.querySelector('button[aria-label="بحث صوتي"]'))
    expect(lastToast().message).toContain('تعذر بدء الإدخال الصوتي')
    unmount()
  })

  it('خطأ network (حجب خدمة التحويل كـ Brave/Avast) يعرض رسالة الحجب دون نص', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ onResult: vi.fn(), ariaLabel: 'بحث صوتي' })
    click(host.querySelector('button[aria-label="بحث صوتي"]'))
    act(() => {
      rec.onerror({ error: 'network' })
    })
    expect(lastToast().message).toContain('يحجب خدمة تحويل الصوت إلى نص')
    unmount()
  })
})
