import { describe, it, expect } from 'vitest'
import {
  getCustomers, getCustomerById, searchCustomers, findCustomerByPhone,
  findCustomerPhoneConflict, assertCustomerPhoneAvailable,
  createCustomer, updateCustomer, getCustomerAddresses, addCustomerAddress,
  setDefaultCustomerAddress, removeCustomerAddress, recalculateCustomerBalance,
} from '@/domain/customers/customers'
import { CUSTOMER_CATEGORIES, DEFAULT_CUSTOMER_CATEGORY } from '@/domain/customers/customerRules'
import { freshSystem, seedCustomer, STORAGE_KEYS } from '../helpers/fakeRepo'

describe('customerRules constants — parity', () => {
  it('exposes the legacy category list + default', () => {
    expect(CUSTOMER_CATEGORIES).toEqual([
      'تاجر جملة', 'عميل قطاعي / فردي', 'عميل محتمل',
    ])
    expect(DEFAULT_CUSTOMER_CATEGORY).toBe('تاجر جملة')
  })
})

describe('createCustomer — parity with js/services/customers.js', () => {
  it('creates a customer with derived zero-ledger defaults', () => {
    const { db, repo } = freshSystem()
    const c = createCustomer({ name: '  أحمد  ', phone: '01012345678', category: 'تاجر جملة' }, repo)

    expect(c.id).toMatch(/^CUST-/)
    expect(c.name).toBe('أحمد')
    expect(c.phone).toBe('01012345678')
    expect(c.category).toBe('تاجر جملة')
    expect(c.ordersCount).toBe(0)
    expect(c.totalPurchases).toBe(0)
    expect(c.paid).toBe(0)
    expect(c.remainingBalance).toBe(0)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)).toHaveLength(1)
  })

  it('returns the EXISTING customer when the phone is already registered', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1', phone: '01012345678' })] })
    const c = createCustomer({ name: 'مستنسخ', phone: '01012345678' }, repo)
    expect(c.id).toBe('CUST1')
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)).toHaveLength(1)
  })

  it('rejects a secondary phone identical to the primary', () => {
    const { repo } = freshSystem()
    expect(() => createCustomer({ name: 'أ', phone: '01012345678', secondaryPhone: '01012345678' }, repo)).toThrow(/الثانوي لا يمكن أن يطابق/)
  })

  it('rejects a secondary phone that already belongs to another customer', () => {
    const { db, repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1', phone: '01000000000', secondaryPhone: '01111111111' })] })
    expect(() => createCustomer({ name: 'ب', phone: '01099999999', secondaryPhone: '01111111111' }, repo)).toThrow(/مسجل بالفعل/)
    expect(db.getCollection(STORAGE_KEYS.CUSTOMERS)).toHaveLength(1)
  })

  it('auto-builds the default address record from the address text', () => {
    const { repo } = freshSystem()
    const c = createCustomer({ name: 'أ', phone: '01012345678', address: 'القاهرة' }, repo)
    expect(c.address).toBe('القاهرة')
    expect(c.addresses).toHaveLength(1)
    expect(c.addresses[0]).toMatchObject({ label: 'العنوان الأساسي', address: 'القاهرة', isDefault: true })
  })
})

describe('phone lookup + uniqueness helpers', () => {
  const twoCustomers = {
    [STORAGE_KEYS.CUSTOMERS]: [
      seedCustomer({ id: 'CUST1', name: 'أحمد', phone: '01012345678' }),
      seedCustomer({ id: 'CUST2', name: 'محمود', phone: '01112345678', secondaryPhone: '01212345678' }),
    ],
  }

  it('findCustomerByPhone matches primary OR secondary after normalization', () => {
    const { repo } = freshSystem(twoCustomers)
    expect(findCustomerByPhone(repo.getCustomers(), '01012345678').id).toBe('CUST1')
    expect(findCustomerByPhone(repo.getCustomers(), '01212345678').id).toBe('CUST2')
    expect(findCustomerByPhone(repo.getCustomers(), '+201012345678').id).toBe('CUST1') // normalized intl
    expect(findCustomerByPhone(repo.getCustomers(), '99999999999')).toBeNull()
  })

  it('excludeId skips the customer itself (edit flow)', () => {
    const { repo } = freshSystem(twoCustomers)
    expect(findCustomerByPhone(repo.getCustomers(), '01112345678', 'CUST2')).toBeNull()
  })

  it('findCustomerPhoneConflict checks both numbers; assert throws with owner name', () => {
    const { repo } = freshSystem(twoCustomers)
    expect(findCustomerPhoneConflict(repo.getCustomers(), '01012345678', '')).not.toBeNull()
    expect(findCustomerPhoneConflict(repo.getCustomers(), '', '01212345678')).not.toBeNull()
    expect(() => assertCustomerPhoneAvailable(repo.getCustomers(), '01012345678', '')).toThrow(/أحمد/)
  })
})

describe('updateCustomer — parity', () => {
  it('strips address/addresses from updates and sets updatedAt', () => {
    const { repo } = freshSystem({ [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1', address: 'شارع قديم' })] })
    const c = updateCustomer('CUST1', { name: 'اسم جديد', address: 'شارع ممنوع', addresses: [] }, repo)
    expect(c.name).toBe('اسم جديد')
    expect(c.address).toBe('شارع قديم')
  })

  it('rejects an edit that collides with another customer phone', () => {
    const { repo } = freshSystem({
      [STORAGE_KEYS.CUSTOMERS]: [
        seedCustomer({ id: 'CUST1', phone: '01012345678' }),
        seedCustomer({ id: 'CUST2', phone: '01112345678' }),
      ],
    })
    expect(() => updateCustomer('CUST2', { phone: '01012345678' }, repo)).toThrow(/مسجل بالفعل/)
  })
})

describe('customer addresses — parity', () => {
  it('add first address (auto default), add second (non-default), then force a new default', () => {
    const { repo } = freshSystem()
    const c = createCustomer({ name: 'أ', phone: '01012345678' }, repo)

    const first = addCustomerAddress(c.id, { label: 'بيت', address: 'المنزل' }, repo)
    expect(first.isDefault).toBe(true)
    expect(getCustomerAddresses(c.id, repo)).toHaveLength(1)

    const second = addCustomerAddress(c.id, { label: 'شغل', address: 'العمل' }, repo)
    expect(second.isDefault).toBe(false)
    expect(getCustomerAddresses(c.id, repo)).toHaveLength(2)

    const forced = addCustomerAddress(c.id, { label: 'مفضل', address: 'المفضل', isDefault: true }, repo)
    expect(forced.isDefault).toBe(true)
    const all = getCustomerAddresses(c.id, repo)
    expect(all.filter(a => a.isDefault)).toHaveLength(1)
    expect(all.find(a => a.id === forced.id).isDefault).toBe(true)
  })

  it('setDefaultCustomerAddress switches the default; remove refuses to delete the last address', () => {
    const { repo } = freshSystem()
    const c = createCustomer({ name: 'أ', phone: '01012345678' }, repo)
    const first = addCustomerAddress(c.id, { address: 'أ' }, repo)
    const second = addCustomerAddress(c.id, { address: 'ب' }, repo)

    setDefaultCustomerAddress(c.id, second.id, repo)
    let all = getCustomerAddresses(c.id, repo)
    expect(all.find(a => a.id === second.id).isDefault).toBe(true)
    expect(all.find(a => a.id === first.id).isDefault).toBe(false)

    removeCustomerAddress(c.id, first.id, repo)
    all = getCustomerAddresses(c.id, repo)
    expect(all).toHaveLength(1)
    expect(() => removeCustomerAddress(c.id, all[0].id, repo)).toThrow(/لا يمكن حذف العنوان الوحيد/)
  })
})

describe('recalculateCustomerBalance — audit engine parity', () => {
  it('recomputes debt from orders + payments (legacy formula)', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.ORDERS]: [
        { id: 'ORD-1', status: 'delivered', customerId: 'CUST1', totalAmount: 600, downPayment: 100, createdAt: '2026-08-01 10:00', updatedAt: '2026-08-01 10:00' },
        { id: 'ORD-2', status: 'cancelled', customerId: 'CUST1', totalAmount: 5000, downPayment: 0, createdAt: '2026-08-02 10:00', updatedAt: '2026-08-02 10:00' },
      ],
      [STORAGE_KEYS.PAYMENTS]: [
        { id: 'PAY-1', entityType: 'customer', entityId: 'CUST1', amount: 100, isDownPayment: true },
        { id: 'PAY-2', entityType: 'customer', entityId: 'CUST1', amount: 200, isDownPayment: false },
      ],
      [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1' })],
    })

    recalculateCustomerBalance('CUST1', repo)

    const c = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(c.totalPurchases).toBe(600)      // cancelled excluded
    expect(c.paid).toBe(300)                // downPayment 100 + direct 200
    expect(c.remainingBalance).toBe(300)
    expect(c.creditBalance).toBe(0)
    expect(c.ordersCount).toBe(1)
    expect(c.lastOrderDate).toBe('2026-08-01 10:00')
  })

  it('surfaces overpayments as an explicit creditBalance (V3.15.1)', () => {
    const { db, repo } = freshSystem({
      [STORAGE_KEYS.ORDERS]: [
        { id: 'ORD-1', status: 'completed', customerId: 'CUST1', totalAmount: 600, downPayment: 600, createdAt: '2026-08-01 10:00', updatedAt: '2026-08-01 10:00' },
      ],
      [STORAGE_KEYS.PAYMENTS]: [
        { id: 'PAY-1', entityType: 'customer', entityId: 'CUST1', amount: 600, isDownPayment: true },
        { id: 'PAY-2', entityType: 'customer', entityId: 'CUST1', amount: 50, isDownPayment: false },
      ],
      [STORAGE_KEYS.CUSTOMERS]: [seedCustomer({ id: 'CUST1' })],
    })

    recalculateCustomerBalance('CUST1', repo)

    const c = db.getCollection(STORAGE_KEYS.CUSTOMERS)[0]
    expect(c.remainingBalance).toBe(0)
    expect(c.creditBalance).toBe(50)
  })
})

describe('list query helpers', () => {
  it('getCustomers / getCustomerById / searchCustomers', () => {
    const list = [
      seedCustomer({ id: 'CUST1', name: 'أحمد', phone: '01012345678' }),
      seedCustomer({ id: 'CUST2', name: 'محمود', phone: '01112345678', secondaryPhone: '01234567890' }),
    ]
    expect(getCustomers(list)).toBe(list)
    expect(getCustomerById(list, 'CUST2').name).toBe('محمود')
    expect(getCustomerById(list, 'X')).toBeNull()
    expect(searchCustomers(list, 'مح')).toHaveLength(1)
    expect(searchCustomers(list, '34567890')).toHaveLength(1)
    expect(searchCustomers(list, '')).toHaveLength(2)
  })
})
