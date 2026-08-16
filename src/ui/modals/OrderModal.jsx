// =============================================================================
// ui/modals/OrderModal.jsx — نافذة فاتورة البيع الجديدة — نسخة React من
// js/components/orders-dialog.js (978 سطراً)
// -----------------------------------------------------------------------------
// ينقل كل منطق النافذة الحرفي إلى حالة React: التعرف التلقائي على العميل من
// الهاتف، العناوين المسجلة/اليدوية، مؤشر العجز اللحظي، وضع الكاشير، نوع
// العربون والتعبئة التلقائية، التحقق الصارم للهاتف/الكمية/الدفعة المقدمة،
// وحماية الضغط المتكرر. قراءة البيانات (getProducts/getSuppliers/createOrder/
// findCustomerByPhone/getCustomerAddresses/addCustomerAddress) عبر جسر window
// (compat)، بينما تأتي الدوال النقية (egypt/phones/customerRules) مباشرة.
// =============================================================================
import { useState, useMemo, useEffect } from 'react'
import { UserCheck, Plus, Trash2, Boxes, Truck, Coins, CheckCircle2, ShoppingCart } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { EGYPT_GOVERNORATES, getCitiesForGovernorate, parseAddressComponents, matchEgyptAddress } from '../../utils/egypt.js'
import { normalizePhone, validateEgyptianPhone } from '../../utils/phones.js'
import { formatCurrency, labelWithCurrency } from '../../utils/formatters.js'
import { CUSTOMER_CATEGORIES } from '../../domain/customers/customerRules.js'

const DEPOSIT_TYPE_OPTIONS = [
  { value: 'custom', label: 'عربون عادي — تحدد المبلغ يدوياً (دفعة مقدمة عامة)' },
  { value: 'shipping', label: 'عربون بقيمة الشحن — تُعبأ الدفعة تلقائياً = تكلفة الشحن' },
  { value: 'shipping_extra', label: 'عربون الشحن + المصروفات الإضافية — تُعبأ تلقائياً = الشحن + التغليف' },
]

const STATUS_OPTIONS = [
  { value: 'new', label: 'جديد / قيد الانتظار (بدون خصم من المخزون حالياً)' },
  { value: 'delivered', label: 'تم التوصيل / خرج للشحن (خصم الكميات فوراً من المخزن)' },
  { value: 'completed', label: 'مكتمل نهائي (تسليم وتم تحصيل الحساب كامل بالكامل)' },
]

const DEPOSIT_TYPE_HINTS = {
  shipping:
    'سيُعبَّأ حقل الدفعة المقدمة تلقائياً بقيمة تكلفة الشحن، ويُسجَّل الجزء الخاص بالشحن في حساب «إيراد خدمات شحن ونقل» منفصلاً عن مبيعات البضاعة وصافي ربح المنتجات.',
  shipping_extra:
    'سيُعبَّأ حقل الدفعة المقدمة تلقائياً بقيمة الشحن + المصروفات الإضافية، ويُسجَّل جزآ الشحن والتغليف في حساب «إيراد خدمات شحن ونقل» منفصلاً عن مبيعات البضاعة وصافي ربح المنتجات.',
  custom: '',
}

function makeLineItem(product, supplier) {
  return {
    productId: product?.id || '',
    productName: product?.name || '',
    quantity: 1,
    purchasePrice: product?.purchasePrice || 0,
    sellingPrice: product?.sellingPrice || 0,
    supplierId: supplier?.id || '',
    supplierName: supplier?.name || '',
    isDirectShip: false,
  }
}

// 🔒 اسم المستخدم الجالس بأمان (جلسة قد تكون غائبة/ناقصة في المعاينة والاختبارات).
function safeCurrentUserName() {
  try {
    const u = typeof window !== 'undefined' && typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null
    return u && u.name ? u.name : 'المدير العام'
  } catch {
    return 'المدير العام'
  }
}

function OrderModal() {
  const open = useUiStore(s => s.orderModal.open)
  if (!open) return null
  return <OrderModalInner />
}

function OrderModalInner() {
  const onSuccess = useUiStore(s => s.orderModal.onSuccess)
  const initialData = useUiStore(s => s.orderModal.initialData)
  const close = useUiStore(s => s.closeOrderModal)

  const products = useState(() => (window.getProducts ? window.getProducts() : []))[0]
  const suppliers = useState(() => (window.getSuppliers ? window.getSuppliers() : []))[0]

  useEffect(() => {
    if (products.length === 0) {
      showToast('يرجى إدخال منتج واحد على الأقل في قائمة المنتجات قبل إضافة طلب جديد', 'warning')
    }
  }, [products.length])

  // V3.35 — التعبئة الذكية من الشات (createOrder): بيانات مستخرجة تُعرض للمراجعة
  // والحفظ بواسطة المستخدم — لا يُنفَّذ أي شيء هنا.
  const prefilled = initialData && typeof initialData === 'object' ? initialData : null
  const prefilledAddr = useMemo(() => matchEgyptAddress(prefilled ? prefilled.address : ''), [prefilled])

  const [lineItems, setLineItems] = useState(() => {
    if (prefilled && Array.isArray(prefilled.items) && prefilled.items.length > 0) {
      return prefilled.items.map(it => ({
        productId: it.productId || '',
        productName: it.productName || it.name || '',
        quantity: Number(it.quantity) || 1,
        purchasePrice: Number(it.purchasePrice) || 0,
        sellingPrice: Number(it.sellingPrice) || 0,
        supplierId: it.supplierId || '',
        supplierName: it.supplierName || '',
        isDirectShip: !!it.isDirectShip,
      }))
    }
    return [makeLineItem(products[0], suppliers[0])]
  })

  // V3.56 — إخفاء المنتجات المختارة سابقاً: المنتجات المضافة في أسطر أخرى لا
  // تظهر في قائمة اختيار السطر الجديد، وتعاود الظهور فور حذف سطرها.
  const selectedProductIds = useMemo(
    () => new Set(lineItems.map(it => it.productId).filter(Boolean)),
    [lineItems]
  )

  // --- بيانات العميل ---
  const [phone, setPhone] = useState(prefilled ? String(prefilled.phone || '') : '')
  const [phone2, setPhone2] = useState(prefilled ? String(prefilled.secondaryPhone || '') : '')
  const [name, setName] = useState(prefilled ? String(prefilled.customerName || '') : '')
  const [category, setCategory] = useState(prefilled && prefilled.category ? prefilled.category : CUSTOMER_CATEGORIES[0])
  const [notes, setNotes] = useState(prefilled ? String(prefilled.notes || '') : '')
  const [gov, setGov] = useState(prefilled ? prefilledAddr.governorate : 'القاهرة')
  const [city, setCity] = useState(() => {
    if (!prefilled) return ''
    if (prefilledAddr.city && getCitiesForGovernorate(prefilledAddr.governorate).includes(prefilledAddr.city)) {
      return prefilledAddr.city
    }
    return prefilledAddr.city ? '__other__' : ''
  })
  const [cityManual, setCityManual] = useState(() => {
    if (prefilled && prefilledAddr.city
      && !getCitiesForGovernorate(prefilledAddr.governorate).includes(prefilledAddr.city)) {
      return prefilledAddr.city
    }
    return ''
  })
  const [addrDetails, setAddrDetails] = useState(prefilled ? prefilledAddr.details : '')
  const [matchedCustomer, setMatchedCustomer] = useState(null)
  const [matchedAddresses, setMatchedAddresses] = useState([])
  const [selectedAddressId, setSelectedAddressId] = useState('')
  const [useRegistered, setUseRegistered] = useState(false)

  // --- عنوان جديد لعميل مسجل ---
  const [newAddrOpen, setNewAddrOpen] = useState(false)
  const [newAddrLabel, setNewAddrLabel] = useState('')
  const [newAddrGov, setNewAddrGov] = useState('القاهرة')
  const [newAddrCity, setNewAddrCity] = useState('')
  const [newAddrCityManual, setNewAddrCityManual] = useState('')
  const [newAddrDetails, setNewAddrDetails] = useState('')

  // --- الوضع المالي ---
  const [shippingCost, setShippingCost] = useState(prefilled ? Number(prefilled.shippingCost) || 0 : 0)
  const [shippingPayer, setShippingPayer] = useState('customer')
  const [extraExpenses, setExtraExpenses] = useState(prefilled ? Number(prefilled.extraExpenses) || 0 : 0)
  const [extraExpensesPayer, setExtraExpensesPayer] = useState('customer')
  const [depositType, setDepositType] = useState(prefilled && prefilled.depositType ? prefilled.depositType : 'custom')
  const [downPayment, setDownPayment] = useState(prefilled ? (Number(prefilled.advanceAmount) || Number(prefilled.downPayment) || 0) : 0)
  const [status, setStatus] = useState(prefilled && prefilled.paymentType === 'full' ? 'completed' : 'new')
  const [submitting, setSubmitting] = useState(false)
  const [savingAddr, setSavingAddr] = useState(false)
  const [errors, setErrors] = useState({})

  const cityOptions = useMemo(
    () => [
      ...getCitiesForGovernorate(gov).map(c => ({ value: c, label: c })),
      { value: '__other__', label: 'أخرى (إدخال يدوي)...' },
    ],
    [gov]
  )

  const newAddrCityOptions = useMemo(
    () => [
      ...getCitiesForGovernorate(newAddrGov).map(c => ({ value: c, label: c })),
      { value: '__other__', label: 'أخرى (إدخال يدوي)...' },
    ],
    [newAddrGov]
  )

  const summary = useMemo(() => {
    const shipCost = Number(shippingCost) || 0
    const exExp = Number(extraExpenses) || 0
    const itemsSubtotal = lineItems.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.sellingPrice) || 0),
      0
    )
    const totalAmount =
      itemsSubtotal + (shippingPayer === 'customer' ? shipCost : 0) + (extraExpensesPayer === 'customer' ? exExp : 0)
    const rawDp = Number(downPayment) || 0
    const isCompleted = status === 'completed'
    const effectiveDp = isCompleted ? totalAmount : rawDp
    const dp = Math.min(totalAmount, effectiveDp)
    const rem = Math.max(0, totalAmount - dp)
    const overLimit = effectiveDp > totalAmount && totalAmount > 0

    const stockWarnings = {}
    const deficitGroups = {}
    lineItems.forEach((item, idx) => {
      const product = products.find(p => p.id === item.productId)
      const qty = Number(item.quantity) || 0
      if (item.isDirectShip) {
        stockWarnings[idx] = { level: 'direct', text: 'شحن مباشر: لن يُخصم من مخزون المستودع' }
        return
      }
      if (product && qty > Number(product.stock)) {
        const deficit = qty - Number(product.stock)
        stockWarnings[idx] = { level: 'deficit', text: `عجز ${deficit} قطعة (سيتصفر المخزون ويُسجل عجز للمورد)` }
        const supplierId = item.supplierId || ''
        const supplierName = item.supplierName || ''
        const costPerUnit = Number(item.purchasePrice) || Number(product.purchasePrice) || 0
        const amount = deficit * costPerUnit
        if (supplierId && amount > 0) {
          deficitGroups[supplierId] = deficitGroups[supplierId] || { name: supplierName, units: 0, amount: 0 }
          deficitGroups[supplierId].units += deficit
          deficitGroups[supplierId].amount += amount
        }
      } else if (product) {
        stockWarnings[idx] = { level: 'ok', text: `(المخزون الحالي: ${Number(product.stock)} قطعة)` }
      }
    })

    return { itemsSubtotal, shipCost, exExp, totalAmount, rawDp, effectiveDp, dp, rem, overLimit, stockWarnings, deficitGroups }
  }, [lineItems, shippingCost, shippingPayer, extraExpenses, extraExpensesPayer, status, downPayment, products])

  const dpReadOnly = depositType === 'shipping' || depositType === 'shipping_extra'
  const depositHint = DEPOSIT_TYPE_HINTS[depositType] || ''

  const updateItem = (idx, patch) =>
    setLineItems(list => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  // --- التعرف التلقائي على العميل من الهاتف (V3.23 / V3.25 / V3.26) ---
  const clearCustomerFields = () => {
    setMatchedCustomer(null)
    setMatchedAddresses([])
    setUseRegistered(false)
    setName('')
    setPhone2('')
    setCategory(CUSTOMER_CATEGORIES[0])
    setNotes('')
    setGov('القاهرة')
    setCity('')
    setCityManual('')
    setAddrDetails('')
  }

  const applyCustomerMatch = existing => {
    setMatchedCustomer(existing)
    setName(existing.name || '')
    const realPrimary = existing.phone ? existing.phone.trim() : ''
    const realSecondary = existing.secondaryPhone ? existing.secondaryPhone.trim() : ''
    setPhone(realPrimary)
    setPhone2(realSecondary && normalizePhone(realSecondary) !== normalizePhone(realPrimary) ? realSecondary : '')
    if (existing.category) setCategory(existing.category)
    if (existing.notes) setNotes(existing.notes)
    const addresses = window.getCustomerAddresses ? window.getCustomerAddresses(existing.id) : []
    if (addresses.length > 0) {
      setUseRegistered(true)
      setMatchedAddresses(addresses)
      const defaultIndex = addresses.findIndex(a => a.isDefault)
      setSelectedAddressId(addresses[defaultIndex >= 0 ? defaultIndex : 0].id)
      setNewAddrOpen(false)
    } else {
      setUseRegistered(false)
      setMatchedAddresses([])
      if (existing.address) {
        const parts = parseAddressComponents(existing.address)
        setGov(parts.governorate)
        if (parts.city) {
          const cityList = getCitiesForGovernorate(parts.governorate)
          if (cityList.includes(parts.city)) {
            setCity(parts.city)
            setCityManual('')
          } else {
            setCity('__other__')
            setCityManual(parts.city)
          }
        }
        if (parts.details) setAddrDetails(parts.details)
      }
    }
    showToast(`تم التعرف على العميل: ${existing.name}`, 'info', 2000)
  }

  const handleUnregisteredNumber = () => {
    if (!matchedCustomer) return
    clearCustomerFields()
    showToast('الرقم غير مسجل لعميل — استكمل إدخال بيانات العميل الجديد', 'info', 2000)
  }

  const handlePhoneAutoFill = (fromField, typed) => {
    const norm = normalizePhone(typed)
    if (norm.length === 11 && norm.startsWith('01')) {
      const existing = window.findCustomerByPhone ? window.findCustomerByPhone(typed) : null
      if (existing) {
        applyCustomerMatch(existing)
      } else {
        handleUnregisteredNumber()
      }
      return
    }
    if (matchedCustomer) {
      const expected =
        fromField === 'phone'
          ? matchedCustomer.phone
            ? normalizePhone(matchedCustomer.phone)
            : ''
          : matchedCustomer.secondaryPhone
            ? normalizePhone(matchedCustomer.secondaryPhone)
            : ''
      if (norm !== expected) {
        clearCustomerFields()
        showToast('تغيّر رقم الهاتف — أعد إدخال رقم العميل لتعبئة البيانات تلقائياً', 'info', 2000)
      }
    }
  }

  const onPhoneChange = v => {
    setPhone(v)
    clearError('phone')
    handlePhoneAutoFill('phone', v)
  }
  const onPhone2Change = v => {
    setPhone2(v)
    clearError('phone2')
    handlePhoneAutoFill('phone2', v)
  }

  // --- حفظ عنوان جديد لعميل مسجل ---
  const saveNewAddress = () => {
    if (savingAddr) return
    if (!matchedCustomer) {
      showToast('اختر العميل أولاً من رقم الهاتف', 'error')
      return
    }
    const effCity = newAddrCity === '__other__' ? newAddrCityManual.trim() : newAddrCity
    if (!newAddrGov.trim() || !effCity) {
      showToast('يرجى اختيار المحافظة والمدينة للعنوان الجديد', 'error')
      return
    }
    const details = newAddrDetails.trim()
    const combined = details ? `${newAddrGov} - ${effCity} - ${details}` : `${newAddrGov} - ${effCity}`
    setSavingAddr(true)
    try {
      const added = window.addCustomerAddress(matchedCustomer.id, { label: newAddrLabel.trim(), address: combined })
      const addresses = window.getCustomerAddresses(matchedCustomer.id)
      setMatchedAddresses(addresses)
      setSelectedAddressId(added.id)
      setNewAddrLabel('')
      setNewAddrDetails('')
      setNewAddrOpen(false)
      showToast('تم حفظ العنوان الجديد بنجاح', 'success')
    } catch (err) {
      showToast(err.message || 'تعذر حفظ العنوان', 'error')
    } finally {
      setSavingAddr(false)
    }
  }

  // --- التعبئة التلقائية للدفعة المقدمة حسب نوع العربون (V3.11) ---
  const onDepositTypeChange = t => {
    setDepositType(t)
    if (t === 'shipping') setDownPayment(Number(shippingCost) || 0)
    else if (t === 'shipping_extra') setDownPayment((Number(shippingCost) || 0) + (Number(extraExpenses) || 0))
  }

  const onShippingCostChange = v => {
    setShippingCost(v)
    if (depositType === 'shipping') setDownPayment(v)
    else if (depositType === 'shipping_extra') setDownPayment(v + (Number(extraExpenses) || 0))
  }

  const onExtraExpensesChange = v => {
    setExtraExpenses(v)
    if (depositType === 'shipping_extra') setDownPayment((Number(shippingCost) || 0) + v)
  }

  const onProductChange = (idx, productId) => {
    clearError(`product_${idx}`)
    clearError(`qty_${idx}`)
    clearError(`supplier_${idx}`)
    const pObj = products.find(p => p.id === productId)
    if (!pObj) {
      updateItem(idx, { productId, productName: '', quantity: 1, purchasePrice: 0, sellingPrice: 0, supplierId: '', supplierName: '' })
      return
    }
    const patch = {
      productId: pObj.id,
      productName: pObj.name,
      purchasePrice: pObj.purchasePrice,
      sellingPrice: pObj.sellingPrice,
      supplierId: pObj.supplierId || '',
      supplierName: pObj.supplierName || '',
    }
    updateItem(idx, patch)
  }

  const onSupplierChange = (idx, supplierId) => {
    clearError(`supplier_${idx}`)
    const sObj = suppliers.find(s => s.id === supplierId)
    updateItem(idx, { supplierId, supplierName: sObj ? sObj.name : '' })
  }

  const addLineItem = () => {
    const first = products.find(p => !selectedProductIds.has(p.id)) || products[0]
    setLineItems(list => [...list, makeLineItem(first, suppliers[0])])
  }
  const removeLineItem = idx => setLineItems(list => list.filter((_, i) => i !== idx))

  // --- الحفظ والتحقق الصارم ---
  const handleSubmit = async e => {
    e.preventDefault()
    if (submitting) return
    const phoneVal = phone.trim()

    const v = validateEgyptianPhone(phoneVal)
    if (!v.isValid) {
      setErrors({ phone: v.message })
      showToast(v.message, 'error')
      return
    }

    const phone2Raw = phone2.trim()
    let secondaryPhone = ''
    if (phone2Raw) {
      const v = validateEgyptianPhone(phone2Raw)
      if (!v.isValid) {
        setErrors({ phone2: v.message })
        showToast(v.message, 'error')
        return
      }
      secondaryPhone = v.cleaned
    }

    if (!name.trim()) {
      setErrors({ name: 'يرجى إدخال اسم العميل (رقم الهاتف غير مسجل — أكمل بيانات العميل الجديد)' })
      showToast('يرجى إدخال اسم العميل (رقم الهاتف غير مسجل — أكمل بيانات العميل الجديد)', 'error')
      return
    }

    const validItems = lineItems.filter(it => it.productId && Number(it.quantity) > 0)
    if (validItems.length === 0) {
      const rowErrors = {}
      lineItems.forEach((it, idx) => {
        if (!it.productId) rowErrors[`product_${idx}`] = 'يرجى اختيار المنتج'
        if (!(Number(it.quantity) > 0)) rowErrors[`qty_${idx}`] = 'يرجى إدخال كمية صحيحة أكبر من الصفر'
      })
      setErrors(rowErrors)
      showToast('يرجى اختيار منتج واحد على الأقل وإدخال كمية صحيحة', 'error')
      return
    }

    // V3.59 — الشحن المباشر يُطلب على مستوى الصنف: كل صنف عليه isDirectShip
    // يحتاج مورداً مصنعاً. الأصناف العادية (من المخزون) لا تحتاج ذلك.
    const missingSupplier = lineItems.some(it => it.productId && Number(it.quantity) > 0 && it.isDirectShip && !it.supplierId)
    if (missingSupplier) {
      const rowErrors = {}
      lineItems.forEach((it, idx) => {
        if (it.productId && Number(it.quantity) > 0 && it.isDirectShip && !it.supplierId) {
          rowErrors[`supplier_${idx}`] = 'مطلوب للشحن المباشر — اختر المورد المصنع'
        }
      })
      setErrors(rowErrors)
      showToast('للشحن المباشر من المورد يجب اختيار المورد المصنع لكل منتج', 'error')
      return
    }

    const shipCost = Number(shippingCost) || 0
    const exExpenses = Number(extraExpenses) || 0
    const itemsSubtotal = validItems.reduce(
      (sum, it) => sum + (Number(it.quantity) * Number(it.sellingPrice)),
      0
    )
    const totalInvoiceAmount =
      itemsSubtotal + (shippingPayer === 'customer' ? shipCost : 0) + (extraExpensesPayer === 'customer' ? exExpenses : 0)
    const rawDownPayment = Number(downPayment) || 0
    const orderStatus = status
    const finalDownPayment = orderStatus === 'completed' ? totalInvoiceAmount : rawDownPayment

    const effCity = city === '__other__' ? cityManual.trim() : (city || '').trim()
    const addrDetailsTrimmed = addrDetails.trim()
    let shippingAddressId = ''
    let addressCombined = ''
    // V3.28 — العنوان اختياري تماماً: دون مدينة لا يُبنى عنوان «نصف فارغ».
    if (effCity) {
      addressCombined = addrDetailsTrimmed ? `${gov} - ${effCity} - ${addrDetailsTrimmed}` : `${gov} - ${effCity}`
    }
    if (matchedCustomer && matchedAddresses.length > 0 && selectedAddressId) {
      const selectedAddr = matchedAddresses.find(a => a.id === selectedAddressId)
      if (selectedAddr) {
        shippingAddressId = selectedAddr.id
        addressCombined = selectedAddr.address
      }
    }

    // V3.28 — AUTO-UPDATE: عنوان يدوي جديد لعميل مسجل (بلا عنوان مسجل أو بعنوان
    // مختلف) يُحفظ تلقائياً في customerStore وFirestore ليُستخدم في الطلبات
    // المستقبلية — لا يُكرَّر حفظ عنوان مطابق لمسجَّل مسبقاً.
    if (matchedCustomer && !shippingAddressId && addressCombined) {
      const registeredAddresses = (matchedAddresses || [])
        .map(a => String(a.address || '').trim())
        .filter(Boolean)
      if (String(matchedCustomer.address || '').trim()) {
        registeredAddresses.push(String(matchedCustomer.address).trim())
      }
      if (!registeredAddresses.includes(addressCombined) && typeof window.addCustomerAddress === 'function') {
        try {
          const added = window.addCustomerAddress(matchedCustomer.id, { label: 'عنوان الطلب', address: addressCombined })
          shippingAddressId = added && added.id ? added.id : ''
          const refreshed = window.getCustomerAddresses ? window.getCustomerAddresses(matchedCustomer.id) : []
          if (refreshed.length) setMatchedAddresses(refreshed)
          showToast('تم حفظ العنوان الجديد في ملف العميل ليُستخدم في الطلبات القادمة', 'success')
        } catch (addrErr) {
          // الفشل في حفظ العنوان لا يمنع إتمام الطلب إطلاقاً.
          console.warn('Auto address update skipped:', addrErr)
        }
      }
    }
    const customerName = name

    if (rawDownPayment > totalInvoiceAmount) {
      setErrors({ downPayment: 'الدفعة المقدمة لا يمكن أن تتجاوز إجمالي الفاتورة' })
      showToast(
        `خطأ: الدفعة المقدمة (${formatCurrency(rawDownPayment)}) لا يمكن أن تتجاوز إجمالي الفاتورة (${formatCurrency(totalInvoiceAmount)})`,
        'error'
      )
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const newOrder = await window.createOrder({
        customerInfo: {
          name: customerName,
          phone: phoneVal,
          secondaryPhone,
          category,
          address: addressCombined,
          addressId: shippingAddressId,
          notes,
        },
        items: validItems,
        downPayment: finalDownPayment,
        shippingCost: shipCost,
        shippingPayer,
        extraExpenses: exExpenses,
        extraExpensesPayer,
        status: orderStatus,
        directShipping: validItems.every(it => it.isDirectShip),
        depositType,
        cashierMode: false,
        createdBy: safeCurrentUserName(),
      })
      showToast(`تم حفظ وتأكيد الطلب رقم ${newOrder.id} بنجاح`, 'success')
      close()
      if (typeof onSuccess === 'function') onSuccess(newOrder)
    } catch (err) {
      console.error(err)
      showToast(err.message || 'حدث خطأ أثناء إتمام الطلب', 'error')
      setSubmitting(false)
    }
  }

  const allDirect = lineItems.length > 0 && lineItems.every(it => it.isDirectShip)
  const directCount = lineItems.filter(it => it.isDirectShip).length
  const deficitEntries = Object.entries(summary.deficitGroups)

  return (
    <Modal open onClose={close} title="إنشاء طلب جديد / فاتورة بيع" icon={ShoppingCart} maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* بيانات العميل */}
        <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-brand-400 flex items-center gap-2">
              <UserCheck className="w-4 h-4" />
              <span>بيانات العميل</span>
            </h4>
            {matchedCustomer ? (
              <span className="px-2.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 rounded-lg border border-emerald-500/30">
                عميل مسجل حالياً
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="اسم العميل *"
              value={name}
              onChange={v => {
                setName(v)
                clearError('name')
              }}
              placeholder="اسم العميل الثلاثي"
              disabled={!!matchedCustomer}
              error={errors.name}
              hint="يُعبَّأ تلقائياً عند إدخال رقم هاتف مسجل لعميل"
            />
            <Input
              label="رقم الهاتف * (11 رقم يبدأ بـ 01)"
              value={phone}
              onChange={onPhoneChange}
              placeholder="01012345678"
              maxLength={11}
              numeric
              textLeft
              error={errors.phone}
              hint="يُستخدم للتحقق والربط التلقائي بحساب العميل"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="رقم هاتف ثانوي (اختياري)"
              value={phone2}
              onChange={onPhone2Change}
              placeholder="01012345678"
              maxLength={11}
              numeric
              textLeft
              error={errors.phone2}
            />
            <Select
              label="تصنيف العميل *"
              value={category}
              onChange={setCategory}
              options={CUSTOMER_CATEGORIES}
              disabled={!!matchedCustomer}
            />
          </div>

          {/* العناوين المسجلة */}
          {useRegistered ? (
            <div className="space-y-3">
              <Select
                label="عنوان التوصيل (من العناوين المسجلة للعميل)"
                value={selectedAddressId}
                onChange={setSelectedAddressId}
                options={matchedAddresses.map(a => ({
                  value: a.id,
                  label: `${a.label ? a.label + ' — ' : ''}${a.address}${a.isDefault ? ' (الافتراضي)' : ''}`,
                }))}
              />
              <button
                type="button"
                onClick={() => setNewAddrOpen(o => !o)}
                className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ إضافة عنوان جديد</span>
              </button>
              {newAddrOpen ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-950/40 rounded-xl border border-slate-800">
                  <div className="sm:col-span-2">
                    <Input label="اسم العنوان (اختياري)" value={newAddrLabel} onChange={setNewAddrLabel} placeholder="المنزل / محل العمل / المخزن..." />
                  </div>
                  <Select
                    label="المحافظة *"
                    value={newAddrGov}
                    onChange={setNewAddrGov}
                    options={Object.keys(EGYPT_GOVERNORATES)}
                  />
                  <div>
                    <Select
                      label="المدينة / المركز *"
                      value={newAddrCity}
                      onChange={setNewAddrCity}
                      options={newAddrCityOptions}
                    />
                    {newAddrCity === '__other__' ? (
                      <Input
                        value={newAddrCityManual}
                        onChange={setNewAddrCityManual}
                        placeholder="اكتب اسم المدينة / المركز يدوياً..."
                        className="mt-2 border-amber-700/60"
                      />
                    ) : null}
                  </div>
                  <div className="sm:col-span-2">
                    <Input label="تفاصيل العنوان / العلامة المميزة (اختياري)" value={newAddrDetails} onChange={setNewAddrDetails} placeholder="مثال: الشارع الرئيسي، بجوار مسجد الهدى، قرية..." />
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={saveNewAddress} loading={savingAddr} disabled={savingAddr}>حفظ العنوان</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            /* العنوان اليدوي */
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select label="المحافظة *" value={gov} onChange={setGov} options={Object.keys(EGYPT_GOVERNORATES)} hint="اختياري — يُترك فارغاً للبيع دون عنوان توصيل" />
                <div>
                  <Select label="المدينة / المركز *" value={city} onChange={setCity} options={cityOptions} />
                  {city === '__other__' ? (
                    <Input
                      value={cityManual}
                      onChange={setCityManual}
                      placeholder="اكتب اسم المدينة / المركز يدوياً..."
                      className="mt-2 border-amber-700/60"
                    />
                  ) : null}
                </div>
              </div>
              <Input
                label="تفاصيل العنوان / العلامة المميزة (اختياري)"
                value={addrDetails}
                onChange={setAddrDetails}
                placeholder="مثال: الشارع الرئيسي، بجوار مسجد الهدى، قرية..."
              />
            </div>
          )}

          <Input label="ملاحظات العميل" value={notes} onChange={setNotes} placeholder="ملاحظات تسليم خاصة..." voiceLabel="ملاحظات صوتية للطلب" />
        </div>

        {/* المنتجات المطلوبة */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-brand-400 flex items-center gap-2">
              <Boxes className="w-4 h-4" />
              <span>المنتجات المطلوبة</span>
            </h4>
            <Button size="sm" variant="secondary" icon={Plus} onClick={addLineItem}>إضافة منتج آخر</Button>
          </div>

          <label className="flex items-center gap-2.5 p-3 bg-purple-950/30 rounded-xl border border-purple-800/40 cursor-pointer transition-all select-none">
            <input
              type="checkbox"
              checked={allDirect}
              onChange={e => {
                const v = e.target.checked
                setLineItems(list => list.map(it => ({ ...it, isDirectShip: v })))
              }}
              className="w-4 h-4 accent-purple-500 shrink-0"
              aria-label="شحن مباشر من المورد"
            />
            <span className="text-xs font-bold text-purple-300">
              شحن مباشر من المورد لجميع الأصناف (الطلب يذهب من المصنع مباشرة للعميل — لا يُخصم من مخزون المستودع، ويُسجل
              توريد على المورد المختار لكل منتج). يمكن تفعيله لكل صنف على حدة من داخل صف المنتج.
            </span>
          </label>

          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {lineItems.map((item, idx) => {
              const subtotal = (Number(item.quantity) || 0) * (Number(item.sellingPrice) || 0)
              const warning = summary.stockWarnings[idx]
              return (
                <div
                  key={idx}
                  className="product-item-row grid grid-cols-1 sm:grid-cols-12 gap-3 p-4 bg-slate-800/60 rounded-xl border border-slate-700/80 items-center relative"
                >
                  <div className="sm:col-span-4">
                    <Select
                      label="المنتج *"
                      value={item.productId}
                      onChange={v => onProductChange(idx, v)}
                      placeholder="اختر المنتج..."
                      error={errors[`product_${idx}`]}
                      options={products
                        .filter(p => !selectedProductIds.has(p.id) || p.id === item.productId)
                        .map(p => ({ value: p.id, label: `${p.name} (متوفر: ${p.stock ?? 0})` }))}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label="الكمية *"
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={v => {
                        updateItem(idx, { quantity: Number(v) || 1 })
                        clearError(`qty_${idx}`)
                      }}
                      error={errors[`qty_${idx}`]}
                      className="text-center num-font"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label="سعر البيع *"
                      type="number"
                      min="0"
                      value={item.sellingPrice}
                      onChange={v => updateItem(idx, { sellingPrice: Number(v) || 0 })}
                      className="text-center num-font"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Select
                      label="المورد المصنع"
                      value={item.supplierId}
                      onChange={v => onSupplierChange(idx, v)}
                      placeholder="(اختياري)"
                      error={errors[`supplier_${idx}`]}
                      options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                      className="text-xs"
                    />
                  </div>
                  <div className="sm:col-span-1 flex flex-col items-center justify-end h-full">
                    {lineItems.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        onClick={() => removeLineItem(idx)}
                        title="حذف السطر"
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                      >
                        حذف
                      </Button>
                    ) : null}
                  </div>

                  <div className="sm:col-span-12 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-2 border-t border-slate-700/40 text-xs">
                    <div className="flex items-center gap-3">
                      <label
                        className="flex items-center gap-1.5 cursor-pointer select-none"
                        title="شحن مباشر من المورد لهذا الصنف فقط (لا يُخصم من مخزون المستودع ويُسجل توريد على مورده)"
                      >
                        <input
                          type="checkbox"
                          checked={!!item.isDirectShip}
                          onChange={e => updateItem(idx, { isDirectShip: e.target.checked })}
                          className="w-3.5 h-3.5 accent-purple-500 shrink-0"
                          aria-label={`شحن مباشر من المورد للصنف ${idx + 1}`}
                        />
                        <span className={`font-bold text-[11px] ${item.isDirectShip ? 'text-purple-400' : 'text-slate-400'}`}>
                          شحن مباشر من المورد
                        </span>
                      </label>
                      <span className="text-slate-400">
                        سعر الشراء الأصلي:{' '}
                        <span className="num-font text-slate-300">{formatCurrency(item.purchasePrice)}</span>
                      </span>
                    </div>
                    <span
                      className={`font-bold text-xs ${
                        warning ? (warning.level === 'deficit' ? 'text-rose-400' : warning.level === 'direct' ? 'text-purple-400' : 'text-slate-400 font-medium') : ''
                      }`}
                    >
                      {warning ? warning.text : ''}
                    </span>
                    <span className="font-bold text-emerald-400">
                      الإجمالي الفرعي: <span className="num-font font-extrabold text-sm">{formatCurrency(subtotal)}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* تكاليف الشحن والمصروفات الإضافية */}
        <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-4">
            <h4 className="text-sm font-bold text-purple-400 flex items-center gap-2">
              <Truck className="w-4 h-4" />
              <span>تكاليف الشحن والمصروفات الإضافية</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label={labelWithCurrency('تكلفة الشحن')} type="number" min="0" value={shippingCost} onChange={onShippingCostChange} className="num-font" />
              <Select
                label="الشحن على مَن؟"
                value={shippingPayer}
                onChange={setShippingPayer}
                options={[
                  { value: 'customer', label: 'على العميل (يضاف للفاتورة والمديونية)' },
                  { value: 'merchant', label: 'على التاجر (يخصم من صافي الربح)' },
                ]}
              />
              <Input label="مصروفات إضافية (تغليف/نقل)" type="number" min="0" value={extraExpenses} onChange={onExtraExpensesChange} className="text-amber-400 font-bold num-font" />
              <Select
                label="المصروفات الإضافية على مَن؟"
                value={extraExpensesPayer}
                onChange={setExtraExpensesPayer}
                options={[
                  { value: 'customer', label: 'على العميل (يضاف للفاتورة والمديونية)' },
                  { value: 'merchant', label: 'على التاجر (يخصم من صافي الربح)' },
                ]}
              />
            </div>
          </div>

        {/* نوع العربون */}
        <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
              <span className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-sky-400" />
                نوع العربون (الدفعة المقدمة)
              </span>
              <span className="text-[10px] font-bold text-sky-400/80 bg-sky-500/10 px-2 py-1 rounded-lg border border-sky-500/20">
                إيراد خدمات شحن ونقل منفصل
              </span>
            </div>
            <Select label="نوع العربون (الدفعة المقدمة)" value={depositType} onChange={onDepositTypeChange} options={DEPOSIT_TYPE_OPTIONS} />
            <p className={`text-[11px] font-bold text-sky-400 ${depositHint ? '' : 'hidden'}`}>{depositHint}</p>
          </div>

        {/* الدفعة المقدمة وحالة الطلب */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
          <div>
              <Input
                label="الدفعة المقدمة (اختياري)"
                type="number"
                min="0"
                value={dpReadOnly && status !== 'completed' ? summary.effectiveDp : status === 'completed' ? summary.totalAmount : downPayment}
                onChange={v => {
                  setDownPayment(Number(v) || 0)
                  clearError('downPayment')
                }}
                disabled={dpReadOnly}
                error={errors.downPayment}
                className="text-emerald-400 font-bold num-font"
              />
              {summary.overLimit ? (
                <p className="text-xs font-bold text-rose-400 mt-1">
                  {`⚠️ تنبيه: الدفعة المقدمة (${formatCurrency(summary.effectiveDp)}) لا يمكن أن تتجاوز إجمالي الفاتورة (${formatCurrency(summary.totalAmount)})`}
                </p>
              ) : null}
            </div>
            <div>
              <Select
                label="حالة الطلب الإبتدائية"
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS}
              />
              <p className={`text-[11px] font-bold text-emerald-400 mt-1.5 ${status === 'completed' ? '' : 'hidden'}`}>
                ✓ «مكتمل نهائي» يعني تحصيل كامل الفاتورة: سيُسدد إجمالي الفاتورة تلقائياً (المتبقي = {formatCurrency(0)})
              </p>
            </div>
          </div>

        {/* الملخص */}
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-700/80 shadow-sm space-y-2">
          <div className="flex justify-between items-center text-slate-300 text-sm">
            <span>إجمالي الفاتورة:</span>
            <span className="text-xl font-extrabold text-white num-font">{formatCurrency(summary.totalAmount)}</span>
          </div>
          <div className="flex justify-between items-center text-slate-400 text-xs">
            <span>المدفوع مقدماً:</span>
            <span className="font-bold text-emerald-400 num-font">{formatCurrency(summary.effectiveDp)}</span>
          </div>
          <div className="border-t border-slate-700 pt-2 flex justify-between items-center text-sm">
            <span className="font-bold text-slate-200">المبلغ المتبقي على العميل:</span>
            <span className="text-lg font-extrabold text-rose-400 num-font">{formatCurrency(summary.rem)}</span>
          </div>
          {directCount > 0 ? (
            <div className="border-t border-slate-800 pt-2 text-[11px] font-bold text-purple-300">
              {allDirect
                ? 'شحن مباشر من المورد: لن يُخصم أي مخزون من المستودع. ستُسجل شحنة توريد (بسعر الشراء) على المورد المختار لكل سطر.'
                : `شحن مباشر من المورد لـ ${directCount} من أصل ${lineItems.length} أصناف — مخزونها لن يُخصم ويُسجل توريد (بسعر الشراء) على المورد المختار لكل سطر منها.`}
            </div>
          ) : null}
          {deficitEntries.length > 0 ? (
            <div className="border-t border-slate-800 pt-2 flex flex-col gap-1 text-[11px] font-bold text-rose-400">
              <span>عجز مخزون (طلب مؤجل) سيُسجل كمديونية للمورد المختار:</span>
              {deficitEntries.map(([id, d]) => (
                <div key={id} className="flex justify-between items-center">
                  <span className="text-slate-300">{d.name} ({d.units} قطعة بسعر الشراء)</span>
                  <span className="num-font">{formatCurrency(d.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* الأزرار */}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>إلغاء</Button>
          <Button
            type="submit"
            variant="success"
            icon={CheckCircle2}
            loading={submitting}
            disabled={submitting}
            className="px-6"
          >
            {submitting ? 'جاري حفظ الطلب...' : 'حفظ وتأكيد الطلب'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default OrderModal
