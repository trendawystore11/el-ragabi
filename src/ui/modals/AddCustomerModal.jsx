// =============================================================================
// ui/modals/AddCustomerModal.jsx — نافذة إضافة/تعديل عميل — نسخة React من
// window.openAddCustomerModal (js/components/customers-view.js)
// -----------------------------------------------------------------------------
// إدارة بيانات العميل (الاسم، الهاتفان، التصنيف، الملاحظات) مع التحقق الصارم
// للهاتف المصري (11 رقماً يبدأ بـ 01). في وضع الإضافة: العنوان الثلاثي المعتمد
// (محافظة ← مدينة/مركز ← تفاصيل) مع دعم الإدخال اليدوي للمدن. في وضع التعديل:
// إدارة العناوين المسجلة (تعيين افتراضي / حذف / إضافة) عبر واجهات
// addCustomerAddress/setDefaultCustomerAddress/removeCustomerAddress من الجسر.
// =============================================================================
import { useState, useMemo } from 'react'
import { UserPlus, Plus, Pin, Trash2, CheckCircle2 } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { EGYPT_GOVERNORATES, getCitiesForGovernorate, parseAddressComponents, matchEgyptAddress } from '../../utils/egypt.js'
import { validateEgyptianPhone } from '../../utils/phones.js'
import { CUSTOMER_CATEGORIES, DEFAULT_CUSTOMER_CATEGORY } from '../../domain/customers/customerRules.js'

function cityOptionsFor(gov) {
  return [
    ...getCitiesForGovernorate(gov).map(c => ({ value: c, label: c })),
    { value: '__other__', label: 'أخرى (إدخال يدوي)...' },
  ]
}

function AddCustomerModal() {
  const open = useUiStore(s => s.customerModal.open)
  if (!open) return null
  return <AddCustomerModalInner />
}

function AddCustomerModalInner() {
  const { customerId, onDone, initialData } = useUiStore(s => s.customerModal)
  const close = useUiStore(s => s.closeAddCustomerModal)

  const [customer] = useState(() => (customerId && window.getCustomerById ? window.getCustomerById(customerId) : null))
  const isEdit = !!customer

  const parsedAddr = useMemo(() => parseAddressComponents(customer ? customer.address : ''), [customer])
  // V3.35 — تعبئة ذكية من الشات: address نص حر (قد يكون مدينة فقط أو ثلاثياً).
  const prefilledAddr = useMemo(() => matchEgyptAddress(initialData ? initialData.address : ''), [initialData])

  const [name, setName] = useState(customer ? customer.name : (initialData ? String(initialData.name || '') : ''))
  const [phone, setPhone] = useState(customer ? customer.phone : (initialData ? String(initialData.phone || '') : ''))
  const [phone2, setPhone2] = useState(customer ? customer.secondaryPhone || '' : (initialData ? String(initialData.secondaryPhone || '') : ''))
  const [category, setCategory] = useState(
    customer
      ? customer.category || DEFAULT_CUSTOMER_CATEGORY
      : (initialData && initialData.category ? initialData.category : DEFAULT_CUSTOMER_CATEGORY)
  )
  const [notes, setNotes] = useState(customer ? customer.notes || '' : (initialData ? String(initialData.notes || '') : ''))

  const [gov, setGov] = useState(initialData ? prefilledAddr.governorate : parsedAddr.governorate)
  const [city, setCity] = useState(() => {
    if (!initialData) return parsedAddr.city
    if (prefilledAddr.city && getCitiesForGovernorate(prefilledAddr.governorate).includes(prefilledAddr.city)) {
      return prefilledAddr.city
    }
    return prefilledAddr.city ? '__other__' : ''
  })
  const [cityManual, setCityManual] = useState(() => {
    if (initialData && prefilledAddr.city
      && !getCitiesForGovernorate(prefilledAddr.governorate).includes(prefilledAddr.city)) {
      return prefilledAddr.city
    }
    return ''
  })
  const [addrDetails, setAddrDetails] = useState(initialData ? prefilledAddr.details : (parsedAddr.details || ''))

  const [addresses, setAddresses] = useState(() =>
    isEdit && window.getCustomerAddresses ? window.getCustomerAddresses(customer.id) : []
  )
  const [newAddrOpen, setNewAddrOpen] = useState(false)
  const [newAddrLabel, setNewAddrLabel] = useState('')
  const [newAddrGov, setNewAddrGov] = useState('القاهرة')
  const [newAddrCity, setNewAddrCity] = useState('')
  const [newAddrCityManual, setNewAddrCityManual] = useState('')
  const [newAddrDetails, setNewAddrDetails] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [savingAddr, setSavingAddr] = useState(false)
  const [errors, setErrors] = useState({})

  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const cityOptions = useMemo(() => cityOptionsFor(gov), [gov])
  const newAddrCityOptions = useMemo(() => cityOptionsFor(newAddrGov), [newAddrGov])

  const reloadAddresses = () => {
    if (window.getCustomerAddresses) setAddresses(window.getCustomerAddresses(customer.id))
  }

  const saveNewAddress = () => {
    if (savingAddr) return
    const effCity = newAddrCity === '__other__' ? newAddrCityManual.trim() : newAddrCity
    if (!effCity) {
      showToast('يرجى اختيار المدينة / المركز للعنوان الجديد', 'error')
      return
    }
    const details = newAddrDetails.trim()
    const combined = details ? `${newAddrGov} - ${effCity} - ${details}` : `${newAddrGov} - ${effCity}`
    setSavingAddr(true)
    try {
      window.addCustomerAddress(customer.id, { label: newAddrLabel.trim(), address: combined })
      setNewAddrLabel('')
      setNewAddrCity('')
      setNewAddrCityManual('')
      setNewAddrDetails('')
      setNewAddrOpen(false)
      reloadAddresses()
      showToast('تم حفظ العنوان الجديد بنجاح', 'success')
    } catch (err) {
      showToast(err.message || 'تعذر حفظ العنوان', 'error')
    } finally {
      setSavingAddr(false)
    }
  }

  const handleAddressAction = (action, addrId) => {
    if (action === 'remove' && !window.confirm('هل أنت متأكد من حذف هذا العنوان؟')) {
      return
    }
    try {
      if (action === 'set-default') {
        window.setDefaultCustomerAddress(customer.id, addrId)
        showToast('تم تعيين العنوان الافتراضي بنجاح', 'success')
      } else {
        window.removeCustomerAddress(customer.id, addrId)
        showToast('تم حذف العنوان بنجاح', 'success')
      }
      reloadAddresses()
    } catch (err) {
      showToast(err.message || 'تعذر تعديل العنوان', 'error')
    }
  }

  const handleSubmit = e => {
    e.preventDefault()

    const nextErrors = {}

    if (!name.trim()) {
      nextErrors.name = 'يرجى إدخال اسم العميل'
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

    if (!isEdit) {
      const effCity = city === '__other__' ? cityManual.trim() : city
      if (!effCity) {
        nextErrors.city = 'يرجى اختيار المدينة / المركز'
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      showToast(Object.values(nextErrors)[0], 'error')
      return
    }

    setErrors({})

    const data = {
      name,
      phone: phoneValid.cleaned,
      secondaryPhone: secondaryRaw.trim() ? secondaryValid.cleaned : '',
      category,
      notes,
    }

    if (!isEdit) {
      const effCity = city === '__other__' ? cityManual.trim() : city
      const details = addrDetails.trim()
      data.address = details ? `${gov} - ${effCity} - ${details}` : `${gov} - ${effCity}`
    }

    setSubmitting(true)
    try {
      if (isEdit) {
        window.updateCustomer(customer.id, data)
        showToast('تم تحديث بيانات العميل بنجاح', 'success')
      } else {
        window.createCustomer(data)
        showToast('تم إضافة العميل الجديد بنجاح', 'success')
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
      title={isEdit ? `تعديل بيانات العميل: ${customer.name}` : 'إضافة عميل جديد'}
      icon={UserPlus}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="اسم العميل" required value={name} onChange={v => { setName(v); clearError('name') }} placeholder="اسم العميل الثلاثي" error={errors.name} />
          <Input
            label="رقم الهاتف (11 رقماً يبدأ بـ 01)"
            value={phone}
            onChange={v => { setPhone(v); clearError('phone') }}
            placeholder="01012345678"
            maxLength={11}
            required
            numeric
            textLeft
            hint="يُستخدم للربط التلقائي بطلبات العميل وكشف حسابه"
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
          <Select
            label="تصنيف العميل (Category) *"
            value={category}
            onChange={setCategory}
            options={CUSTOMER_CATEGORIES}
            hint="يُستخدم في التقارير والفرز حسب نوع التعامل (جملة/تجزئة...)"
          />
        </div>

        {isEdit ? (
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-300">
              العناوين المسجلة (تُدار من هنا فقط — لا يُعدَّل العنوان الأساسي القديم مباشرة)
            </label>
            <div className="space-y-2">
              {addresses.length === 0 ? (
                <p className="text-xs text-slate-400">لا توجد عناوين مسجلة بعد.</p>
              ) : (
                addresses.map(a => (
                  <div
                    key={a.id}
                    className={`flex items-start justify-between gap-3 p-3 bg-slate-900 rounded-xl border ${
                      a.isDefault ? 'border-emerald-700/60' : 'border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                        {a.label ? <span>{a.label}</span> : null}
                        {a.isDefault ? (
                          <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-lg">
                            الافتراضي
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-300 mt-1">{a.address}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!a.isDefault ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Pin}
                          onClick={() => handleAddressAction('set-default', a.id)}
                          className="text-amber-300 hover:bg-amber-500/10"
                        >
                          تعيين افتراضي
                        </Button>
                      ) : null}
                      {addresses.length > 1 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => handleAddressAction('remove', a.id)}
                          className="text-rose-300 hover:bg-rose-500/10"
                        >
                          حذف
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setNewAddrOpen(o => !o)}
                className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ إضافة عنوان جديد</span>
              </button>
              {newAddrOpen ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 p-3 bg-slate-950/40 rounded-xl border border-slate-800">
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
                    <Select label="المدينة / المركز *" value={newAddrCity} onChange={setNewAddrCity} options={newAddrCityOptions} />
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
                    <Input
                      label="تفاصيل العنوان / العلامة المميزة (اختياري)"
                      value={newAddrDetails}
                      onChange={setNewAddrDetails}
                      placeholder="مثال: الشارع الرئيسي، بجوار مسجد الهدى، قرية..."
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={saveNewAddress} loading={savingAddr} disabled={savingAddr}>حفظ العنوان</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="المحافظة *"
                value={gov}
                onChange={setGov}
                options={Object.keys(EGYPT_GOVERNORATES)}
              />
              <div>
                <Select label="المدينة / المركز *" value={city} onChange={v => { setCity(v); clearError('city') }} options={cityOptions} error={errors.city} />
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
          </>
        )}

        <Input label="ملاحظات العميل" value={notes} onChange={setNotes} placeholder="عميل جملة / تجزئة / تفاصيل إضافية" voiceLabel="ملاحظات صوتية للعميل" />

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
            {isEdit ? (submitting ? 'جاري الحفظ...' : 'حفظ التعديلات') : submitting ? 'جاري الإضافة...' : 'إضافة العميل'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default AddCustomerModal
