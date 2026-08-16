import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { migrateStorageVersion, STORAGE_VERSION } from '@/services/db'
import '@/legacy/compat'

// كل مفاتيح التخزين مسبوقة بمعرّف العميل (bms_<clientId>_*) — V3.44
const VERSION_KEY = 'bms_trendawy_storage_version'
const DATA_PRODUCTS = 'bms_trendawy_data_products'
const DATA_ORDERS = 'bms_trendawy_data_orders'
const PENDING_OPS = 'bms_trendawy_pending_ops'
const TOMBSTONES = 'bms_trendawy_tombstones'
const SNAPSHOT_PRODUCTS = 'bms_trendawy_pending_snapshot_products'
const LEGACY_DATA = 'bms_data_products' // مفتاح قديم (قبل البادئة) قابل للهجرة

function seedOwnedCache() {
  window.localStorage.setItem(DATA_PRODUCTS, JSON.stringify([{ id: 'P1', name: 'قديم' }]))
  window.localStorage.setItem(DATA_ORDERS, JSON.stringify([{ id: 'ORD-1', status: 'new' }]))
  window.localStorage.setItem(PENDING_OPS, JSON.stringify([{ kind: 'set', collection: 'orders', docId: 'ORD-1' }]))
  window.localStorage.setItem(TOMBSTONES, JSON.stringify(['DEL-1']))
  window.localStorage.setItem(SNAPSHOT_PRODUCTS, JSON.stringify([{ id: 'P1' }]))
}

beforeEach(() => {
  window.localStorage.clear()
  window.firestoreCache.products = []
})

afterEach(() => {
  window.localStorage.clear()
})

describe('services/db.js — STORAGE_VERSION migration (v2_clean)', () => {
  it('إصدار التخزين هو v2_clean وهو مكشوف على window', () => {
    expect(STORAGE_VERSION).toBe('v2_clean')
    expect(window.STORAGE_VERSION).toBe('v2_clean')
    expect(typeof window.migrateStorageVersion).toBe('function')
  })

  it('عند اختفاء إصدار قديم/مختلف: يمسح مرايا bms_data_* المسبوقة وصفوف الانتظار والقبور واللقطات ويُثبت الإصدار الجديد', () => {
    seedOwnedCache()
    window.localStorage.setItem(VERSION_KEY, 'v1_legacy')
    const changed = migrateStorageVersion()
    expect(changed).toBe(true)
    expect(window.localStorage.getItem(DATA_PRODUCTS)).toBeNull()
    expect(window.localStorage.getItem(DATA_ORDERS)).toBeNull()
    expect(window.localStorage.getItem(PENDING_OPS)).toBeNull()
    expect(window.localStorage.getItem(TOMBSTONES)).toBeNull()
    expect(window.localStorage.getItem(SNAPSHOT_PRODUCTS)).toBeNull()
    expect(window.localStorage.getItem(VERSION_KEY)).toBe('v2_clean')
    expect(window.firestoreCache.products).toEqual([])
  })

  it('الهجرة تزيل أيضاً المفاتيح القديمة غير المسبوقة (bms_data_*) فلا يبقى أي أثر لنسخة سابقة', () => {
    window.localStorage.setItem(LEGACY_DATA, JSON.stringify([{ id: 'OLD', name: 'بقايا' }]))
    const changed = migrateStorageVersion()
    expect(changed).toBe(true)
    expect(window.localStorage.getItem(LEGACY_DATA)).toBeNull()
  })

  it('عند غياب مفتاح الإصدار تماماً (متصفح قديم) يمسح الكاش ويعتبر البيانات القديمة غير صالحة', () => {
    seedOwnedCache()
    const changed = migrateStorageVersion()
    expect(changed).toBe(true)
    expect(window.localStorage.getItem(DATA_PRODUCTS)).toBeNull()
    expect(window.localStorage.getItem(VERSION_KEY)).toBe('v2_clean')
  })

  it('عند تطابق الإصدار لا يمسح أي شيء ويعيد false', () => {
    seedOwnedCache()
    window.localStorage.setItem(VERSION_KEY, STORAGE_VERSION)
    const changed = migrateStorageVersion()
    expect(changed).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(DATA_PRODUCTS))).toEqual([{ id: 'P1', name: 'قديم' }])
    expect(window.localStorage.getItem(PENDING_OPS)).not.toBeNull()
  })

  it('إعدادات الحساسة (ai_config / firebase_config) لا تُمحى بالهجرة', () => {
    window.localStorage.setItem('bms_trendawy_ai_config', JSON.stringify({ provider: 'gemini', apiKey: 'K', model: 'M' }))
    window.localStorage.setItem('bms_trendawy_firebase_config', JSON.stringify({ apiKey: 'F' }))
    seedOwnedCache()
    migrateStorageVersion()
    expect(window.localStorage.getItem('bms_trendawy_ai_config')).not.toBeNull()
    expect(window.localStorage.getItem('bms_trendawy_firebase_config')).not.toBeNull()
  })
})
