import { describe, it, expect } from 'vitest'
import { CLIENT, DEFAULT_CONFIG, SHEETS_SYNC_CONFIG } from '@/client/config'
import { getSettings } from '@/services/settings'
import { formatCurrency, getCairoFormattedDate } from '@/utils/formatters'
import { EGYPT_GOVERNORATES, getCitiesForGovernorate, parseAddressComponents } from '@/utils/egypt'
import { CUSTOMER_CATEGORIES, DEFAULT_CUSTOMER_CATEGORY } from '@/domain/customers/customerRules'
import { EXPENSE_CATEGORIES } from '@/state/expensesStore'

describe('client.config (ملف التخصيص المركزي) — نسخة عميل = تعديل ملف واحد', () => {
  it('هوية المتجر تُقرأ من config: اسم/شعار/لون/مظهر', () => {
    const d = getSettings()
    expect(d.appName).toBe(CLIENT.appName)
    expect(d.tagline).toBe(CLIENT.tagline)
    expect(d.logo).toBe(CLIENT.logo)
    expect(d.primaryColor).toBe(CLIENT.primaryColor)
    expect(d.theme).toBe(CLIENT.theme)
  })

  it('العملة والتوقيت يُقرآن من config', () => {
    expect(formatCurrency(250)).toContain(CLIENT.currency.symbol)
    const s = getCairoFormattedDate(new Date('2026-01-05T12:00:00Z'))
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('المحافظات والمنطقة الافتراضية تُقرآن من config', () => {
    expect(EGYPT_GOVERNORATES).toBe(CLIENT.region.governorates)
    const firstGov = Object.keys(CLIENT.region.governorates)[0]
    expect(getCitiesForGovernorate(firstGov).length).toBeGreaterThan(0)
    expect(parseAddressComponents('').governorate).toBe(CLIENT.region.defaultGovernorate)
  })

  it('قواعد البيزنس (عملاء/مصروفات) تُقرأ من config', () => {
    expect(CUSTOMER_CATEGORIES).toBe(CLIENT.customerCategories)
    expect(DEFAULT_CUSTOMER_CATEGORY).toBe(CLIENT.defaultCustomerCategory)
    expect(EXPENSE_CATEGORIES).toBe(CLIENT.expenseCategories)
  })

  it('البنية الافتراضية والربط المتوافق متوفرة في config', () => {
    expect(DEFAULT_CONFIG).toBeDefined()
    expect(DEFAULT_CONFIG.sheets).toBe(SHEETS_SYNC_CONFIG)
    expect(DEFAULT_CONFIG.aiProvider).toBe('gemini')
    expect(DEFAULT_CONFIG.aiModel).toBe('gemini-3.1-flash-lite')
    expect(DEFAULT_CONFIG.geminiApiKey).toBeDefined()
  })
})
