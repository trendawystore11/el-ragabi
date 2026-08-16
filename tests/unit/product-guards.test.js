import { describe, it, expect } from 'vitest'
import { createProduct, deleteProduct, getLowStockProducts } from '@/domain/inventory/products'
import { freshSystem, seedProduct, STORAGE_KEYS } from '../helpers/fakeRepo'

describe('createProduct initial-stock & min-stock validation (V3.58)', () => {
  it('empty/missing initial stock becomes 0', () => {
    const { repo } = freshSystem()
    expect(createProduct({ name: 'مخزون صفري', code: 'S0', sellingPrice: 10 }, repo).stock).toBe(0)
    expect(createProduct({ name: 'مخزون فارغ', code: 'S1', sellingPrice: 10, stock: '' }, repo).stock).toBe(0)
  })

  it('rejects negative initial stock', () => {
    const { repo } = freshSystem()
    expect(() => createProduct({ name: 'سالب', code: 'NEG', sellingPrice: 10, stock: -5 }, repo)).toThrow(/غير سالبة/)
  })

  it('rejects non-finite initial stock (NaN/Infinity)', () => {
    const { repo } = freshSystem()
    expect(() => createProduct({ name: 'لانهاية', code: 'INF', sellingPrice: 10, stock: Infinity }, repo)).toThrow(/غير سالبة/)
    expect(() => createProduct({ name: 'نان', code: 'NAN', sellingPrice: 10, stock: NaN }, repo)).toThrow(/غير سالبة/)
  })

  it('minStock 0 is preserved (alert disabled) instead of old || 5 bug', () => {
    const { repo } = freshSystem()
    expect(createProduct({ name: 'بدون تنبيه', code: 'MS0', sellingPrice: 10, minStock: 0 }, repo).minStock).toBe(0)
  })

  it('empty minStock falls back to default 5', () => {
    const { repo } = freshSystem()
    expect(createProduct({ name: 'افتراضي', code: 'D5', sellingPrice: 10 }, repo).minStock).toBe(5)
    expect(createProduct({ name: 'افتراضي2', code: 'D6', sellingPrice: 10, minStock: '' }, repo).minStock).toBe(5)
  })

  it('invalid non-numeric minStock coerces to 0 (alert disabled)', () => {
    const { repo } = freshSystem()
    expect(createProduct({ name: 'غير صالح', code: 'BAD', sellingPrice: 10, minStock: 'abc' }, repo).minStock).toBe(0)
  })

  it('getLowStockProducts honours explicit minStock 0', () => {
    const p = seedProduct({ id: 'PRD1', stock: 1, minStock: 0 })
    expect(getLowStockProducts([p])).toHaveLength(0)
    expect(getLowStockProducts([{ ...p, stock: 0 }])).toHaveLength(1)
  })
})

describe('deleteProduct protection (V3.58)', () => {
  it('blocks deleting a product that still has stock', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 3 })] })
    await expect(deleteProduct('PRD1', repo)).rejects.toThrow(/رصيد مخزون/)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)).toHaveLength(1)
  })

  it('blocks deleting a product referenced by a non-cancelled/non-returned order', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 0 })],
      [STORAGE_KEYS.ORDERS]: [{ id: 'ORD-1', status: 'delivered', items: [{ productId: 'PRD1', quantity: 1 }] }],
    })
    await expect(deleteProduct('PRD1', repo)).rejects.toThrow(/طلبات قائمة/)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)).toHaveLength(1)
  })

  it('allows deleting an unreferenced product with zero stock', async () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 0 })] })
    await deleteProduct('PRD1', repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)).toHaveLength(0)
  })

  it('allows deleting a product only referenced by cancelled/returned orders', async () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.PRODUCTS]: [seedProduct({ id: 'PRD1', stock: 0 })],
      [STORAGE_KEYS.ORDERS]: [{ id: 'ORD-1', status: 'cancelled', items: [{ productId: 'PRD1', quantity: 1 }] }],
    })
    await deleteProduct('PRD1', repo)
    expect(db.getCollection(STORAGE_KEYS.PRODUCTS)).toHaveLength(0)
  })
})
