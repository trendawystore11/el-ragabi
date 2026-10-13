// =============================================================================
// ui/modals/ShipmentEditModal.jsx — تعديل شحنة توريد مسجَّلة (المدير فقط)
// -----------------------------------------------------------------------------
// تصحيح شحنة سُجّلت بكمية/سعر خطأ. يختار المدير قيد الشحنة من قيود المنتج ثم
// يعدّل الكمية وسعر الشراء؛ الحفظ عبر window.editStockShipment يعدّل المخزون
// ومديونية المورد ومتوسط تكلفة القطعة دفعة واحدة مع قيد تدقيق في البيان.
// =============================================================================
import { useState, useMemo } from 'react'
import { PackageSearch, AlertTriangle } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { round2, formatCurrency, formatDateTime, labelWithCurrency } from '@/utils/formatters'

const SHIPMENT_TYPES = ['شحنة توريد', 'تسجيل منتج ومخزون']

function parseShipmentNote(note) {
  const s = String(note || '').replace(/,/g, '')
  const m = /\((\d+(?:\.\d+)?)\s*قطعة\s*×\s*(\d+(?:\.\d+)?)/.exec(s)
  if (!m) return null
  return { qty: Number(m[1]), unitCost: Number(m[2]) }
}

function readQty(txn) {
  const q = Number(txn.qty)
  if (Number.isFinite(q) && q > 0) return q
  const parsed = parseShipmentNote(txn.note)
  return parsed ? parsed.qty : 0
}

function readUnitCost(txn) {
  const c = Number(txn.unitCost)
  if (Number.isFinite(c) && c >= 0 && txn.unitCost !== null && txn.unitCost !== undefined) return c
  const parsed = parseShipmentNote(txn.note)
  if (parsed) return parsed.unitCost
  const q = readQty(txn)
  const debit = Number(txn.debit) || 0
  return q > 0 ? round2(debit / q) : debit
}

function ShipmentEditModal() {
  const open = useUiStore(s => s.shipmentEditModal.open)
  if (!open) return null
  return <ShipmentEditModalInner />
}

function ShipmentEditModalInner() {
  const { productId, onDone } = useUiStore(s => s.shipmentEditModal)
  const close = useUiStore(s => s.closeShipmentEditModal)

  const [product] = useState(() => (productId && window.getProductById ? window.getProductById(productId) : null))
  const [shipments] = useState(() => {
    const all = typeof window !== 'undefined' && window.getSupplierTransactions ? window.getSupplierTransactions() : []
    return all
      .filter(t => t.refId === productId && SHIPMENT_TYPES.includes(t.type))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  })

  const [txnId, setTxnId] = useState(shipments.length ? shipments[0].id : '')
  const selected = shipments.find(t => t.id === txnId) || null

  const oldQty = selected ? readQty(selected) : 0
  const oldUnitCost = selected ? readUnitCost(selected) : 0
  const oldDebit = selected ? round2(Number(selected.debit) || 0) : 0

  const [qty, setQty] = useState(String(oldQty))
  const [unitCost, setUnitCost] = useState(String(oldUnitCost))
  const [notes, setNotes] = useState(selected ? selected.note || '' : '')
  const [shipmentDate, setShipmentDate] = useState(selected ? String(selected.shipmentDate || '').slice(0, 10) : '')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const selectShipment = id => {
    setTxnId(id)
    const t = shipments.find(s => s.id === id) || null
    setQty(t ? String(readQty(t)) : '')
    setUnitCost(t ? String(readUnitCost(t)) : '')
    setNotes(t ? t.note || '' : '')
    setShipmentDate(t ? String(t.shipmentDate || '').slice(0, 10) : '')
    setErrors({})
  }

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const oldStock = Number(product ? product.stock : 0) || 0
  const oldPrice = Number(product ? product.purchasePrice : 0) || 0

  const calc = useMemo(() => {
    const nq = Number(qty)
    const nc = Number(unitCost)
    const newStock = oldStock + (nq - oldQty)
    const newDebit = round2(nq * nc)
    const debtDelta = round2(newDebit - oldDebit)
    const oldGoods = round2(oldQty * oldUnitCost)
    const totalCost = (oldStock * oldPrice) - oldGoods + newDebit
    const newAvg = newStock > 0 ? Math.max(0, round2(totalCost / newStock)) : 0
    return { newStock, newDebit, debtDelta, newAvg }
  }, [qty, unitCost, oldStock, oldPrice, oldQty, oldUnitCost, oldDebit])

  const handleSubmit = e => {
    e.preventDefault()
    if (submitting || !selected) return

    const nextErrors = {}
    const nq = Number(qty)
    if (String(qty).trim() === '' || !Number.isFinite(nq) || nq < 1) {
      nextErrors.qty = 'يرجى إدخال كمية صحيحة أكبر من الصفر'
    }
    const nc = Number(unitCost)
    if (String(unitCost).trim() === '' || !Number.isFinite(nc) || nc < 0) {
      nextErrors.unitCost = 'يرجى إدخال سعر شراء صحيح (0 أو أكثر)'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const me = window.getCurrentUser ? window.getCurrentUser() : null
      const res =       window.editStockShipment(
        selected.id,
        { qty: nq, unitCost: nc, notes, shipmentDate },
        me && me.name ? me.name : ''
      )
      showToast(`تم تعديل الشحنة: ${res.oldQty}→${res.newQty} قطعة، وتحديث المخزون وحساب المورد`, 'success')
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء تعديل الشحنة', 'error')
      setSubmitting(false)
    }
  }

  if (!product) return null

  return (
    <Modal open onClose={close} title={`✏️ تعديل شحنة مسجَّلة: ${product.name}`} icon={PackageSearch} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700 flex justify-between items-center">
          <div>
            <h4 className="font-bold text-white text-base">{product.name}</h4>
            <p className="text-xs text-amber-400 font-mono">كود الـ SKU: {product.code || product.id}</p>
          </div>
          <div className="text-left">
            <span className="text-xs text-slate-400 block">المخزون الحالي</span>
            <span className="text-lg font-extrabold text-emerald-400 num-font">{oldStock} قطعة</span>
          </div>
        </div>

        {shipments.length === 0 ? (
          <div className="flex items-start gap-3 p-4 bg-amber-950/30 border border-amber-800/40 rounded-xl text-sm text-amber-300">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>لا توجد شحنات مسجَّلة على هذا المنتج قابلة للتعديل. (الشحنات بلا مورد مرتبط لا تُسجَّل كقيد مستقل.)</p>
          </div>
        ) : (
          <>
            <Select
              label="اختر الشحنة المراد تعديلها *"
              value={txnId}
              onChange={selectShipment}
              options={shipments.map(t => ({
                value: t.id,
                label: `${formatDateTime(t.createdAt)} • ${readQty(t)} قطعة × ${formatCurrency(readUnitCost(t))} • ${t.supplierName || 'بلا مورد'}`,
              }))}
            />

            {selected ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="الكمية الصحيحة * (قطعة)" type="number" min="1" value={qty} onChange={v => { setQty(v); clearError('qty') }} required className="text-center text-emerald-300" error={errors.qty} />
                <Input label={labelWithCurrency('سعر الشراء الصحيح للقطعة *')} type="number" min="0" value={unitCost} onChange={v => { setUnitCost(v); clearError('unitCost') }} required className="text-center" error={errors.unitCost} />
              </div>
            ) : null}

            {selected ? (
              <div className="space-y-1.5 p-3 bg-purple-950/30 rounded-xl border border-purple-800/40 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-bold">المخزون بعد التعديل:</span>
                  <span className="font-extrabold text-white num-font">
                    {oldStock} <span className="text-slate-500">→</span> <span className={calc.newStock < 0 ? 'text-rose-400' : 'text-emerald-400'}>{calc.newStock} قطعة</span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-bold">تغيير مديونية المورد:</span>
                  <span className={`font-extrabold num-font ${calc.debtDelta > 0 ? 'text-purple-400' : calc.debtDelta < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {calc.debtDelta > 0 ? '+' : ''}{formatCurrency(calc.debtDelta)}
                  </span>
                </div>
                <div className="border-t border-purple-800/50 pt-1.5 flex justify-between items-center">
                  <span className="text-slate-200 font-bold">متوسط التكلفة الجديد للقطعة (COGS):</span>
                  <span className="font-extrabold text-white num-font">
                    {formatCurrency(oldPrice)} <span className="text-slate-500">→</span> {formatCurrency(calc.newAvg)}
                  </span>
                </div>
                {calc.newStock < 0 ? (
                  <p className="text-rose-400 font-bold pt-1">⚠️ المخزون الناتج سالب — قلّل الكمية أو تأكد أن البضاعة لم تُبع بعد.</p>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="تاريخ الشحنة" type="date" value={shipmentDate} onChange={setShipmentDate} textLeft className="num-font" />
              <Input label="بيانات وملاحظات الشحنة / رقم الفاتورة" value={notes} onChange={setNotes} placeholder="مثال: توريد شحنة من مصنع المورا فاتورة رقم 804" />
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button type="submit" variant="success" icon={PackageSearch} className="px-6" loading={submitting} disabled={submitting || !selected || calc.newStock < 0}>
            {submitting ? 'جاري الحفظ...' : 'حفظ التعديل وتصحيح الحساب'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default ShipmentEditModal
