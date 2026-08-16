// =============================================================================
// ui/views/OrdersView.jsx — نسخة React من js/components/orders-view.js — Phase 3
// -----------------------------------------------------------------------------
// نفس البنية (هيدر بحث/حالة/زر إنشاء + جدول data-table) على المكوّنات الأساسية
// الجديدة، مع قراءة البيانات من ordersStore. نوافذ التفاصيل وتحديث الحالة تفتح
// عبر uiStore (OrderDetailsModal/OrderStatusModal) وتُحدَّث القائمة عند الحفظ.
// =============================================================================
import { useMemo, useEffect } from 'react'
import { ShoppingBag, Search, PlusCircle, Eye, RefreshCcw } from 'lucide-react'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Badge from '../components/Badge.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { useOrdersStore, applyOrderFilters } from '@/state/ordersStore'
import { useAuthStore } from '@/state/authStore'
import { useUiStore } from '../state/uiStore.js'
import { getOrderStatusLabel, getOrderRemainingAmount } from '@/domain/accounting/accounting'
import { formatCurrency, formatDate, formatPhonePair, getCairoFormattedDate } from '@/utils/formatters'
import { canCreateOrder, canUpdateOrderStatus } from '@/services/permissions'

const STATUS_OPTIONS = [
  { value: '', label: 'جميع الحالات' },
  { value: 'new', label: 'قيد الانتظار (new)' },
  { value: 'delivered', label: 'تم التوصيل (delivered)' },
  { value: 'completed', label: 'مكتمل ومسدد (completed)' },
  { value: 'returned', label: 'مرتجع (returned)' },
  { value: 'cancelled', label: 'ملغي (cancelled)' },
]

const STATUS_VARIANT = {
  new: 'warning',
  delivered: 'success',
  completed: 'success',
  returned: 'error',
  cancelled: 'neutral',
}

function DepositBadge({ order }) {
  if (order.depositType === 'shipping') {
    return <Badge variant="info">عربون الشحن</Badge>
  }
  if (order.depositType === 'shipping_extra') {
    return <Badge variant="purple">عربون شحن + مصروفات</Badge>
  }
  return <Badge variant="neutral">عربون عادي</Badge>
}

function OrderRow({ order, canUpdate }) {
  const remaining = getOrderRemainingAmount(order)
  const openDetails = () => useUiStore.getState().openOrderDetailsModal(order.id)
  const openStatus = () =>
    useUiStore.getState().openOrderStatusModal(order.id, order.status, () => useOrdersStore.getState().refresh())

  return (
    <tr>
      <td>
        <span className="num-font text-brand-300 font-semibold">{order.id}</span>
      </td>
      <td>
        <div className="font-semibold text-slate-100">{order.customerName || '—'}</div>
        {order.address ? (
          <div className="text-xs text-slate-500 truncate max-w-[180px]">{order.address}</div>
        ) : null}
      </td>
      <td className="text-slate-400">{formatPhonePair(order.customerPhone, order.customerSecondaryPhone)}</td>
      <td className="num-font font-bold text-slate-100">{formatCurrency(order.totalAmount)}</td>
      <td className="num-font text-slate-400">{formatCurrency(order.downPayment)}</td>
      <td className={`num-font font-bold ${remaining > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
        {formatCurrency(remaining)}
      </td>
      <td className="num-font text-slate-400">{formatCurrency(order.shippingCost)}</td>
      <td><DepositBadge order={order} /></td>
      <td><Badge variant={STATUS_VARIANT[order.status] || 'warning'}>{getOrderStatusLabel(order.status)}</Badge></td>
      <td className="num-font text-slate-400">{order.createdAt ? formatDate(order.createdAt) : '—'}</td>
      <td>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Button size="sm" variant="ghost" icon={Eye} onClick={openDetails}>تفاصيل</Button>
          {canUpdate ? (
            <Button size="sm" variant="ghost" icon={RefreshCcw} onClick={openStatus}>تحديث</Button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function OrdersView() {
  const orders = useOrdersStore(s => s.orders)
  const search = useOrdersStore(s => s.search)
  const status = useOrdersStore(s => s.status)
  const setSearch = useOrdersStore(s => s.setSearch)
  const setStatus = useOrdersStore(s => s.setStatus)
  const refresh = useOrdersStore(s => s.refresh)

  // 🔒 V3.43 — الكاشير يرى فواتير اليوم التي أنشأها هو فقط؛ المدير والمحاسب
  // يريان كل الفواتير. تحديد «فواتير اليوم» مقارنة بتاريخ القاهرة (YYYY-MM-DD).
  const role = useAuthStore(s => s.role)
  const user = useAuthStore(s => s.user)
  const canCreate = canCreateOrder(role)
  const canUpdate = canUpdateOrderStatus(role)

  useEffect(() => {
    refresh()
  }, [refresh])

  const todayCairo = getCairoFormattedDate().slice(0, 10)
  const visibleOrders = useMemo(() => {
    if (role !== 'employee') return orders
    const myName = user && user.name ? user.name : ''
    return orders.filter(o =>
      String(o.createdBy || '').trim() === myName &&
      String(o.createdAt || '').slice(0, 10) === todayCairo
    )
  }, [orders, role, user, todayCairo])

  const rows = useMemo(() => applyOrderFilters(visibleOrders, search, status), [visibleOrders, search, status])

  const openNewOrder = () => useUiStore.getState().openOrderModal()

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <FilterBar
        icon={<ShoppingBag className="w-6 h-6 text-brand-400" />}
        title="سجل الطلبات والفواتير"
        subtitle={
          role === 'employee'
            ? 'فواتير اليوم الخاصة بك فقط — تفاصيل وتحديث الحالة وطباعة'
            : 'متابعة كشوفات جميع الفواتير، تحديث الحالات، المرتجعات وتتبع الديون'
        }
        actions={
          canCreate ? (
            <Button variant="success" icon={PlusCircle} onClick={openNewOrder}>
              إنشاء طلب جديد
            </Button>
          ) : null
        }
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="بحث برقم الطلب، اسم العميل، الهاتف..."
          icon={Search}
          voiceLabel="بحث صوتي في الطلبات"
        />
        <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </FilterBar>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>كود الطلب</th>
                <th>اسم العميل</th>
                <th>رقم الهاتف</th>
                <th>إجمالي الفاتورة</th>
                <th>المقدم</th>
                <th>المتبقي</th>
                <th>الشحن</th>
                <th>نوع العربون</th>
                <th>حالة الطلب</th>
                <th>التاريخ</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-500">
                    لا توجد طلبات مطابقة للبحث الحالي
                  </td>
                </tr>
              ) : (
                rows.map(order => <OrderRow key={order.id} order={order} canUpdate={canUpdate} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default OrdersView
