import { describe, it, expect } from 'vitest'
import { toNumber, round2, formatCurrency, formatDate, getCairoFormattedDate, generateAutoId, toSubunits } from '@/utils/formatters'
import { EGYPT_GOVERNORATES, CITY_CUSTOM_STORAGE_KEY, getCitiesForGovernorate, addCustomCity, parseAddressComponents, citySelectOptions } from '@/utils/egypt'
import { normalizePhone, validateEgyptianPhone } from '@/utils/phones'

describe('formatters (parity with js/utils/formatters.js)', () => {
  it('toNumber: NaN/undefined/empty collapse to 0', () => {
    expect(toNumber(undefined)).toBe(0)
    expect(toNumber(null)).toBe(0)
    expect(toNumber('')).toBe(0)
    expect(toNumber('   ')).toBe(0)
    expect(toNumber(NaN)).toBe(0)
    expect(toNumber('12.5')).toBe(12.5)
    expect(toNumber(2000.5)).toBe(2000.5)
  })

  it('round2: float-safe precision', () => {
    expect(round2(2000.0000000001)).toBe(2000)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(NaN)).toBe(0)
    expect(round2('12.345')).toBe(12.35)
    expect(round2(undefined)).toBe(0)
  })

  it('formatCurrency: EGP with arabic numerals', () => {
    expect(formatCurrency(250)).toBe('٢٥٠ ج.م')
    expect(formatCurrency(0.5)).toBe('٠٫٥٠ ج.م')
    expect(formatCurrency(undefined)).toBe('٠ ج.م')
    expect(formatCurrency('570')).toBe('٥٧٠ ج.م')
  })

  it('formatDate: empty → — , invalid passthrough', () => {
    expect(formatDate('')).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })

  it('getCairoFormattedDate: YYYY-MM-DD HH:mm in Africa/Cairo', () => {
    // Jan 5 2026 12:00 UTC = 14:00 Cairo (UTC+2, no DST in January)
    const s = getCairoFormattedDate(new Date('2026-01-05T12:00:00Z'))
    expect(s).toBe('2026-01-05 14:00')
    expect(getCairoFormattedDate(new Date(NaN))).toBe('—')
  })

  it('generateAutoId: prefix + strong (timestamp+random) suffix', () => {
    const id = generateAutoId('PAY')
    expect(/^PAY-[0-9a-z]{8,}$/.test(id)).toBe(true)
    expect(generateAutoId()).toMatch(/^ID-[0-9a-z]{8,}$/)
    expect(generateAutoId('PAY')).not.toBe(generateAutoId('PAY'))
  })

  it('toSubunits honours the factor parameter', () => {
    expect(toSubunits(5.5)).toBe(550)
    expect(toSubunits(5.5, 1000)).toBe(5500)
    expect(toSubunits(2.25, 4)).toBe(9)
    expect(toSubunits(NaN)).toBe(0)
    expect(toSubunits(Infinity)).toBe(0)
  })
})

describe('egypt (parity with formatters.js regions/address helpers)', () => {
  it('EGYPT_GOVERNORATES integrity', () => {
    expect(Object.keys(EGYPT_GOVERNORATES).length).toBeGreaterThan(20)
    expect(EGYPT_GOVERNORATES['القاهرة']).toContain('مدينة نصر')
    expect(CITY_CUSTOM_STORAGE_KEY).toBe('bms_trendawy_city_custom_entries')
  })

  it('parseAddressComponents: 3-part and fallback', () => {
    expect(parseAddressComponents('القاهرة - مدينة نصر - شارع النصر')).toEqual({
      governorate: 'القاهرة', city: 'مدينة نصر', details: 'شارع النصر'
    })
    expect(parseAddressComponents('')).toEqual({
      governorate: 'القاهرة', city: 'مدينة نصر', details: ''
    })
  })

  it('addCustomCity + getCitiesForGovernorate persist via localStorage', () => {
    localStorage.removeItem(CITY_CUSTOM_STORAGE_KEY)
    expect(addCustomCity('القاهرة', 'مدينة نصر')).toBe(false) // already built-in
    expect(addCustomCity('القاهرة', 'حى المنيل الجديدة')).toBe(true)
    expect(getCitiesForGovernorate('القاهرة')).toContain('حى المنيل الجديدة')
    localStorage.removeItem(CITY_CUSTOM_STORAGE_KEY)
  })

  it('citySelectOptions includes manual-entry option', () => {
    expect(citySelectOptions('القاهرة')).toContain('__other__')
  })

  it('citySelectOptions يهرّب أسماء المدن المخصصة (XSS) في القيمة والنص', () => {
    localStorage.removeItem(CITY_CUSTOM_STORAGE_KEY)
    addCustomCity('القاهرة', '<script>alert(1)</script>')
    addCustomCity('القاهرة', 'مدينة "الخوف"')
    const html = citySelectOptions('القاهرة')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;')
    localStorage.removeItem(CITY_CUSTOM_STORAGE_KEY)
  })
})

describe('phones (parity with formatters.js phone helpers)', () => {
  it('validateEgyptianPhone: valid prefixes 010/011/012/015', () => {
    expect(validateEgyptianPhone('01012345678').isValid).toBe(true)
    expect(validateEgyptianPhone('01112345678').isValid).toBe(true)
    expect(validateEgyptianPhone('01234567890').isValid).toBe(true)
    expect(validateEgyptianPhone('01512345678').isValid).toBe(true)
    expect(validateEgyptianPhone('01912345678').isValid).toBe(false)
    expect(validateEgyptianPhone('010123').isValid).toBe(false)
    expect(validateEgyptianPhone('').isValid).toBe(false)
  })

  it('normalizePhone: country-code forms → local 11-digit', () => {
    expect(normalizePhone('+201012345678')).toBe('01012345678')
    expect(normalizePhone('00201012345678')).toBe('01012345678')
    expect(normalizePhone('010 1234 5678')).toBe('01012345678')
    expect(normalizePhone('')).toBe('')
  })

  it('validateEgyptianPhone normalizes before matching (V3.58)', () => {
    expect(validateEgyptianPhone('+201012345678').isValid).toBe(true)
    expect(validateEgyptianPhone('+201012345678').cleaned).toBe('01012345678')
    expect(validateEgyptianPhone('010 1234 5678').isValid).toBe(true)
    expect(validateEgyptianPhone('00201012345678').cleaned).toBe('01012345678')
    expect(validateEgyptianPhone('0101234567').isValid).toBe(false)
    expect(validateEgyptianPhone('01912345678').isValid).toBe(false)
  })
})
