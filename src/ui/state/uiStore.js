// =============================================================================
// ui/state/uiStore.js — مخزن حالة الواجهة (النوافذ) — بديل js/utils/modal.js
// -----------------------------------------------------------------------------
// يحمل حالة النوافذ التفاعلية (نافذة فاتورة البيع الجديدة + نافذة تفاصيل
// الفاتورة + نافذة تحديث الحالة) ودوال فتح/إغلاق. openOrderModal(onSuccess?)
// تقبل استدعاء اختياري يُنفَّذ بعد الحفظ (نفس توقيع
// window.openNewOrderModal(onSuccessCallback) القديم)، وopenOrderStatusModal
// تأخذ (orderId, currentStatus, onDone) بنفس توقيع window.openOrderStatusModal.
// =============================================================================
import { create } from 'zustand'
import { showToast } from '../components/toastStore.js'
import {
  canCreateOrder,
  canUsePos,
  canUseAi,
  canManageProducts,
  canManageExpenses,
  canRecordPayment,
  canAddSupplier,
  canManageSettings,
  canManageUsers,
  canAdjustTreasury,
} from '@/services/permissions'

// 🔐 قراءة الدور الحالي من جلسة getCurrentUser (نفس مصدر الحقيقة في auth.js).
function currentRoleValue() {
  const user = typeof window !== 'undefined' && window.getCurrentUser ? window.getCurrentUser() : null
  return user && user.role ? user.role : null
}

// 🔐 حماية صارمة (V3.57 — fail-closed): لا جلسة → رفض. الدور المخول فقط يمر.
// غياب جلسة (null/undefined) لم يعد يُفتح — أي عملية بلا مستخدم مسجّل مرفوضة.
function hasPermission(predicate) {
  const role = currentRoleValue()
  if (role === null || role === undefined) return false
  return predicate(role)
}

export const useUiStore = create(set => ({
  orderModal: { open: false, onSuccess: null, initialData: null },

  posModal: { open: false, onSuccess: null },

  aiAssistantModal: { open: false },

  orderDetailsModal: { open: false, orderId: null },

  orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null },

  customerModal: { open: false, customerId: null, onDone: null, initialData: null },

  productModal: { open: false, productId: null, onDone: null, initialData: null },

  shipmentModal: { open: false, productId: null, onDone: null },

  supplierModal: { open: false, supplierId: null, onDone: null, initialData: null },

  supplierReturnModal: { open: false, supplierId: null, onDone: null },

  expenseModal: { open: false, expenseId: null, onDone: null, initialData: null },

  wipeDatabaseModal: { open: false },

  paymentModal: { open: false, defaults: null, onDone: null },

  userModal: { open: false, userId: null, onDone: null },

  adminPasswordModal: { open: false, note: null, onOk: null },

  changePasswordModal: { open: false },

  syncCloudModal: { open: false },

  statementModal: { open: false, entityType: null, entityId: null },

  treasuryAdjustModal: { open: false, onDone: null },

  contentModal: { open: false, title: null, maxWidth: null, contentHTML: null, onRender: null },

  openOrderModal(onSuccess = null, initialData = null) {
    if (!hasPermission(role => canCreateOrder(role))) {
      showToast('عفواً، إنشاء الفواتير غير متاح لدورك الحالي', 'error')
      return
    }
    set({
      orderModal: {
        open: true,
        onSuccess: typeof onSuccess === 'function' ? onSuccess : null,
        initialData: initialData || null,
      },
    })
  },

  closeOrderModal() {
    set({ orderModal: { open: false, onSuccess: null, initialData: null } })
  },

  openPosModal(onSuccess = null) {
    if (!hasPermission(role => canUsePos(role))) {
      showToast('عفواً، الكاشير السريع غير متاح لدورك الحالي', 'error')
      return
    }
    set({
      posModal: {
        open: true,
        onSuccess: typeof onSuccess === 'function' ? onSuccess : null,
      },
    })
  },

  closePosModal() {
    set({ posModal: { open: false, onSuccess: null } })
  },

  // 🔒 V3.43 — مساعد AI يقرأ مبيعات/مصروفات/تقارير حساسة: المدير فقط (حتى لو
  // أُزيل الزر فهو لا يُفتح لأي دور آخر).
  openAiAssistantModal() {
    if (!hasPermission(role => canUseAi(role))) {
      showToast('مساعد AI متاح للمدير فقط', 'error')
      return
    }
    set({ aiAssistantModal: { open: true } })
  },

  closeAiAssistantModal() {
    set({ aiAssistantModal: { open: false } })
  },

  // التعبئة الذكية للنماذج (V3.35): تفتح نافذة الإدخال المناسبة معبأةً بالبيانات
  // المستخرجة من الشات — لا يُنفَّذ أي تغيير هنا؛ المستخدم وحده يضغط الحفظ.
  // V3.36: form='updateProduct' + entityId تفتح نافذة تعديل المنتج معبأةً بالبيانات.
  openAiFormFill(form = '', initialData = {}, entityId = null) {
    const data = initialData && typeof initialData === 'object' ? initialData : {}
    if (form === 'createOrder') {
      set({ orderModal: { open: true, onSuccess: null, initialData: data } })
      return
    }
    if (form === 'addCustomer') {
      set({ customerModal: { open: true, customerId: null, onDone: null, initialData: data } })
      return
    }
    if (form === 'addProduct') {
      set({ productModal: { open: true, productId: null, onDone: null, initialData: data } })
      return
    }
    if (form === 'updateProduct') {
      set({ productModal: { open: true, productId: entityId || null, onDone: null, initialData: data } })
      return
    }
    if (form === 'addExpense') {
      set({ expenseModal: { open: true, expenseId: null, onDone: null, initialData: data } })
      return
    }
    if (form === 'addSupplier') {
      set({ supplierModal: { open: true, supplierId: null, onDone: null, initialData: data } })
      return
    }
  },

  openOrderDetailsModal(orderId) {
    set({ orderDetailsModal: { open: true, orderId } })
  },

  closeOrderDetailsModal() {
    set({ orderDetailsModal: { open: false, orderId: null } })
  },

  openOrderStatusModal(orderId, currentStatus = null, onDone = null) {
    set({
      orderStatusModal: {
        open: true,
        orderId,
        currentStatus,
        onDone: typeof onDone === 'function' ? onDone : null,
      },
    })
  },

  closeOrderStatusModal() {
    set({ orderStatusModal: { open: false, orderId: null, currentStatus: null, onDone: null } })
  },

  openAddCustomerModal(customerId = null, onDone = null, initialData = null) {
    set({
      customerModal: {
        open: true,
        customerId,
        onDone: typeof onDone === 'function' ? onDone : null,
        initialData: initialData || null,
      },
    })
  },

  closeAddCustomerModal() {
    set({ customerModal: { open: false, customerId: null, onDone: null, initialData: null } })
  },

  openAddProductModal(productId = null, onDone = null, initialData = null) {
    if (!hasPermission(role => canManageProducts(role))) {
      showToast('إدارة المنتجات غير متاحة لدورك الحالي', 'error')
      return
    }
    set({
      productModal: {
        open: true,
        productId,
        onDone: typeof onDone === 'function' ? onDone : null,
        initialData: initialData || null,
      },
    })
  },

  closeAddProductModal() {
    set({ productModal: { open: false, productId: null, onDone: null, initialData: null } })
  },

  openShipmentModal(productId, onDone = null) {
    if (!hasPermission(role => canManageProducts(role))) {
      showToast('توريد الشحنات غير متاح لدورك الحالي', 'error')
      return
    }
    set({
      shipmentModal: {
        open: true,
        productId,
        onDone: typeof onDone === 'function' ? onDone : null,
      },
    })
  },

  closeShipmentModal() {
    set({ shipmentModal: { open: false, productId: null, onDone: null } })
  },

  openAddSupplierModal(supplierId = null, onDone = null, initialData = null) {
    if (!hasPermission(role => canAddSupplier(role))) {
      showToast('إضافة أو تعديل مورد مخصصة للمدير فقط', 'error')
      return
    }
    set({
      supplierModal: {
        open: true,
        supplierId,
        onDone: typeof onDone === 'function' ? onDone : null,
        initialData: initialData || null,
      },
    })
  },

  closeAddSupplierModal() {
    set({ supplierModal: { open: false, supplierId: null, onDone: null, initialData: null } })
  },

  openSupplierReturnModal(supplierId = null, onDone = null) {
    if (!hasPermission(role => canRecordPayment(role))) {
      showToast('مرتجع المشتريات متاح للمدير والمحاسب فقط', 'error')
      return
    }
    set({
      supplierReturnModal: {
        open: true,
        supplierId,
        onDone: typeof onDone === 'function' ? onDone : null,
      },
    })
  },

  closeSupplierReturnModal() {
    set({ supplierReturnModal: { open: false, supplierId: null, onDone: null } })
  },

  openAddExpenseModal(expenseId = null, onDone = null, initialData = null) {
    if (!hasPermission(role => canManageExpenses(role))) {
      showToast('إدارة المصروفات غير متاحة لدورك الحالي', 'error')
      return
    }
    set({
      expenseModal: {
        open: true,
        expenseId,
        onDone: typeof onDone === 'function' ? onDone : null,
        initialData: initialData || null,
      },
    })
  },

  closeAddExpenseModal() {
    set({ expenseModal: { open: false, expenseId: null, onDone: null, initialData: null } })
  },

  openWipeDatabaseModal() {
    if (!hasPermission(role => canManageSettings(role))) {
      showToast('هذه العملية مخصصة للمدير فقط', 'error')
      return
    }
    set({ wipeDatabaseModal: { open: true } })
  },

  closeWipeDatabaseModal() {
    set({ wipeDatabaseModal: { open: false } })
  },

  // 🔒 نافذة تسجيل الدفعات مخصصة للمدير والمحاسب (V3.43): بدون صلاحية يعرض
  // تنبيه الحظر ولا يفتح النافذة إطلاقاً.
  openPaymentModal(defaults = {}, onDone = null) {
    if (!hasPermission(role => canRecordPayment(role))) {
      showToast('عفواً، تسجيل الدفعات متاح للمدير والمحاسب فقط', 'error')
      return
    }
    const rawType = defaults.entityType
    const entityType = rawType === 'supplier_collect'
      ? 'supplier_collect'
      : (rawType === 'supplier' ? 'supplier' : 'customer')
    set({
      paymentModal: {
        open: true,
        defaults: {
          entityType,
          entityId: defaults.entityId || null,
        },
        onDone: typeof onDone === 'function' ? onDone : null,
      },
    })
  },

  closePaymentModal() {
    set({ paymentModal: { open: false, defaults: null, onDone: null } })
  },

  // 🔒 لوحة إدارة الموظفين مخصصة للمدير العام فقط (نفس بوابة renderUsersView
  // القديمة): بدون جلسة أو برتبة أقل يعرض تنبيه الحظر ولا يفتح النافذة إطلاقاً.
  openUserModal(userId = null, onDone = null) {
    if (!hasPermission(role => canManageUsers(role))) {
      showToast('عفواً، هذه الصفحة مخصصة للمدير العام فقط', 'error')
      return
    }
    set({
      userModal: {
        open: true,
        userId,
        onDone: typeof onDone === 'function' ? onDone : null,
      },
    })
  },

  closeUserModal() {
    set({ userModal: { open: false, userId: null, onDone: null } })
  },

  // 🔐 بوابة المدير لنافذة تأكيد الهوية (نفس requireAdminPassword في legacy):
  // بدون جلسة أو برتبة أقل يعرض التنبيه ولا يفتح النافذة إطلاقاً.
  openAdminPasswordModal(note = 'أدخل كلمة سر المدير للمتابعة.', onOk = null) {
    if (!hasPermission(role => canManageSettings(role))) {
      showToast('هذه الإعدادات مخصصة للمدير فقط', 'error')
      return
    }
    set({
      adminPasswordModal: {
        open: true,
        note,
        onOk: typeof onOk === 'function' ? onOk : null,
      },
    })
  },

  closeAdminPasswordModal() {
    set({ adminPasswordModal: { open: false, note: null, onOk: null } })
  },

  openChangePasswordModal() {
    set({ changePasswordModal: { open: true } })
  },

  closeChangePasswordModal() {
    set({ changePasswordModal: { open: false } })
  },

  openSyncCloudModal() {
    if (!hasPermission(role => canManageSettings(role))) {
      showToast('إعدادات الربط والسحابة مخصصة للمدير فقط', 'error')
      return
    }
    set({ syncCloudModal: { open: true } })
  },

  closeSyncCloudModal() {
    set({ syncCloudModal: { open: false } })
  },

  openStatementModal(entityType, entityId) {
    set({
      statementModal: {
        open: true,
        entityType: entityType === 'supplier' ? 'supplier' : 'customer',
        entityId: entityId || null,
      },
    })
  },

  closeStatementModal() {
    set({ statementModal: { open: false, entityType: null, entityId: null } })
  },

  // 🔒 تسوية رصيد الخزينة اليدوية مخصصة للمدير فقط (V3.54): بلا صلاحية يعرض
  // تنبيه الحظر ولا يفتح النافذة إطلاقاً.
  openTreasuryAdjustModal(onDone = null) {
    if (!hasPermission(role => canAdjustTreasury(role))) {
      showToast('تسوية رصيد الخزينة متاحة للمدير فقط', 'error')
      return
    }
    set({
      treasuryAdjustModal: {
        open: true,
        onDone: typeof onDone === 'function' ? onDone : null,
      },
    })
  },

  closeTreasuryAdjustModal() {
    set({ treasuryAdjustModal: { open: false, onDone: null } })
  },

  // V3.51 — نافذة محتوى عامة (جسر legacy): تُعرض contentHTML عبر
  // dangerouslySetInnerHTML وتُنفَّذ onRender(wrapper, close) بعد التركيب —
  // بذلك تتحول استدعاءات window.openModal القديمة (كشوف الحسابات + فتح
  // الحقول الحساسة في إعدادات الربط) من عطل Runtime إلى نافذة تعمل.
  openContentModal({ title, contentHTML, maxWidth, onRender }) {
    set({
      contentModal: {
        open: true,
        title: title || null,
        maxWidth: maxWidth || null,
        contentHTML: contentHTML || '',
        onRender: typeof onRender === 'function' ? onRender : null,
      },
    })
  },

  closeContentModal() {
    set({ contentModal: { open: false, title: null, maxWidth: null, contentHTML: null, onRender: null } })
  },
}))
