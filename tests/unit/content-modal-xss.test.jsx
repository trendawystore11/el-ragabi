import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ContentModal from '@/ui/modals/ContentModal'
import { useUiStore } from '@/ui/state/uiStore'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// V3.58 — XSS sanitization (#13) at the ContentModal boundary: contentHTML من
// window.openModal (جسر legacy) يمر عبر sanitizeHtml قبل dangerouslySetInnerHTML
// — فيجب ألا يظهر أي <script> أو خاصية on* في DOM الفعلي، مع بقاء بنية القوالب.

const RESET_UI = {
  contentModal: { open: false, title: null, maxWidth: null, contentHTML: null, onRender: null },
}

function mountContent(contentHTML) {
  useUiStore.setState({ contentModal: { open: true, title: 'اختبار', maxWidth: null, contentHTML, onRender: null } })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(<ContentModal />) })
  return {
    host,
    root,
    container: () => document.getElementById('modal-container'),
    unmount() {
      act(() => { root.unmount() })
      host.remove()
    },
  }
}

beforeEach(() => {
  useUiStore.setState(RESET_UI)
})

afterEach(() => {
  const container = document.getElementById('modal-container')
  if (container) container.remove()
  useUiStore.setState(RESET_UI)
})

describe('ui/modals/ContentModal — XSS sanitization (V3.58)', () => {
  it('لا يُدرج <script> أبداً في DOM المنصّب', () => {
    const m = mountContent('x<script>alert(1)</script><p onclick="alert(1)">نص آمن</p>')
    const body = m.container()
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('[onclick]')).toBeNull()
    expect(body.textContent).toContain('نص آمن')
    expect(body.textContent).not.toContain('alert(1)')
    m.unmount()
  })

  it('يحذف img/iframe ويجرد onclick/onerror وjavascript: URLs', () => {
    const m = mountContent('<img src=x onerror="alert(1)"><iframe src="https://evil"></iframe><a href="javascript:alert(1)" onmouseover="x()">رابط</a>')
    const body = m.container()
    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('iframe')).toBeNull()
    const a = body.querySelector('a')
    expect(a).not.toBeNull()
    expect(a.getAttribute('href')).toBeNull()
    expect(a.hasAttribute('onmouseover')).toBe(false)
    m.unmount()
  })

  it('يحافظ على بنية قوالب النظام (جدول + حقول/أزرار بمعرّفاتها) بعد التطهير', () => {
    const html = '<table class="data-table"><tr><td>مبلغ</td></tr></table>' +
      '<label>كلمة السر<input id="unlock-admin-pass" type="password"></label>' +
      '<button id="unlock-go" style="color:#fff">تأكيد</button>'
    const m = mountContent(html)
    const body = m.container()
    expect(body.querySelector('table.data-table')).not.toBeNull()
    expect(body.querySelector('#unlock-admin-pass')).not.toBeNull()
    expect(body.querySelector('#unlock-go')).not.toBeNull()
    expect(body.textContent).toContain('مبلغ')
    expect(body.textContent).toContain('تأكيد')
    m.unmount()
  })

  it('onRender يجد العناصر بعد التطهير (تعويذة فتح الحقول الحساسة في sheets.js)', () => {
    const seen = { input: null, go: null }
    useUiStore.setState({
      contentModal: {
        open: true,
        title: 'فتح',
        maxWidth: null,
        contentHTML: '<label>كلمة السر<input id="unlock-admin-pass" type="password"></label>' +
          '<button id="unlock-go">تأكيد</button>',
        onRender: (wrapper) => {
          seen.input = wrapper.querySelector('#unlock-admin-pass')
          seen.go = wrapper.querySelector('#unlock-go')
        },
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(<ContentModal />) })
    expect(seen.input).not.toBeNull()
    expect(seen.go).not.toBeNull()
    act(() => { root.unmount() })
    host.remove()
  })
})
