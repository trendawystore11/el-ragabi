// =============================================================================
// services/posService.js — أدوات البيع السريع (وضع الكاشير) — دوال نقية
// -----------------------------------------------------------------------------
// تُجهّز بنود البيع بصيغة مطابقة تماماً لـ window.createOrder (نفس صيغة
// OrderModal) حتى تظهر طلبات الكاشير في سجل الطلبات وتصدير Excel/Google Sheets
// كأي طلب عادي 100%. applyPosDiscount يوزّع الخصم على أسعار البيع للبنود
// نسبياً (مع امتصاص فروق التقريب في آخر بند) دون إدخال أي حقل جديد في الـ Schema.
// =============================================================================
import { round2 } from '../utils/formatters.js'

/** بناء مصفوفة البنود بصيغة createOrder من أسطر البيع المختارة. */
export function buildPosItems(lines = []) {
  return lines
    .filter(line => line && line.product && Number(line.quantity) > 0)
    .map(line => {
      const product = line.product
      return {
        productId: product.id || '',
        productName: product.name || '',
        quantity: Number(line.quantity),
        purchasePrice: Number(product.purchasePrice) || 0,
        sellingPrice: Number(product.sellingPrice) || 0,
        supplierId: product.supplierId || '',
        supplierName: product.supplierName || '',
      }
    })
}

/** توزيع خصم (ج.م) على أسعار بيع البنود نسبياً، آخر بند يمتص فروق التقريب. */
export function applyPosDiscount(items = [], discount) {
  const discountAmount = Number(discount) || 0
  if (discountAmount <= 0 || items.length === 0) return items

  const subtotal = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.sellingPrice), 0)
  if (subtotal <= 0) return items

  // 🔒 إصلاح (تدقيق V3.46 — H3): خصم أكبر من إجمالي السلة كان يُنتج أسعار بيع سالبة
  // (ratio > 1) ويُفسد حسابات الأرباح لاحقاً. نُقيّد (clamp) بدل throw لأن PosModal
  // يستدعي هذه الدالة مباشرةً أثناء الرسم (مع كل ضغطة أثناء كتابة قيمة الخصم)،
  // والتحقق الفعلي الذي يمنع الحفظ موجود بالفعل في handleSave بالواجهة (رسالة خطأ toast).
  const clampedDiscount = Math.min(discountAmount, subtotal)

  const ratio = clampedDiscount / subtotal
  const targetTotal = round2(subtotal - clampedDiscount)

  const discounted = items.map(it => ({
    ...it,
    sellingPrice: round2(Number(it.sellingPrice) * (1 - ratio)),
  }))

  const currentTotal = round2(discounted.reduce((sum, it) => sum + Number(it.quantity) * Number(it.sellingPrice), 0))
  const diff = round2(targetTotal - currentTotal)

  const lastIndex = discounted.length - 1
  const last = discounted[lastIndex]
  discounted[lastIndex] = {
    ...last,
    sellingPrice: round2(Number(last.sellingPrice) + diff / Number(last.quantity)),
  }

  return discounted
}

/** إجمالي البنود بعد الخصم. */
export function computePosTotal(items = []) {
  return round2(items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.sellingPrice), 0))
}
