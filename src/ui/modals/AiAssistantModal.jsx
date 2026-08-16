// =============================================================================
// ui/modals/AiAssistantModal.jsx — مساعد AI الذكي (شات تفاعلي)
// -----------------------------------------------------------------------------
// نافذة شات تفاعلية: سجل رسائل + حقل إرسال + إدخال صوتي (الميك مدمج تلقائياً
// في Input) + أسئلة سريعة مقترحة. الإجابات تُبنى من بيانات النظام عبر محرك
// answerQuestion (services/aiAssistant.js) كنواة داخلية؛ وعند توفر مفتاح API
// في الإعدادات الحساسة (CloudSyncModal) يُستدعى المزوّد الخارجي (Gemini/OpenAI)
// للإجابات المتقدمة مع العودة السلسة للمحرك الداخلي عند أي فشل.
//
// V3.35 — التعبئة الذكية للنماذج (Smart Form Fill): عند طلب إضافة بيانات
// (مورد/عميل/منتج/مصروف/طلب) يُستخرج المساعد البيانات ويُجهّز نموذجاً معبأً
// (initialData)؛ تُعرض الرسالة «تم تجهيز البيانات للمراجعة، يمكنك التأكد منها
// وضغط حفظ.» وتُفتح نافذة الإدخال المناسبة تلقائياً — ولا يُنفَّذ أي تغيير في
// النظام إطلاقاً، والمستخدم وحده يضغط الحفظ من داخل النموذج. لا أزرار تأكيد/
// تعديل مسودة لأن لا مسودات معلقة بعد الآن.
//
// V3.38 — التوزيع النهائي لشريط الأقسام: [🌐 عام] [📦 المنتجات] [🏭 الموردين]
// [👥 العملاء] [🛒 إنشاء طلب]. أُزيل قسم «التقارير والمالية» لتخفيف الشريط
// وتوجيه المساعد للعمليات التشغيلية؛ وأُضيف قسم «إنشاء طلب» الذي يوجّه كل
// بيانات الفاتورة (العميل/المنتجات/الكمية/العنوان/طريقة الدفع) لنموذج الطلب
// مباشرةً دون شاشة إضافة عميل منفصلة. حُذف شريط الأسئلة السريعة كلياً لتوفير
// المساحة الرأسية وتكبير منطقة الشات.
//
// V3.39 — إعادة التوازن البصري: تقليص العرض إلى max-w-2xl، وجعل الارتفاع
// متكيفاً مع طول المحادثة (منطقة الرسائل flex-1 min-h-0 تنمو مع المحتوى حتى
// حد 90vh ثم تتمرّر داخلياً) بدل ارتفاع ثابت ضخم؛ ودمج زر «مسح السجل» أيقونةً
// في نفس سطر شريط الأقسام (grid-cols-5) لسحب الأزرار في موضع واحد دون مساحات
// فارغة مبعثرة؛ وتوحيد هوامش منطقة الرسائل (px-4 py-3).
// =============================================================================
import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, Bot, Trash2 } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { useAuthStore } from '@/state/authStore'
import { canUseAi } from '@/services/permissions'
import { answerQuestion, AI_TOOLS, getFormFill, consumeFormFill } from '../../services/aiAssistant.js'
import { getAiConfig, askAiProvider, buildContextForPrompt, hasAiProvider, scopeLabel } from '../../services/aiProvider.js'
import { cleanAiText } from '../../utils/cleanAiText.js'
import { showToast } from '../components/toastStore.js'
import { storageKey } from '../../client/storage.js'

const CHAT_HISTORY_KEY = storageKey('ai_chat_history')

const COMPOSER_ID = 'ai-assistant-composer'

// V3.38 — شريط الأقسام (Scope Tabs): القسم المختار يُحقن كتلميح أولوية للمحرك
// الداخلي وللمزوّد الخارجي، وقسم «إنشاء طلب» يوجّه بيانات الفاتورة لنموذج الطلب.
const AI_SCOPES = [
  { key: 'general', icon: '🌐', label: 'عام / الشامل' },
  { key: 'products', icon: '📦', label: 'المنتجات' },
  { key: 'suppliers', icon: '🏭', label: 'الموردين' },
  { key: 'customers', icon: '👥', label: 'العملاء' },
  { key: 'orders', icon: '🛒', label: 'إنشاء طلب' },
]

const GREETING =
  'مرحباً! أنا مساعد متجرك الذكي 🤖 — اسألني عن مبيعات اليوم، المنتجات الناقصة، ' +
  'أكثر العملاء شراءً، المصروفات، أو اكتب «وصف» + اسم المنتج لأصيغ لك وصفاً جاهزاً. ' +
  'ويمكنك أن تطلب مني تجهيز إضافة مورد/عميل/منتج/مصروف أو إنشاء طلب — أجهّز لك النموذج معبأً لتراجعه وتحفظه بنفسك. ' +
  'استخدم شريط الأقسام أعلاه لتحديد مجال حديثك (منتجات/موردين/عملاء/إنشاء طلب) فيجيبك المساعد بدقة أكبر.'

/** تحميل سجل المحادثة المحفوظ (لا يرمي أبداً — يعيد null عند غياب/تلف البيانات). */
function loadChatHistory() {
  if (typeof window === 'undefined') return null
  try {
    const saved = JSON.parse(window.localStorage.getItem(CHAT_HISTORY_KEY) || 'null')
    if (Array.isArray(saved) && saved.length > 0
      && saved.every(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')) {
      // تنظيف الرسائل القديمة المخزنة من علامات «*»/«#» الخام — مرة واحدة عند
      // التحميل، ثم يُعاد حفظ النص النظيف تلقائياً (useEffect أدناه).
      return saved.map(m => (m.role === 'assistant' ? { ...m, text: cleanAiText(m.text) } : m))
    }
  } catch {
    /* ignore corrupted history */
  }
  return null
}

function AiAssistantModal() {
  const open = useUiStore(s => s.aiAssistantModal.open)
  // 🔒 V3.43 — طبقة دفاع ثانية: مساعد AI للمدير فقط حتى لو حُوكم الفتح من مصدر آخر.
  // بلا جلسة (null — معاينة/اختبارات) يُسمح بنفس مبدأ hasPermission في uiStore؛
  // وأي دور صريح غير المدير يُرفض.
  const role = useAuthStore?.getState?.()?.role ?? null
  if (!open) return null
  if (role && !canUseAi(role)) return null
  return <AiAssistantModalInner />
}

function AiAssistantModalInner() {
  const close = useUiStore(s => s.closeAiAssistantModal)

  // تُقرأ بيانات النظام حية عند كل إرسال (وليس لقطة واحدة لحظة فتح النافذة)
  // كي تبقى الإجابات مبنية على أحدث أرقام المخزون/الطلبات/المصروفات دائماً.
  const readLiveData = () => ({
    products: window.getProducts ? window.getProducts() : [],
    customers: window.getCustomers ? window.getCustomers() : [],
    orders: window.getOrders ? window.getOrders() : [],
    expenses: window.getExpenses ? window.getExpenses() : [],
    suppliers: window.getSuppliers ? window.getSuppliers() : [],
  })

  const [messages, setMessages] = useState(() => loadChatHistory() || [{ role: 'assistant', text: GREETING }])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  // V3.38 — القسم النشط (عام افتراضياً) يُحقن كتلميح أولوية للمحرك والمزوّد.
  const [scope, setScope] = useState('general')
  const feedRef = useRef(null)

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  // V3.29 — حفظ السجل مستمراً في localStorage كي يبقى بعد إغلاق النافذة.
  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages))
    } catch {
      /* ignore quota/serialization errors */
    }
  }, [messages])

  // إضافة رسالة: نصوص المساعد تُنظَّف من علامات Markdown الخام («*»/«#»/«_»)
  // حتى يظهر الرد بلا رموز تشويش وبنسق نقاط «•» أنيق.
  const pushMessage = (role, text, extra = {}) =>
    setMessages(prev => [...prev, { role, text: role === 'assistant' ? cleanAiText(text) : text, ...extra }])

  const clearChat = () => {
    try {
      window.localStorage.removeItem(CHAT_HISTORY_KEY)
    } catch {
      /* ignore */
    }
    setMessages([{ role: 'assistant', text: GREETING }])
    showToast('تم مسح سجل المحادثة', 'success')
  }

  // V3.35 — استهلاك إشارة نموذج التعبئة: عند وجود نموذج معبأ جاهز يُفتح نموذج
  // الإدخال المناسب للمراجعة والحفظ (لا تنفيذ) وتُغلق نافذة الشات.
  const applyFormFillSignal = () => {
    const formFill = getFormFill()
    if (formFill && formFill.form && formFill.data) {
      consumeFormFill()
      close()
      useUiStore.getState().openAiFormFill(formFill.form, formFill.data, formFill.entityId)
      return true
    }
    return false
  }

  const send = text => {
    const question = String(text || '').trim()
    if (!question || typing) return

    // V3.34 — ذاكرة المحادثة: نرسل الرسائل السابقة للمزوّد (قبل إضافة رسالة
    // المستخدم الحالية) كي لا ينسى الأسماء/البيانات المذكورة سابقاً.
    const history = messages.slice(-10).map(m => ({ role: m.role, text: m.text }))

    pushMessage('user', question)
    setInput('')

    const data = readLiveData()
    // V3.37 — القسم المختار يُمرَّر للمحرك الداخلي (تلميح أولوية فتح النموذج).
    const internal = () => answerQuestion(question, data, scope)
    const config = getAiConfig()

    // بدون مفتاح API → المحرك الداخلي فوري (بديل سلس).
    if (!hasAiProvider(config)) {
      pushMessage('assistant', internal())
      applyFormFillSignal()
      return
    }

    // مع مفتاح API → إجابة متقدمة من المزوّد (مع Function Calling لدى Gemini)،
    // والعودة للمحرك الداخلي عند أي فشل. القسم يُحقن في سياق المزوّد أيضاً.
    setTyping(true)
    askAiProvider(config, question, buildContextForPrompt(data), { tools: AI_TOOLS, history, scope })
      .then(reply => {
        setTyping(false)
        if (reply) {
          pushMessage('assistant', reply)
        } else {
          showToast('تعذر الاتصال بمزوّد الذكاء الاصطناعي — تحقق من صحة المفتاح والنموذج أو من اتصالك بالإنترنت', 'error')
          pushMessage('assistant', internal())
        }
        applyFormFillSignal()
      })
      .catch(err => {
        setTyping(false)
        showToast((err && err.message) || 'تعذر الاتصال بمزوّد الذكاء الاصطناعي — تحقق من المفتاح والاتصال بالإنترنت', 'error')
        pushMessage('assistant', internal())
        applyFormFillSignal()
      })
  }

  const onComposerKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const sendButtonDisabled = !input.trim() || typing

  return (
    <Modal open onClose={close} title="مساعد AI السريع" icon={Sparkles} maxWidth="max-w-2xl" bodyClassName="flex flex-col min-h-0">
      {/* V3.39 — شريط الأقسام + زر مسح السجل في سطر واحد موزّعان على كامل العرض */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex-1 grid grid-cols-5 gap-1.5 bg-slate-950/50 border border-slate-800 rounded-xl p-1.5">
          {AI_SCOPES.map(s => {
            const active = scope === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setScope(s.key)}
                aria-pressed={active}
                title={active ? `القسم الحالي: ${scopeLabel(s.key)}` : `التحدث عن ${scopeLabel(s.key)}`}
                className={[
                  'flex items-center justify-center gap-1 min-w-0 px-1.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap overflow-hidden',
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/70',
                ].join(' ')}
              >
                <span className="shrink-0">{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={clearChat}
          title="مسح سجل المحادثة"
          aria-label="مسح سجل المحادثة"
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/50 text-slate-400 hover:text-red-400 hover:border-red-500 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* سجل الرسائل — ارتفاع متكيف مع طول المحادثة (V3.39) */}
      <div
        ref={feedRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-3 px-4 py-3 rounded-xl border border-slate-800 bg-slate-950/40"
      >
        {messages.map((m, index) => (
          <div
            key={index}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={[
                'max-w-[85%] whitespace-pre-line text-sm leading-relaxed px-3.5 py-2.5 rounded-2xl',
                m.role === 'user'
                  ? 'bg-brand-600 text-white rounded-bl-sm'
                  : 'bg-slate-800/90 text-slate-200 border border-slate-700 rounded-br-sm',
              ].join(' ')}
            >
              {m.text}
            </div>
          </div>
        ))}
        {typing ? (
          <div className="flex justify-start">
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl rounded-br-sm px-3.5 py-2.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0.15s' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        ) : null}
      </div>

      {/* شريط الإرسال: المايك مدمج تلقائياً في Input */}
      <div className="flex items-start gap-2 shrink-0">
        <div className="flex-1">
          <Input
            id={COMPOSER_ID}
            value={input}
            onChange={setInput}
            onKeyDown={onComposerKeyDown}
            placeholder="اكتب سؤالك هنا أو استخدم المايك..."
            voiceLabel="إملاء سؤال المساعد صوتياً"
          />
        </div>
        <Button
          type="button"
          variant="primary"
          icon={Send}
          onClick={() => send(input)}
          disabled={sendButtonDisabled}
          aria-label="إرسال السؤال"
        >
          إرسال
        </Button>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1 shrink-0">
        <Bot className="w-3.5 h-3.5" />
        اختر قسماً من الشريط أعلاه ليركّز المساعد على مجاله (منتجات/موردين/عملاء/إنشاء طلب) — ومع مفتاح Gemini في «إعدادات الربط والسحابة» يجهّز المساعد نماذج معبأةً (مورد/عميل/منتج/مصروف/طلب) لتراجعها وتحفظها بنفسك — لا يُنفَّذ أي تغيير تلقائياً.
      </div>
    </Modal>
  )
}

export default AiAssistantModal
