/**
 * Analytics Engine — pure domain layer for the Analytics dashboard.
 * 100% pure: no window/document/storage. All money math uses the shared
 * subunits (piastres) helpers for exact, rounding-safe aggregation.
 */
import { toNumber, round2, toSubunits, fromSubunits } from '../../utils/formatters.js';
import { isFulfilledOrderStatus, isActiveOrderStatus, getOrderRemainingAmount } from '../accounting/accounting.js';

/** V4 — Execution-type classifier per order. */
export function getOrderExecType(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return 'stock';
  let direct = 0;
  items.forEach((it) => { if (it.isDirectShip) direct += 1; });
  if (direct === items.length) return 'direct';
  if (direct === 0) return 'stock';
  return 'mixed';
}

/** V4 — Items gross sales for an order (sellingPrice × quantity). */
export function orderItemsSales(order) {
  return (order?.items || []).reduce((s, i) => s + (toNumber(i.sellingPrice) * toNumber(i.quantity)), 0);
}

/** V4 — Items cost of goods sold (purchasePrice × quantity). */
export function orderItemsCogs(order) {
  return (order?.items || []).reduce((s, i) => s + (toNumber(i.purchasePrice) * toNumber(i.quantity)), 0);
}

/** V4 — Merchant-paid shipping/extra expenses (what the shop bears). */
export function orderMerchantExpenses(order) {
  return (order.shippingPayer === 'merchant' ? toNumber(order.shippingCost) : 0)
    + (order.extraExpensesPayer === 'merchant' ? toNumber(order.extraExpenses) : 0);
}

/** V4 — Gross items profit of a fulfilled order (before operating expenses). */
export function orderItemsProfit(order) {
  return orderItemsSales(order) - orderItemsCogs(order) - orderMerchantExpenses(order);
}

/** V4 — Local (non-UTC) day key YYYY-MM-DD. */
function pad2(n) { return String(n).padStart(2, '0'); }
export function toDayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
export function toMonthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** V4 — Normalise an order's createdAt/updatedAt to a day key ('' when missing). */
export function orderDayKey(order) {
  return String(order?.createdAt || order?.updatedAt || '').slice(0, 10);
}

/** V4 — Apply the dynamic filter bag to an order list. */
export function applyAnalyticsFilters(orders, filters = {}) {
  const f = filters || {};
  return (orders || []).filter((o) => {
    if (f.from && orderDayKey(o) < f.from) return false;
    if (f.to && orderDayKey(o) > f.to) return false;
    if (f.customerId && o.customerId !== f.customerId) return false;
    if (f.category && o.customerCategory !== f.category) return false;
    if (f.cashier && o.createdBy !== f.cashier) return false;
    if (f.execution && getOrderExecType(o) !== f.execution) return false;
    if (f.status && o.status !== f.status) return false;
    return true;
  });
}

/** V4 — Contiguous list of day/month keys between from..to (inclusive). */
export function buildDateBuckets(from, to, granularity = 'day') {
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T00:00:00`) : null;
  if (!start || !end || isNaN(start) || isNaN(end) || start > end) return [];
  const g = granularity === 'month' ? 'month' : 'day';
  const buckets = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (g === 'month') cur.setDate(1);
  let guard = 0;
  while (cur <= end && guard < 2000) {
    buckets.push(g === 'month' ? toMonthKey(cur) : toDayKey(cur));
    if (g === 'month') cur.setMonth(cur.getMonth() + 1);
    else cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return buckets;
}

/** V4 — Default period presets -> {from, to} range. */
export function resolveRange(period = '30d') {
  const now = new Date();
  const today = toDayKey(now);
  if (period === 'today') return { from: today, to: today };
  if (period === '7d') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    s.setDate(s.getDate() - 6);
    return { from: toDayKey(s), to: today };
  }
  if (period === 'month') {
    return { from: toDayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  return { from: toDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to: today };
}

/** V4 — Pick a sensible chart granularity from a range length. */
export function granularityForRange(from, to) {
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T00:00:00`) : null;
  if (!start || !end || isNaN(start) || isNaN(end)) return 'day';
  const days = Math.round((end - start) / 86400000) + 1;
  return days > 45 ? 'month' : 'day';
}

/** V4 — KPI summary for the filtered order set. */
export function computeAnalyticsKPIs(orders, filters) {
  const filtered = applyAnalyticsFilters(orders, filters);
  const fulfilled = filtered.filter((o) => isFulfilledOrderStatus(o.status));
  const active = filtered.filter((o) => isActiveOrderStatus(o.status));

  const totalSales = fulfilled.reduce((s, o) => s + toSubunits(o.totalAmount), 0);
  const itemsSales = fulfilled.reduce((s, o) => s + toSubunits(orderItemsSales(o)), 0);
  const cogs = fulfilled.reduce((s, o) => s + toSubunits(orderItemsCogs(o)), 0);
  const merchant = fulfilled.reduce((s, o) => s + toSubunits(orderMerchantExpenses(o)), 0);
  const grossProfit = itemsSales - cogs - merchant;
  const receivables = active.reduce((s, o) => s + toSubunits(getOrderRemainingAmount(o)), 0);
  const uncollected = active.reduce((s, o) => s + toSubunits(o.totalAmount - (o.paidInFull ? o.totalAmount : o.downPayment || 0)), 0);

  const count = fulfilled.length;
  const salesVal = fromSubunits(totalSales);
  const profitVal = fromSubunits(grossProfit);
  return {
    totalSales: round2(salesVal),
    orderCount: count,
    avgOrderValue: count ? round2(salesVal / count) : 0,
    grossProfit: round2(profitVal),
    profitMargin: salesVal > 0 ? round2((profitVal / salesVal) * 100) : 0,
    receivables: round2(fromSubunits(receivables)),
    uncollected: round2(fromSubunits(uncollected)),
  };
}

/** V4 — Sales & profit trend across the range, one row per day/month bucket. */
export function computeSalesTrend(orders, filters, granularity = 'day') {
  const filtered = applyAnalyticsFilters(orders, filters);
  const g = granularity === 'month' ? 'month' : 'day';
  const buckets = buildDateBuckets(filters?.from, filters?.to, g);
  const map = new Map();
  filtered.forEach((o) => {
    const k = g === 'month' ? orderDayKey(o).slice(0, 7) : orderDayKey(o);
    if (!k || !buckets.includes(k)) return;
    const rec = map.get(k) || { sales: 0, profit: 0, orders: 0 };
    rec.sales += toSubunits(o.totalAmount);
    if (isFulfilledOrderStatus(o.status)) rec.profit += toSubunits(orderItemsProfit(o));
    rec.orders += 1;
    map.set(k, rec);
  });
  return buckets.map((k) => {
    const rec = map.get(k) || { sales: 0, profit: 0, orders: 0 };
    return {
      key: k,
      label: g === 'month' ? k : k.slice(5),
      sales: round2(fromSubunits(rec.sales)),
      profit: round2(fromSubunits(rec.profit)),
      orders: rec.orders,
    };
  });
}

/** V4 — Equal-length window immediately before the given range (calendar-day safe). */
export function previousPeriodRange(from, to) {
  if (!from || !to || from > to) return null;
  const days = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
  const prevEnd = shiftDayKey(from, -1);
  const prevStart = shiftDayKey(from, -days);
  return { from: prevStart, to: prevEnd };
}

/** V4 — Shift a YYYY-MM-DD key by whole days (DST-proof via calendar day arithmetic). */
export function shiftDayKey(key, delta) {
  const d = new Date(`${key}T00:00:00`);
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + delta);
  return toDayKey(d);
}

/** V4 — Current vs previous-period sales with growth %. */
export function computePeriodGrowth(orders, filters) {
  const { from, to } = filters || {};
  if (!from || !to) return null;
  const prev = previousPeriodRange(from, to);
  if (!prev) return null;
  const filtered = applyAnalyticsFilters(orders, { ...filters, from: null, to: null });
  let cur = 0;
  let prv = 0;
  filtered.forEach((o) => {
    const d = orderDayKey(o);
    if (d >= from && d <= to) cur += toSubunits(o.totalAmount);
    else if (d >= prev.from && d <= prev.to) prv += toSubunits(o.totalAmount);
  });
  const curV = fromSubunits(cur);
  const prvV = fromSubunits(prv);
  const growthPct = prvV > 0 ? round2(((curV - prvV) / prvV) * 100) : (curV > 0 ? 100 : 0);
  return { current: round2(curV), previous: round2(prvV), growthPct };
}

/** V4 — Best-selling products by revenue (fulfilled orders only). */
export function computeTopProducts(orders, filters, limit = 10) {
  const filtered = applyAnalyticsFilters(orders, filters).filter((o) => isFulfilledOrderStatus(o.status));
  const map = new Map();
  filtered.forEach((o) => {
    (o.items || []).forEach((it) => {
      const name = it.productName || 'منتج غير مسجل';
      const rec = map.get(name) || { name, qty: 0, revenue: 0, profit: 0 };
      const qty = toNumber(it.quantity);
      rec.qty += qty;
      rec.revenue += toSubunits(toNumber(it.sellingPrice) * qty);
      rec.profit += toSubunits((toNumber(it.sellingPrice) - toNumber(it.purchasePrice)) * qty);
      map.set(name, rec);
    });
  });
  return Array.from(map.values())
    .map((r) => ({ ...r, revenue: round2(fromSubunits(r.revenue)), profit: round2(fromSubunits(r.profit)) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** V4 — Top customers by fulfilled sales. */
export function computeTopCustomers(orders, filters, limit = 10) {
  const filtered = applyAnalyticsFilters(orders, filters).filter((o) => isFulfilledOrderStatus(o.status));
  const map = new Map();
  filtered.forEach((o) => {
    const name = o.customerName || 'عميل';
    const rec = map.get(name) || { name, sales: 0, profit: 0, orders: 0 };
    rec.sales += toSubunits(o.totalAmount);
    rec.profit += toSubunits(orderItemsProfit(o));
    rec.orders += 1;
    map.set(name, rec);
  });
  return Array.from(map.values())
    .map((r) => ({ ...r, sales: round2(fromSubunits(r.sales)), profit: round2(fromSubunits(r.profit)) }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

/** V4 — Top debtors by remaining balance (active orders only). */
export function computeTopDebtors(orders, filters, limit = 10) {
  const filtered = applyAnalyticsFilters(orders, filters).filter((o) => isActiveOrderStatus(o.status));
  const map = new Map();
  filtered.forEach((o) => {
    const name = o.customerName || 'عميل';
    const rec = map.get(name) || { name, remaining: 0, orders: 0 };
    rec.remaining += toSubunits(getOrderRemainingAmount(o));
    rec.orders += 1;
    map.set(name, rec);
  });
  return Array.from(map.values())
    .map((r) => ({ ...r, remaining: round2(fromSubunits(r.remaining)) }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, limit);
}

/** V4 — Sales share per customer category (for the donut). */
export function computeCategoryMix(orders, filters) {
  const filtered = applyAnalyticsFilters(orders, filters).filter((o) => isFulfilledOrderStatus(o.status));
  const map = new Map();
  filtered.forEach((o) => {
    const c = o.customerCategory || 'غير مصنف';
    map.set(c, (map.get(c) || 0) + toSubunits(o.totalAmount));
  });
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, value: round2(fromSubunits(v)) }))
    .sort((a, b) => b.value - a.value);
}

/** V4 — Distinct values for the filter dropdowns. */
export function collectFilterOptions(orders) {
  const customers = new Map();
  const categories = new Set();
  const cashiers = new Set();
  (orders || []).forEach((o) => {
    if (o.customerId) customers.set(o.customerId, o.customerName || o.customerId);
    if (o.customerCategory) categories.add(o.customerCategory);
    if (o.createdBy) cashiers.add(o.createdBy);
  });
  return {
    customers: Array.from(customers.entries()).map(([id, name]) => ({ id, name })),
    categories: Array.from(categories).sort(),
    cashiers: Array.from(cashiers).sort(),
  };
}
