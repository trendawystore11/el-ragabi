// =============================================================================
// ui/views/UsersView.jsx — نسخة React من renderUsersView (users-view.js) — Phase 10
// -----------------------------------------------------------------------------
// لوحة إدارة الحسابات وصلاحيات الموظفين: بوابة مدير (بدون جلسة مدير تظهر
// شاشة «الصفحة خاصة بالمدير فقط»)، جدول المستخدمين (كود/اسم/بريد/صلاحية/
// تاريخ إنشاء/إجراءات) مع شارات الرتب، أزرار «تعديل والرمز 🔑» و«إزالة الحساب»
// (لغير المديرين فقط). الإضافة/التعديل عبر UserModal (uiStore) والحذف عبر
// window.deleteUserAccount.
// =============================================================================
import { useState, useEffect } from 'react'
import { UserCog, UserPlus, ShieldAlert, Key, UserX } from 'lucide-react'
import Button from '../components/Button.jsx'
import { useUiStore } from '../state/uiStore.js'
import { showToast } from '../components/toastStore.js'
import { formatDate } from '@/utils/formatters'

function RoleBadge({ role }) {
  if (role === 'admin') {
    return (
      <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/40">
        مدير النظام (Admin)
      </span>
    )
  }
  if (role === 'storekeeper') {
    return (
      <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40">
        أمين مخزن (Storekeeper)
      </span>
    )
  }
  if (role === 'accountant') {
    return (
      <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/40">
        محاسب / مالي (Accountant)
      </span>
    )
  }
  return (
    <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
      كاشير / موظف مبيعات (Cashier / Sales)
    </span>
  )
}

function UsersView() {
  const [users, setUsers] = useState([])
  const [deletingId, setDeletingId] = useState(null)
  const isAdmin = typeof window !== 'undefined' && window.isAdmin ? window.isAdmin() : false

  const load = () => {
    if (typeof window === 'undefined' || !window.getUsers) return
    const list = window.getUsers()
    setUsers(Array.isArray(list) ? list : [])
  }

  useEffect(() => {
    load()
  }, [])

  if (!isAdmin) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl animate-fadeIn">
        <ShieldAlert className="w-16 h-16 text-rose-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">عفواً! الصفحة خاصة بالمدير فقط</h2>
        <p className="text-sm text-slate-400">ليس لديك الصلاحية الكافية لاستعراض لوحة إشراف الموظفين والحسابات</p>
      </div>
    )
  }

  const openAdd = () => useUiStore.getState().openUserModal(null, load)
  const openEdit = id => useUiStore.getState().openUserModal(id, load)

  const remove = async u => {
    if (deletingId) return
    if (!window.confirm(`هل أنت تأكد من إزالة حساب الموظف "${u.name}" نهائياً من النظام؟`)) return
    setDeletingId(u.id)
    try {
      const ok = await window.deleteUserAccount(u.id)
      if (ok) showToast(`تم إزالة حساب "${u.name}" بنجاح`, 'info')
      else showToast('تعذر إزالة الحساب — حاول مرة أخرى', 'error')
    } catch (err) {
      showToast(err && err.message ? err.message : 'حدث خطأ أثناء إزالة الحساب', 'error')
    } finally {
      setDeletingId(null)
      load()
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 v7-page-hero">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <UserCog className="w-6 h-6 text-brand-400" />
            <span>إدارة الحسابات وصلاحيات الموظفين</span>
          </h1>
          <p className="text-sm text-slate-400">إضافة موظفين جدد، إعادة ضبط كلمات المرور، وتعديل الصلاحيات والرتب</p>
        </div>

        <Button variant="primary" icon={UserPlus} onClick={openAdd} className="shrink-0">
          إضافة موظف / حساب جديد
        </Button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>كود المستخدم</th>
                <th>اسم الموظف</th>
                <th>البريد الإلكتروني</th>
                <th>الصلاحية / الرتبة</th>
                <th>تاريخ الإنشاء</th>
                <th>الإجراءات والعمليات</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-500">
                    لا يوجد موظفين مسجلين
                  </td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.id}>
                    <td className="font-bold text-slate-400 font-mono num-font">{u.id || 'USR'}</td>
                    <td className="font-bold text-white">{u.name}</td>
                    <td className="num-font text-slate-300 font-mono">{u.email}</td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="text-xs text-slate-400">{formatDate(u.createdAt)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Key}
                          onClick={() => openEdit(u.id)}
                          className="text-amber-400 hover:bg-amber-950/40 hover:text-amber-300"
                        >
                          تعديل والرمز 🔑
                        </Button>
                        {u.role !== 'admin' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={UserX}
                            onClick={() => remove(u)}
                            loading={deletingId === u.id}
                            disabled={!!deletingId}
                            className="text-rose-400 hover:bg-rose-950/40 hover:text-rose-300"
                          >
                            إزالة الحساب
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default UsersView
