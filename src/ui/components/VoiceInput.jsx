// =============================================================================
// ui/components/VoiceInput.jsx — زر الإدخال الصوتي القابل لإعادة الاستخدام
// -----------------------------------------------------------------------------
// يعتمد على Web Speech API (webkitSpeechRecognition / SpeechRecognition) مع
// العربية (ar-EG ثم ar-SA كاحتياط). أثناء الاستماع يظهر مؤشر نابض (animate-ping)
// وتنبيه «جاري الاستماع...».
//
// 🔧 مكافحة تكرار النص على الجوال: تُؤخذ النتيجة النهائية فقط
//    (event.results[i].isFinal) — النتائج المؤقتة (interim) تُتجاهل تماماً حتى
//    لا يتردد النص أو يتكرر أثناء الإملاء. كما يُتتبع آخر فهرس تمت معالجته
//    (lastResultIndexRef) حتى لا تُعاد إضافة نتيجة نهائية أعاد المتصفح إرسالها
//    مرة أخرى (سلوك شائع في بعض متصفحات أندرويد مع continuous). عند كل نتيجة
//    نهائية جديدة تُمرَّر النسخة المتراكمة الكاملة إلى onResult فيستبدل الحقل
//    بمحتواها النهائي نظيفاً دون تكرار. إذا لم يدعم المتصفح التعرف الصوتي لا
//    يتعطل التطبيق — يعرض تنبيهاً توضيحياً فقط.
//
// 🔧 رسالة تشخيصية عند حجب خدمة تحويل الصوت (Brave/Avast): عندما يُنهي
//    المتصفح الجلسة دون التقاط نص وكان المتصفح Brave أو وقع خطأ شبكة (network —
//    كحجب Avast لاتصال خدمة التعرف السحابية)، يُعرض تنبيه «هذا المتصفح يحجب
//    خدمة تحويل الصوت إلى نص — استخدم Chrome أو Edge» بدل الصمت التام.
// =============================================================================
import { useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { showToast } from './toastStore.js'

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function VoiceInput({ onResult, ariaLabel = 'الإدخال الصوتي', title = 'الإدخال الصوتي' }) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)
  const finalRef = useRef('')
  const lastResultIndexRef = useRef(0)
  const lastErrorRef = useRef('')

  const blockedBrowserMessage = () => {
    const brave = typeof navigator !== 'undefined' && !!navigator.brave
    if (brave || lastErrorRef.current === 'network') {
      return 'هذا المتصفح يحجب خدمة تحويل الصوت إلى نص — استخدم Chrome أو Edge للإدخال الصوتي'
    }
    return null
  }

  const stop = () => {
    const rec = recognitionRef.current
    if (rec) {
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.stop()
      } catch {
        /* ignore stop errors */
      }
    }
    recognitionRef.current = null
    setListening(false)
  }

  const finish = () => {
    setListening(false)
    recognitionRef.current = null
    // رسالة تشخيصية فقط عند حجب المتصفح للخدمة دون التقاط نص.
    if (!finalRef.current.trim()) {
      const blocked = blockedBrowserMessage()
      if (blocked) showToast(blocked, 'warning')
    }
  }

  const toggle = () => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      showToast('المتصفح الحالي لا يدعم الإدخال الصوتي', 'warning')
      return
    }
    if (listening) {
      stop()
      return
    }

    finalRef.current = ''
    lastResultIndexRef.current = 0
    lastErrorRef.current = ''
    try {
      const rec = new Ctor()
      rec.lang = 'ar-EG'
      rec.interimResults = true
      rec.continuous = true
      rec.maxAlternatives = 1

      rec.onresult = event => {
        // 🔧 النتيجة النهائية فقط: النتائج المؤقتة تُتجاهل، والنتائج التي أعاد
        //    المتصفح إرسالها (فهرس مُنهى سابقاً) لا تُضاف مرة ثانية. المؤشر
        //    يتقدم فقط عند إنهاء نتيجة فعلية حتى تتحول المؤقتة إلى نهائية
        //    (نفس الفهرس) وتُلتقط بشكل طبيعي.
        const start = Math.max(event.resultIndex, lastResultIndexRef.current)
        let appended = ''
        for (let i = start; i < event.results.length; i++) {
          const result = event.results[i]
          if (result && result.isFinal && result[0] && result[0].transcript) {
            finalRef.current += result[0].transcript
            appended += result[0].transcript
            lastResultIndexRef.current = i + 1
          }
        }
        const text = finalRef.current.trim()
        if (appended && text && typeof onResult === 'function') onResult(text)
      }

      rec.onend = finish

      rec.onerror = event => {
        lastErrorRef.current = (event && event.error) || ''
        finish()
      }

      rec.start()
      recognitionRef.current = rec
      setListening(true)
      showToast('جاري الاستماع...', 'info')
    } catch (err) {
      console.error(err)
      setListening(false)
      recognitionRef.current = null
      showToast('تعذر بدء الإدخال الصوتي', 'error')
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? 'إيقاف الاستماع' : title}
      aria-label={ariaLabel}
      aria-pressed={listening}
      className={[
        'relative grid place-items-center w-8 h-8 rounded-lg border transition-all shrink-0 cursor-pointer',
        listening
          ? 'border-rose-500 bg-rose-500/15 text-rose-400'
          : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:text-brand-300 hover:border-brand-500',
      ].join(' ')}
    >
      {listening ? <span className="absolute inset-0 rounded-lg bg-rose-500/40 animate-ping" /> : null}
      {listening ? (
        <Square className="w-3.5 h-3.5 relative z-10" />
      ) : (
        <Mic className="w-4 h-4 relative z-10" />
      )}
    </button>
  )
}

export default VoiceInput
