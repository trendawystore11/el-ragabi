import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPasswordHash } from '@/services/auth'

// V3.52 — إغلاق ثغرة الـ salt الاحتياطي: كانت hashPassword ترجع عند غياب salt
// إلى قيمة ثابتة معروفة ('bms_salt_default') مكتوبة في المصدر العام. الآن
// غياب salt خطأ صريح (fail-closed) — لا مسار يصل لقيمة افتراضية ضعيفة.

describe('services/auth — salt مطلوب في hashPassword (لا fallback ثابت)', () => {
  it('يرفض التجزئة بدون salt في كل صور الغياب', async () => {
    await expect(hashPassword('admin123', '')).rejects.toThrow(/salt/)
    await expect(hashPassword('admin123', '   ')).rejects.toThrow(/salt/)
    await expect(hashPassword('admin123', undefined)).rejects.toThrow(/salt/)
    await expect(hashPassword('admin123', null)).rejects.toThrow(/salt/)
  })

  it('لا يستخدم salt معروفاً ثابتاً — salt مختلف لنفس كلمة السر يعطي تجزئة مختلفة', async () => {
    const a = await hashPassword('admin123', 'salt-A')
    const b = await hashPassword('admin123', 'salt-B')
    expect(a).not.toBe(b)
    expect(a).not.toBe('')
  })

  it('التجزئة محدّدة بثبات مع نفس salt (متوافقة مع التحقق الدوري)', async () => {
    const salt = '9f0a1b2c3d4e5f6a'
    const first = await hashPassword('admin123', salt)
    const second = await hashPassword('admin123', salt)
    expect(second).toBe(first)
  })

  it('verifyPasswordHash يرفض حساباً بدون passwordSalt ولا يمر عبر fallback', async () => {
    const ok = await verifyPasswordHash(
      { id: 'USR-x', passwordHash: 'whatever', passwordSalt: null },
      'anything'
    )
    expect(ok).toBe(false)
  })
})
