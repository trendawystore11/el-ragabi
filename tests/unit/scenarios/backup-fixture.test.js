import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { importFullBackup, exportFullBackup } from '@/services/db'

// V3.71 — مجلد tests/fixtures (بيانات اختبار) لا يُشحن لريبوهات العملاء (يستثنيه
// المصنع)، لذا نتخطّى هذا الاختبار عند غياب الملف بدل الفشل. يبقى يعمل كاملاً في
// قالب النظام حيث الملف موجود.
const seedPath = process.cwd() + '/tests/fixtures/demo-data.json'
const seed = existsSync(seedPath) ? JSON.parse(readFileSync(new URL('file://' + seedPath))) : null

describe.skipIf(!seed)('demo-data.json — تنسيق «تصدير نسخة كاملة»', () => {
  it('يجتاز عتبة الاستيراد الحقيقية ويُصدَّر من جديد بنفس السجلات', () => {
    // compat.js يسجّل مفتاح المصروفات وقت التشغيل — نحاكيه قبل الاستيراد
    window.STORAGE_KEYS.EXPENSES = 'expenses'

    expect(seed && typeof seed === 'object' && seed.collections && typeof seed.collections === 'object').toBe(true)

    const res = importFullBackup(seed)
    expect(res.skipped).toEqual([])
    expect(res.collections).toBeGreaterThan(0)
    expect(res.records).toBeGreaterThan(0)
    expect(res.records).toBe(31)

    const out = exportFullBackup()
    expect(out).toMatchObject({ app: 'bms', type: 'full-backup', version: 1 })
    // التصدير يعيد نفس كل مجموعة من المجموعات المستوردة (بالإضافة إلى users الفارغة)
    Object.keys(seed.collections).forEach(k => {
      expect(out.collections[k].length).toBe(seed.collections[k].length)
    })
    expect(out.collections.users || []).toHaveLength(0)
  })
})
