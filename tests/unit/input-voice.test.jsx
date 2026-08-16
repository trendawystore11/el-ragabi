import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import Input from '@/ui/components/Input'
import { useToastStore } from '@/ui/components/toastStore'

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

function Harness(props) {
  const [value, setValue] = useState(props.initial || '')
  return <Input value={value} onChange={setValue} {...props} />
}

function mount(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Harness {...props} />)
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

function fireResult(rec, transcript, isFinal = true) {
  act(() => {
    rec.onresult({
      resultIndex: 0,
      results: { 0: { isFinal, 0: { transcript } }, length: 1 },
    })
  })
}

function fireResults(rec, payload) {
  act(() => {
    rec.onresult({
      resultIndex: payload.resultIndex,
      results: payload.results,
      length: payload.results.length,
    })
  })
}

function lastToast() {
  const toasts = useToastStore.getState().toasts
  return toasts.length ? toasts[toasts.length - 1] : null
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  window.localStorage.clear()
  delete window.webkitSpeechRecognition
  delete window.SpeechRecognition
})

describe('Input (ui/components/Input.jsx) — الإدخال الصوتي الشامل', () => {
  it('يعرض زر المايك تلقائياً لكل حقل نص مع تسمية مشتقة من الـ label', () => {
    const { host, unmount } = mount({ label: 'الاسم', placeholder: 'اسم العميل' })
    const mic = host.querySelector('button[aria-label="الإدخال الصوتي لـ الاسم"]')
    expect(mic).toBeTruthy()
    unmount()
  })

  it('بدون دعم المتصفح يعرض تنبيهاً ولا يتعطل الحقل', () => {
    const { host, unmount } = mount({ label: 'الاسم' })
    const mic = host.querySelector('button[aria-label="الإدخال الصوتي لـ الاسم"]')
    click(mic)
    expect(lastToast().message).toContain('لا يدعم الإدخال الصوتي')
    unmount()
  })

  it('voice={false} يعطّل زر المايك', () => {
    const { host, unmount } = mount({ label: 'الاسم', voice: false })
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    unmount()
  })

  it('الحقل المعطّل لا يعرض زر المايك', () => {
    const { host, unmount } = mount({ label: 'الاسم', disabled: true })
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    unmount()
  })

  it('نتيجة التعرف الصوتي تُكتب مباشرة داخل الحقل عبر onChange', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ label: 'الاسم' })
    const mic = host.querySelector('button[aria-label="الإدخال الصوتي لـ الاسم"]')
    click(mic)
    fireResult(rec, 'أحمد محمد')
    expect(host.querySelector('input').value).toBe('أحمد محمد')
    unmount()
  })

  it('الحقول الرقمية type="number" لا تعرض زر المايك إطلاقاً', () => {
    const { host, unmount } = mount({ label: 'الكمية', type: 'number' })
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    unmount()
  })

  it('الحقول الرقمية الصارمة numeric (هاتف/باركود/كود) لا تعرض زر المايك وتضيف لوحة أرقام', () => {
    const { host, unmount } = mount({ label: 'رقم الهاتف', numeric: true, textLeft: true })
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    expect(host.querySelector('input').getAttribute('inputmode')).toBe('numeric')
    unmount()
  })

  it('سواء number أو numeric لا يتبقى فراغ يساري محجوز لزر المايك', () => {
    const { host: hostA, unmount: umA } = mount({ label: 'الكمية', type: 'number' })
    expect(hostA.querySelector('input').className).not.toContain('pl-11')
    umA()
    const { host: hostB, unmount: umB } = mount({ label: 'الموبايل', numeric: true })
    expect(hostB.querySelector('input').className).not.toContain('pl-11')
    umB()
  })

  it('الحقل الرقمي numeric لا يستقبل نتائج صوتية (لا مايك أصلاً)', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ label: 'الباركود', numeric: true })
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    unmount()
  })

  it('يكرر آخر النسخة النصية في كل نتيجة مؤقتة/نهائية (مرور مستمر)', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ label: 'البحث', placeholder: 'بحث...' })
    const mic = host.querySelector('button[aria-label="الإدخال الصوتي لـ البحث"]')
    click(mic)
    fireResult(rec, 'بطانية')
    expect(host.querySelector('input').value).toBe('بطانية')
    unmount()
  })

  it('حقل كلمة المرور type="password" لا يعرض زر المايك إطلاقاً', () => {
    const { host, unmount } = mount({ label: 'كلمة السر', type: 'password' })
    expect(host.querySelector('button[aria-label*="الإدخال الصوتي"]')).toBeNull()
    unmount()
  })

  it('النتائج المؤقتة (interim) لا تُكتب في الحقل — النتيجة النهائية فقط', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ label: 'البحث', placeholder: 'بحث...' })
    const mic = host.querySelector('button[aria-label="الإدخال الصوتي لـ البحث"]')
    click(mic)
    fireResult(rec, 'بطانية', false)
    expect(host.querySelector('input').value).toBe('')
    fireResult(rec, 'بطانية', true)
    expect(host.querySelector('input').value).toBe('بطانية')
    unmount()
  })

  it('النتيجة النهائية التي أعاد المتصفح إرسالها لا تتكرر في الحقل', () => {
    const rec = new MockRecognition()
    window.webkitSpeechRecognition = vi.fn(function () { return rec })
    const { host, unmount } = mount({ label: 'البحث', placeholder: 'بحث...' })
    const mic = host.querySelector('button[aria-label="الإدخال الصوتي لـ البحث"]')
    click(mic)
    fireResult(rec, 'بطانية')
    expect(host.querySelector('input').value).toBe('بطانية')
    // إعادة إرسال نفس النتيجة النهائية (نتيجة مؤكدة سابقاً) — يجب ألا تتكرر.
    fireResults(rec, { resultIndex: 0, results: { 0: { isFinal: true, 0: { transcript: 'بطانية' } }, length: 1 } })
    expect(host.querySelector('input').value).toBe('بطانية')
    // نتيجة نهائية جديدة تُضاف للنسخة المتراكمة بشكل نظيف.
    fireResults(rec, { resultIndex: 1, results: { 1: { isFinal: true, 0: { transcript: ' زرقاء' } }, length: 2 } })
    expect(host.querySelector('input').value).toBe('بطانية زرقاء')
    unmount()
  })
})
