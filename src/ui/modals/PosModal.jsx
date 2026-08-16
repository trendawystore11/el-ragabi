// =============================================================================
// ui/modals/PosModal.jsx — وضع الكاشير / البيع السريع (بيع فوري)
// -----------------------------------------------------------------------------
// واجهة بيع سريعة: شبكة منتجات تُضاف بلمسة واحدة، بحث سريع (اسم/كود/باركود)
// + إدخال صوتي، بنود مختارة مع عدّاد كميات، خصم ومدفوع فوري، وأزرار إنهاء
// سريعة: «دفعة كاملة» (تعبئة المدفوع = الإجمالي)، «نقداً» (حفظ فوري مكتمل)،
// «آجل» (حفظ فوري آجل بدون دفع — يتطلب هاتف عميل)، «إتمام البيع» (حفظ حسب
// المدفوع). الحفظ عبر window.createOrder بنفس صيغة OrderModal حصراً حتى تظهر
// طلبات الكاشير في سجل الطلبات وتصدير Excel/Google Sheets كأي طلب عادي 100%.
// =============================================================================
import { useState, useMemo } from 'react'
import { Store, Search, Minus, Plus, Trash2, PackageSearch } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { validateEgyptianPhone, normalizePhone } from '../../utils/phones.js'
import { formatCurrency, round2, labelWithCurrency } from '../../utils/formatters.js'
import { DEFAULT_CUSTOMER_CATEGORY } from '../../domain/customers/customerRules.js'
import { buildPosItems, applyPosDiscount, computePosTotal } from '../../services/posService.js'

// 🔒 اسم المستخدم الجالس بأمان (جلسة قد تكون غائبة/ناقصة في المعاينة والاختبارات).
function safeCurrentUserName() {
  try {
    const u = typeof window !== 'undefined' && typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null
    return u && u.name ? u.name : 'المدير العام'
  } catch {
    return 'المدير العام'
  }
}

function PosModal() {
  const open = useUiStore(s => s.posModal.open)
  if (!open) return null
  return <PosModalInner />
}

function PosModalInner() {
  const onSuccess = useUiStore(s => s.posModal.onSuccess)
  const close = useUiStore(s => s.closePosModal)

  const products = useState(() => (window.getProducts ? window.getProducts() : []))[0]

  const [search, setSearch] = useState('')
  const [lines, setLines] = useState([])
  const [qtyDrafts, setQtyDrafts] = useState({})
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    )
  }, [products, search])

  const rawItems = buildPosItems(lines)
  const finalItems = applyPosDiscount(rawItems, discount)
  const subtotal = computePosTotal(rawItems)
  const total = computePosTotal(finalItems)
  const discountApplied = round2(subtotal - total)
  const paidValue = Number(paid) || 0
  const remaining = Math.max(0, round2(total - paidValue))

  const addProduct = product => {
    clearError('items')
    setQtyDrafts(d => {
      const { [product.id]: _, ...rest } = d
      return rest
    })
    setLines(list => {
      const found = list.find(l => l.product.id === product.id)
      if (found) {
        return list.map(l => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...list, { product, quantity: 1 }]
    })
  }

  const changeQty = (productId, delta) => {
    clearError('items')
    setQtyDrafts(d => {
      const { [productId]: _, ...rest } = d
      return rest
    })
    setLines(list => list.map(l =>
      l.product.id === productId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l
    ))
  }

  const removeLine = productId => {
    clearError('items')
    setQtyDrafts(d => {
      const { [productId]: _, ...rest } = d
      return rest
    })
    setLines(list => list.filter(l => l.product.id !== productId))
  }

  // كمية قابلة للكتابة: يحتفظ بمسودة نصية أثناء الكتابة، وعند إخلاء الحقل
  // (blur أو Enter) يُسقِط القيمة النهائية إلى بنود الفاتورة مع تحصين كل
  // قيمة فارغة/غير صالحة إلى الحد الأدنى 1 (لا قيم صفرية أو سالبة).
  const setQtyDraft = (productId, raw) => {
    setQtyDrafts(d => ({ ...d, [productId]: raw }))
  }

  const commitQty = (productId, raw) => {
    setQtyDrafts(d => {
      const { [productId]: _, ...rest } = d
      return rest
    })
    const parsed = parseInt(raw, 10)
    const safe = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
    setLines(list => list.map(l =>
      l.product.id === productId ? { ...l, quantity: safe } : l
    ))
  }

  // --- التعرف التلقائي على العميل من رقم الهاتف (مثل OrderModal) ---
  // عند اكتمال رقم مصري صحيح يبحث في قاعدة العملاء ويُعبّئ الاسم والعنوان
  // المسجل تلقائياً (العنوان اختياري لكنه يُرفق بالفاتورة إن وُجد).
  // التعارض: اسم مكتوب يدوياً مختلف عن العميل المسجّل للرقم يبقى كما هو مع
  // تنبيه — لا يُلغى عمل المستخدم صامتاً.
  const resolveCustomerAddress = customer => {
    const saved = String((customer && customer.address) || '').trim()
    if (saved) return saved
    if (customer && typeof window.getCustomerAddresses === 'function') {
      const list = window.getCustomerAddresses(customer.id) || []
      const def = list.find(a => a && a.isDefault) || list[0]
      if (def && def.address) return String(def.address).trim()
    }
    return ''
  }

  const onCustomerPhoneChange = v => {
    setCustomerPhone(v)
    clearError('customerPhone')
    const norm = normalizePhone(v)
    if (norm.length !== 11 || !norm.startsWith('01')) return
    const existing = window.findCustomerByPhone ? window.findCustomerByPhone(v) : null
    if (!existing) {
      showToast('الرقم غير مسجل لعميل — سيُسجل كعميل جديد', 'info', 2000)
      return
    }
    const matchedName = String(existing.name || '').trim()
    const typedName = String(customerName || '').trim()
    if (typedName && typedName !== matchedName) {
      showToast(`رقم الهاتف مسجل للعميل «${matchedName}» — الاسم المكتوب مختلف ويبقى كما هو`, 'warning', 3000)
      return
    }
    setCustomerName(matchedName)
    setCustomerAddress(resolveCustomerAddress(existing))
    showToast(`تم التعرف على العميل: ${matchedName}`, 'info', 2000)
  }

  const handleSave = async ({ deferred = false, forceFull = false } = {}) => {
    if (submitting) return
    const raw = buildPosItems(lines)
    if (raw.length === 0) {
      setErrors({ items: 'يرجى اختيار منتج واحد على الأقل للبيع' })
      showToast('يرجى اختيار منتج واحد على الأقل للبيع', 'error')
      return
    }
    const subtotalNow = computePosTotal(raw)
    const discountNum = Number(discount) || 0
    if (discountNum < 0) {
      setErrors({ discount: 'قيمة الخصم يجب أن تكون صفراً أو أكبر' })
      showToast('قيمة الخصم يجب أن تكون صفراً أو أكبر', 'error')
      return
    }
    if (discountNum > subtotalNow) {
      setErrors({ discount: 'الخصم أكبر من قيمة الفاتورة — تحقق من إجمالي البنود' })
      showToast('الخصم أكبر من قيمة الفاتورة — تحقق من إجمالي البنود', 'error')
      return
    }
    const paidNum = Number(paid) || 0
    if (paidNum < 0) {
      setErrors({ paid: 'المبلغ المدفوع لا يمكن أن يكون سالباً' })
      showToast('المبلغ المدفوع لا يمكن أن يكون سالباً', 'error')
      return
    }
    const items = applyPosDiscount(raw, discount)
    const totalAmount = computePosTotal(items)
    const isFull = forceFull || (!deferred && paidNum >= totalAmount)

    if (!isFull) {
      const phoneVal = customerPhone.trim()
      const validation = validateEgyptianPhone(phoneVal)
      if (!validation.isValid) {
        setErrors({ customerPhone: 'مطلوب رقم هاتف عميل صحيح للبيع الآجل أو الجزئي' })
        showToast('للبيع الآجل أو الجزئي يجب إدخال رقم هاتف عميل صحيح', 'error')
        return
      }
    }

    setErrors({})
    setSubmitting(true)
    try {
      if (typeof window.createOrder !== 'function') {
        throw new Error('خدمة تسجيل الطلبات غير متوفرة')
      }
      const newOrder = await window.createOrder({
        customerInfo: {
          name: customerName.trim() || 'عميل معرض',
          phone: customerPhone.trim(),
          secondaryPhone: '',
          category: DEFAULT_CUSTOMER_CATEGORY,
          address: customerAddress,
          addressId: '',
          notes: isFull ? 'بيع فوري من الكاشير' : (paidNum > 0 ? 'بيع جزئي من الكاشير' : 'بيع آجل من الكاشير'),
        },
        items,
        downPayment: isFull ? totalAmount : Math.min(Math.max(paidNum, 0), totalAmount),
        shippingCost: 0,
        shippingPayer: 'customer',
        extraExpenses: 0,
        extraExpensesPayer: 'customer',
        status: isFull ? 'completed' : 'new',
        directShipping: false,
        depositType: 'custom',
        cashierMode: isFull,
        createdBy: safeCurrentUserName(),
      })
      showToast(`تم إتمام البيع رقم ${newOrder.id} بنجاح`, 'success')
      close()
      if (typeof onSuccess === 'function') onSuccess(newOrder)
    } catch (err) {
      console.error(err)
      showToast(err.message || 'حدث خطأ أثناء إتمام البيع', 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title="كاشير سريع (بيع فوري)" icon={Store} maxWidth="max-w-4xl">
      {/* اختيار المنتجات */}
      <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex items-center gap-2">
          <PackageSearch className="w-4 h-4 text-brand-400" />
          <h4 className="text-sm font-bold text-brand-400">المنتجات — لمسة واحدة للإضافة</h4>
        </div>
        <Input
          value={search}
          onChange={setSearch}
          placeholder="بحث سريع بالاسم، كود الـ SKU، أو الباركود..."
          icon={Search}
          voiceLabel="بحث صوتي في كاشير المنتجات"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
          {filteredProducts.length === 0 ? (
            <p className="col-span-full text-sm text-slate-500 py-6 text-center">لا توجد منتجات مطابقة للبحث</p>
          ) : (
            filteredProducts.map(product => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="flex flex-col gap-1 p-3 rounded-xl border border-slate-700 bg-slate-800/60 text-right hover:border-brand-500 hover:bg-slate-800 transition-all cursor-pointer"
              >
                <span className="text-sm font-bold text-slate-100 truncate">{product.name}</span>
                <span className="text-xs num-font text-brand-300">{formatCurrency(product.sellingPrice)}</span>
                <span
                  className={`text-[11px] num-font ${
                    Number(product.stock) <= Number(product.minStock) ? 'text-rose-400' : 'text-slate-500'
                  }`}
                >
                  مخزون: {product.stock}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* البنود المختارة */}
      <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-3">
        <h4 className="text-sm font-bold text-brand-400">بنود الفاتورة</h4>
        {errors.items ? (
          <p className="text-xs font-bold text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
            {errors.items}
          </p>
        ) : null}
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">لم تُحدد أي منتجات بعد — اختر من الشبكة أعلاه</p>
        ) : (
          <div className="space-y-2">
            {lines.map(line => (
              <div key={line.product.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-900/60">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-100 truncate">{line.product.name}</div>
                  <div className="text-xs num-font text-slate-400">
                    {formatCurrency(line.product.sellingPrice)} × {line.quantity} ={' '}
                    <span className="font-bold text-slate-200">{formatCurrency(line.product.sellingPrice * line.quantity)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => changeQty(line.product.id, 1)}
                    aria-label={`زيادة كمية ${line.product.name}`}
                    className="w-7 h-7 grid place-items-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={qtyDrafts[line.product.id] ?? line.quantity}
                    onChange={e => setQtyDraft(line.product.id, e.target.value)}
                    onBlur={e => commitQty(line.product.id, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    aria-label={`كمية ${line.product.name}`}
                    title="اكتب كمية مباشرة (عدد صحيح موجب)"
                    className="w-14 text-center num-font font-bold text-white bg-slate-800 border border-slate-700 rounded-lg py-1.5 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => changeQty(line.product.id, -1)}
                    aria-label={`نقص كمية ${line.product.name}`}
                    className="w-7 h-7 grid place-items-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(line.product.id)}
                    aria-label={`حذف ${line.product.name} من الفاتورة`}
                    className="w-7 h-7 grid place-items-center rounded-lg border border-rose-700/50 text-rose-400 hover:bg-rose-700/20 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* بيانات العميل */}
      <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-4">
        <h4 className="text-sm font-bold text-brand-400">بيانات العميل (اختياري للبيع النقدي)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="اسم العميل" value={customerName} onChange={setCustomerName} placeholder="عميل معرض" />
          <Input
            label="رقم الهاتف"
            value={customerPhone}
            onChange={onCustomerPhoneChange}
            placeholder="01012345678"
            maxLength={11}
            numeric
            textLeft
            error={errors.customerPhone}
            hint="مطلوب فقط للبيع الآجل أو الجزئي — يُعبَّأ اسم العميل وعنوانه تلقائياً من الرقم المسجل"
          />
        </div>
        <Input
          label="عنوان العميل (اختياري)"
          value={customerAddress}
          onChange={setCustomerAddress}
          placeholder="المحافظة - المدينة - التفاصيل (يُعبأ تلقائياً من ملف العميل عند التعرف عليه)"
        />
      </div>

      {/* الملخص المالي */}
      <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-3">
        <h4 className="text-sm font-bold text-brand-400">الملخص المالي</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={labelWithCurrency('الخصم')}
            type="number"
            min="0"
            value={discount}
            onChange={v => {
              setDiscount(v)
              clearError('discount')
            }}
            error={errors.discount}
            className="num-font"
          />
          <Input
            label={labelWithCurrency('المدفوع')}
            type="number"
            min="0"
            value={paid}
            onChange={v => {
              setPaid(v)
              clearError('paid')
            }}
            error={errors.paid}
            className="num-font"
          />
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-400">
            <span>المجموع قبل الخصم</span>
            <span className="num-font">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>الخصم</span>
            <span className="num-font text-rose-400">− {formatCurrency(discountApplied)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-white border-t border-slate-800 pt-2">
            <span>الإجمالي</span>
            <span className="num-font">{formatCurrency(total)}</span>
          </div>
          <div className={`flex justify-between font-bold ${remaining > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            <span>المتبقي</span>
            <span className="num-font">{formatCurrency(remaining)}</span>
          </div>
        </div>
      </div>

      {/* أزرار الإنهاء السريع */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        <Button variant="secondary" onClick={() => setPaid(total)} disabled={submitting}>
          دفعة كاملة
        </Button>
        <Button variant="success" onClick={() => handleSave({ forceFull: true })} loading={submitting} disabled={submitting}>
          نقداً
        </Button>
        <Button variant="warning" onClick={() => handleSave({ deferred: true })} loading={submitting} disabled={submitting}>
          آجل
        </Button>
        <Button variant="primary" onClick={() => handleSave({ deferred: false })} loading={submitting} disabled={submitting}>
          إتمام البيع
        </Button>
      </div>
    </Modal>
  )
}

export default PosModal
