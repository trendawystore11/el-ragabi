// =============================================================================
// ui/modals/AddProductModal.jsx — نافذة إضافة/تعديل منتج — نسخة React من
// window.openAddProductModal (js/components/products-view.js)
// -----------------------------------------------------------------------------
// إدارة بيانات المنتج (الاسم، المورد المصنع، المخزون، سعر الشراء/البيع، الحد
// الأدنى للمخزون، الملاحظات) مع ربط إجباري بالمورد. زر «+ مورد جديد» يفتح
// AddSupplierModal فوق النافذة الحالية عبر uiStore (بدل الجسر القديم) دون
// إغلاق نموذج المنتج أو فقدان بياناته، وعند الحفظ تُحدَّث قائمة الموردين
// ويُختار المورد المُنشأ حديثاً تلقائياً (نفس منطق legacy بالفرق في المعرفات).
// =============================================================================
import { useState, useMemo } from 'react'
import { Package, Plus, CheckCircle2 } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'

function AddProductModal() {
  const open = useUiStore(s => s.productModal.open)
  if (!open) return null
  return <AddProductModalInner />
}

function AddProductModalInner() {
  const { productId, onDone, initialData } = useUiStore(s => s.productModal)
  const close = useUiStore(s => s.closeAddProductModal)

  const [product] = useState(() => (productId && window.getProductById ? window.getProductById(productId) : null))
  const isEdit = !!product

  // 🔒 V3.42 — بيانات الاتصال بالموردين (رقم الهاتف) سرية: تظهر للمدير فقط.
  // أمين المخزن وموظف المبيعات يريان اسم المورد دون رقم هاتفه، فلا تتسرب
  // أرقام المصانع لأي موظف.
  const isAdmin = typeof window !== 'undefined' && window.isAdmin ? window.isAdmin() : false

  const [suppliers, setSuppliers] = useState(() => (window.getSuppliers ? window.getSuppliers() : []))

  // V3.36 — في وضع التعديل تُدمج بيانات التعبئة الذكية (initialData) فوق بيانات
  // المنتج المسجلة، فيفتح نموذج التعديل معبأً بما استخرجه المساعد من الشات.
  const base = product
    ? Object.assign({}, product, initialData || {})
    : (initialData || {})

  // V3.37 — عند التعبئة الذكية من المساعد لا تُخترَع قيم افتراضية: الحقول التي
  // لم يذكرها المساعد تبقى فارغة ليستكملها المستخدم، فلا يُسجَّل منتج ببيانات
  // غير حقيقية. أما الإضافة اليدوية فتبقى بقيمها الافتراضية المعتادة.
  const hasPrefill = !!initialData && typeof initialData === 'object'
  const [name, setName] = useState(base.name ? String(base.name) : '')
  const [supplierId, setSupplierId] = useState(base.supplierId ? String(base.supplierId) : '')
  const [stock, setStock] = useState(base.stock != null ? String(base.stock) : (hasPrefill ? '' : '10'))
  const [purchasePrice, setPurchasePrice] = useState(base.purchasePrice != null ? String(base.purchasePrice) : (hasPrefill ? '' : '1000'))
  const [sellingPrice, setSellingPrice] = useState(base.price != null
    ? String(base.price)
    : (base.sellingPrice != null ? String(base.sellingPrice) : (hasPrefill ? '' : '1400')))
  const [minStock, setMinStock] = useState(base.minStock != null ? String(base.minStock) : (hasPrefill ? '' : '5'))
  const [notes, setNotes] = useState(base.notes ? String(base.notes) : '')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const supplierOptions = useMemo(
    () => [
      { value: '', label: '-- اختر المورد المصنع --' },
      ...suppliers.map(s => ({
        value: s.id,
        label: isAdmin ? (s.phone ? `${s.name} (${s.phone})` : s.name) : s.name,
      })),
    ],
    [suppliers, isAdmin]
  )

  const quickAddSupplier = () => {
    const idsBefore = window.getSuppliers().map(s => s.id)
    useUiStore.getState().openAddSupplierModal(null, () => {
      const updated = window.getSuppliers()
      const created = updated.find(s => idsBefore.indexOf(s.id) === -1) || null
      setSuppliers(updated)
      if (created) setSupplierId(created.id)
    })
  }

  const handleSubmit = e => {
    e.preventDefault()

    const nextErrors = {}

    if (!name.trim()) {
      nextErrors.name = 'يرجى إدخال اسم المنتج'
    }
    if (!supplierId) {
      nextErrors.supplierId = 'يرجى اختيار المورد المصنع للمنتج'
    }

    // V3.37 — لا يُقبل حفظ منتج ببيانات مالية ناقصة: سعر بيع وسعر شراء حقيقيان
    // وكمية مخزون غير سالبة — حتى لا تُسجَّل منتجات بأسعار صفر أو قيم افتراضية.
    const numStock = Number(stock)
    if (String(stock).trim() === '' || isNaN(numStock) || numStock < 0) {
      nextErrors.stock = 'يرجى إدخال كمية مخزون صحيحة (0 أو أكثر)'
    }
    const numPurchase = Number(purchasePrice)
    if (String(purchasePrice).trim() === '' || isNaN(numPurchase) || numPurchase <= 0) {
      nextErrors.purchasePrice = 'يرجى إدخال سعر شراء صحيحاً أكبر من الصفر'
    }
    const numSell = Number(sellingPrice)
    if (String(sellingPrice).trim() === '' || isNaN(numSell) || numSell <= 0) {
      nextErrors.sellingPrice = 'يرجى إدخال سعر بيع صحيحاً أكبر من الصفر'
    }
    const numMin = Number(minStock)
    if (String(minStock).trim() === '' || isNaN(numMin) || numMin < 0) {
      nextErrors.minStock = 'يرجى إدخال حد أدنى صحيح (0 أو أكثر)'
    }
    if (!nextErrors.sellingPrice && !nextErrors.purchasePrice && numPurchase > numSell) {
      nextErrors.purchasePrice = 'سعر الشراء لا يمكن أن يتجاوز سعر البيع'
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }

    setErrors({})

    const selected = suppliers.find(s => s.id === supplierId)
    const data = {
      name,
      stock: numStock,
      purchasePrice: numPurchase,
      sellingPrice: numSell,
      minStock: numMin,
      supplierId,
      supplierName: selected ? selected.name : '',
      notes,
    }

    setSubmitting(true)
    try {
      if (isEdit) {
        window.updateProduct(product.id, data)
        showToast('تم تحديث بيانات المنتج والمورد بنجاح', 'success')
      } else {
        window.createProduct(data)
        showToast('تم إضافة المنتج الجديد للمخزون وربطه بالمورد بنجاح', 'success')
      }
      close()
      if (typeof onDone === 'function') onDone()
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title={isEdit ? `تعديل بيانات المنتج (${product.code || product.id}): ${product.name}` : 'إضافة منتج جديد للمخزن'}
      icon={Package}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="اسم المنتج"
          required
          value={name}
          onChange={v => { setName(v); clearError('name') }}
          placeholder="مثال: بطانية مورا إسباني 6 كيلو"
          error={errors.name}
        />

        <div className="flex items-end gap-2">
          <Select
            label="المورد المصنع"
            value={supplierId}
            onChange={v => { setSupplierId(v); clearError('supplierId') }}
            options={supplierOptions}
            required
            error={errors.supplierId}
            hint="إجباري — كل منتج يُربط بمورده المصنع، ويظهر مع اسمه في التقارير"
          />
          {isAdmin ? (
            <Button
              type="button"
              variant="secondary"
              icon={Plus}
              onClick={quickAddSupplier}
              className="text-purple-300 hover:bg-purple-600/40 shrink-0"
            >
              + مورد جديد
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="المخزون الحالي" type="number" value={stock} onChange={v => { setStock(v); clearError('stock') }} required className="text-center" error={errors.stock} />
          <Input label="سعر الشراء" type="number" value={purchasePrice} onChange={v => { setPurchasePrice(v); clearError('purchasePrice') }} required className="text-center" error={errors.purchasePrice} />
          <Input label="سعر البيع" type="number" value={sellingPrice} onChange={v => { setSellingPrice(v); clearError('sellingPrice') }} required className="text-center" hint="سعر بيع القطعة للعميل" error={errors.sellingPrice} />
        </div>

        <Input label="الحد الأدنى للمخزون للتنبيه" type="number" value={minStock} onChange={v => { setMinStock(v); clearError('minStock') }} className="text-center text-amber-300" hint="عند انخفاض المخزون لهذه النسبة يظهر في النواقص" error={errors.minStock} />
        <Input label="ملاحظات وصفية" value={notes} onChange={setNotes} placeholder="خامة المنتج، المقاسات، اللون..." />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button
            type="submit"
            variant="primary"
            icon={CheckCircle2}
            loading={submitting}
            disabled={submitting}
            className="px-6"
          >
            {isEdit ? (submitting ? 'جاري الحفظ...' : 'حفظ التعديلات') : submitting ? 'جاري الإضافة...' : 'إضافة المنتج'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default AddProductModal
