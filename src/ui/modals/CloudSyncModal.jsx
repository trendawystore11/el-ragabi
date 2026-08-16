// =============================================================================
// ui/modals/CloudSyncModal.jsx — نافذة إعدادات الربط والسحابة (🔐)
// -----------------------------------------------------------------------------
// نسخة React من نافذة «إعدادات الربط والسحابة» legacy في قائمة الحساب:
//   1) إعدادات اتصال Firebase (getFirebaseConfig/saveFirebaseConfig — نفس منطق
//      js/firebase-config.js: دمج المثبّت مع localStorage bms_firebase_config).
//   2) لوحة مزامنة Google Sheets (renderSyncPanel) مع unlocked:true — نفس استدعاء
//      settings-view legacy مع توجيه التنبيهات إلى showToast الخاص بـ React.
//   3) زر فتح الشيت عبر GoogleSheetsSync.openSheetUrl.
// تُفتح فقط عبر تدفق تأكيد هوية المدير (AdminPasswordModal) من قائمة الحساب.
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { Database, Cloud, ExternalLink, Bot, FileSpreadsheet, Upload, Download } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { useSandboxStore } from '@/state/sandboxStore'
import { showToast } from '../components/toastStore.js'
import { FALLBACK_FIREBASE_CONFIG } from '@/services/db'
import { getAiConfig, saveAiConfig, testAiProviderConnection, DEFAULT_GEMINI_MODEL } from '@/services/aiProvider'
import { storageKey } from '@/client/storage'
import { ensureXLSX } from '@/utils/excel'
import { getCairoFormattedDate } from '@/utils/formatters'

const FB_KEY = storageKey('firebase_config')

function baseFirebaseConfig() {
  if (typeof window === 'undefined') return FALLBACK_FIREBASE_CONFIG
  if (window.firebaseConfig && typeof window.firebaseConfig === 'object') return window.firebaseConfig
  return FALLBACK_FIREBASE_CONFIG
}

function readFirebaseConfig() {
  if (typeof window !== 'undefined' && typeof window.getFirebaseConfig === 'function') {
    return window.getFirebaseConfig()
  }
  const base = baseFirebaseConfig()
  if (typeof window === 'undefined') return base
  try {
    const saved = JSON.parse(window.localStorage.getItem(FB_KEY))
    if (saved && saved.apiKey && saved.projectId && saved.authDomain) {
      return { ...base, ...saved }
    }
  } catch {
    /* ignore corrupted saved config */
  }
  return base
}

function writeFirebaseConfig(obj) {
  if (typeof window !== 'undefined' && typeof window.saveFirebaseConfig === 'function') {
    window.saveFirebaseConfig(obj)
    return
  }
  const cleaned = {}
  Object.keys(obj).forEach(k => {
    if (typeof obj[k] === 'string' && obj[k].trim()) cleaned[k] = obj[k].trim()
  })
  window.localStorage.setItem(FB_KEY, JSON.stringify({ ...baseFirebaseConfig(), ...cleaned }))
}

const FB_FIELDS = [
  ['apiKey', 'API Key'],
  ['authDomain', 'Auth Domain'],
  ['projectId', 'Project ID'],
  ['storageBucket', 'Storage Bucket'],
  ['messagingSenderId', 'Messaging Sender ID'],
  ['appId', 'App ID'],
  ['measurementId', 'Measurement ID'],
]

function CloudSyncModalInner() {
  const close = useUiStore(s => s.closeSyncCloudModal)
  const sandboxActive = useSandboxStore(s => s.active)
  const [config, setConfig] = useState(() => readFirebaseConfig())
  const [aiConfig, setAiConfig] = useState(() => getAiConfig())
  const [aiTesting, setAiTesting] = useState(false)
  const [savingFirebase, setSavingFirebase] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [aiTestResult, setAiTestResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [jsonRestoring, setJsonRestoring] = useState(false)
  const sheetPanelRef = useRef(null)
  const fileInputRef = useRef(null)
  const jsonFileRef = useRef(null)

  useEffect(() => {
    const el = sheetPanelRef.current
    if (!el || typeof window === 'undefined') return
    const gs = window.GoogleSheetsSync
    if (!gs || typeof gs.renderSyncPanel !== 'function') return
    gs.renderSyncPanel(el, {
      unlocked: true,
      onSaved: () => showToast('تم حفظ إعدادات مزامنة Google Sheets بنجاح', 'success'),
      onSynced: () => showToast('تمت المزامنة مع Google Sheets بنجاح', 'success'),
      onError: err => showToast((err && err.message) || String(err), 'error'),
    })
    return () => {
      el.innerHTML = ''
    }
  }, [])

  const setField = (key, value) => setConfig(prev => ({ ...prev, [key]: value }))

  const saveFirebase = () => {
    // وضع الاختبار: إعدادات الربط والسحابة حساسة — لا تُحفظ محلياً ولا تُرفع
    // للسحابة إلا خارج الوضع، كي لا يُسرب تعديل «تجريبي» إلى الإعدادات الحقيقية.
    if (sandboxActive) {
      showToast('وضع الاختبار نشط — لا يمكن تعديل إعدادات الربط والسحابة قبل الخروج من وضع الاختبار', 'error')
      return
    }
    // V3.40 — تحقق صريح من الحقول المطلوبة للاتصال قبل الحفظ: لا نجاح زائف.
    const required = [['apiKey', 'API Key'], ['authDomain', 'Auth Domain'], ['projectId', 'Project ID']]
    const missing = required.find(([key]) => !String(config[key] || '').trim())
    if (missing) {
      showToast('يرجى تعبئة الحقل المطلوب أولاً: ' + missing[1], 'error')
      return
    }
    setSavingFirebase(true)
    try {
      writeFirebaseConfig(config)
      showToast('تم حفظ إعدادات اتصال Firebase بنجاح', 'success')
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setSavingFirebase(false)
    }
  }

  const openSheet = () => {
    const gs = window.GoogleSheetsSync
    if (gs && typeof gs.openSheetUrl === 'function') {
      gs.openSheetUrl()
      showToast('تم فتح صفحة الـ Webhook — راجع جدول البيانات من نافذة Google Sheets الجديدة', 'info')
    } else {
      showToast('خدمة فتح الشيت غير متوفرة حالياً — تحقق من تحميل مكوّن Google Sheets', 'error')
    }
  }

  const saveAi = () => {
    // إعدادات الذكاء الاصطناعي حساسة مثل بقية إعدادات الربط — لا تُحفظ في
    // وضع الاختبار كي لا تُسرب تعديلات تجريبية إلى الإعدادات الحقيقية.
    if (sandboxActive) {
      showToast('وضع الاختبار نشط — لا يمكن تعديل إعدادات الذكاء الاصطناعي قبل الخروج من وضع الاختبار', 'error')
      return
    }
    setSavingAi(true)
    try {
      const saved = saveAiConfig(aiConfig)
      setAiConfig(saved)
      if (!saved.apiKey || !saved.model) {
        showToast('تم حفظ إعدادات الذكاء الاصطناعي — أضف المفتاح والنموذج لتفعيل الإجابات المتقدمة', 'success')
      } else {
        showToast('تم حفظ إعدادات الذكاء الاصطناعي بنجاح', 'success')
      }
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setSavingAi(false)
    }
  }

  const testAi = async () => {
    if (sandboxActive) {
      showToast('وضع الاختبار نشط — لا يمكن اختبار الاتصال قبل الخروج من وضع الاختبار', 'error')
      return
    }
    setAiTesting(true)
    setAiTestResult(null)
    try {
      // V3.28 — يُمرَّر الكائن للدالة التي تُطبِّع المفتاح والنموذج داخلياً،
      // فنتيجة الاختبار تعكس دائماً المفتاح الفعلي (بلا فراغات) والنموذج الصالح.
      const result = await testAiProviderConnection(aiConfig)
      setAiTestResult(result)
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (err) {
      // أي خطأ غير متوقع لا يجوز أن يترك الزر عالقاً أو يمنع ظهور النتيجة.
      const message = (err && err.message) || String(err)
      setAiTestResult({ ok: false, message })
      showToast('تعذر اختبار الاتصال: ' + message, 'error')
    } finally {
      setAiTesting(false)
    }
  }

  const onAiProviderChange = value => {
    setAiConfig(prev => {
      const next = { ...prev, provider: value }
      // عند التبديل لـ Gemini: إن كان حقل النموذج فارغاً أو يحوي اسم المزوّد
      // يُضبط النموذج الافتراضي gemini-3.1-flash-lite تلقائياً.
      if (value === 'gemini') {
        const m = String(next.model || '').trim()
        if (!m || m === 'Google Gemini') next.model = DEFAULT_GEMINI_MODEL
      }
      return next
    })
  }

  // V3.59 — offline backup (Excel/CSV): no webhook reachable, no problem.
  // V3.61 — single-file export: every table goes into ONE .xlsx workbook (8
  // sheets). The old loop fired one programmatic download per table, which
  // browsers block silently — the toast said "8 files" but nothing was saved.
  const exportAllCsv = async () => {
    try {
      const gs = window.GoogleSheetsSync
      if (!gs || typeof gs.getSheetDefinitions !== 'function' || typeof gs.exportSheetToCsv !== 'function') {
        throw new Error('خدمة التصدير إلى Excel غير متوفرة')
      }
      const XLSX = await ensureXLSX()
      if (!XLSX || typeof XLSX.utils !== 'object') throw new Error('مكتبة Excel غير محملة')
      const wb = XLSX.utils.book_new()
      let totalRows = 0
      let tables = 0
      gs.getSheetDefinitions().forEach(def => {
        const out = gs.exportSheetToCsv(def.entityKey)
        if (!out.rows.length) return
        const ws = XLSX.utils.json_to_sheet(out.rows)
        if (!ws['!views']) ws['!views'] = []
        ws['!views'].push({ RTL: true })
        XLSX.utils.book_append_sheet(wb, ws, def.title)
        totalRows += out.rows.length
        tables++
      })
      if (!tables) {
        showToast('لا توجد بيانات للتصدير', 'info')
        return
      }
      const today = getCairoFormattedDate().slice(0, 10)
      XLSX.writeFile(wb, `نسخة_احتياطية_محلية_${today}.xlsx`)
      showToast(`تم تنزيل نسخة احتياطية واحدة (${tables} جدول / ${totalRows} سجل) — جاهزة لإعادة الاستيراد`, 'success')
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    }
  }

  const handleImportFile = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (sandboxActive) {
      showToast('وضع الاختبار نشط — الاستيراد من ملف محظور', 'error')
      return
    }
    setImporting(true)
    try {
      const gs = window.GoogleSheetsSync
      if (!gs || typeof gs.importFromFile !== 'function') {
        throw new Error('خدمة استيراد الملفات غير متوفرة')
      }
      const res = await gs.importFromFile(file)
      showToast(`تم استيراد ${res.rowsImported} سجل من «${res.label || res.sheet}»`, res.rowsImported ? 'success' : 'info')
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setImporting(false)
    }
  }

  // V3.60 — full JSON backup: every synced collection dumped as-is (byte-for-byte),
  // not limited to the 8 sheet tables and without re-deriving any field.
  const exportFullBackupJson = () => {
    try {
      if (typeof window.exportFullBackup !== 'function') {
        throw new Error('خدمة النسخة الاحتياطية الكاملة غير متوفرة')
      }
      const backup = window.exportFullBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bms_backup_${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('تم تنزيل النسخة الاحتياطية الكاملة (JSON)', 'success')
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    }
  }

  const handleRestoreJson = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (sandboxActive) {
      showToast('وضع الاختبار نشط — استعادة النسخة الاحتياطية محظورة', 'error')
      return
    }
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (typeof window.importFullBackup !== 'function') {
        throw new Error('خدمة استعادة النسخ الاحتياطية غير متوفرة')
      }
      if (!window.confirm('سيتم استبدال بيانات كل مجموعات النظام بالنسخة المحفوظة في الملف. هل تريد المتابعة؟')) return
      setJsonRestoring(true)
      const res = window.importFullBackup(data)
      const skippedNote = res.skipped && res.skipped.length ? ` — تم تخطي: ${res.skipped.join(', ')}` : ''
      showToast(
        `تمت الاستعادة: ${res.collections} مجموعة / ${res.records} سجل${skippedNote}`,
        res.records ? 'success' : 'info'
      )
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setJsonRestoring(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title="إعدادات الربط والسحابة 🔐"
      icon={Cloud}
      maxWidth="max-w-3xl"
    >
      <section className="space-y-4">
        {sandboxActive ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <p className="text-amber-300 font-bold flex items-center gap-2">
              🧪 وضع الاختبار نشط
            </p>
            <p className="text-xs text-slate-300 mt-1">
              تعديل بيانات الربط والسحابة (Firebase / Google Sheets) محظور في وضع
              الاختبار — اخرج منه أولاً كي لا تُسرب تعديلات تجريبية إلى إعداداتك الحقيقية.
            </p>
          </div>
        ) : null}
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <Database className="w-4 h-4 text-brand-400" />
          <h4>إعدادات اتصال Firebase</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FB_FIELDS.map(([key, label]) => (
            <Input
              key={key}
              label={label}
              value={config[key] || ''}
              onChange={value => setField(key, value)}
              textLeft={key === 'apiKey' || key === 'projectId' || key === 'appId'}
              voice={false}
              disabled={sandboxActive}
            />
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={openSheet} icon={ExternalLink}>
            فتح الشيت
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={saveFirebase}
            icon={Database}
            loading={savingFirebase}
            disabled={sandboxActive || savingFirebase}
            title={sandboxActive ? 'غير متاح في وضع الاختبار' : undefined}
          >
            {savingFirebase ? 'جارٍ الحفظ...' : 'حفظ إعدادات Firebase'}
          </Button>
        </div>
      </section>

      <hr className="border-slate-800" />

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <Bot className="w-4 h-4 text-violet-400" />
          <h4>إعدادات الذكاء الاصطناعي (AI)</h4>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          اضبط مفتاح API والنموذج لتوليد إجابات متقدمة لمساعد AI — وبدون مفتاح يعتمد
          المساعد على محرك التحليل الداخلي المدمج بسلاسة. الإعدادات مخصصة للمدير العام فقط.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="مزوّد الذكاء الاصطناعي"
            value={aiConfig.provider}
            onChange={onAiProviderChange}
            disabled={sandboxActive}
            options={[
              { value: 'gemini', label: 'Google Gemini' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
          <Input
            label="اسم النموذج (Model)"
            value={aiConfig.model}
            onChange={value => setAiConfig(prev => ({ ...prev, model: value }))}
            placeholder={`مثال: ${DEFAULT_GEMINI_MODEL} / gpt-4o-mini`}
            hint={aiConfig.provider === 'gemini' ? `الافتراضي ${DEFAULT_GEMINI_MODEL} يُضبط تلقائياً عند الفراغ` : undefined}
            textLeft
            voice={false}
            disabled={sandboxActive}
          />
        </div>
        <Input
          label="مفتاح الذكاء الاصطناعي (API Key)"
          value={aiConfig.apiKey}
          onChange={value => setAiConfig(prev => ({ ...prev, apiKey: value }))}
          placeholder="مفتاح مزوّد الذكاء الاصطناعي (يُحفظ محلياً فقط)"
          textLeft
          voice={false}
          disabled={sandboxActive}
        />
        <Select
          label="مستوى خصوصية بيانات العملاء في مساعد AI"
          value={aiConfig.redactLevel}
          onChange={value => setAiConfig(prev => ({ ...prev, redactLevel: value }))}
          disabled={sandboxActive}
          options={[
            { value: 'full', label: 'كل البيانات (الافتراضي)' },
            { value: 'noSensitive', label: 'بدون ملاحظات وأرصدة العملاء' },
            { value: 'minimal', label: 'حد أدنى (بدون أسماء وأرقام العملاء)' },
          ]}
          hint="يتحكم في البيانات الشخصية المرسلة للمزوّد مع كل سؤال — الافتراضي «كل البيانات» يحافظ على السلوك الحالي"
        />
        {aiTestResult ? (
          <div
            data-testid="ai-test-result"
            className={`px-3 py-2 rounded-xl border text-xs font-bold ${
              aiTestResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {aiTestResult.ok ? '✓' : '✗'} نتيجة الاختبار: {aiTestResult.message}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={testAi}
            icon={Bot}
            disabled={sandboxActive || aiTesting}
            title={sandboxActive ? 'غير متاح في وضع الاختبار' : undefined}
          >
            {aiTesting ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={saveAi}
            icon={Bot}
            loading={savingAi}
            disabled={sandboxActive || savingAi}
            title={sandboxActive ? 'غير متاح في وضع الاختبار' : undefined}
          >
            {savingAi ? 'جارٍ الحفظ...' : 'حفظ إعدادات الذكاء الاصطناعي'}
          </Button>
        </div>
      </section>

      <hr className="border-slate-800" />

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <Cloud className="w-4 h-4 text-brand-400" />
          <h4>مزامنة Google Sheets</h4>
        </div>
        <div ref={sheetPanelRef} />
      </section>

      <hr className="border-slate-800" />

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          <h4>النسخ الاحتياطي المحلي (Excel/CSV)</h4>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          تصدير واستيراد بدون إنترنت: نزّل كل جداول النظام في ملف Excel واحد (كل جدول في
          ورقة مستقلة) ثم أعد استيراده من أي جهاز. عند تعذّر الوصول إلى الـ Webhook، هذا
          هو المسار الآمن للمزامنة اليدوية — يعيد نفس محرك التحقق والدمج (Last-Write-Wins)
          المستخدم في السحابة.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" icon={FileSpreadsheet} onClick={exportAllCsv}>
            تصدير كل الجداول (ملف واحد)
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={Upload}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            loading={importing}
            disabled={sandboxActive || importing}
            title={sandboxActive ? 'غير متاح في وضع الاختبار' : undefined}
          >
            {importing ? 'جارٍ الاستيراد...' : 'استيراد من ملف Excel/CSV'}
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={handleImportFile} />
        </div>
      </section>

      <hr className="border-slate-800" />

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-slate-200 font-semibold">
          <Download className="w-4 h-4 text-sky-400" />
          <h4>النسخة الاحتياطية الكاملة (JSON)</h4>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          نسخة كاملة بكل الحقول الحقيقية — لا تقتصر على جداول الشيت ولا تعيد اشتقاق أي
          حقل. صدّرها دورياً، وعند الحاجة (بعد التصفير مثلاً) استرجعها بضغطة واحدة.
          لا تشمل بيانات تفعيل الموظفين والإعدادات (staff/settings) — وهي ليست بيانات أعمال.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" icon={Download} onClick={exportFullBackupJson}>
            تصدير نسخة كاملة (JSON)
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={Upload}
            onClick={() => jsonFileRef.current && jsonFileRef.current.click()}
            loading={jsonRestoring}
            disabled={sandboxActive || jsonRestoring}
            title={sandboxActive ? 'غير متاح في وضع الاختبار' : undefined}
          >
            {jsonRestoring ? 'جارٍ الاستعادة...' : 'استعادة من نسخة (JSON)'}
          </Button>
          <input ref={jsonFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleRestoreJson} />
        </div>
      </section>
    </Modal>
  )
}

function CloudSyncModal() {
  const open = useUiStore(s => s.syncCloudModal.open)
  if (!open) return null
  return <CloudSyncModalInner />
}

export default CloudSyncModal
