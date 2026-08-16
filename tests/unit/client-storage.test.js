import { describe, it, expect } from 'vitest'
import { storageKey, isOwnKey, isDataKey, isSnapshotKey } from '@/client/storage'
import { CLIENT } from '@/client/config'

describe('client/storage — عزل التخزين المحلي بمعرّف العميل (V3.44)', () => {
  it('storageKey تسبق المفتاح ببادئة bms_<clientId>_', () => {
    expect(storageKey('data_customers')).toBe('bms_' + CLIENT.clientId + '_data_customers')
    expect(storageKey('firebase_config')).toBe('bms_' + CLIENT.clientId + '_firebase_config')
  })

  it('isOwnKey تُميّز مفاتيح هذا العميل (وتقبل القديمة القابلة للهجرة فقط)', () => {
    expect(isOwnKey(storageKey('data_orders'))).toBe(true)
    expect(isOwnKey(storageKey('ai_config'))).toBe(true)
    expect(isOwnKey('bms_data_orders')).toBe(true)          // مفتاح قديم (هجرة)
    expect(isOwnKey('bms_pending_ops')).toBe(true)          // مفتاح قديم (هجرة)
    expect(isOwnKey('bms_' + CLIENT.clientId + '_custom')).toBe(true)
    expect(isOwnKey('bms_otherclient_data_orders')).toBe(false) // عميل آخر — لا يُمسّ
    expect(isOwnKey('not-a-bms-key')).toBe(false)
  })

  it('isDataKey / isSnapshotKey تكتشف مرايا بيانات هذا العميل وقديمة الهجرة', () => {
    expect(isDataKey(storageKey('data_products'))).toBe(true)
    expect(isDataKey('bms_data_products')).toBe(true)
    expect(isDataKey(storageKey('ai_config'))).toBe(false)
    expect(isSnapshotKey(storageKey('pending_snapshot_orders'))).toBe(true)
    expect(isSnapshotKey('bms_pending_snapshot_orders')).toBe(true)
    expect(isSnapshotKey(storageKey('data_orders'))).toBe(false)
  })
})
