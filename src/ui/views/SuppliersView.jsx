// =============================================================================
// ui/views/SuppliersView.jsx — نسخة React من js/components/suppliers-view.js — Phase 6
// -----------------------------------------------------------------------------
// دليل الموردين والمصانع: هيدر (بحث بالاسم/الهاتف + زر إضافة) وجدول بيانات
// (الكود/الاسم/الهاتف/العنوان/إجمالي التعاملات/المسدد/المستحق) مع العمليات.
// البيانات من suppliersStore. «إضافة/تعديل» يفتحان AddSupplierModal و«مرتجع
// مشتريات» يفتح SupplierReturnModal و«تسديد دفعة» يفتح PaymentModal و«كشف
// حساب» يفتح StatementModal — كلها عبر uiStore.
// =============================================================================
import { useMemo, useEffect } from 'react'
import { Truck, Search, Plus, Wallet, Undo2, BookOpen, Edit3 } from 'lucide-react'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { useSuppliersStore, applySupplierFilters } from '@/state/suppliersStore'
import { useUiStore } from '../state/uiStore.js'
import { useAuthStore } from '@/state/authStore'
import { canAddSupplier, canRecordPayment, canSeeSupplierContact } from '@/services/permissions'
import { formatCurrency, formatPhonePair, formatAddress } from '@/utils/formatters'

function SupplierRow({ supplier, onRefresh, canContact, canPay, canManage }) {
  const remaining = Number(supplier.remainingBalance) || 0

  const pay = () =>
    useUiStore.getState().openPaymentModal({ entityType: 'supplier', entityId: supplier.id })

  // V3.62 — مورد مدين لنا (رصيد سالب): زر تحصيل نقدية منه يفتح PaymentModal
  // في وضع supplier_collect (قبض وارد خزينة) بدلاً من دفع له.
  const collect = () =>
    useUiStore.getState().openPaymentModal({ entityType: 'supplier_collect', entityId: supplier.id })

  const returnGoods = () =>
    useUiStore.getState().openSupplierReturnModal(supplier.id, onRefresh)

  const statement = () =>
    useUiStore.getState().openStatementModal('supplier', supplier.id)

  const edit = () =>
    useUiStore.getState().openAddSupplierModal(supplier.id, onRefresh)

  return (
    <tr>
      <td className="font-bold text-purple-400 num-font">{supplier.id}</td>
      <td className="font-bold text-white">{supplier.name}</td>
      {canContact ? (
        <>
          <td className="num-font text-slate-300 font-mono">{formatPhonePair(supplier.phone, supplier.secondaryPhone)}</td>
          <td className="text-slate-400 text-xs whitespace-normal break-words">{formatAddress(supplier.address)}</td>
        </>
      ) : null}
      <td className="num-font text-white font-bold">{formatCurrency(supplier.totalPurchases)}</td>
      <td className="num-font text-emerald-400 font-bold">{formatCurrency(supplier.paid)}</td>
      <td className={`num-font font-extrabold ${remaining > 0 ? 'text-purple-400' : remaining < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
        {formatCurrency(supplier.remainingBalance)}
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
          {canPay ? (
            <Button size="sm" variant="ghost" icon={Wallet} onClick={pay} className="text-emerald-300 hover:bg-emerald-500/10">
              تسديد دفعة
            </Button>
          ) : null}
          {canPay && remaining < 0 ? (
            <Button size="sm" variant="ghost" icon={Wallet} onClick={collect} className="text-teal-300 hover:bg-teal-500/10">
              تحصيل نقدية
            </Button>
          ) : null}
          {canPay ? (
            <Button size="sm" variant="ghost" icon={Undo2} onClick={returnGoods} className="text-orange-300 hover:bg-orange-500/10">
              مرتجع مشتريات
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon={BookOpen} onClick={statement} className="text-purple-300 hover:bg-purple-500/10">
            كشف حساب
          </Button>
          {canManage ? (
            <Button size="sm" variant="ghost" icon={Edit3} onClick={edit} className="text-brand-300 hover:bg-brand-500/10">
              تعديل
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function SuppliersView() {
  const suppliers = useSuppliersStore(s => s.suppliers)
  const search = useSuppliersStore(s => s.search)
  const setSearch = useSuppliersStore(s => s.setSearch)
  const refresh = useSuppliersStore(s => s.refresh)

  // 🔒 V3.43 — أعمدة الهاتف والعنوان (بيانات اتصال سرية): المدير والمحاسب فقط.
  // زر «إضافة/تعديل مورد»: المدير فقط. «تسديد دفعة/مرتجع مشتريات»: المدير
  // والمحاسب (مالياً). بقية الأدوار ترى الأسماء والأرصدة وكشف الحساب فقط.
  const role = useAuthStore(s => s.role)
  const canContact = canSeeSupplierContact(role)
  const canPay = canRecordPayment(role)
  const canManage = canAddSupplier(role)

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(() => applySupplierFilters(suppliers, search), [suppliers, search])

  const openAdd = () => useUiStore.getState().openAddSupplierModal(null, () => useSuppliersStore.getState().refresh())

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <FilterBar
        icon={<Truck className="w-6 h-6 text-purple-400" />}
        title="دليل الموردين والمصانع"
        subtitle="إدارة حسابات المصانع، إجمالي التعاملات، والمدفوعات والمستحقات للموردين"
        actions={
          canManage ? (
            <Button variant="primary" icon={Plus} onClick={openAdd} className="!bg-purple-600 hover:!bg-purple-500">
              إضافة مورد جديد
            </Button>
          ) : null
        }
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="بحث بالاسم..."
          icon={Search}
          className="lg:max-w-xl"
        />
      </FilterBar>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>كود المورد</th>
                <th>اسم المورد / المصنع</th>
                {canContact ? (
                  <>
                    <th>رقم الهاتف</th>
                    <th>العنوان والمحافظة</th>
                  </>
                ) : null}
                <th>إجمالي التعاملات</th>
                <th>المبلغ المسدد</th>
                <th>الرصيد (مستحق له / مستحق لنا)</th>
                <th>العمليات والإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canContact ? 8 : 6} className="text-center py-10 text-slate-500">
                    لا يوجد موردين مسجلين المطابقين للبحث
                  </td>
                </tr>
              ) : (
                rows.map(s => <SupplierRow key={s.id} supplier={s} onRefresh={refresh} canContact={canContact} canPay={canPay} canManage={canManage} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default SuppliersView
