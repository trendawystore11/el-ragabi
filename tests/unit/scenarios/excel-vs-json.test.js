// =============================================================================
// مقارنة تطابق تصدير/استيراد النظام بين JSON وExcel (ملفا النسخة في fixtures)
// -----------------------------------------------------------------------------
// يختبر سؤال المستخدم: هل يصدّر النظام JSON وExcel بنفس البيانات الموجودة في
// النظام بدون أي اختلاف ولا بيانات ناقصة — سواء بالتصدير أو الاستيراد بأي صيغة؟
//
// النتيجة المؤكدة من هذا الملف:
//   - JSON «تصدير نسخة كاملة» = نسخة حرفية بلا فقدان (استيراد → تصدير متطابقان).
//   - Excel (أوراق المزامنة) = صفوف متطابقة العدد للأوراق الموجودة، لكن:
//       * «دفتر الموردين» supplierTransactions (6 حركات) ليس له ورقة إطلاقاً →
//         يضيع كلياً من Excel.
//       * حقول موثقة تُسقط من الأوراق (منها lastPostedPeriod للمصروفات الدورية
//         التي تمنع الازدواج، وpaidInFull للفواتير، وcycleKey/refOrderId للدفعات).
//   - أسطر الفواتير (items) تحفظها ورقة Excel حرفياً في عمود «الأصناف (JSON)».
// =============================================================================
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { importFullBackup, exportFullBackup, forceWipeDatabase } from '@/services/db'
import { SHEETS } from '@/services/sheets'

const FIXTURE_DIR = process.cwd() + '/tests/fixtures/'
const fixturePath = name => 'file://' + FIXTURE_DIR + name

const backupFile = readdirSync(FIXTURE_DIR).find(f => f.endsWith('.json') && !f.startsWith('demo-data'))
const excelFile = readdirSync(FIXTURE_DIR).find(f => f.toLowerCase().endsWith('.xlsx'))

expect(backupFile, 'نسخة احتياطية JSON موجودة في fixtures').toBeTruthy()
expect(excelFile, 'ملف Excel موجود في fixtures').toBeTruthy()

const backup = JSON.parse(readFileSync(new URL(fixturePath(backupFile))))
const workbook = XLSX.read(readFileSync(new URL(fixturePath(excelFile))))

const defByTitle = new Map(SHEETS.map(s => [s.title, s]))

function sheetData(title) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[title], { defval: '' })
  const def = defByTitle.get(title)
  const headers = rows.length
    ? Object.keys(rows[0]).map(String)
    : (def ? def.headers.map(h => h.label) : [])
  return { rows, headers }
}

describe('نسخة JSON الكاملة — استيراد ثم تصدير بلا فقدان (lossless)', () => {
  it('كل مجموعة تُعاد بذات السجلات والحقول بعد دورة استيراد/تصدير', () => {
    window.STORAGE_KEYS.EXPENSES = 'expenses'
    window.isSandboxMode = false

    const res = importFullBackup(backup)
    expect(res.skipped).toEqual([])
    const totalRecords = Object.values(backup.collections).reduce((n, a) => n + a.length, 0)
    expect(res.records).toBe(totalRecords)

    const out = exportFullBackup()
    expect(out).toMatchObject({ app: 'bms', type: 'full-backup', version: 1 })
    Object.keys(backup.collections).forEach(k => {
      expect(out.collections[k]).toEqual(backup.collections[k])
    })
  })
})

describe('مقارنة ملفي النسخة الفعلية في fixtures: Excel مقابل JSON', () => {
  it('الأوراق الموجودة تطابق عدد سجلات كل مجموعة (parity)', () => {
    for (const def of SHEETS) {
      const col = backup.collections[def.entityKey] || []
      if (!workbook.Sheets[def.title]) {
        expect(col.length, `${def.title} — ورقة غير موجودة ⇒ لا بيانات قابلة للفقد`).toBe(0)
        continue
      }
      const { rows } = sheetData(def.title)
      expect(rows.length, `${def.title} (${def.entityKey})`).toBe(col.length)
    }
  })

  it('ترويسات كل ورقة تطابق تعريف جداول المزامنة في النظام (SHEETS)', () => {
    for (const def of SHEETS) {
      if (!workbook.Sheets[def.title]) continue
      const { headers } = sheetData(def.title)
      const expected = def.headers.map(h => h.label)
      expect([...headers].sort(), def.title).toEqual([...expected].sort())
    }
  })

  it('دفتر الموردين supplierTransactions غير ممثَّل في Excel إطلاقاً', () => {
    const ledger = backup.collections.supplierTransactions || []
    expect(ledger.length).toBeGreaterThan(0)
    // لا تعريف ورقة لهذا الدفتر في جداول المزامنة إطلاقاً ⇒ لا يمكن أن يُصدَّر لـ Excel
    expect(SHEETS.some(s => s.entityKey === 'supplierTransactions')).toBe(false)
    const wbEntityKeys = workbook.SheetNames.map(t => defByTitle.get(t)?.entityKey).filter(Boolean)
    expect(wbEntityKeys).not.toContain('supplierTransactions')
  })

  it('الحقول المسقطة من كل ورقة Excel (عقد فقدان موثق — مقابل JSON)', () => {
    const expectations = {
      orders: ['customerCategory', 'paidInFull', 'updatedAt'],
      payments: ['createdBy', 'cycleKey', 'refOrderId', 'type'],
      customers: ['creditBalance', 'lastOrderDate', 'updatedAt'],
      suppliers: ['createdAt', 'updatedAt'],
      products: [],
      users: ['passwordHash', 'passwordSalt', 'uid'],
      expenses: ['lastPostedPeriod', 'updatedAt'],
      supplierReturns: [],
    }
    for (const def of SHEETS) {
      const docs = backup.collections[def.entityKey] || []
      const covered = new Set(def.headers.map(h => h.key))
      const fields = new Set()
      for (const d of docs) for (const k of Object.keys(d)) fields.add(k)
      const missing = [...fields].filter(k => !covered.has(k)).sort()
      const expected = (expectations[def.entityKey] || []).slice().sort()
      expect(missing, `${def.title} — حقول JSON غير الممثلة في Excel`).toEqual(expected)
    }
  })

  it('خطوط الفواتير (items) لا تضيع: عمود «الأصناف (JSON)» يطابق مصفوفة items الأصلية', () => {
    const { rows, headers } = sheetData('Orders_Sales')
    const itemsCol = 'الأصناف (JSON)'
    expect(headers).toContain(itemsCol)
    const byId = new Map((backup.collections.orders || []).map(o => [o.id, o]))
    for (const row of rows) {
      const id = row['رقم الطلب (ID)']
      const original = byId.get(id)
      expect(original, `الطلب ${id} موجود في النسخة JSON`).toBeTruthy()
      const cell = row[itemsCol]
      const parsed = (typeof cell === 'string' && cell.trim()) ? JSON.parse(cell) : []
      expect(parsed.length).toBe(original.items.length)
      expect(parsed.map(i => i.productId)).toEqual(original.items.map(i => i.productId))
      expect(parsed.map(i => i.quantity)).toEqual(original.items.map(i => i.quantity))
    }
  })
})

describe('الدورة الكاملة: تصدير JSON → تصفير → استيراد → كل البيانات ترجع حرفياً', () => {
  it('بعد التصفير تُصفَّر كل المجموعات (عدا حسابات المديرين) ثم الاستيراد يعيدها كما كانت قبل التصفير', async () => {
    window.STORAGE_KEYS.EXPENSES = 'expenses'
    window.isSandboxMode = false
    window.showToast = () => {}
    window.verifyAdminPassword = async () => true

    importFullBackup(backup)
    const before = exportFullBackup()

    // 1) تصفير فعلي عبر قناة النظام نفسها (forceWipeDatabase)
    vi.useFakeTimers() // يمنع تنفيذ window.location.reload المجدول بعد التصفير
    const wiped = await forceWipeDatabase('admin-pass')
    expect(wiped).toBe(true)

    // 2) بعد التصفير: كل مجموعة فارغة — عدا حسابات المديرين (الحماية من الإغلاق)
    const afterWipe = exportFullBackup()
    Object.keys(before.collections).forEach(k => {
      if (k === 'users') {
        expect(afterWipe.collections.users, 'المدير يبقى بعد التصفير').toHaveLength(1)
        expect(afterWipe.collections.users[0].id).toBe('USR-1001')
      } else {
        expect(afterWipe.collections[k], `${k} تُصفَّر`).toEqual([])
      }
    })
    expect(afterWipe.collections.supplierTransactions).toEqual([])

    // 3) استيراد ملف الجيسون الذي نزّله المستخدم
    const res = importFullBackup(backup)
    expect(res.skipped).toEqual([])
    vi.useRealTimers()

    // 4) كل مجموعة ترجع حرفياً بنفس السجلات والحقول قبل التصفير — بلا أي نقص
    const restored = exportFullBackup()
    Object.keys(before.collections).forEach(k => {
      expect(restored.collections[k]).toEqual(before.collections[k])
    })
    expect(restored.collections.supplierTransactions).toEqual(before.collections.supplierTransactions)
  })
})
