import { describe, it, expect } from 'vitest'
import {
  visibleNavItems,
  canCreateOrder,
  canUsePos,
  canUseAi,
  canSyncOrTest,
  canRecordPayment,
  canManageUsers,
  canManageSettings,
  canManageExpenses,
  canManageProducts,
  canDeleteProduct,
  canAddSupplier,
  canSeePurchasePrice,
  canSeeSupplierContact,
  canViewAllOrders,
  canUpdateOrderStatus,
  canSeeDashboard,
  canSeeAnalytics,
  canSeeFinancialReports,
  canRecalcOrWipe,
} from '@/services/permissions'

const ROLES = ['admin', 'employee', 'storekeeper', 'accountant']

describe('permissions (services/permissions.js) — V3.43 RBAC', () => {
  it('admin: كل الصلاحيات مفعّلة', () => {
    const gates = [
      canCreateOrder, canUsePos, canUseAi, canSyncOrTest, canRecordPayment,
      canManageUsers, canManageSettings, canManageExpenses, canManageProducts,
      canDeleteProduct, canAddSupplier, canSeePurchasePrice, canSeeSupplierContact,
      canViewAllOrders, canUpdateOrderStatus, canSeeDashboard, canSeeAnalytics, canSeeFinancialReports,
      canRecalcOrWipe,
    ]
    gates.forEach(gate => expect(gate('admin'), gate.name).toBe(true))
  })

  it('employee (كاشير): إنشاء طلبات وكاشير وتحديث حالة فقط — بلا مزايا مالية/إدارية', () => {
    expect(canCreateOrder('employee')).toBe(true)
    expect(canUsePos('employee')).toBe(true)
    expect(canUpdateOrderStatus('employee')).toBe(true)
    expect(canUseAi('employee')).toBe(false)
    expect(canSyncOrTest('employee')).toBe(false)
    expect(canRecordPayment('employee')).toBe(false)
    expect(canManageUsers('employee')).toBe(false)
    expect(canManageSettings('employee')).toBe(false)
    expect(canManageExpenses('employee')).toBe(false)
    expect(canManageProducts('employee')).toBe(false)
    expect(canDeleteProduct('employee')).toBe(false)
    expect(canAddSupplier('employee')).toBe(false)
    expect(canSeePurchasePrice('employee')).toBe(false)
    expect(canSeeSupplierContact('employee')).toBe(false)
    expect(canViewAllOrders('employee')).toBe(false)
    expect(canSeeDashboard('employee')).toBe(false)
    expect(canSeeAnalytics('employee')).toBe(false)
    expect(canSeeFinancialReports('employee')).toBe(false)
    expect(canRecalcOrWipe('employee')).toBe(false)
  })

  it('storekeeper (أمين مخزن): إدارة المنتجات والشحنات ورؤية التكلفة — بلا أزرار مالية/كاشير', () => {
    expect(canManageProducts('storekeeper')).toBe(true)
    expect(canSeePurchasePrice('storekeeper')).toBe(true)
    expect(canCreateOrder('storekeeper')).toBe(false)
    expect(canUsePos('storekeeper')).toBe(false)
    expect(canUseAi('storekeeper')).toBe(false)
    expect(canSyncOrTest('storekeeper')).toBe(false)
    expect(canRecordPayment('storekeeper')).toBe(false)
    expect(canManageUsers('storekeeper')).toBe(false)
    expect(canManageSettings('storekeeper')).toBe(false)
    expect(canManageExpenses('storekeeper')).toBe(false)
    expect(canDeleteProduct('storekeeper')).toBe(false)
    expect(canAddSupplier('storekeeper')).toBe(false)
    expect(canSeeSupplierContact('storekeeper')).toBe(false)
    expect(canViewAllOrders('storekeeper')).toBe(false)
    expect(canUpdateOrderStatus('storekeeper')).toBe(false)
    expect(canSeeDashboard('storekeeper')).toBe(false)
    expect(canSeeAnalytics('storekeeper')).toBe(false)
    expect(canSeeFinancialReports('storekeeper')).toBe(false)
    expect(canRecalcOrWipe('storekeeper')).toBe(false)
  })

  it('accountant (محاسب): مالية (مدفوعات/مصروفات/تقارير/موردون) — بلا إعدادات وبدون تعديل منتجات', () => {
    expect(canRecordPayment('accountant')).toBe(true)
    expect(canManageExpenses('accountant')).toBe(true)
    expect(canSeeDashboard('accountant')).toBe(true)
    expect(canSeeAnalytics('accountant')).toBe(true)
    expect(canSeeFinancialReports('accountant')).toBe(true)
    expect(canViewAllOrders('accountant')).toBe(true)
    expect(canSeePurchasePrice('accountant')).toBe(true)
    expect(canCreateOrder('accountant')).toBe(false)
    expect(canUsePos('accountant')).toBe(false)
    expect(canUpdateOrderStatus('accountant')).toBe(false)
    expect(canUseAi('accountant')).toBe(false)
    expect(canSyncOrTest('accountant')).toBe(false)
    expect(canManageUsers('accountant')).toBe(false)
    expect(canManageSettings('accountant')).toBe(false)
    expect(canManageProducts('accountant')).toBe(false)
    expect(canDeleteProduct('accountant')).toBe(false)
    expect(canAddSupplier('accountant')).toBe(false)
    expect(canSeeSupplierContact('accountant')).toBe(true)
    expect(canRecalcOrWipe('accountant')).toBe(false)
  })

  it('دور غير معروف / بلا جلسة (null): لا صلاحيات خاصة (توافق قديم في الشاشات فقط)', () => {
    ROLES.concat(['unknown', null, undefined]).forEach(role => {
      expect(canCreateOrder(role), role).toBe(role === 'admin' || role === 'employee')
    })
    expect(canUseAi(null)).toBe(false)
    expect(canManageSettings(null)).toBe(false)
    expect(canManageUsers(null)).toBe(false)
    expect(canRecalcOrWipe(undefined)).toBe(false)
  })

  it('visibleNavItems حسب الدور', () => {
    expect(visibleNavItems('admin')).toEqual([
      'dashboard', 'analytics', 'orders', 'customers', 'products', 'suppliers',
      'expenses', 'payments', 'reports', 'users', 'settings',
    ])
    expect(visibleNavItems('employee')).toEqual(['orders', 'customers', 'products'])
    expect(visibleNavItems('storekeeper')).toEqual(['products'])
    expect(visibleNavItems('accountant')).toEqual([
      'dashboard', 'analytics', 'orders', 'customers', 'products', 'suppliers',
      'expenses', 'payments', 'reports',
    ])
  })

  it('visibleNavItems لغير المعروف/null يعيد القائمة الكاملة (توافق قديم/معاينة)', () => {
    expect(visibleNavItems(null)).toEqual([
      'dashboard', 'analytics', 'orders', 'customers', 'products', 'suppliers',
      'expenses', 'payments', 'reports', 'users', 'settings',
    ])
    expect(visibleNavItems('whatever')).toEqual(visibleNavItems('admin'))
  })
})


