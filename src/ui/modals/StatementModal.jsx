// =============================================================================
// ui/modals/StatementModal.jsx — نافذة كشف الحساب البنكي — نسخة React من
// window.openCustomerStatementModal / window.openSupplierStatementModal
// (js/utils/statements.js + js/utils/modal.js)
// -----------------------------------------------------------------------------
// يعرض كشف الحساب المصرفي (نفس buildCustomerStatementEntries/
// buildSupplierStatementEntries): عمودا المدين/الدائن والرصيد التراكمي الذي
// يطابق دائماً رصيد العميل/المورد الحالي المخزّن (مع صف التسوية الافتتاحية).
// جسم الكشف مشترك مع تبويبَي ReportsView عبر BankStatementTable.
// البيانات تُقرأ من window عند العرض بنفس نموذج الشاشات الأخرى (الجسر).
// =============================================================================
import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'
import BankStatementTable from '../components/BankStatementTable.jsx'
import { useUiStore } from '../state/uiStore.js'
import { resolveStatement } from '../../utils/statements.js'

function StatementModal() {
  const open = useUiStore(s => s.statementModal.open)
  if (!open) return null
  return <StatementModalInner />
}

function StatementModalInner() {
  const { entityType, entityId } = useUiStore(s => s.statementModal)
  const close = useUiStore(s => s.closeStatementModal)

  const [data] = useState(() => (entityId ? resolveStatement(entityType, entityId) : null))
  if (!data) return null

  const title = `📒 كشف حساب ${data.isSupplier ? 'مورد' : 'مصرفي'}: ${data.entity ? data.entity.name : entityId}`
  const footer = (
    <Button variant="secondary" onClick={close}>إغلاق</Button>
  )

  return (
    <Modal open onClose={close} title={title} icon={BookOpen} maxWidth="max-w-5xl" footer={footer}>
      <BankStatementTable entity={data.entity} isSupplier={data.isSupplier} rows={data.rows} />
    </Modal>
  )
}

export default StatementModal
