/**
 * Order State Machine — pure domain layer (100% pure).
 * Ported verbatim from js/services/orders.js (legacy): the transition matrix and
 * the status predicates/labels. No window/document/storage access.
 */

/**
 * V3.15.2 — Order Status State Machine (مصفوفة حالات الطلب).
 * Only these transitions are allowed when updating an order's status:
 *   new       → delivered, completed, cancelled     (قيد الانتظار → أي حالة لاحقة)
 *   delivered → completed, returned                 (تم التوصيل → تسوية أو مرتجع)
 *   completed → returned                            (مكتمل → مرتجع فقط)
 *   returned  → new, delivered                      (مرتجع → إعادة تفعيل أو إعادة شحن)
 *   cancelled → new                                 (ملغي → إعادة تفعيل فقط)
 */
export const ORDER_STATUS_TRANSITIONS = {
  new: ['delivered', 'completed', 'cancelled'],
  delivered: ['completed', 'returned'],
  completed: ['returned'],
  returned: ['new', 'delivered'],
  cancelled: ['new']
};

/** V3.15.2 — Pure matrix check used by updateOrderStatus before any write. */
export function canTransition(oldStatus, newStatus) {
  return (ORDER_STATUS_TRANSITIONS[oldStatus] || []).includes(newStatus);
}

export function getAllowedTransitions(status) {
  return (ORDER_STATUS_TRANSITIONS[status] || []).slice();
}

/** V3.8 — Fulfilled-status helper. */
export function isFulfilledOrderStatus(status) {
  return status === 'delivered' || status === 'completed';
}

/** V3.16 — An order is "active" when NOT cancelled or returned. */
export function isActiveOrderStatus(status) {
  return status !== 'cancelled' && status !== 'returned';
}

/**
 * V3.59 — Per-line shipping mode. Each item can ship directly from its
 * supplier (`isDirectShip`) or from warehouse stock. `order.directShipping`
 * remains the legacy "all direct" fallback for orders recorded before the
 * per-line flag existed (i.e. lines without an explicit boolean flag).
 */
export function isDirectShipItem(item, order) {
  if (!item) return false;
  if (typeof item.isDirectShip === 'boolean') return item.isDirectShip;
  return !!order && !!order.directShipping;
}

export function getDirectShipSummary(order) {
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  const directCount = items.filter(i => isDirectShipItem(i, order)).length;
  const total = items.length;
  return {
    directCount,
    total,
    all: total > 0 && directCount === total,
    none: directCount === 0,
    mixed: directCount > 0 && directCount < total,
  };
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
