/**
 * Products & Stock domain — pure core + injected repository (100% pure).
 * Ported VERBATIM from js/services/products.js (legacy).
 */
import { round2, generateAutoId, formatCurrency, increment } from '../../utils/formatters.js';
import { getCairoFormattedDate } from '../../utils/formatters.js';
import { getSupplierById } from '../suppliers/suppliers.js';

/* ===================== pure query helpers ===================== */

export function getProducts(list) {
  return list;
}

export function getProductById(products, id) {
  return products.find(p => p.id === id || p.code === id) || null;
}

export function findDuplicateProduct(products, { name, code, excludeId = '' }) {
  const cleanName = (name || '').trim().toLowerCase();
  const cleanCode = (code || '').trim().toLowerCase();
  return products.find(p =>
    p.id !== excludeId && (
      (cleanName && p.name && p.name.trim().toLowerCase() === cleanName) ||
      (cleanCode && p.code && p.code.trim().toLowerCase() === cleanCode)
    )
  ) || null;
}

export function searchProducts(products, query) {
  if (!query) return products;
  const q = query.trim().toLowerCase();
  return products.filter(p =>
    (p.name && p.name.toLowerCase().includes(q)) ||
    (p.code && p.code.toLowerCase().includes(q)) ||
    (p.id && p.id.toLowerCase().includes(q)) ||
    (p.category && p.category.toLowerCase().includes(q)) ||
    (p.supplierName && p.supplierName.toLowerCase().includes(q))
  );
}

export function getLowStockProducts(products) {
  return products.filter(p => {
    const minStock = Number(p.minStock);
    const threshold = (!isNaN(minStock) && minStock >= 0) ? minStock : 5;
    return Number(p.stock) <= threshold;
  });
}

/* ===================== orchestration ===================== */

export function createProduct({ code, name, category, purchasePrice, sellingPrice, stock, minStock, supplierId = '', supplierName = '', entryDate = null }, repo) {
  const numPurchasePrice = Number(purchasePrice) || 0;
  const numSellingPrice = Number(sellingPrice) || 0;
  if (numPurchasePrice < 0 || numSellingPrice < 0) {
    throw new Error('لا يمكن تسجيل أسعار سالبة للمنتج');
  }

  // V3.58 — Initial stock: ''/null/undefined ⇒ 0, but any negative or
  // non-finite value is rejected (the old `|| 0` silently accepted negatives).
  const rawStock = (stock === '' || stock === undefined || stock === null) ? 0 : Number(stock);
  if (isNaN(rawStock) || !isFinite(rawStock) || rawStock < 0) {
    throw new Error('يرجى إدخال قيمة مخزون أولي صحيحة (غير سالبة)');
  }
  const numStock = rawStock;

  // V3.58 — minStock: 0 is a legitimate "disable alert" value. The old
  // `Number(minStock) || 5` coerced 0 → 5, so the low-stock alert could never
  // be switched off. Only a missing/empty value falls back to the default 5.
  const rawMinStock = (minStock === '' || minStock === undefined || minStock === null) ? 5 : Number(minStock);
  const numMinStock = (isNaN(rawMinStock) || !isFinite(rawMinStock)) ? 0 : Math.max(0, rawMinStock);

  if (findDuplicateProduct(repo.getProducts(), { name, code })) {
    throw new Error('يوجد منتج مسجل بالفعل بنفس الاسم أو الكود (SKU) — اختر اسماً أو كوداً مختلفاً');
  }

  const productId = generateAutoId('PRD');
  const now = getCairoFormattedDate();

  const newProduct = {
    id: productId,
    code: code ? code.trim() : productId,
    name: (name || '').trim(),
    category: category ? category.trim() : 'عام',
    purchasePrice: numPurchasePrice,
    sellingPrice: numSellingPrice,
    stock: numStock,
    minStock: numMinStock,
    supplierId,
    supplierName,
    entryDate: (entryDate || now.slice(0, 10)),
    createdAt: now,
    updatedAt: now
  };

  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;

  // Add Product to Cloud Firestore
  if (batch) {
    batch.add(repo.storageKeys.PRODUCTS, newProduct);
  } else {
    repo.addFirestoreDoc(repo.storageKeys.PRODUCTS, newProduct);
  }

  // If supplier provided with stock > 0, accumulate supplier debt
  if (supplierId && numStock > 0 && newProduct.purchasePrice > 0) {
    const totalCost = round2(numStock * newProduct.purchasePrice);
    const supplier = getSupplierById(repo.getSuppliers(), supplierId);
    if (supplier) {
      const supplierPayload = {
        totalPurchases: increment(totalCost),
        remainingBalance: increment(totalCost)
      };

      if (batch) {
        batch.update(repo.storageKeys.SUPPLIERS, supplierId, supplierPayload);
        batch.add(repo.storageKeys.SUPPLIER_TRANSACTIONS, {
          id: generateAutoId('SUPLOG'),
          supplierId,
          supplierName: supplier.name,
          type: 'تسجيل منتج ومخزون',
          refId: productId,
          debit: totalCost,
          credit: 0,
          note: `إضافة منتج "${newProduct.name}" للمخزون (${numStock} قطعة × ${newProduct.purchasePrice})`,
          createdAt: now
        });
      } else {
        repo.updateSupplier(supplierId, supplierPayload);
        if (repo.logSupplierTransaction) {
          repo.logSupplierTransaction({
            supplierId,
            supplierName: supplier.name,
            type: 'تسجيل منتج ومخزون',
            refId: productId,
            debit: totalCost,
            note: `إضافة منتج "${newProduct.name}" للمخزون (${numStock} قطعة × ${newProduct.purchasePrice})`,
            date: now
          });
        }
      }
    }
  }

  if (batch) batch.commit();

  return newProduct;
}

export function updateProduct(id, data, repo) {
  if (findDuplicateProduct(repo.getProducts(), { name: data.name, code: data.code, excludeId: id })) {
    throw new Error('يوجد منتج مسجل بالفعل بنفس الاسم أو الكود (SKU)');
  }
  repo.updateFirestoreDoc(repo.storageKeys.PRODUCTS, id, {
    ...data,
    updatedAt: getCairoFormattedDate()
  });
}

export async function deleteProduct(id, repo) {
  const product = getProductById(repo.getProducts(), id);
  if (!product) return false;

  // V3.58 — Protect financial integrity: never delete a product that still
  // holds stock or appears in any open (non-settled) order.
  if ((Number(product.stock) || 0) > 0) {
    throw new Error('لا يمكن حذف منتج يمتلك رصيد مخزون متبقي — صفّر المخزون أو اعكس الشحنات أولاً');
  }
  const openOrders = (repo.getOrders ? repo.getOrders() : []).filter(o =>
    o.status !== 'cancelled' && o.status !== 'returned' &&
    (o.items || []).some(i => i && i.productId === id)
  );
  if (openOrders.length > 0) {
    throw new Error('لا يمكن حذف منتج مفتوح عليه طلبات قائمة — أغلق أو أرجِع الطلبات المرتبطة به أولاً');
  }

  return repo.deleteFirestoreDoc(repo.storageKeys.PRODUCTS, id);
}

/**
 * Consume available stock for a sale, clamping stock at 0 (never negative).
 * V3.57 — the stock write emits an `increment(-consumedQty)` marker so a single
 * atomic WriteBatch (createOrder / updateOrderStatus / createSupplierReturn)
 * applies it server-side as FieldValue.increment — no read-modify-write race.
 */
export function decrementProductStock(productId, qty, repo) {
  const product = getProductById(repo.getProducts(), productId);
  if (!product) return { consumedQty: 0, deficitQty: Number(qty) || 0 };

  const currentStock = Number(product.stock) || 0;
  const requestedQty = Number(qty) || 0;
  const consumedQty = Math.min(currentStock, requestedQty);
  const newStock = currentStock - consumedQty;
  const deficitQty = requestedQty - consumedQty;

  repo.updateFirestoreDoc(repo.storageKeys.PRODUCTS, productId, {
    stock: increment(-consumedQty),
    updatedAt: getCairoFormattedDate()
  });

  return { consumedQty, deficitQty };
}

export function incrementProductStock(productId, qty, repo) {
  const product = getProductById(repo.getProducts(), productId);
  if (!product) return;

  repo.updateFirestoreDoc(repo.storageKeys.PRODUCTS, productId, {
    stock: increment(Number(qty) || 0),
    updatedAt: getCairoFormattedDate()
  });
}

/**
 * Add Stock Supply Shipment & Update Supplier Debt
 *
 * F3 — Shipment logistics costs (شحن + نسريات/مستلزمات) are NOT added to the
 * supplier's debt; instead they are distributed into COGS, raising the product's
 * weighted-average cost per unit.
 */
export function addStockShipment(productId, addedQty, supplierId = '', unitPurchasePrice = 0, notes = '', extras = {}, repo, shipmentDate = null) {
  const product = getProductById(repo.getProducts(), productId);
  if (!product) throw new Error('المنتج غير موجود');

  const qty = Number(addedQty);
  if (isNaN(qty) || qty <= 0) throw new Error('يرجى إدخال كمية شحنة صحيحة أكبر من الصفر');

  const currentStock = Number(product.stock) || 0;
  const newStock = currentStock + qty;

  const shipCost = round2(Number(extras && extras.shippingCost) || 0);
  const suppliesCost = round2(Number(extras && extras.suppliesCost) || 0);
  const extrasTotal = round2(shipCost + suppliesCost);
  if (extrasTotal < 0) throw new Error('قيمة مصاريف الشحن/النسريات غير صالحة');

  const updatePayload = {
    stock: newStock,
    updatedAt: getCairoFormattedDate()
  };

  const purPrice = Number(unitPurchasePrice);
  const oldPurchasePrice = Number(product.purchasePrice) || 0;

  // F3 — COGS split: new unit cost = weighted average of (old stock cost +
  // goods cost + shipment logistics costs) across the new total stock.
  if ((!isNaN(purPrice) && purPrice >= 0) || extrasTotal > 0) {
    const goodsCost = (purPrice > 0 ? purPrice : oldPurchasePrice) * qty;
    const totalCost = (currentStock * oldPurchasePrice) + goodsCost + extrasTotal;
    updatePayload.purchasePrice = newStock > 0 ? round2(totalCost / newStock) : 0;
  }
  if (extrasTotal > 0) {
    updatePayload.shipmentExtrasTotal = round2((Number(product.shipmentExtrasTotal) || 0) + extrasTotal);
    updatePayload.lastShipmentExtras = { shippingCost: shipCost, suppliesCost, total: extrasTotal, date: getCairoFormattedDate() };
  }

  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;

  if (batch) {
    batch.update(repo.storageKeys.PRODUCTS, productId, updatePayload);
  } else {
    repo.updateFirestoreDoc(repo.storageKeys.PRODUCTS, productId, updatePayload);
  }

  // 📦 Accumulate Supplier Debt if Supplier selected — goods value ONLY
  if (supplierId) {
    const costPerUnit = purPrice > 0 ? purPrice : oldPurchasePrice;
    const totalShipmentCost = round2(qty * costPerUnit);

    const supplier = getSupplierById(repo.getSuppliers(), supplierId);
    if (supplier && totalShipmentCost > 0) {
      const supplierPayload = {
        totalPurchases: increment(totalShipmentCost),
        remainingBalance: increment(totalShipmentCost)
      };

      const extrasNote = extrasTotal > 0
        ? ` + مصاريف شحن/نسريات ${formatCurrency(extrasTotal)} موزعة على تكلفة القطعة (لا تُضاف لمديونية المورد)`
        : '';
      const noteText = (notes || '').trim() || `توريد شحنة "${product.name}" (${qty} قطعة × ${formatCurrency(costPerUnit)}) للمخزن${extrasNote}`;

      if (batch) {
        batch.update(repo.storageKeys.SUPPLIERS, supplierId, supplierPayload);
        batch.add(repo.storageKeys.SUPPLIER_TRANSACTIONS, {
          id: generateAutoId('SUPLOG'),
          supplierId,
          supplierName: supplier.name,
          type: 'شحنة توريد',
          refId: product.id,
          productName: product.name,
          qty: qty,
          unitCost: costPerUnit,
          debit: totalShipmentCost,
          credit: 0,
          note: noteText,
          shipmentDate: shipmentDate || getCairoFormattedDate().slice(0, 10),
          createdAt: getCairoFormattedDate()
        });
      } else {
        repo.updateSupplier(supplierId, supplierPayload);
        if (repo.logSupplierTransaction) {
          repo.logSupplierTransaction({
            supplierId,
            supplierName: supplier.name,
            type: 'شحنة توريد',
            refId: product.id,
            productName: product.name,
            qty: qty,
            unitCost: costPerUnit,
            debit: totalShipmentCost,
            note: noteText,
            shipmentDate: shipmentDate || getCairoFormattedDate().slice(0, 10),
            date: getCairoFormattedDate()
          });
        }
      }
    }
  }

  if (batch) batch.commit();
}

/** استخراج الكمية وسعر الوحدة من نص بيان شحنة قديمة (لقيود لم تُحفظ فيها الحقول). */
function parseShipmentNote(note) {
  const s = String(note || '').replace(/,/g, '');
  const m = /\((\d+(?:\.\d+)?)\s*قطعة\s*×\s*(\d+(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  return { qty: Number(m[1]), unitCost: Number(m[2]) };
}

/**
 * Edit an existing stock supply shipment (admin-only correction) — V3.70.
 *
 * Corrects a shipment that was recorded with the wrong quantity and/or unit
 * price. Adjusts, in one atomic write:
 *   • product stock         (+ qtyDelta)
 *   • supplier debt         (+ valueDelta on totalPurchases & remainingBalance)
 *   • weighted-average cost (re-blended from the current embedded stock value)
 * and updates the original ledger entry (supplier transaction) in place with an
 * audit note — so no fake debt is left on the supplier and history is preserved.
 *
 * @param {string} txnId   SUPPLIER_TRANSACTIONS doc id (SUPLOG…)
 * @param {{qty:number, unitCost:number, notes?:string}} changes
 * @param {object} repo    injected repository
 * @param {string} editedBy display name for the audit trail
 */
export function editStockShipment(txnId, changes, repo, editedBy = '') {
  const txns = repo.getSupplierTransactions ? repo.getSupplierTransactions() : [];
  const txn = txns.find(t => t.id === txnId);
  if (!txn) throw new Error('لم يتم العثور على قيد الشحنة المطلوبة');
  if (txn.type !== 'شحنة توريد' && txn.type !== 'تسجيل منتج ومخزون') {
    throw new Error('هذا القيد ليس شحنة توريد قابلة للتعديل');
  }

  const product = getProductById(repo.getProducts(), txn.refId);
  if (!product) throw new Error('المنتج المرتبط بالشحنة غير موجود');

  const newQty = Number(changes && changes.qty);
  if (isNaN(newQty) || newQty <= 0) throw new Error('يرجى إدخال كمية صحيحة أكبر من الصفر');
  const newUnitCost = Number(changes && changes.unitCost);
  if (isNaN(newUnitCost) || newUnitCost < 0) throw new Error('يرجى إدخال سعر شراء صحيح (0 أو أكثر)');

  // Old quantity/unit cost: prefer explicit fields, else parse the note text.
  let oldQty = Number.isFinite(Number(txn.qty)) && Number(txn.qty) > 0 ? Number(txn.qty) : null;
  let oldUnitCost = Number.isFinite(Number(txn.unitCost)) && Number(txn.unitCost) >= 0 ? Number(txn.unitCost) : null;
  if (oldQty === null || oldUnitCost === null) {
    const parsed = parseShipmentNote(txn.note);
    if (oldQty === null && parsed) oldQty = parsed.qty;
    if (oldUnitCost === null && parsed) oldUnitCost = parsed.unitCost;
  }
  const oldDebit = round2(Number(txn.debit) || 0);
  if (oldQty === null || !(oldQty > 0)) {
    throw new Error('تعذّر تحديد الكمية الأصلية لهذه الشحنة القديمة تلقائياً — استخدم «مرتجع مشتريات» للتصحيح بدلاً من التعديل');
  }
  if (oldUnitCost === null) oldUnitCost = round2(oldDebit / oldQty);

  const oldGoodsValue = round2(oldQty * oldUnitCost);
  const deltaQty = newQty - oldQty;

  const currentStock = Number(product.stock) || 0;
  const newStock = currentStock + deltaQty;
  if (newStock < 0) {
    throw new Error(`لا يمكن تعديل الشحنة: المخزون الناتج سالب (${newStock}) لأن جزءاً من البضاعة تم بيعه أو صرفه بالفعل`);
  }

  const newDebit = round2(newQty * newUnitCost);
  const debtDelta = round2(newDebit - oldDebit);

  const oldPrice = Number(product.purchasePrice) || 0;
  const totalCost = (currentStock * oldPrice) - oldGoodsValue + newDebit;
  const newAvg = newStock > 0 ? Math.max(0, round2(totalCost / newStock)) : 0;

  const stamp = getCairoFormattedDate();
  const baseNote = (changes && typeof changes.notes === 'string') ? changes.notes.trim() : (txn.note || '').trim();
  const auditNote = `${baseNote} — [تعديل ${stamp}${editedBy ? ' بواسطة ' + editedBy : ''}: كمية ${oldQty}→${newQty}، سعر ${oldUnitCost}→${newUnitCost}]`.trim();

  const txnPayload = { qty: newQty, unitCost: newUnitCost, debit: newDebit, note: auditNote, updatedAt: stamp };
  if (changes && changes.shipmentDate) {
    txnPayload.shipmentDate = String(changes.shipmentDate).slice(0, 10);
  } else if (txn.shipmentDate) {
    txnPayload.shipmentDate = txn.shipmentDate;
  }
  const supplierPayload = txn.supplierId
    ? { totalPurchases: increment(debtDelta), remainingBalance: increment(debtDelta) }
    : null;

  const batch = (typeof repo.createWriteBatch === 'function') ? repo.createWriteBatch() : null;
  if (batch) {
    batch.update(repo.storageKeys.PRODUCTS, product.id, { stock: newStock, purchasePrice: newAvg, updatedAt: stamp });
    batch.update(repo.storageKeys.SUPPLIER_TRANSACTIONS, txn.id, txnPayload);
    if (supplierPayload) batch.update(repo.storageKeys.SUPPLIERS, txn.supplierId, supplierPayload);
    batch.commit();
  } else {
    repo.updateFirestoreDoc(repo.storageKeys.PRODUCTS, product.id, { stock: newStock, purchasePrice: newAvg, updatedAt: stamp });
    repo.updateFirestoreDoc(repo.storageKeys.SUPPLIER_TRANSACTIONS, txn.id, txnPayload);
    if (supplierPayload) repo.updateSupplier(txn.supplierId, supplierPayload);
  }

  return { productId: product.id, oldQty, newQty, oldUnitCost, newUnitCost, debtDelta, newAvg, newStock };
}

