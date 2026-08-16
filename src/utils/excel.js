/**
 * Excel Export utility using SheetJS (xlsx) — → React (Phase 2 port)
 * ==================================================================
 * Faithful ES-module port of js/utils/excel.js: single-table exports plus the
 * full 5-sheet unified workbook export. Pure module — reads `window.XLSX` and
 * the live data-access helpers at call time, exactly like the legacy script.
 */

import { getCairoFormattedDate, labelWithCurrency } from './formatters.js';
import { getDirectShipSummary } from '../domain/orders/orderMachine.js';

// V3.51 — SheetJS كانت حزمة مثبتة (package.json) لكنها لا تُستورد أبداً، فكان
// window.XLSX undefined وزر التصدير يفشل صامتاً. الآن تُحمَّل ديناميكياً عند
// أول تصدير فقط (تتحول لقطعة chunk منفصلة خارج الحزمة الأولى) ويُحتفظ بها
// في window.XLSX كي تستفيد منها أي مسارات أخرى بنفس شكل الجسر القديم.
export async function ensureXLSX() {
  if (window.XLSX) return window.XLSX;
  try {
    const mod = await import('xlsx');
    window.XLSX = mod;
    return mod;
  } catch (e) {
    console.error('Failed to load SheetJS:', e);
    return null;
  }
}

export async function exportToExcel(dataArray, filename = 'report.xlsx', sheetName = 'التقرير') {
  if (!(await ensureXLSX())) {
    console.error('SheetJS library is not loaded');
    alert('تعذر تحميل مكتبة التصدير إلى Excel');
    return;
  }

  try {
    const worksheet = window.XLSX.utils.json_to_sheet(dataArray);

    if (!worksheet['!views']) worksheet['!views'] = [];
    worksheet['!views'].push({ RTL: true });

    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    window.XLSX.writeFile(workbook, filename);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('حدث خطأ أثناء تصدير ملف Excel');
  }
}

export async function exportTableToExcel(tableId, filename = 'table_export.xlsx') {
  if (!(await ensureXLSX())) {
    console.error('SheetJS library is not loaded');
    return;
  }

  const table = document.getElementById(tableId);
  if (!table) return;

  const workbook = window.XLSX.utils.table_to_book(table, { sheet: 'التقرير' });
  window.XLSX.writeFile(workbook, filename);
}

/**
 * Full Database Export into a Single Unified Excel Workbook with 5 Worksheets
 */
export async function exportFullDatabaseToExcel() {
  if (!(await ensureXLSX())) {
    alert('مكتبة SheetJS غير محملة');
    return;
  }

  try {
    const workbook = window.XLSX.utils.book_new();
    const todayStr = getCairoFormattedDate().slice(0, 10);

    // 1. Sheet: Orders & Sales (المبيعات والفواتير)
    const orders = window.getOrders();
    const ordersData = orders.map(o => ({
      'رقم الفاتورة': o.id,
      'اسم العميل': o.customerName,
      'رقم الهاتف': o.customerPhone,
      'الهاتف الثانوي': o.customerSecondaryPhone || '',
      'تصنيف العميل': o.customerCategory || '',
      // V3.26 — dedicated columns so the shipping address chosen for this order
      // and the customer's full address list are exported (never lost).
      'عنوان الشحن لهذا الطلب': o.shippingAddress || '—',
      'اسم عنوان الشحن': o.shippingAddressLabel || '',
      'معرّف عنوان الشحن': o.shippingAddressId || '',
      'عناوين العميل (قائمة)': (window.getCustomerAddresses ? window.getCustomerAddresses(o.customerId).map(a => (a.label ? a.label + ': ' : '') + a.address).join(' | ') : (o.customerAddresses || '')),
      'نوع التنفيذ': (() => {
        const ship = getDirectShipSummary(o);
        return ship.all ? 'شحن مباشر من المورد' : ship.mixed ? `مختلط (${ship.directCount} شحن مباشر / ${ship.total - ship.directCount} مخزون)` : 'من المخزون';
      })(),
      'نوع العربون': o.depositType === 'shipping' ? 'عربون بقيمة الشحن' : o.depositType === 'shipping_extra' ? 'عربون الشحن + المصروفات' : 'عربون عادي',
      [labelWithCurrency('إيراد خدمات شحن ونقل')]: window.getOrderShippingRevenue ? window.getOrderShippingRevenue(o) : 0,
      [labelWithCurrency('إجمالي الفاتورة')]: o.totalAmount,
      [labelWithCurrency('المدفوع مقدماً')]: o.downPayment,
      'عربون محتفظ به (إيراد)': (o.status === 'cancelled' || o.status === 'returned') ? (Number(o.retainedDeposit) || 0) : 0,
      'إرجاع عربون (خصم)': (o.status === 'cancelled' || o.status === 'returned') ? (Number(o.refundedAmount) || 0) : 0,
      [labelWithCurrency('المتبقي')]: window.getOrderRemainingAmount(o),
      'حالة الطلب': window.getOrderStatusLabel(o.status),
      'المسجل': o.createdBy || 'المدير العام',
      'التاريخ': window.formatDate(o.createdAt)
    }));
    const wsOrders = window.XLSX.utils.json_to_sheet(ordersData);
    wsOrders['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsOrders, 'المبيعات والفواتير');

    // 2. Sheet: Payments & Treasury (الخزينة والدفعات) — receipts (inflow) and
    //    refunds/refunded deposits (outflow) so net treasury reconciles exactly.
    const payments = window.getPayments();
    const paymentsData = payments.map(p => {
      const amt = Number(p.amount) || 0;
      const isRefund = amt < 0;
      let typeLabel;
      if (p.entityType === 'supplier' && p.type === 'supplierCollection') {
        typeLabel = 'تحصيل نقدية من مورد (قبض)';
      } else if (isRefund) {
        typeLabel = 'استرداد / رد عربون (صادر)';
      } else {
        typeLabel = p.entityType === 'customer' ? 'تحصيل من عميل (وارد)' : 'تسديد لمورد (صادر)';
      }
      return {
        'كود العملية': p.id,
        'نوع العملية': typeLabel,
        'الطرف': p.entityName,
        [labelWithCurrency('المبلغ')]: amt,
        'وسيلة الدفع': p.paymentMethod === 'cash' ? 'نقدي (كاش)' : p.paymentMethod === 'transfer' ? 'تحويل بنكي / فودافون كاش' : p.paymentMethod === 'check' ? 'شيك بنكي' : 'أخرى',
        'التاريخ': p.date,
        'البيان': p.notes || '—',
        'المسجل': p.createdBy || 'المدير العام'
      };
    });
    const wsPayments = window.XLSX.utils.json_to_sheet(paymentsData);
    wsPayments['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsPayments, 'الخزينة والدفعات');

    // 3. Sheet: Customers (العملاء وأرصدتهم)
    const customers = window.getCustomers();
    const customersData = customers.map(c => ({
      'كود العميل': c.id,
      'اسم العميل': c.name,
      'رقم الهاتف': c.phone,
      'الهاتف الثانوي': c.secondaryPhone || '',
      'تصنيف العميل': c.category || '',
      'العنوان': c.address || '—',
      // V3.26 — export the customer's full saved address list (labels + addresses).
      'قائمة العناوين': (Array.isArray(c.addresses) && c.addresses.length ? c.addresses : (window.getCustomerAddresses ? window.getCustomerAddresses(c.id) : [])).map(a => (a.label ? a.label + ': ' : '') + a.address).join(' | '),
      'عدد الطلبات': c.ordersCount || 0,
      [labelWithCurrency('إجمالي المشتريات')]: c.totalPurchases || 0,
      [labelWithCurrency('إجمالي المسدد')]: c.paid || 0,
      [labelWithCurrency('الرصيد المتبقي عليه')]: c.remainingBalance || 0,
      'تاريخ آخر طلب': window.formatDate(c.lastOrderDate)
    }));
    const wsCustomers = window.XLSX.utils.json_to_sheet(customersData);
    wsCustomers['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsCustomers, 'العملاء والأرصدة');

    // 4. Sheet: Suppliers & Payments (الموردين والدفعات)
    const suppliers = window.getSuppliers();
    const suppliersData = suppliers.map(s => ({
      'كود المورد': s.id,
      'اسم المورد / المصنع': s.name,
      'رقم الهاتف': s.phone || '—',
      'الهاتف الثانوي': s.secondaryPhone || '',
      'العنوان': s.address || '—',
      [labelWithCurrency('إجمالي التعاملات')]: s.totalPurchases || 0,
      [labelWithCurrency('المبلغ المسدد')]: s.paid || 0,
      [labelWithCurrency('الرصيد المستحق للمورد')]: s.remainingBalance || 0
    }));
    const wsSuppliers = window.XLSX.utils.json_to_sheet(suppliersData);
    wsSuppliers['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsSuppliers, 'الموردين والحسابات');

    // 5. Sheet: Products & Inventory (المنتجات والمخزون)
    const products = window.getProducts();
    const productsData = products.map(p => ({
      'كود المنتج': p.id,
      'اسم المنتج': p.name,
      'المخزون الحالي': p.stock,
      [labelWithCurrency('سعر الشراء')]: p.purchasePrice,
      [labelWithCurrency('سعر البيع')]: p.sellingPrice,
      'الحد الأدنى للتنبيه': p.minStock,
      'الحالة': p.stock <= p.minStock ? (p.stock < 0 ? `عجز (${p.stock})` : 'مخزون منخفض') : 'متوفر',
      'ملاحظات': p.notes || '—'
    }));
    const wsProducts = window.XLSX.utils.json_to_sheet(productsData);
    wsProducts['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsProducts, 'المنتجات والمخزون');

    // 6. Sheet: Users & Accounts (حسابات الموظفين)
    const users = window.getUsers();
    const usersData = users.map(u => ({
      'كود المستخدم': u.id,
      'الاسم': u.name,
      'البريد الإلكتروني': u.email,
      'الصلاحية / الرتبة': u.role === 'admin' ? 'مدير نظام' : u.role === 'storekeeper' ? 'أمين مخزن' : 'موظف مبيعات',
      'تاريخ الإنشاء': window.formatDate(u.createdAt)
    }));
    const wsUsers = window.XLSX.utils.json_to_sheet(usersData);
    wsUsers['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsUsers, 'حسابات الموظفين');

    // 7. Sheet: Supplier Returns (مرتجع المشتريات)
    const returns = window.getSupplierReturns ? window.getSupplierReturns() : [];
    const returnsData = returns.map(r => ({
      'كود المرتجع': r.id,
      'رقم المورد': r.supplierId,
      'اسم المورد': r.supplierName,
      'عدد الأصناف': Array.isArray(r.items) ? r.items.length : 0,
      [labelWithCurrency('قيمة المرتجع')]: r.totalValue,
      'نوع الاسترداد': r.refundType === 'cash' ? 'نقدي (استلام كاش)' : 'خصم من الحساب',
      'الملاحظات': r.notes || '—',
      'المسجل': r.createdBy || 'المدير العام',
      'التاريخ': window.formatDate(r.createdAt)
    }));
    const wsReturns = window.XLSX.utils.json_to_sheet(returnsData);
    wsReturns['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsReturns, 'مرتجع المشتريات');

    // 8. Sheet: Expenses (المصروفات الشهرية)
    const expenses = window.getExpenses ? window.getExpenses() : [];
    const expensesData = expenses.map(x => ({
      'كود المصروف': x.id,
      'البيان': x.title || x.description || '—',
      'التصنيف': x.category || 'عام',
      [labelWithCurrency('المبلغ')]: x.amount,
      'التاريخ': window.formatDate(x.date || x.createdAt),
      'متكرر': x.recurring ? 'نعم' : 'لا',
      'يوم الاستحقاق': (x.dueDay === null || x.dueDay === undefined || x.dueDay === '') ? '—' : x.dueDay,
      'الملاحظات': x.notes || '—',
      'المسجل': x.createdBy || 'المدير العام'
    }));
    const wsExpenses = window.XLSX.utils.json_to_sheet(expensesData);
    wsExpenses['!views'] = [{ RTL: true }];
    window.XLSX.utils.book_append_sheet(workbook, wsExpenses, 'المصروفات الشهرية');

    // Write file
    window.XLSX.writeFile(workbook, `تصدير_قاعدة_البيانات_الشاملة_${todayStr}.xlsx`);
    window.showToast('تم تصدير قاعدة البيانات بالكامل إلى ملف Excel موحد بنجاح', 'success');

  } catch (err) {
    console.error('Unified Export Error:', err);
    alert('حدث خطأ أثناء تصدير كافة بيانات النظام إلى Excel');
  }
}

/**
 * Offline-first CSV helpers (V3.59 — Webhook Edition)
 * ===================================================
 * Local CSV export/import as a fallback when the Apps Script webhook is
 * unreachable. `toCsvString` is pure (unit-testable); `exportToCsv` drives the
 * browser download; `readWorkbookSheets` normalises either a CSV/TXT file or an
 * XLSX/XLS workbook into `[{ title, headers, rows }]` so the sync engine can
 * consume it as a read-only file transport.
 */

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return /[",\n\r،]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsvString(dataArray) {
  if (!Array.isArray(dataArray) || !dataArray.length) return '';
  const headers = Object.keys(dataArray[0]);
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of dataArray) {
    lines.push(headers.map(h => csvEscape(row == null ? '' : row[h])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function exportToCsv(dataArray, filename = 'report.csv') {
  const csv = toCsvString(dataArray);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  row.push(field);
  rows.push(row);

  const nonEmpty = rows.filter(r => r.some(c => c !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0];
  return nonEmpty.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] != null ? r[idx] : ''; });
    return obj;
  });
}

export async function readWorkbookSheets(file) {
  if (!file) return [];
  const name = String(file.name || '');
  if (/\.(csv|txt)$/i.test(name)) {
    const text = await file.text();
    return [{ title: 'CSV', headers: Object.keys(parseCsvText(text)[0] || {}), rows: parseCsvText(text) }];
  }
  if (!(await ensureXLSX())) {
    throw new Error('تعذر تحميل مكتبة قراءة ملفات Excel');
  }
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map(title => {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[title], { defval: '' });
    return {
      title,
      headers: rows.length ? Object.keys(rows[0]).map(String) : [],
      rows,
    };
  });
}
