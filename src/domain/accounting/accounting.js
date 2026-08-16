/**
 * Accounting Core — pure domain layer (100% pure: no window/document/storage).
 * Ported verbatim from js/utils/formatters.js (legacy) for the profit engine and
 * order money helpers. Data-access dependencies are INJECTED via the `deps`
 * argument (repository pattern) — see src/legacy/compat.js for adapters.
 */
import { toNumber, round2, toSubunits, fromSubunits } from '../../utils/formatters.js';

/** V3.8 — Fulfilled-status helper. */
export function isFulfilledOrderStatus(status) {
  return status === 'delivered' || status === 'completed';
}

/** V3.8 — Shared human-readable status label. */
export function getOrderStatusLabel(status) {
  switch (status) {
    case 'delivered': return 'تم التوصيل';
    case 'completed': return 'مكتمل';
    case 'returned': return 'مرتجع';
    case 'cancelled': return 'ملغي';
    case 'new':
    default: return 'قيد الانتظار';
  }
}

/** V3.16 — An order is "active" when NOT cancelled or returned. */
export function isActiveOrderStatus(status) {
  return status !== 'cancelled' && status !== 'returned';
}

/** V3.16 — Single source of truth for "المتبقي على العميل" (order-level debt). */
export function getOrderRemainingAmount(order) {
  if (!order) return 0;
  if (order.status === 'cancelled' || order.status === 'returned') return 0;
  return getOrderOutstanding(order);
}

/**
 * Outstanding debt WITHOUT the status gate — used by fulfillment/reactivation
 * paths where the order object still carries its previous (returned/cancelled)
 * status even though it is being (re)activated into an active state.
 */
export function getOrderOutstanding(order) {
  if (!order) return 0;
  const totalCents = toSubunits(order.totalAmount);
  const dpCents = toSubunits(order.downPayment);
  return fromSubunits(Math.max(0, totalCents - dpCents));
}


/**
 * Compute the portion of a down payment designated to the "إيراد خدمات شحن ونقل"
 * account. Only services the CUSTOMER actually pays for count. The designated
 * portion can never exceed the deposit actually collected.
 */
export function computeShippingRevenueDeposit(depositType, downPayment, shippingCost, extraExpenses, shippingPayer, extraExpensesPayer) {
  const dp = Math.max(0, Number(downPayment) || 0);
  if (dp <= 0) return 0;
  let services = 0;
  if (depositType === 'shipping') {
    services = shippingPayer === 'customer' ? (Number(shippingCost) || 0) : 0;
  } else if (depositType === 'shipping_extra') {
    services = (shippingPayer === 'customer' ? (Number(shippingCost) || 0) : 0)
      + (extraExpensesPayer === 'customer' ? (Number(extraExpenses) || 0) : 0);
  } else {
    return 0;
  }
  return Math.max(0, Math.min(dp, services));
}

/** Shipping & Packaging revenue recognized from an order. Status-independent. */
export function getOrderShippingRevenue(order) {
  const base = Number(order.shippingRevenueDeposit) || 0;
  if (!base) return 0;
  return Math.max(0, base - (Number(order.refundedAmount) || 0));
}

/** Retained shipping/packaging portion of a cancelled/returned deposit. */
export function getOrderRetainedShippingDeposit(order) {
  if (order.status !== 'cancelled' && order.status !== 'returned') return 0;
  const base = Number(order.shippingRevenueDeposit) || 0;
  if (!base) return 0;
  return Math.max(0, base - (Number(order.refundedAmount) || 0));
}

/**
 * V3.15 — Unified Financial Engine (Dashboard + Reports + Statements use this).
 * Single source of truth for every money figure. The computation body is a
 * VERBATIM port of the legacy window.calculateNetProfit(orders).
 *
 * @param {Array} orders
 * @param {{getExpenses?:Function, getCurrentOperatingExpenses?:Function, getSupplierReturns?:Function}} deps injected data access
 */
export function calculateNetProfit(orders, deps = {}) {
  const fulfilledOrders = orders.filter(o => isFulfilledOrderStatus(o.status));

  const itemsSales = fulfilledOrders.reduce((sum, o) => {
    const itemsSubtotal = toNumber(o.itemsSubtotal)
      || (o.items || []).reduce((s, i) => s + (toNumber(i.sellingPrice) * toNumber(i.quantity)), 0);
    return sum + itemsSubtotal;
  }, 0);

  const customerShippingTotal = fulfilledOrders.reduce((sum, o) => sum + (o.shippingPayer === 'customer' ? toNumber(o.shippingCost) : 0), 0);
  const customerExtraExpensesTotal = fulfilledOrders.reduce((sum, o) => sum + (o.extraExpensesPayer === 'customer' ? toNumber(o.extraExpenses) : 0), 0);
  const grossSales = itemsSales + customerShippingTotal + customerExtraExpensesTotal;
  const totalSales = fulfilledOrders.reduce((sum, o) => sum + toNumber(o.totalAmount), 0);

  const cogs = fulfilledOrders.reduce((totalCogs, order) => {
    const orderCogs = (order.items || []).reduce((itemSum, item) => {
      return itemSum + (toNumber(item.purchasePrice) * toNumber(item.quantity));
    }, 0);
    return totalCogs + orderCogs;
  }, 0);

  const shippedOrders = orders.filter(o => isFulfilledOrderStatus(o.status) || o.status === 'returned');

  const merchantShippingTotal = shippedOrders.reduce((sum, o) => sum + (o.shippingPayer === 'merchant' ? toNumber(o.shippingCost) : 0), 0);
  const merchantExtraExpensesTotal = shippedOrders.reduce((sum, o) => sum + (o.extraExpensesPayer === 'merchant' ? toNumber(o.extraExpenses) : 0), 0);
  const merchantExpenses = merchantShippingTotal + merchantExtraExpensesTotal;

  const expenses = deps.getExpenses ? deps.getExpenses() : [];
  const totalOpExpenses = (deps.getCurrentOperatingExpenses
    ? deps.getCurrentOperatingExpenses().total
    : expenses.reduce((sum, e) => sum + toNumber(e.amount), 0));

  const retainedDepositIncome = orders
    .filter(o => (o.status === 'cancelled' || o.status === 'returned') && typeof o.retainedDeposit === 'number')
    .reduce((sum, o) => sum + (Math.max(0, toNumber(o.retainedDeposit)) - getOrderRetainedShippingDeposit(o)), 0);

  const shippingRevenueIncome = orders.reduce((sum, o) => sum + getOrderShippingRevenue(o), 0);

  const grossProfit = grossSales - cogs - merchantExpenses;

  // V3.54 — مردودات الموردين النقدية = كاش استُلم فعلياً (حقل cashRefund =
  // الفائض فوق المديونية عند اختيار الاسترداد النقدي). للسجلات القديمة التي
  // لا تحمل الحقل يُحسب كامل قيمة المرتجع النقدي كما كانت عليه سابقاً.
  // المهم: هذا المبلغ واردُ خزينة لا يُضاف إلى صافي الربح إطلاقاً — إرجاع
  // البضاعة لا يولّد دخلاً، والكاش المقبوض يُحصّله النظام في حساب الخزينة.
  const supplierCashRefunds = (deps.getSupplierReturns ? deps.getSupplierReturns() : [])
    .reduce((sum, r) => sum + toNumber(r.cashRefund != null ? r.cashRefund : (r.refundType === 'cash' ? r.totalValue : 0)), 0);

  const netProfit = (itemsSales - cogs) - merchantExpenses - totalOpExpenses + retainedDepositIncome;

  return {
    totalSales: round2(totalSales),
    grossSales: round2(grossSales),
    itemsSales: round2(itemsSales),
    customerShippingTotal: round2(customerShippingTotal),
    customerExtraExpensesTotal: round2(customerExtraExpensesTotal),
    cogs: round2(cogs),
    merchantShippingTotal: round2(merchantShippingTotal),
    merchantExtraExpensesTotal: round2(merchantExtraExpensesTotal),
    merchantExpenses: round2(merchantExpenses),
    grossProfit: round2(grossProfit),
    totalOpExpenses: round2(totalOpExpenses),
    retainedDepositIncome: round2(retainedDepositIncome),
    shippingRevenueIncome: round2(shippingRevenueIncome),
    supplierCashRefunds: round2(supplierCashRefunds),
    netProfit: round2(netProfit)
  };
}
