// =============================================================================
// ui/views/CustomersView.jsx — نسخة React من js/components/customers-view.js — Phase 4
// -----------------------------------------------------------------------------
// دليل العملاء: هيدر (بحث بالاسم/الهاتف/الكود + فلتر تصنيف + زر إضافة) وجدول
// بيانات مع شارات التصنيف والمديونيات. البيانات من customersStore. الإجراءات:
// «تحصيل دفعة» تفتح PaymentModal و«كشف حساب» تفتح StatementModal و
// «تعديل»/«إضافة» تفتح AddCustomerModal — كلها عبر uiStore.
// =============================================================================
import { useMemo, useEffect } from 'react'
import { Users, Search, UserPlus, Wallet, BookOpen, Edit3 } from 'lucide-react'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Badge from '../components/Badge.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { useCustomersStore, applyCustomerFilters } from '@/state/customersStore'
import { useUiStore } from '../state/uiStore.js'
import { CUSTOMER_CATEGORIES } from '@/domain/customers/customerRules'
import { formatCurrency, formatPhonePair, formatAddress } from '@/utils/formatters'

const CATEGORY_VARIANT = {
  'تاجر جملة': 'warning',
  'تاجر تجزئة': 'info',
  'عميل قطاعي / فردي': 'neutral',
  'جمعية خيرية / مؤسسة': 'purple',
  'معرض / وكيل': 'success',
  'عميل محتمل': 'error',
}

function CustomerRow({ customer }) {
  const remaining = Number(customer.remainingBalance) || 0
  const collect = () =>
    useUiStore.getState().openPaymentModal({ entityType: 'customer', entityId: customer.id })
  const statement = () =>
    useUiStore.getState().openStatementModal('customer', customer.id)
  const edit = () =>
    useUiStore.getState().openAddCustomerModal(customer.id, () => useCustomersStore.getState().refresh())

  return (
    <tr>
      <td className="font-bold text-sky-400 num-font">{customer.id}</td>
      <td className="font-bold text-white">{customer.name}</td>
      <td>
        <Badge variant={CATEGORY_VARIANT[customer.category] || 'neutral'}>{customer.category || '—'}</Badge>
      </td>
      <td className="num-font text-slate-300">{formatPhonePair(customer.phone, customer.secondaryPhone)}</td>
      <td className="text-slate-400 text-xs whitespace-normal break-words">{formatAddress(customer.address)}</td>
      <td className="num-font text-center font-bold text-slate-300">{customer.ordersCount || 0}</td>
      <td className="num-font text-white font-bold">{formatCurrency(customer.totalPurchases)}</td>
      <td className="num-font text-emerald-400 font-bold">{formatCurrency(customer.paid)}</td>
      <td className={`num-font font-extrabold ${remaining > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
        {formatCurrency(customer.remainingBalance)}
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
          <Button size="sm" variant="ghost" icon={Wallet} onClick={collect} className="text-emerald-300 hover:bg-emerald-500/10">
            تحصيل دفعة
          </Button>
          <Button size="sm" variant="ghost" icon={BookOpen} onClick={statement} className="text-sky-300 hover:bg-sky-500/10">
            كشف حساب
          </Button>
          <Button size="sm" variant="ghost" icon={Edit3} onClick={edit} className="text-brand-300 hover:bg-brand-500/10">
            تعديل
          </Button>
        </div>
      </td>
    </tr>
  )
}

function CustomersView() {
  const customers = useCustomersStore(s => s.customers)
  const search = useCustomersStore(s => s.search)
  const category = useCustomersStore(s => s.category)
  const setSearch = useCustomersStore(s => s.setSearch)
  const setCategory = useCustomersStore(s => s.setCategory)
  const refresh = useCustomersStore(s => s.refresh)

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(() => applyCustomerFilters(customers, search, category), [customers, search, category])

  const openAdd = () => useUiStore.getState().openAddCustomerModal(null, () => useCustomersStore.getState().refresh())

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <FilterBar
        icon={<Users className="w-6 h-6 text-sky-400" />}
        title="دليل العملاء وحسابات الديون"
        subtitle="إدارة بيانات العملاء، إجمالي المشتريات، والمدفوعات والمستحقات المتبقية"
        actions={
          <Button variant="primary" icon={UserPlus} onClick={openAdd}>
            إضافة عميل جديد
          </Button>
        }
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="بحث بالاسم، رقم الهاتف، الكود..."
          icon={Search}
          voiceLabel="بحث صوتي في العملاء"
        />
        <Select
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: 'كل التصنيفات' }, ...CUSTOMER_CATEGORIES.map(c => ({ value: c, label: c }))]}
        />
      </FilterBar>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>كود العميل</th>
                <th>اسم العميل</th>
                <th>التصنيف</th>
                <th>رقم الهاتف</th>
                <th>العنوان والمحافظة</th>
                <th>عدد الفواتير</th>
                <th>إجمالي المشتريات</th>
                <th>المسدد</th>
                <th>الرصيد المتبقي (آجل)</th>
                <th>العمليات والإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-slate-500">
                    لا يوجد عملاء مسجلين المطابقين للبحث
                  </td>
                </tr>
              ) : (
                rows.map(c => <CustomerRow key={c.id} customer={c} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default CustomersView
