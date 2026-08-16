import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { importFullBackup, exportFullBackup } from '@/services/db'

const seed = JSON.parse(readFileSync(new URL('file://' + process.cwd() + '/tests/fixtures/demo-data.json')))

describe('demo-data.json — تنسيق «تصدير نسخة كاملة»', () => {
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
