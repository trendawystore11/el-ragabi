/**
 * Invoice math — pure order/invoice computations (100% pure).
 * Ported verbatim from the calculation core of js/services/orders.js (legacy):
 * item processing, subtotal/total, down payment split, deposit designation.
 */
import { round2, toSubunits, fromSubunits } from '../../utils/formatters.js';
import { computeShippingRevenueDeposit } from '../accounting/accounting.js';

/** Pure item line → processed item (subtotal = round2(qty × sellPrice)). */
export function processItems(items) {
  return items.map(item => {
    // V3.58 — Block quantity <= 0, NaN or Infinity (the old `|| 1` silently
    // coerced 0/negative to 1, letting invalid orders through).
    const qty = Number(item.quantity);
    if (!isFinite(qty) || !(qty > 0)) {
      throw new Error('كميات أصناف الطلب يجب أن تكون أكبر من الصفر');
    }
    const sellPrice = Number(item.sellingPrice) || 0;
    const purPrice = Number(item.purchasePrice) || 0;
    if (sellPrice < 0 || purPrice < 0) {
      throw new Error('لا يمكن إدخال أسعار سالبة في أصناف الطلب');
    }
    const itemSubtotalCents = toSubunits(qty * sellPrice);
    return {
      productId: item.productId,
      productName: item.productName,
      quantity: qty,
      purchasePrice: purPrice,
      sellingPrice: sellPrice,
      supplierId: item.supplierId || '',
      supplierName: item.supplierName || '',
      isDirectShip: typeof item.isDirectShip === 'boolean' ? item.isDirectShip : undefined,
      subtotal: fromSubunits(itemSubtotalCents)
    };
  });
}

export function computeItemsSubtotal(processedItems) {
  const totalSubunits = (processedItems || []).reduce((sum, item) => sum + toSubunits(item.subtotal), 0);
  return fromSubunits(totalSubunits);
}

/** Order Total = items + customer-paid shipping + customer-paid extra. */
export function computeTotalAmount({ itemsSubtotal, shippingCost, shippingPayer, extraExpenses, extraExpensesPayer }) {
  const itemsCents = toSubunits(itemsSubtotal);
  const shipCents = shippingPayer === 'customer' ? toSubunits(shippingCost) : 0;
  const extraCents = extraExpensesPayer === 'customer' ? toSubunits(extraExpenses) : 0;
  return fromSubunits(itemsCents + shipCents + extraCents);
}

/**
 * Down payment / remaining split. "مكتمل نهائي" auto-settles the full invoice;
 * cancelled/returned orders are always settled (remaining 0).
 */
export function computePaymentSplit({ status, totalAmount, downPayment }) {
  const totalCents = toSubunits(totalAmount);
  const dpInputCents = toSubunits(parseFloat(downPayment) || 0);
  const dpCents = (status === 'completed') ? totalCents : Math.min(totalCents, Math.max(0, dpInputCents));
  const remainingCents = (status === 'cancelled' || status === 'returned') ? 0 : Math.max(0, totalCents - dpCents);
  const dp = fromSubunits(dpCents);
  const remainingBalance = fromSubunits(remainingCents);
  const paidInFull = (dpCents === totalCents);
  return { dp, remainingBalance, paidInFull };
}


/** V3.11 — Deposit portion designated to shipping/packaging services. */
export function computeShippingRevenueDepositForOrder({ depositType, downPayment, shippingCost, extraExpenses, shippingPayer, extraExpensesPayer }) {
  return computeShippingRevenueDeposit(depositType, downPayment, shippingCost, extraExpenses, shippingPayer, extraExpensesPayer);
}
