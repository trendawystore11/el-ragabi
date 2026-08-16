import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toCsvString, parseCsvText, readWorkbookSheets } from '@/utils/excel'

describe('CSV offline helpers (V3.59)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('toCsvString emits a BOM + quoted fields + CRLF', () => {
    const csv = toCsvString([
      { 'اسم العميل': 'محمد، علي', 'رقم الهاتف': '0100', 'ملاحظة': 'سطر\nثانٍ' },
      { 'اسم العميل': 'أحمد', 'رقم الهاتف': '0111', 'ملاحظة': 'لا شيء' },
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"محمد، علي"')
    expect(csv).toContain('"سطر\nثانٍ"')
    expect(csv).toContain('\r\n')
  })

  it('parseCsvText round-trips a CSV string into header-keyed objects', () => {
    const csv = toCsvString([
      { id: 'C-1', name: 'محمد', note: 'أ، ب' },
      { id: 'C-2', name: 'سطر\nجديد', note: '' },
    ])
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: 'C-1', name: 'محمد', note: 'أ، ب' })
    expect(rows[1]).toEqual({ id: 'C-2', name: 'سطر\nجديد', note: '' })
  })

  it('parseCsvText strips the BOM and skips empty lines', () => {
    const rows = parseCsvText('\uFEFFاسم\n\nمحمد\n')
    expect(rows).toEqual([{ 'اسم': 'محمد' }])
  })

  it('readWorkbookSheets reads a CSV file into one sheet', async () => {
    const file = { name: 'orders.csv', text: () => Promise.resolve('id,name\nO-1,فاتورة') }
    const sheets = await readWorkbookSheets(file)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].title).toBe('CSV')
    expect(sheets[0].headers).toEqual(['id', 'name'])
    expect(sheets[0].rows).toEqual([{ id: 'O-1', name: 'فاتورة' }])
  })
})
