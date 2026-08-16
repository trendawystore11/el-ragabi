// =============================================================================
// ui/modals/AddSupplierModal.jsx — نافذة إضافة/تعديل مورد — نسخة React من
// window.openAddSupplierModal (js/components/suppliers-view.js)
// -----------------------------------------------------------------------------
// إدارة بيانات المورد (الاسم، الهاتفان، العنوان الثلاثي المعتمد من
// EGYPT_GOVERNORATES مع دعم الإدخال اليدوي للمدن، الملاحظات) مع التحقق الصارم
// للهاتف المصري. الحفظ عبر window.createSupplier / window.updateSupplier.
// =============================================================================
import { useState, useMemo } from 'react'
import { Truck, CheckCircle2 } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { EGYPT_GOVERNORATES, getCitiesForGovernorate, parseAddressComponents, matchEgyptAddress } from '../../utils/egypt.js'
import { validateEgyptianPhone } from '../../utils/phones.js'

function cityOptionsFor(gov) {
  return [
    { value: '', label: 'اختر المدينة / المركز' },
    ...getCitiesForGovernorate(gov).map(c => ({ value: c, label: c })),
    { value: '__other__', label: 'أخرى (إدخال يدوي)...' },
  ]
}

function AddSupplierModal() {
  const open = useUiStore(s => s.supplierModal.open)
  // 🔒 V3.42 — نافذة بيانات المورد تحتوي الهاتف والعنوان (سرية): تُعرض للمدير
  // فقط حتى لو فُتحت من مسار آخر. أمين المخزن وموظف المبيعات لا يريانها.
  const isAdmin = typeof window !== 'undefined' && window.isAdmin ? window.isAdmin() : false
  if (!open || !isAdmin) return null
  return <AddSupplierModalInner />
}

function AddSupplierModalInner() {
  const { supplierId, onDone, initialData } = useUiStore(s => s.supplierModal)
  const close = useUiStore(s => s.closeAddSupplierModal)

  const [supplier] = useState(() => (supplierId && window.getSupplierById ? window.getSupplierById(supplierId) : null))
  const isEdit = !!supplier

  const parsedAddr = useMemo(() => parseAddressComponents(supplier ? supplier.address : ''), [supplier])
  // V3.35 — تعبئة ذكية من الشات: address نص حر (قد يكون مدينة فقط أو ثلاثياً).
  const prefilledAddr = useMemo(() => matchEgyptAddress(initialData ? initialData.address : ''), [initialData])

  const [name, setName] = useState(supplier ? supplier.name : (initialData ? String(initialData.name || '') : ''))
  const [phone, setPhone] = useState(supplier ? supplier.phone || '' : (initialData ? String(initialData.phone || '') : ''))
  const [phone2, setPhone2] = useState(supplier ? supplier.secondaryPhone || '' : (initialData ? String(initialData.secondaryPhone || '') : ''))
  const [notes, setNotes] = useState(supplier ? supplier.notes || '' : (initialData ? String(initialData.notes || '') : ''))

  const [gov, setGov] = useState(supplier ? parsedAddr.governorate : (initialData ? prefilledAddr.governorate : 'القاهرة'))
  const [city, setCity] = useState(() => {
    if (supplier) {
      const cities = getCitiesForGovernorate(parsedAddr.governorate)
      return parsedAddr.city && cities.includes(parsedAddr.city) ? parsedAddr.city : '__other__'
    }
    if (initialData && prefilledAddr.city) {
      return getCitiesForGovernorate(prefilledAddr.governorate).includes(prefilledAddr.city)
        ? prefilledAddr.city
        : '__other__'
    }
    return ''
  })
  const [cityManual, setCityManual] = useState(() => {
    if (supplier) {
      const cities = getCitiesForGovernorate(parsedAddr.governorate)
      return parsedAddr.city && !cities.includes(parsedAddr.city) ? parsedAddr.city : ''
    }
    if (initialData && prefilledAddr.city) {
      return getCitiesForGovernorate(prefilledAddr.governorate).includes(prefilledAddr.city) ? '' : prefilledAddr.city
    }
    return ''
  })
  const [addrDetails, setAddrDetails] = useState(supplier ? (parsedAddr.details || '') : (initialData ? prefilledAddr.details : ''))

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const cityOptions = useMemo(() => cityOptionsFor(gov), [gov])
  const isManualCity = city === '__other__'

  const handleSubmit = e => {
    e.preventDefault()

    const nextErrors = {}

    if (!name.trim()) {
      nextErrors.name = 'يرجى إدخال اسم المورد / المصنع'
    }

    const phoneValid = validateEgyptianPhone(phone)
    if (!phoneValid.isValid) {
      nextErrors.phone = phoneValid.message
    }

    const secondaryRaw = phone2
    const secondaryValid = validateEgyptianPhone(secondaryRaw)
    if (secondaryRaw.trim() && !secondaryValid.isValid) {
      nextErrors.phone2 = secondaryValid.message
    }

    const effCity = isManualCity ? cityManual.trim() : city

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }

    setErrors({})

    const details = addrDetails.trim()
    const address = details ? `${gov} - ${effCity} - ${details}` : `${gov} - ${effCity}`

    const data = {
      name,
      phone: phoneValid.cleaned,
      secondaryPhone: secondaryRaw.trim() ? secondaryValid.cleaned : '',
      address,
      notes,
    }

    setSubmitting(true)
    try {
      if (isEdit) {
        window.updateSupplier(supplier.id, data)
        showToast('تم تحديث بيانات المورد بنجاح', 'success')
      } else {
        window.createSupplier(data)
        showToast('تم إضافة المورد الجديد بنجاح', 'success')
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
      title={isEdit ? `تعديل بيانات المورد: ${supplier.name}` : 'إضافة مورد جديد'}
      icon={Truck}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="اسم المورد / المصنع" required value={name} onChange={v => { setName(v); clearError('name') }} placeholder="اسم الشركة أو المصنع" error={errors.name} />
          <Input
            label="رقم الهاتف (11 رقماً يبدأ بـ 01)"
            value={phone}
            onChange={v => { setPhone(v); clearError('phone') }}
            placeholder="01012345678"
            maxLength={11}
            required
            numeric
            textLeft
            hint="يُظهر بجوار اسم المورد عند ربط المنتجات"
            error={errors.phone}
          />
          <Input
            label="رقم هاتف ثانوي (اختياري)"
            value={phone2}
            onChange={v => { setPhone2(v); clearError('phone2') }}
            placeholder="01012345678"
            maxLength={11}
            numeric
            textLeft
            error={errors.phone2}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="المحافظة" value={gov} onChange={setGov} options={Object.keys(EGYPT_GOVERNORATES)} required />
          <div>
            <Select label="المدينة / المركز" value={city} onChange={v => { setCity(v); clearError('city') }} options={cityOptions} required error={errors.city} />
            {isManualCity ? (
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
          label="تفاصيل العنوان / المقر (اختياري)"
          value={addrDetails}
          onChange={setAddrDetails}
          placeholder="مثال: المنطقة الصناعية، الشارع الرئيسي، بجوار..."
        />

        <Input label="ملاحظات عن التعامل" value={notes} onChange={setNotes} placeholder="نوع البضائع، التخصص، تفاهمات السعر..." voiceLabel="ملاحظات صوتية للمورد" />

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
            {isEdit ? (submitting ? 'جاري الحفظ...' : 'حفظ التعديلات') : submitting ? 'جاري الإضافة...' : 'إضافة المورد'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default AddSupplierModal
