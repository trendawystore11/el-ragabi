import { describe, it, expect } from 'vitest'
import {
  getSuppliers, getSupplierById, searchSuppliers, findSupplierByPhone,
  findSupplierPhoneConflict, assertSupplierPhoneAvailable,
  createSupplier, updateSupplier,
} from '@/domain/suppliers/suppliers'
import { freshSystem, seedSupplier, STORAGE_KEYS } from '../helpers/fakeRepo'

describe('createSupplier — parity with js/services/suppliers.js', () => {
  it('creates a supplier; remainingBalance = totalPurchases − paid', () => {
    const { db, repo } = freshSystem()
    const s = createSupplier({ name: 'مورد نسيج', phone: '01012345678', totalPurchases: 1000, paid: 300 }, repo)
    expect(s.id).toMatch(/^SUP-/)
    expect(s.remainingBalance).toBe(700)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)).toHaveLength(1)
  })

  it('rejects duplicate primary phone with the owner name in the message', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'مورد قديم', phone: '01012345678' })] })
    expect(() => createSupplier({ name: 'مورد جديد', phone: '01012345678' }, repo)).toThrow(/مسجل بالفعل لمورد آخر/)
    expect(db.getCollection(STORAGE_KEYS.SUPPLIERS)).toHaveLength(1)
  })

  it('rejects secondary phone identical to primary', () => {
    const { repo } = freshSystem()
    expect(() => createSupplier({ name: 'أ', phone: '01012345678', secondaryPhone: '01012345678' }, repo)).toThrow(/الثانوي لا يمكن أن يطابق/)
  })

  it('rejects a secondary phone already used by another supplier', () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', phone: '01000000000', secondaryPhone: '01111111111' })],
    })
    expect(() => createSupplier({ name: 'ب', phone: '01099999999', secondaryPhone: '01111111111' }, repo)).toThrow(/مسجل بالفعل/)
  })
})

describe('supplier phone uniqueness on edit', () => {
  it('updateSupplier rejects a phone owned by another supplier', () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [
        seedSupplier({ id: 'SUP1', phone: '01012345678' }),
        seedSupplier({ id: 'SUP2', phone: '01112345678' }),
      ],
    })
    expect(() => updateSupplier('SUP2', { phone: '01012345678' }, repo)).toThrow(/مسجل بالفعل/)
  })

  it('updateSupplier applies non-phone fields and returns the refreshed doc', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.SUPPLIERS]: [seedSupplier({ id: 'SUP1', name: 'قديم' })] })
    const s = updateSupplier('SUP1', { name: 'جديد', address: 'العتبة' }, repo)
    expect(s.name).toBe('جديد')
    expect(s.address).toBe('العتبة')
    expect(s.phone).toBe('01000000000')
  })
})

describe('lookup helpers', () => {
  it('findSupplierByPhone matches primary or secondary, with excludeId', () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.SUPPLIERS]: [
        seedSupplier({ id: 'SUP1', phone: '01012345678' }),
        seedSupplier({ id: 'SUP2', phone: '01112345678', secondaryPhone: '01212345678' }),
      ],
    })
    expect(findSupplierByPhone(repo.getSuppliers(), '01012345678').id).toBe('SUP1')
    expect(findSupplierByPhone(repo.getSuppliers(), '01212345678').id).toBe('SUP2')
    expect(findSupplierByPhone(repo.getSuppliers(), '01012345678', 'SUP1')).toBeNull()
    expect(findSupplierPhoneConflict(repo.getSuppliers(), '', '01212345678')).not.toBeNull()
    expect(() => assertSupplierPhoneAvailable(repo.getSuppliers(), '01112345678', '')).toThrow(/مورد/)
  })
})

describe('list query helpers', () => {
  it('getSuppliers / getSupplierById / searchSuppliers', () => {
    const list = [
      seedSupplier({ id: 'SUP1', name: 'مورد أقمشة', phone: '01012345678' }),
      seedSupplier({ id: 'SUP2', name: 'مورد أكسسوار', phone: '01112345678' }),
    ]
    expect(getSuppliers(list)).toBe(list)
    expect(getSupplierById(list, 'SUP2').name).toBe('مورد أكسسوار')
    expect(getSupplierById(list, 'X')).toBeNull()
    expect(searchSuppliers(list, 'أكسسوار')).toHaveLength(1)
    expect(searchSuppliers(list, '01112')).toHaveLength(1)
    expect(searchSuppliers(list, '')).toHaveLength(2)
  })
})
