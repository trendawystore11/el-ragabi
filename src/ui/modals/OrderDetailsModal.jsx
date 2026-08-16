// =============================================================================
// ui/modals/OrderDetailsModal.jsx — نافذة تفاصيل الفاتورة — نسخة React من
// window.openOrderDetailsModal (js/components/orders-view.js)
// -----------------------------------------------------------------------------
// يعرض تفاصيل الفاتورة كاملة: الحالة، المنتجات المباعة، التكاليف، التحليل
// المالي (صافي الربح بنفس نموذج calculateNetProfit)، مديونية عجز المخزون،
// شحنات التوريد المباشر، مع زر «طباعة الفاتورة» يفتح نسخة طباعة نظيفة.
// قراءة الطلب عبر window.getOrderById (الجسر)، والوظائف المالية النقية
// (getOrderRemainingAmount/getOrderShippingRevenue) مباشرة من الدومين.
// =============================================================================
import { useState } from 'react'
import { FileText, Truck, AlertTriangle, Printer, Boxes } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import { useUiStore } from '../state/uiStore.js'
import { useAuthStore } from '@/state/authStore'
import { showToast } from '../components/toastStore.js'
import { getOrderRemainingAmount, getOrderShippingRevenue } from '../../domain/accounting/accounting.js'
import { getDirectShipSummary } from '../../domain/orders/orderMachine.js'
import { formatCurrency, formatDate, formatPhonePair } from '../../utils/formatters.js'

const STATUS_VARIANT = {
  new: 'warning',
  delivered: 'success',
  completed: 'success',
  returned: 'error',
  cancelled: 'neutral',
}

const STATUS_TEXT = {
  new: 'قيد الانتظار',
  delivered: 'تم التوصيل',
  completed: 'مكتمل نهائي',
  returned: 'مرتجع',
  cancelled: 'ملغي',
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function computeBreakdown(order) {
  const orderItemsCost = (order.items || []).reduce(
    (s, i) => s + ((Number(i.purchasePrice) || 0) * (Number(i.quantity) || 0)),
    0
  )
  const orderMerchantShipping = order.shippingPayer === 'merchant' ? (Number(order.shippingCost) || 0) : 0
  const orderMerchantExtra = order.extraExpensesPayer === 'merchant' ? (Number(order.extraExpenses) || 0) : 0
  const orderMerchantExpenses = orderMerchantShipping + orderMerchantExtra
  const orderClientShipping = order.shippingPayer === 'customer' ? (Number(order.shippingCost) || 0) : 0
  const orderClientExtra = order.extraExpensesPayer === 'customer' ? (Number(order.extraExpenses) || 0) : 0
  const orderClientPaidFees = orderClientShipping + orderClientExtra
  const orderItemsSales =
    Number(order.itemsSubtotal) ||
    (order.items || []).reduce((s, i) => s + ((Number(i.sellingPrice) || 0) * (Number(i.quantity) || 0)), 0)
  const orderNetProfit = orderItemsSales - orderItemsCost - orderMerchantExpenses
  return { orderItemsCost, orderMerchantExpenses, orderClientPaidFees, orderItemsSales, orderNetProfit }
}

function buildPrintHTML(order, bd) {
  const itemsRows = (order.items || [])
    .map(
      i => `
        <tr>
          <td>${esc(i.productName)}</td>
          <td style="text-align:center">${Number(i.quantity) || 0}</td>
          <td style="text-align:center">${formatCurrency(i.sellingPrice)}</td>
          <td style="text-align:center">${formatCurrency(i.subtotal)}</td>
        </tr>`
    )
    .join('')
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
  <head>
    <meta charset="UTF-8">
    <title>فاتورة رقم: ${esc(order.id)}</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; padding: 32px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .muted { color: #64748b; font-size: 12px; }
      .row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 13px; }
      .row strong { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; }
      th { background: #f1f5f9; }
      .total { font-weight: 700; font-size: 15px; border-top: 2px solid #0f172a; margin-top: 12px; padding-top: 8px; }
      .footer { margin-top: 32px; border-top: 1px dashed #cbd5e1; padding-top: 12px; font-size: 11px; color: #64748b; }
    </style>
  </head>
  <body>
    <h1>فاتورة بيع — رقم: ${esc(order.id)}</h1>
    <div class="muted">${esc(order.customerName || '')} — ${esc(formatPhonePair(order.customerPhone, order.customerSecondaryPhone))} — ${formatDate(order.createdAt)}</div>
    <table>
      <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر البيع</th><th>الإجمالي</th></tr></thead>
      <tbody>${itemsRows || '<tr><td colspan="4" style="text-align:center">—</td></tr>'}</tbody>
    </table>
    <div class="row"><span>مجموع البضاعة المباعة</span><strong>${formatCurrency(bd.orderItemsSales)}</strong></div>
    ${order.shippingCost ? `<div class="row"><span>تكلفة الشحن (${order.shippingPayer === 'customer' ? 'على العميل' : 'على التاجر'})</span><strong>${formatCurrency(order.shippingCost)}</strong></div>` : ''}
    ${order.extraExpenses ? `<div class="row"><span>مصروفات إضافية (${order.extraExpensesPayer === 'merchant' ? 'على التاجر' : 'على العميل'})</span><strong>${formatCurrency(order.extraExpenses)}</strong></div>` : ''}
    <div class="row total"><span>إجمالي الفاتورة</span><strong>${formatCurrency(order.totalAmount)}</strong></div>
    <div class="row"><span>المسدد مقدماً</span><strong>${formatCurrency(order.downPayment)}</strong></div>
    <div class="row"><span>المتبقي</span><strong>${formatCurrency(getOrderRemainingAmount(order))}</strong></div>
    <div class="footer">تم إنشاء هذه الفاتورة من نظام إدارة المحل — تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div>
  </body>
</html>`
}

function OrderDetailsModal() {
  const open = useUiStore(s => s.orderDetailsModal.open)
  if (!open) return null
  return <OrderDetailsModalInner />
}

function OrderDetailsModalInner() {
  const orderId = useUiStore(s => s.orderDetailsModal.orderId)
  const close = useUiStore(s => s.closeOrderDetailsModal)
  // 🔒 V3.43 — الكاشير يرى سعر البيع فقط: «التحليل المالي» (تكلفة/ربح) مخفي عنه.
  const role = useAuthStore(s => s.role)
  const showFinancialBreakdown = role !== 'employee'
  const [order] = useState(() => (window.getOrderById ? window.getOrderById(orderId) : null))

  if (!order) {
    return (
      <Modal open onClose={close} title={`تفاصيل فاتورة رقم: ${orderId}`} icon={FileText}>
        <p className="text-sm text-slate-400">لم يتم العثور على الطلب المطلوب.</p>
      </Modal>
    )
  }

  const bd = computeBreakdown(order)
  const remaining = getOrderRemainingAmount(order)
  const shippingRevenue = getOrderShippingRevenue(order)
  const shipSummary = getDirectShipSummary(order)

  const handlePrint = () => {
    const printHTML = buildPrintHTML(order, bd)
    let printWindow = null
    try {
      printWindow = window.open('', '_blank', 'width=800,height=600')
    } catch {
      printWindow = null
    }
    if (!printWindow) {
      showToast('تم حظر نافذة الطباعة المنبثقة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة', 'error', 4000)
      return
    }
    try {
      printWindow.document.write(printHTML)
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
    } catch (err) {
      console.error(err)
      showToast('تعذر فتح نافذة الطباعة — تحقق من إعدادات المتصفح وأعد المحاولة', 'error')
      return
    }
    showToast('تم تجهيز نافذة طباعة الفاتورة', 'info', 2000)
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={close}>إغلاق</Button>
      <Button variant="primary" icon={Printer} onClick={handlePrint}>طباعة الفاتورة</Button>
    </>
  )

  return (
    <Modal open onClose={close} title={`تفاصيل فاتورة رقم: ${order.id}`} icon={FileText} footer={footer} maxWidth="max-w-3xl">
      <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700 flex justify-between items-center">
        <div>
          <h4 className="font-extrabold text-white text-lg">طلب رقم: {order.id}</h4>
          <p className="text-xs text-brand-400 font-bold">
            {order.customerName} - {order.customerPhone}
            {order.customerSecondaryPhone ? ` - ${order.customerSecondaryPhone}` : ''}
          </p>
        </div>
        <div className="text-left">
          <span className="text-xs text-slate-400 block mb-1">حالة الطلب</span>
          <Badge variant={STATUS_VARIANT[order.status] || 'warning'}>{STATUS_TEXT[order.status] || order.status}</Badge>
        </div>
      </div>

      <div className="space-y-2">
        <h5 className="text-xs font-bold text-slate-300">المنتجات المباعة في الفاتورة:</h5>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {(order.items || []).map((i, idx) => (
            <div
              key={idx}
              className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex justify-between items-center text-xs"
            >
              <div>
                <span className="font-bold text-white block">
                  {i.productName}
                  {i.isDirectShip ? (
                    <span className="mr-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-purple-400 bg-purple-950/40 border border-purple-800/40 rounded-md px-1.5 py-0.5">
                      <Truck className="w-3 h-3" /> شحن مباشر
                    </span>
                  ) : null}
                </span>
                <span className="text-slate-400">
                  الكمية: <strong className="text-emerald-400">{i.quantity} قطعة</strong> بسعر{' '}
                  <strong className="text-white">{formatCurrency(i.sellingPrice)}</strong>
                </span>
              </div>
              <span className="font-bold text-white num-font text-sm">{formatCurrency(i.subtotal)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-1.5 text-xs">
        {shipSummary.all || shipSummary.mixed ? (
          <div className="flex justify-between items-center">
            <span className="text-slate-300">نوع التنفيذ:</span>
            <span className="font-bold text-purple-400 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" />
              {shipSummary.all
                ? 'شحن مباشر من المورد (بدون خصم مخزون)'
                : `مختلط — ${shipSummary.directCount} من أصل ${shipSummary.total} أصناف شحن مباشر من المورد`}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between text-slate-300">
          <span>مجموع البضاعة المباعة:</span>
          <span className="font-bold text-white num-font">{formatCurrency(order.itemsSubtotal || order.totalAmount)}</span>
        </div>
        {order.shippingCost ? (
          <div className="flex justify-between text-slate-400">
            <span>تكلفة الشحن ({order.shippingPayer === 'customer' ? 'على العميل' : 'على التاجر'}):</span>
            <span className="font-bold text-purple-400 num-font">{formatCurrency(order.shippingCost)}</span>
          </div>
        ) : null}
        {order.extraExpenses ? (
          <div className="flex justify-between text-slate-400">
            <span>مصروفات إضافية ({order.extraExpensesPayer === 'merchant' ? 'على التاجر' : 'على العميل'}):</span>
            <span className="font-bold text-amber-400 num-font">{formatCurrency(order.extraExpenses)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-slate-300 font-bold border-t border-slate-800 pt-1">
          <span>إجمالي الفاتورة:</span>
          <span className="font-bold text-white num-font text-sm">{formatCurrency(order.totalAmount)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>المسدد مقدماً:</span>
          <span className="font-bold text-emerald-400 num-font">{formatCurrency(order.downPayment)}</span>
        </div>
        {order.depositType && order.depositType !== 'custom' ? (
          <div className="flex justify-between text-slate-400">
            <span>نوع العربون:</span>
            <span className="font-bold text-sky-400">
              {order.depositType === 'shipping' ? 'عربون بقيمة الشحن' : 'عربون الشحن + المصروفات الإضافية'}
            </span>
          </div>
        ) : null}
        {shippingRevenue > 0 ? (
          <div className="flex justify-between text-slate-500">
            <span>إيراد خدمات شحن ونقل (من العربون):</span>
            <span className="font-bold text-sky-400 num-font">{formatCurrency(shippingRevenue)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-slate-200 font-bold border-t border-slate-800 pt-1">
          <span>المتبقي الآجل:</span>
          <span className={`font-extrabold num-font text-sm ${remaining > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
            {formatCurrency(remaining)}
          </span>
        </div>
        {showFinancialBreakdown ? (
        <div className="border-t border-slate-800 mt-2 pt-2 space-y-1">
          <span className="text-xs font-bold text-slate-300 block mb-1">🧮 التحليل المالي للفاتورة:</span>
          <div className="flex justify-between text-slate-400">
            <span>إجمالي الفاتورة (المحصل من العميل):</span>
            <span className="font-bold text-white num-font">{formatCurrency(order.totalAmount)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>مبيعات البضاعة الصافية:</span>
            <span className="font-bold text-white num-font">{formatCurrency(bd.orderItemsSales)}</span>
          </div>
          {bd.orderClientPaidFees > 0 ? (
            <div className="flex justify-between text-slate-500">
              <span>شحن ومصاريف العميل (خدمة عبور):</span>
              <span className="font-bold text-sky-400 num-font">{formatCurrency(bd.orderClientPaidFees)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-slate-400">
            <span>تكلفة البضاعة (COGS):</span>
            <span className="font-bold text-amber-400 num-font">{formatCurrency(bd.orderItemsCost)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>مصاريف التاجر (شحن + إضافية):</span>
            <span className="font-bold text-purple-400 num-font">{formatCurrency(bd.orderMerchantExpenses)}</span>
          </div>
          <div className="flex justify-between font-bold border-t border-slate-800 pt-1">
            <span className="text-emerald-300">صافي الربح:</span>
            <span className={`font-extrabold num-font ${bd.orderNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatCurrency(bd.orderNetProfit)}
            </span>
          </div>
          <p className="text-[10px] font-mono text-slate-500">
            صافي الربح ({formatCurrency(bd.orderNetProfit)}) = مبيعات البضاعة الصافية ({formatCurrency(bd.orderItemsSales)}) −
            تكلفة البضاعة ({formatCurrency(bd.orderItemsCost)}) − مصاريف التاجر ({formatCurrency(bd.orderMerchantExpenses)})
          </p>
          <p className="text-[10px] text-slate-500">شحن/مصاريف يدفعها العميل تُحصَّل لحساب شركات الشحن ولا تُحتسب في الربح.</p>
        </div>
        ) : null}
        {order.supplierDeficits && order.supplierDeficits.length ? (
          <div className="border-t border-rose-900/60 pt-2 mt-1 space-y-1">
            <span className="text-rose-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> طلب مؤجل (عجز مخزون) — مديونية للمورد:
            </span>
            {order.supplierDeficits.map((d, idx) => (
              <div key={idx} className="flex justify-between items-center">
                <span className="text-slate-300">
                  {d.supplierName || 'المورد'} - {d.productName} ({d.units} قطعة)
                </span>
                <span className="font-bold text-rose-400 num-font">{formatCurrency(d.amount)}</span>
              </div>
            ))}
            <p className="text-[10px] text-slate-500">تسدد هذه المديونية من خلال صفحة المدفوعات → تسديد دفعة لمورد</p>
          </div>
        ) : null}
        {order.supplierShipments && order.supplierShipments.length ? (
          <div className="border-t border-purple-900/60 pt-2 mt-1 space-y-1">
            <span className="text-purple-400 font-bold flex items-center gap-1">
              <Boxes className="w-3.5 h-3.5" /> شحنات توريد مباشر مسجلة على المورد:
            </span>
            {order.supplierShipments.map((d, idx) => (
              <div key={idx} className="flex justify-between items-center">
                <span className="text-slate-300">
                  {d.supplierName || 'المورد'} - {d.productName} ({d.units} قطعة)
                </span>
                <span className="font-bold text-purple-400 num-font">{formatCurrency(d.amount)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

export default OrderDetailsModal
