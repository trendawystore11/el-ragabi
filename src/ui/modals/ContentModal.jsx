// =============================================================================
// ui/modals/ContentModal.jsx — نافذة محتوى عامة (جسر legacy — V3.51)
// -----------------------------------------------------------------------------
// تخدم استدعاءات window.openModal القديمة ({title, contentHTML, maxWidth,
// onRender(wrapper, close)}) التي كانت تشير إلى دالة غير معرّفة في الحزمة
// فتتعطل (كشوف الحسابات في utils/statements.js + فتح الحقول الحساسة في
// إعدادات الربط sheets.js). تُعرض contentHTML كما هو ويُستدعى onRender بعد
// التركيب مع إغلاق النافذة — بنفس عقد legacy modal.js.
//
// ⚠️ dangerouslySetInnerHTML يخدم محتوى يولّده النظام نفسه (كشوف/نماذج ثابتة)،
// لكن القيم المضمّنة داخله قد تحمل بيانات مستخدم/مخزنة (أسماء، ملاحظات، رسائل
// خطأ) — يمر كل شيء عبر sanitizeHtml (V3.58) لإزالة أي ناقل تنفيذ (سكربت/on*/
// javascript:) مع الحفاظ على بنية القوالب المطلوبة (جداول، حقول، أزرار).
// =============================================================================
import { useEffect, useRef } from 'react'
import { ShieldCheck } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import { useUiStore } from '../state/uiStore.js'
import { sanitizeHtml } from '../../utils/sanitizeHtml.js'

function ContentModal() {
  const open = useUiStore(s => s.contentModal.open)
  if (!open) return null
  return <ContentModalInner />
}

function ContentModalInner() {
  const { title, contentHTML, maxWidth, onRender } = useUiStore(s => s.contentModal)
  const close = useUiStore(s => s.closeContentModal)
  const bodyRef = useRef(null)

  useEffect(() => {
    if (bodyRef.current && typeof onRender === 'function') {
      onRender(bodyRef.current, close)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      open
      onClose={close}
      title={title || ''}
      icon={ShieldCheck}
      maxWidth={maxWidth || 'max-w-2xl'}
      bodyClassName="!p-0"
    >
      <div ref={bodyRef} dangerouslySetInnerHTML={{ __html: sanitizeHtml(contentHTML || '') }} />
    </Modal>
  )
}

export default ContentModal
