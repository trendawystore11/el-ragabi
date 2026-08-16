import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '@/utils/sanitizeHtml'

// V3.58 — XSS sanitization (#13): ContentModal contentHTML bridge + egypt.js.
// يزيل كل ناقل تنفيذ (سكربت/on*/javascript: URL) مع الحفاظ على بنية القوالب
// التي يحتاجها النظام (جداول/حقول/أزرار/class/style).

describe('utils/sanitizeHtml — تطهير HTML الجسر (V3.58)', () => {
  it('يحذف وسوم <script> مع محتواها بالكامل', () => {
    expect(sanitizeHtml('x<script>alert(1)</script>y')).toBe('xy')
    expect(sanitizeHtml('<SCRIPT>alert(1)</SCRIPT>')).toBe('')
  })

  it('يحذف وسوم <style>/<template> مع محتواها', () => {
    expect(sanitizeHtml('a<style>body{}</style>b')).toBe('ab')
    expect(sanitizeHtml('<template><script>alert(1)</script></template>')).toBe('')
  })

  it('يزيل كل خصائص on* (onclick/onerror/onload...)', () => {
    const out = sanitizeHtml('<div onclick="alert(1)" onerror="x()" onmouseover="y()">hi</div>')
    expect(out).toContain('<div')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onmouseover')
    expect(out).toContain('hi')
  })

  it('يرفض href/src بـ javascript: ويحفظ الروابط الآمنة', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="  JAVASCRIPT:alert(1)" onclick="x">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="https://example.com">ok</a>')).toBe('<a href="https://example.com">ok</a>')
    expect(sanitizeHtml('<a href="#section">ok</a>')).toContain('href="#section"')
    expect(sanitizeHtml('<a href="/relative/x">ok</a>')).toContain('href="/relative/x"')
  })

  it('يسقط iframe/object/embed/form ويحتفظ بمحتواها النصي الآمن', () => {
    const out = sanitizeHtml('<iframe src="https://evil"></iframe><object data="x"></object><form action="javascript:y()">نص</form>')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<form')
    expect(out).toContain('نص')
  })

  it('يسقط <img> (أشهر ناقل onerror) ولا يبقي أي أثر له', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('src=')
  })

  it('يحفظ class/id والحقول والأزرار التي تحتاجها قوالب النظام', () => {
    const html = '<div class="p-3 text-xs" id="gs-token-meta"></div><label>كلمة السر' +
      '<input id="unlock-admin-pass" type="password" value="v" maxlength="20"></label>' +
      '<button id="unlock-go" class="btn" style="color:#fff">تأكيد</button>'
    const out = sanitizeHtml(html)
    expect(out).toContain('id="gs-token-meta"')
    expect(out).toContain('class="p-3 text-xs"')
    expect(out).toContain('id="unlock-admin-pass"')
    expect(out).toContain('type="password"')
    expect(out).toContain('maxlength="20"')
    expect(out).toContain('id="unlock-go"')
    expect(out).toContain('تأكيد')
  })

  it('ينظف style من url()/expression()/-moz-binding ويبقي الألوان', () => {
    const out = sanitizeHtml('<div style="color:#b45309;background:url(javascript:alert(1));width:expression(alert(1))">نص</div>')
    expect(out).toContain('color:#b45309')
    expect(out).not.toContain('url(')
    expect(out).not.toContain('expression')
    expect(out).not.toContain('javascript:')
  })

  it('يحافظ على جداول كشوف الحسابات (table/tr/td...)', () => {
    const html = '<table class="data-table"><thead><tr><th>البيان</th></tr></thead><tbody><tr><td>مبلغ</td></tr></tbody></table>'
    const out = sanitizeHtml(html)
    expect(out).toContain('<table class="data-table">')
    expect(out).toContain('<thead>')
    expect(out).toContain('<tbody>')
    expect(out).toContain('<th>')
    expect(out).toContain('<td>')
    expect(out).toContain('مبلغ')
  })
})
