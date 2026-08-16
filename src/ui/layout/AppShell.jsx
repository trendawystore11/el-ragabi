// =============================================================================
// ui/layout/AppShell.jsx — هيكل التطبيق (شريط جانبي + رأس + منطقة محتوى) — Phase 3
// -----------------------------------------------------------------------------
// تنقّل بسيط بدون راوتر (حالة محلية): شاشة «سجل الطلبات» جاهزة الآن، وباقي
// الشاشات تظهر كعناصر معلّقة حتى تُنقل. المظهر والمستخدم يأتيان من المخازن.
// =============================================================================
import { lazy, Suspense, useState, useRef } from 'react'
import {
  ShoppingBag,
  Sun,
  Moon,
  LogOut,
  LayoutDashboard,
  ClipboardList,
  UsersRound,
  Package,
  Truck,
  Receipt,
  WalletCards,
  ChartNoAxesCombined,
  BarChart3,
  ShieldUser,
  Settings,
  ChevronDown,
  CloudCog,
  KeyRound,
  RefreshCw,
  FlaskConical,
  ExternalLink,
  Plus,
  Store,
  Sparkles,
  Menu,
  X,
  Wrench,
} from 'lucide-react'

// V3.52 — تجزئة الحِزَم: كل شاشة تُحمَّل في حزمة مستقلة (React.lazy) لحظة فتحها
// فقط، وكل نافذة تُركَّب (وتُحمَّل) فقط عندما تُفتح فعلاً. هذا يخفض الحزمة
// الأولية جذرياً ويُنهي تحذير build الخاص بالحِزَم فوق 500kB للكود التطبيقي.
const Dashboard = lazy(() => import('../views/Dashboard.jsx'))
const AnalyticsView = lazy(() => import('../views/AnalyticsView.jsx'))
const OrdersView = lazy(() => import('../views/OrdersView.jsx'))
const CustomersView = lazy(() => import('../views/CustomersView.jsx'))
const ProductsView = lazy(() => import('../views/ProductsView.jsx'))
const SuppliersView = lazy(() => import('../views/SuppliersView.jsx'))
const ExpensesView = lazy(() => import('../views/ExpensesView.jsx'))
const ReportsView = lazy(() => import('../views/ReportsView.jsx'))
const PaymentsView = lazy(() => import('../views/PaymentsView.jsx'))
const UsersView = lazy(() => import('../views/UsersView.jsx'))
const SettingsView = lazy(() => import('../views/SettingsView.jsx'))

const OrderModal = lazy(() => import('../modals/OrderModal.jsx'))
const PosModal = lazy(() => import('../modals/PosModal.jsx'))
const AiAssistantModal = lazy(() => import('../modals/AiAssistantModal.jsx'))
const OrderDetailsModal = lazy(() => import('../modals/OrderDetailsModal.jsx'))
const OrderStatusModal = lazy(() => import('../modals/OrderStatusModal.jsx'))
const AddCustomerModal = lazy(() => import('../modals/AddCustomerModal.jsx'))
const AddProductModal = lazy(() => import('../modals/AddProductModal.jsx'))
const ShipmentModal = lazy(() => import('../modals/ShipmentModal.jsx'))
const AddSupplierModal = lazy(() => import('../modals/AddSupplierModal.jsx'))
const SupplierReturnModal = lazy(() => import('../modals/SupplierReturnModal.jsx'))
const AddExpenseModal = lazy(() => import('../modals/AddExpenseModal.jsx'))
const WipeDatabaseModal = lazy(() => import('../modals/WipeDatabaseModal.jsx'))
const PaymentModal = lazy(() => import('../modals/PaymentModal.jsx'))
const UserModal = lazy(() => import('../modals/UserModal.jsx'))
const AdminPasswordModal = lazy(() => import('../modals/AdminPasswordModal.jsx'))
const ChangePasswordModal = lazy(() => import('../modals/ChangePasswordModal.jsx'))
const CloudSyncModal = lazy(() => import('../modals/CloudSyncModal.jsx'))
const StatementModal = lazy(() => import('../modals/StatementModal.jsx'))
const ContentModal = lazy(() => import('../modals/ContentModal.jsx'))
const TreasuryAdjustModal = lazy(() => import('../modals/TreasuryAdjustModal.jsx'))
import Card from '../components/Card.jsx'
import Badge from '../components/Badge.jsx'
import { useSettingsStore } from '@/state/settingsStore'
import { useAuthStore } from '@/state/authStore'
import { useSandboxStore } from '@/state/sandboxStore'
import { useUiStore } from '@/ui/state/uiStore'
import { showToast } from '../components/toastStore.js'
import { visibleNavItems, canCreateOrder, canUsePos, canSyncOrTest, canUseAi, canSeeDashboard } from '@/services/permissions'

const NAV = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, ready: true },
  { id: 'analytics', label: 'تحليل البيانات', icon: BarChart3, ready: true },
  { id: 'orders', label: 'سجل الطلبات', icon: ClipboardList, ready: true },
  { id: 'customers', label: 'العملاء', icon: UsersRound, ready: true },
  { id: 'products', label: 'المنتجات', icon: Package, ready: true },
  { id: 'suppliers', label: 'الموردون', icon: Truck, ready: true },
  { id: 'expenses', label: 'المصروفات', icon: Receipt, ready: true },
  { id: 'payments', label: 'إدارة المدفوعات', icon: WalletCards, ready: true },
  { id: 'reports', label: 'التقارير', icon: ChartNoAxesCombined, ready: true },
  { id: 'users', label: 'المستخدمون', icon: ShieldUser, ready: true },
  { id: 'settings', label: 'الإعدادات', icon: Settings, ready: true },
  { id: 'configWizard', label: 'معالج التخصيص', icon: Wrench, ready: true },
]

// 🔒 RBAC (V3.43): قائمة الشاشات لكل دور محددة في services/permissions:
//   admin → الكل، employee (كاشير) → طلبات/عملاء/منتجات،
//   storekeeper → منتجات فقط، accountant → لوحة/تحليل/طلبات/عملاء/منتجات/موردون/مصروفات/مدفوعات/تقارير.
function visibleNav(role) {
  return visibleNavItems(role)
    .map(id => NAV.find(item => item.id === id))
    .filter(Boolean)
}

function ComingSoon() {
  return (
    <Card>
      <div className="py-20 text-center">
        <div className="text-4xl mb-3">🚧</div>
        <h2 className="text-lg font-bold text-white mb-1">هذه الشاشة قيد النقل إلى React</h2>
        <p className="text-sm text-slate-500">ستُتاح فور اكتمال تحويلها في مرحلة لاحقة</p>
      </div>
    </Card>
  )
}

// V3.52 — بديل التحميل أثناء تقسيم الشاشات (Suspense fallback).
// V14 — Skeleton بدل الـspinner: هيكل ثابت + توهج متحرك (شيمر) من اليمين لليسار (RTL).
function ViewLoading() {
  return (
    <Card>
      <div className="p-2 space-y-3" aria-busy="true" aria-label="جارٍ تحميل الشاشة">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton skeleton--w70" />
        <div className="skeleton skeleton--card" />
        <div className="skeleton skeleton--card" />
      </div>
      <p className="sr-only">جارٍ تحميل الشاشة…</p>
    </Card>
  )
}

// HDI — عائلة الثيمات الفاتحة. زر «تبديل المظهر» يبدّل بينها وبين الثيم
// الداكن الافتراضي (graphite) بدل افتراض الثيمين القديمين dark/light.
const LIGHT_THEMES = ['light', 'light-professional', 'mint']

function AppShell() {
  const role = useAuthStore(s => s.role)
  const [active, setActive] = useState(() => {
    if (role === 'storekeeper') return 'products'
    if (role === 'employee') return 'orders'
    return 'dashboard'
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const syncFileInputRef = useRef(null)
  const [syncDir, setSyncDir] = useState(() => {
    if (typeof window !== 'undefined' && window.GoogleSheetsSync && typeof window.GoogleSheetsSync.getConfig === 'function') {
      try {
        const c = window.GoogleSheetsSync.getConfig()
        if (c) {
          return c.enabled
            ? ['both', 'export', 'import'].indexOf(c.direction) >= 0
              ? c.direction
              : 'export'
            : 'off'
        }
      } catch { /* ignore malformed config */ }
    }
    return 'off'
  })
  const appName = useSettingsStore(s => s.appName)
  const logo = useSettingsStore(s => s.logo)
  const theme = useSettingsStore(s => s.theme)
  const setTheme = useSettingsStore(s => s.setTheme)
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const sandboxActive = useSandboxStore(s => s.active)
  const toggleSandbox = useSandboxStore(s => s.toggle)
  const openAdminPasswordModal = useUiStore(s => s.openAdminPasswordModal)
  const openChangePasswordModal = useUiStore(s => s.openChangePasswordModal)

  // V3.52 — تركيب شرطي لكل نافذة على علمها في uiStore (تُحمَّل وتُركَّب عند
  // الفتح فقط — يحول التحميل الكسول للنوافذ إلى خفض حقيقي للحزمة الأولية).
  const modalOpen = {
    order: useUiStore(s => s.orderModal.open),
    pos: useUiStore(s => s.posModal.open),
    ai: useUiStore(s => s.aiAssistantModal.open),
    orderDetails: useUiStore(s => s.orderDetailsModal.open),
    orderStatus: useUiStore(s => s.orderStatusModal.open),
    customer: useUiStore(s => s.customerModal.open),
    product: useUiStore(s => s.productModal.open),
    shipment: useUiStore(s => s.shipmentModal.open),
    supplier: useUiStore(s => s.supplierModal.open),
    supplierReturn: useUiStore(s => s.supplierReturnModal.open),
    expense: useUiStore(s => s.expenseModal.open),
    wipe: useUiStore(s => s.wipeDatabaseModal.open),
    payment: useUiStore(s => s.paymentModal.open),
    user: useUiStore(s => s.userModal.open),
    adminPassword: useUiStore(s => s.adminPasswordModal.open),
    changePassword: useUiStore(s => s.changePasswordModal.open),
    syncCloud: useUiStore(s => s.syncCloudModal.open),
    statement: useUiStore(s => s.statementModal.open),
    content: useUiStore(s => s.contentModal.open),
    treasuryAdjust: useUiStore(s => s.treasuryAdjustModal.open),
  }

  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const View =
    active === 'dashboard'
      ? Dashboard
      : active === 'analytics'
        ? AnalyticsView
        : active === 'orders'
          ? OrdersView
        : active === 'customers'
          ? CustomersView
          : active === 'products'
            ? ProductsView
            : active === 'suppliers'
              ? SuppliersView
            : active === 'expenses'
              ? ExpensesView
              : active === 'payments'
                ? PaymentsView
                : active === 'reports'
                  ? ReportsView
                  : active === 'users'
                    ? UsersView
                    : active === 'settings'
                      ? SettingsView
                      : ComingSoon

  const ThemeIcon = LIGHT_THEMES.includes(theme) ? Moon : Sun
  const items = visibleNav(user ? role : null)

  // 🔒 V3.43 — زر الشعار لا يمرّ الكاشير/أمين المخزن إلى لوحة التحكم المالية:
  // يوجّههما لشاشتهما الافتراضية بدلاً من dashboard.
  const goDashboard = () =>
    setActive(canSeeDashboard(role) ? 'dashboard' : role === 'storekeeper' ? 'products' : 'orders')

  const runManualSync = async () => {
    if (syncing) return
    const gs = window.GoogleSheetsSync
    const cfg = gs && typeof gs.getConfig === 'function' ? gs.getConfig() : {}
    const direction = cfg.direction || 'export'
    const transport = gs && typeof gs.getTransport === 'function' ? gs.getTransport() : null
    // القناة أحادية الاتجاه (Webhook) لا تستطيع القراءة من السحابة: عند اختيار
    // «استيراد فقط» أو «بالاتجاهين» نوجّه المستخدم للاستيراد المحلي من ملف
    // (Excel/CSV أو نسخة JSON) بدل رسالة الخطأ «الاستيراد غير مدعوم».
    const webhookOnly = !!(cfg.webhookUrl && (!transport || transport.isWebhook))
    if ((direction === 'import' || direction === 'both') && webhookOnly) {
      setSyncMenuOpen(false)
      showToast(
        direction === 'both'
          ? 'القناة أحادية الاتجاه — الاستيراد من ملف محلي ثم يُصدَّر للسحابة'
          : 'القناة أحادية الاتجاه — الاستيراد من ملف محلي (Excel/CSV أو نسخة JSON)',
        'info'
      )
      if (syncFileInputRef.current) syncFileInputRef.current.click()
      return
    }
    setSyncing(true)
    try {
      if (typeof window.syncWithGoogleSheets === 'function') {
        await window.syncWithGoogleSheets()
        showToast('تمت المزامنة مع Google Sheets بنجاح', 'success')
      } else {
        showToast('خدمة المزامنة مع Google Sheets غير متوفرة حالياً', 'warning')
      }
    } catch (err) {
      showToast('فشلت المزامنة: ' + ((err && err.message) || String(err)), 'error')
    } finally {
      setSyncing(false)
      setSyncMenuOpen(false)
    }
  }

  // V3.63 — استيراد محلي من ملف (Excel/CSV أو نسخة JSON) عند اختيار
  // «استيراد فقط»/«بالاتجاهين» مع قناة Webhook أحادية الاتجاه. عند «بالاتجاهين»
  // يُدفع الـ snapshot للسحابة بعد نجاح الاستيراد ليكتمل الاتجاهان فعلًا.
  const handleSyncFilePicked = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (sandboxActive) {
      showToast('وضع الاختبار نشط — الاستيراد من ملف محظور', 'error')
      return
    }
    const gs = window.GoogleSheetsSync
    const cfg = gs && typeof gs.getConfig === 'function' ? gs.getConfig() : {}
    const direction = cfg.direction || 'export'
    const isJson = /\.json$/i.test(file.name)
    setSyncing(true)
    try {
      if (isJson) {
        const text = await file.text()
        const data = JSON.parse(text)
        if (typeof window.importFullBackup !== 'function') {
          throw new Error('خدمة استعادة النسخ الاحتياطية غير متوفرة')
        }
        if (!window.confirm('سيتم استبدال بيانات كل مجموعات النظام بالنسخة المحفوظة في الملف. هل تريد المتابعة؟')) return
        const res = window.importFullBackup(data)
        const skippedNote = res.skipped && res.skipped.length ? ` — تم تخطي: ${res.skipped.join(', ')}` : ''
        showToast(`تمت الاستعادة: ${res.collections} مجموعة / ${res.records} سجل${skippedNote}`, res.records ? 'success' : 'info')
      } else {
        if (!gs || typeof gs.importFromFile !== 'function') {
          throw new Error('خدمة استيراد الملفات غير متوفرة')
        }
        const res = await gs.importFromFile(file)
        showToast(`تم استيراد ${res.rowsImported} سجل من «${res.label || res.sheet}»`, res.rowsImported ? 'success' : 'info')
      }
      // بالاتجاهين: بعد نجاح الاستيراد المحلي ندفع snapshot للسحابة عبر الـ Webhook
      if (direction === 'both' && gs && typeof gs.syncNow === 'function' && cfg.webhookUrl) {
        const pushed = await gs.syncNow({ direction: 'export' })
        const pushedRows = pushed && pushed.exported ? pushed.exported.rowsTotal : 0
        showToast(`وتم تصدير ${pushedRows} سجل للسحابة`, 'success')
      }
    } catch (err) {
      showToast((err && err.message) || String(err), 'error')
    } finally {
      setSyncing(false)
    }
  }

  const openSyncSheet = () => {
    setSyncMenuOpen(false)
    const gs = window.GoogleSheetsSync
    if (gs && typeof gs.openSheetUrl === 'function') {
      gs.openSheetUrl()
    } else {
      showToast('خدمة فتح ورقة البيانات غير متوفرة حالياً', 'warning')
    }
  }

  const changeSyncDirection = value => {
    setSyncDir(value)
    const gs = window.GoogleSheetsSync
    if (gs && typeof gs.setQuickDirection === 'function') {
      gs.setQuickDirection(value)
    }
    const DIR_LABELS = { both: 'بالاتجاهين', export: 'تصدير فقط', import: 'استيراد فقط' }
    showToast(value === 'off' ? '⏸ تم إيقاف المزامنة التلقائية' : '✓ تم تغيير نوع المزامنة إلى: ' + (DIR_LABELS[value] || value), 'success')
  }

  const handleSandboxToggle = () => {
    toggleSandbox()
    showToast(
      sandboxActive
        ? 'تم الخروج من وضع الاختبار وعودة البيانات الأصلية'
        : '🧪 وضع الاختبار نشط — كل التغييرات داخل الذاكرة فقط ولن تمس بياناتك الحقيقية',
      'info'
    )
  }

  return (
    <div dir="rtl" className="app-shell min-h-screen bg-slate-950 text-slate-100">
      {sandboxActive ? (
        <div className={`sandbox-banner sandbox-banner--${theme || "dark"} sticky top-0 z-[60] w-full text-white text-sm font-bold px-4 py-2 flex items-center justify-center gap-2 text-center`}>
          <FlaskConical className="w-4 h-4 shrink-0" />
          <span className="truncate">🧪 وضع الاختبار نشط — كل التغييرات داخل الذاكرة فقط ولن تمس بياناتك الحقيقية. اضغط «إنهاء الاختبار» في الشريط العلوي للعودة.</span>
        </div>
      ) : null}
      {modalOpen.order ? <Suspense fallback={null}><OrderModal /></Suspense> : null}
      {modalOpen.pos ? <Suspense fallback={null}><PosModal /></Suspense> : null}
      {modalOpen.ai ? <Suspense fallback={null}><AiAssistantModal /></Suspense> : null}
      {modalOpen.orderDetails ? <Suspense fallback={null}><OrderDetailsModal /></Suspense> : null}
      {modalOpen.orderStatus ? <Suspense fallback={null}><OrderStatusModal /></Suspense> : null}
      {modalOpen.customer ? <Suspense fallback={null}><AddCustomerModal /></Suspense> : null}
      {modalOpen.product ? <Suspense fallback={null}><AddProductModal /></Suspense> : null}
      {modalOpen.shipment ? <Suspense fallback={null}><ShipmentModal /></Suspense> : null}
      {modalOpen.supplier ? <Suspense fallback={null}><AddSupplierModal /></Suspense> : null}
      {modalOpen.supplierReturn ? <Suspense fallback={null}><SupplierReturnModal /></Suspense> : null}
      {modalOpen.expense ? <Suspense fallback={null}><AddExpenseModal /></Suspense> : null}
      {modalOpen.wipe ? <Suspense fallback={null}><WipeDatabaseModal /></Suspense> : null}
      {modalOpen.payment ? <Suspense fallback={null}><PaymentModal /></Suspense> : null}
      {modalOpen.user ? <Suspense fallback={null}><UserModal /></Suspense> : null}
      {modalOpen.adminPassword ? <Suspense fallback={null}><AdminPasswordModal /></Suspense> : null}
      {modalOpen.changePassword ? <Suspense fallback={null}><ChangePasswordModal /></Suspense> : null}
      {modalOpen.syncCloud ? <Suspense fallback={null}><CloudSyncModal /></Suspense> : null}
      {modalOpen.statement ? <Suspense fallback={null}><StatementModal /></Suspense> : null}
      {modalOpen.content ? <Suspense fallback={null}><ContentModal /></Suspense> : null}
      {modalOpen.treasuryAdjust ? <Suspense fallback={null}><TreasuryAdjustModal /></Suspense> : null}
      <div className="app-frame flex v7-app-frame">
        <aside className="app-sidebar w-60 shrink-0 min-h-screen bg-slate-900/70 border-l border-slate-800 hidden md:flex flex-col v7-sidebar">
          <button
            type="button"
            onClick={goDashboard}
            title="العودة للوحة التحكم"
            aria-label="العودة للوحة التحكم"
            className="w-full p-5 flex items-center gap-3 border-b border-slate-800 text-left cursor-pointer hover:bg-slate-800/40 transition-all v7-brand"
          >
            <span className="w-10 h-10 grid place-items-center rounded-xl bg-brand-500/15 text-brand-400 shrink-0 overflow-hidden">
              {logo ? (
                <img src={logo} alt={appName} className="w-full h-full object-contain" />
              ) : (
                <ShoppingBag className="w-5 h-5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="font-bold text-white leading-tight truncate">{appName}</div>
              <div className="text-[11px] text-slate-500">نظام إدارة المحل</div>
            </div>
          </button>
          <nav className="flex-1 p-3 space-y-1 v7-nav">
            {items.map(item => {
              const Icon = item.icon
              const isActive = item.id === active
              return (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all v7-nav-item',
                    isActive
                      ? 'bg-brand-500/15 text-brand-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200',
                    item.ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                  ].join(' ')}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="flex-1 text-right">{item.label}</span>
                  {!item.ready && <span className="text-[10px] text-slate-600">قريباً</span>}
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 v7-main-column">
          <header className="app-header h-16 flex items-center justify-between md:justify-end px-3 sm:px-6 border-b border-slate-800 bg-slate-900/85 backdrop-blur-sm sticky top-0 z-10 gap-3 v7-header">
            {/* V3.41 — على الجوال فقط: زر القائمة (الثلاث شرط) أولاً في أقصى اليمين
                ثم الشعار. على الشاشات الكبيرة (md+) يختفي هذا القسم كاملاً لأن
                الشعار يعيش في الشريط الجانبي فقط (لا تكرار للشعار في الهيدر). */}
            <div className="flex items-center gap-2 min-w-0 md:hidden">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                title="فتح قائمة التنقل"
                aria-label="فتح قائمة التنقل"
                className="w-10 h-10 shrink-0 grid place-items-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goDashboard}
                title="الذهاب إلى لوحة التحكم"
                aria-label="شعار المتجر — العودة للوحة التحكم"
                className="flex items-center gap-2 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
              >
                <span className="w-9 h-9 grid place-items-center rounded-xl bg-brand-500/15 text-brand-400 shrink-0 overflow-hidden">
                  {logo ? (
                    <img src={logo} alt={appName} className="w-full h-full object-contain" />
                  ) : (
                    <Store className="w-5 h-5" />
                  )}
                </span>
                <span className="min-w-0 text-right hidden sm:block">
                  <span className="block text-sm font-bold text-white truncate">{appName}</span>
                  <span className="block text-[11px] text-slate-500 truncate">نظام إدارة المحل</span>
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {canCreateOrder(role) ? (
                <button
                  onClick={() => useUiStore.getState().openOrderModal()}
                  title="إنشاء طلب جديد / فاتورة بيع"
                  className="v10-header-action v10-header-primary h-10 w-10 sm:w-auto sm:px-3 px-0 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-sm whitespace-nowrap transition-all cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">إنشاء طلب جديد</span>
                </button>
              ) : null}

              {/* V3.41 — الكاشير السريع يُخفى على الجوال لتخفيف ازدحام الهيدر */}
              {canUsePos(role) ? (
                <button
                  onClick={() => useUiStore.getState().openPosModal()}
                  title="وضع الكاشير — بيع سريع فوري"
                  className="v10-header-action v10-header-pos hidden sm:flex h-10 px-3 items-center gap-2 rounded-xl bg-amber-600 border border-amber-500 hover:bg-amber-500 text-white text-sm font-bold whitespace-nowrap transition-all cursor-pointer shrink-0"
                >
                  <Store className="w-4 h-4" />
                  <span className="hidden sm:inline">كاشير سريع</span>
                </button>
              ) : null}

              {canSyncOrTest(role) ? (
                <>
                <div className="relative shrink-0">
                <button
                  onClick={() => {
                    setSyncMenuOpen(o => !o)
                    setMenuOpen(false)
                  }}
                  title="خيارات المزامنة السريعة"
                  className="v10-header-action v10-header-secondary h-10 px-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-800 text-sm font-medium transition-all whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 text-brand-400 ${syncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">المزامنة</span>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </button>
                {syncMenuOpen ? (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setSyncMenuOpen(false)} />
                    <div className="absolute left-0 mt-2 w-64 max-w-[calc(100vw-5rem)] z-40 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl py-2">
                      <p className="px-4 pt-1 pb-2 text-[11px] font-bold text-slate-500 border-b border-slate-800">
                        خيارات المزامنة السريعة
                      </p>
                      <button
                        onClick={runManualSync}
                        disabled={syncing}
                        title="مزامنة مع Google Sheets حسب نوع المزامنة المحفوظ في الإعدادات (تصدير / استيراد / بالاتجاهين)"
                        className="w-full px-4 py-2.5 text-right text-sm text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className={`w-4 h-4 text-brand-400 ${syncing ? 'animate-spin' : ''}`} />
                        <span className="flex-1">مزامنة الآن</span>
                      </button>
                      <button
                        onClick={openSyncSheet}
                        className="w-full px-4 py-2.5 text-right text-sm text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"
                        title="فتح ورقة Google Sheets المرتبطة في النظام في تبويب جديد"
                      >
                        <ExternalLink className="w-4 h-4 text-emerald-400" />
                        <span>فتح ورقة البيانات 📊</span>
                      </button>
                      <div className="px-3 py-2.5 border-t border-slate-800 mt-1">
                        <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                          نوع المزامنة التلقائية
                        </label>
                        <select
                          value={syncDir}
                          onChange={e => changeSyncDirection(e.target.value)}
                          title="نوع المزامنة — يتغير فوراً ويُرفع للسحابة"
                          className="w-full px-2.5 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-xs text-slate-200 font-medium transition-all cursor-pointer focus:outline-none focus:border-brand-500"
                        >
                          <option value="off">⏸ مزامنة متوقفة</option>
                          <option value="export">📤 تصدير فقط</option>
                          <option value="import">📥 استيراد فقط</option>
                          <option value="both">🔄 بالاتجاهين</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
                <input
                  ref={syncFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.json"
                  className="hidden"
                  title="استيراد محلي: Excel/CSV أو نسخة JSON"
                  onChange={handleSyncFilePicked}
                />
                </>
              ) : null}

              {canSyncOrTest(role) ? (
                <button
                  onClick={handleSandboxToggle}
                  title="وضع الاختبار (حقل التجارب) — تجربة النظام بأمان دون أي مساس بالبيانات الحقيقية"
                  className={`v10-header-action v10-header-sandbox h-10 px-3 flex items-center gap-2 rounded-xl border text-sm font-medium transition-all shrink-0 whitespace-nowrap cursor-pointer ${
                    sandboxActive
                      ? 'bg-amber-600 border-amber-500 text-white'
                      : 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <FlaskConical className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">{sandboxActive ? 'إنهاء الاختبار' : 'وضع الاختبار'}</span>
                </button>
              ) : null}

              <button
                onClick={() => setTheme(LIGHT_THEMES.includes(theme) ? 'graphite' : 'light-professional')}
                title="تبديل المظهر"
                className="v10-header-action v10-header-icon w-10 h-10 grid place-items-center rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <ThemeIcon className="w-4 h-4" />
              </button>
              {user ? (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(o => !o)}
                    title="قائمة الحساب"
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-800/70 transition-all"
                  >
                    <span className="w-9 h-9 grid place-items-center rounded-full bg-brand-500/15 text-brand-300 font-bold text-sm shrink-0">
                      {(user.name || '?').charAt(0)}
                    </span>
                    <div className="hidden sm:block text-right leading-tight">
                      <div className="text-sm font-semibold text-white">{user.name}</div>
                      <div className="text-[11px] text-slate-500">{user.email}</div>
                    </div>
                    <Badge variant={user.role === 'admin' ? 'brand' : 'info'}>{user.role}</Badge>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {menuOpen ? (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                      <div className="absolute left-0 mt-2 w-60 z-40 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl p-1.5 space-y-1">
                        {user.role === 'admin' ? (
                          <button
                            onClick={() => {
                              setMenuOpen(false)
                              openAdminPasswordModal(
                                'أدخل كلمة سر المدير للوصول إلى إعدادات الربط والسحابة (Firebase / OAuth / Refresh Token / Spreadsheet).',
                                () => useUiStore.getState().openSyncCloudModal()
                              )
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-slate-800 transition-all"
                          >
                            <CloudCog className="w-4 h-4 text-brand-400" />
                            <span className="flex-1 text-right">إعدادات الربط والسحابة 🔐</span>
                          </button>
                        ) : null}
                        <button
                          onClick={() => {
                            setMenuOpen(false)
                            openChangePasswordModal()
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-slate-800 transition-all"
                        >
                          <KeyRound className="w-4 h-4 text-amber-400" />
                          <span className="flex-1 text-right">تغيير كلمة السر</span>
                        </button>
                        <div className="my-1 border-t border-slate-800" />
                        <button
                          onClick={() => {
                            setMenuOpen(false)
                            logout()
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-300 hover:bg-rose-500/10 transition-all"
                        >
                          <LogOut className="w-4 h-4" />
                          <span className="flex-1 text-right">تسجيل الخروج</span>
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <Badge variant="neutral">زائر</Badge>
              )}
            </div>
          </header>

          <main className="app-main p-6 v7-main">
            <Suspense fallback={<ViewLoading />}>
              <View onNavigate={setActive} />
            </Suspense>
          </main>
        </div>
      </div>

      {/* قائمة التنقل على الجوال (Drawer) */}
      <div className={`fixed inset-0 z-50 md:hidden ${mobileNavOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileNavOpen}>
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${mobileNavOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileNavOpen(false)}
        />
        <div
          role="dialog"
          aria-label="قائمة التنقل"
          className={`absolute top-0 right-0 h-full w-72 max-w-[85vw] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col transition-transform duration-300 ${mobileNavOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="p-4 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 grid place-items-center rounded-xl bg-brand-500/15 text-brand-400 shrink-0 overflow-hidden">
                {logo ? (
                  <img src={logo} alt={appName} className="w-full h-full object-contain" />
                ) : (
                  <Store className="w-5 h-5" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-white truncate">{appName}</span>
                <span className="block text-[11px] text-slate-500 truncate">نظام إدارة المحل</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              title="إغلاق القائمة"
              aria-label="إغلاق القائمة"
              className="w-9 h-9 grid place-items-center rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {items.map(item => {
              const Icon = item.icon
              const isActive = item.id === active
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActive(item.id)
                    setMobileNavOpen(false)
                  }}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all cursor-pointer',
                    isActive
                      ? 'bg-brand-500/15 text-brand-300 font-semibold'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                  ].join(' ')}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="flex-1 text-right">{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="p-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false)
                logout()
              }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="flex-1 text-right">تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>

      {/* V3.41 — زر مساعد AI العائم (Floating Action Button): مثبّت في الزاوية
          السفلية اليسرى، ظاهر من أي صفحة، وتحت طبقة النوافذ (z-40 < z-50)
          كي لا يطفو فوق أي نافذة منبثقة. V3.43 — المدير فقط يتحدث مع AI. */}
      {canUseAi(role) ? (
        <button
          type="button"
          onClick={() => useUiStore.getState().openAiAssistantModal()}
          title="مساعد AI — ملخصات واقتراحات سريعة"
          aria-label="مساعد AI — ملخصات واقتراحات سريعة"
          className={`ai-fab ai-fab--${theme || "dark"} fixed bottom-5 left-5 z-40 flex items-center gap-1.5 h-12 pl-3.5 pr-3 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg transition-colors cursor-pointer`}
        >
          <Sparkles className="w-5 h-5 shrink-0" />
          <span className="text-sm font-bold">مساعد ذكي</span>
        </button>
      ) : null}
    </div>
  )
}

export default AppShell
