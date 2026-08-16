// =============================================================================
// ui/views/ProductsView.jsx — نسخة React من js/components/products-view.js — Phase 5
// -----------------------------------------------------------------------------
// دليل المنتجات وإدارة المخزون: هيدر (بحث باسم/SKU/مورد + فلتر مورد + فلتر
// النواقص + زر إضافة) وجدول منتجات مع شارات الحالة (عجز/منخفض/متوفر) وأزرار
// العمليات. البيانات من productsStore. «إضافة شحنة» و«تعديل» يفتحان
// ShipmentModal/AddProductModal عبر uiStore، و«حذف» عبر الجسر window.deleteProduct.
// =============================================================================
import { useMemo, useEffect, useState } from 'react'
import { Package, Search, PackagePlus, Edit3, Trash2, AlertOctagon, AlertTriangle } from 'lucide-react'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import Badge from '../components/Badge.jsx'
import FilterBar from '../components/FilterBar.jsx'
import { useProductsStore, applyProductFilters } from '@/state/productsStore'
import { useAuthStore } from '@/state/authStore'
import { useUiStore } from '../state/uiStore.js'
import { canManageProducts, canDeleteProduct, canSeePurchasePrice } from '@/services/permissions'
import { formatCurrency } from '@/utils/formatters'
import { showToast } from '../components/toastStore.js'

function stockStatus(p) {
  const stock = Number(p.stock)
  if (stock < 0) return 'negative'
  const min = Number(p.minStock)
  const threshold = !isNaN(min) && min >= 0 ? min : 5
  return stock <= threshold ? 'low' : 'ok'
}

function ProductRow({ product, onRefresh, canManage, canDelete, showPurchasePrice }) {
  const status = stockStatus(product)
  const sku = product.code || product.id
  const stock = Number(product.stock) || 0
  const [deleting, setDeleting] = useState(false)

  const openShipment = () =>
    useUiStore.getState().openShipmentModal(product.id, onRefresh)
  const openEdit = () =>
    useUiStore.getState().openAddProductModal(product.id, onRefresh)

  const remove = () => {
    if (deleting) return
    if (!window.confirm(`هل أنت تأكد من رغبتك في حذف المنتج "${product.name}" من المخزون؟`)) return
    setDeleting(true)
    window
      .deleteProduct(product.id)
      .then(ok => {
        if (ok) {
          showToast(`تم حذف المنتج "${product.name}" بنجاح`, 'info')
        } else {
          showToast('تعذر حذف المنتج — قد يكون مسجلاً في طلبات أو بيانات مرتبطة به', 'error')
        }
        onRefresh()
      })
      .catch(err => {
        showToast((err && err.message) || 'حدث خطأ أثناء حذف المنتج', 'error')
        onRefresh()
      })
      .finally(() => setDeleting(false))
  }

  return (
    <tr className={status === 'negative' ? 'bg-rose-950/20' : status === 'low' ? 'low-stock-row' : ''}>
      <td>
        <span className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-md inline-block num-font font-bold text-amber-400 text-xs">
          {sku}
        </span>
      </td>
      <td className="font-bold text-white">{product.name}</td>
      <td className="text-xs font-bold text-purple-300">{product.supplierName || '—'}</td>
      <td className={`num-font font-extrabold text-base ${status === 'negative' ? 'text-rose-500' : status === 'low' ? 'text-amber-400' : 'text-emerald-400'}`}>
        {stock} قطعة
      </td>
      {showPurchasePrice ? (
        <td className="num-font text-slate-300">{formatCurrency(product.purchasePrice)}</td>
      ) : null}
      <td className="num-font font-bold text-white">{formatCurrency(product.sellingPrice)}</td>
      <td>
        {status === 'negative' ? (
          <Badge variant="error">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            عجز مخزون ({stock})
          </Badge>
        ) : status === 'low' ? (
          <Badge variant="warning">
            <AlertTriangle className="w-3.5 h-3.5" />
            مخزون منخفض
          </Badge>
        ) : (
          <Badge variant="success">متوفر في المخزن</Badge>
        )}
      </td>
      <td>
        {canManage ? (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <Button size="sm" variant="ghost" icon={PackagePlus} onClick={openShipment} className="text-emerald-300 hover:bg-emerald-500/10">
              إضافة شحنة
            </Button>
            <Button size="sm" variant="ghost" icon={Edit3} onClick={openEdit} className="text-brand-300 hover:bg-brand-500/10">
              تعديل
            </Button>
            {canDelete ? (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={remove} loading={deleting} disabled={deleting} className="text-rose-300 hover:bg-rose-500/10">
                حذف
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-slate-600">عرض فقط</span>
        )}
      </td>
    </tr>
  )
}

function ProductsView() {
  const products = useProductsStore(s => s.products)
  const search = useProductsStore(s => s.search)
  const supplier = useProductsStore(s => s.supplier)
  const lowStockOnly = useProductsStore(s => s.lowStockOnly)
  const setSearch = useProductsStore(s => s.setSearch)
  const setSupplier = useProductsStore(s => s.setSupplier)
  const setLowStockOnly = useProductsStore(s => s.setLowStockOnly)
  const refresh = useProductsStore(s => s.refresh)

  // 🔒 V3.43 — صلاحيات الأدوار داخل شاشة المنتجات:
  //   canManage        → إضافة/تعديل/شحنة (admin + storekeeper)
  //   canDelete        → حذف المنتج (admin فقط)
  //   showPurchasePrice→ سعر الشراء (مخفي عن الكاشير فقط)
  const role = useAuthStore(s => s.role)
  const canManage = canManageProducts(role)
  const canDelete = canDeleteProduct(role)
  const showPurchasePrice = canSeePurchasePrice(role)

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(
    () => applyProductFilters(products, search, supplier, lowStockOnly),
    [products, search, supplier, lowStockOnly]
  )

  const suppliers = typeof window !== 'undefined' && window.getSuppliers ? window.getSuppliers() : []
  const supplierOptions = [
    { value: '', label: 'جميع الموردين' },
    ...suppliers.map(s => ({ value: s.id, label: s.name })),
  ]

  const openAdd = () => useUiStore.getState().openAddProductModal(null, () => useProductsStore.getState().refresh())

  return (
    <div className="space-y-6 animate-fadeIn v7-view">
      <FilterBar
        icon={<Package className="w-6 h-6 text-amber-400" />}
        title="دليل المنتجات وإدارة المخزون"
        subtitle="متابعة المخزون، أكواد المنتجات (SKU)، توريد الشحنات الجديدة وتتبع الموردين"
        cols="sm:grid-cols-2 lg:grid-cols-3"
        actions={
          canManage ? (
            <Button variant="primary" icon={PackagePlus} onClick={openAdd}>
              إضافة منتج جديد
            </Button>
          ) : null
        }
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="بحث باسم المنتج، كود الـ SKU..."
          icon={Search}
          voiceLabel="بحث صوتي في المنتجات"
        />
        <Select value={supplier} onChange={setSupplier} options={supplierOptions} />
        <Button
          variant={lowStockOnly ? 'warning' : 'secondary'}
          icon={AlertTriangle}
          onClick={() => setLowStockOnly(!lowStockOnly)}
          className={lowStockOnly ? '' : 'text-amber-300'}
        >
          النواقص فقط
        </Button>
      </FilterBar>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg v7-table-card">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>كود المنتج (SKU)</th>
                <th>اسم المنتج</th>
                <th>المورد المصنع</th>
                <th>المخزون الحالي</th>
                {showPurchasePrice ? <th>سعر الشراء الأصلي</th> : null}
                <th>سعر البيع للجمهور</th>
                <th>الحالة والتنبيه</th>
                <th>الإجراءات والعمليات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={showPurchasePrice ? 8 : 7} className="text-center py-10 text-slate-500">
                    لا توجد منتجات مسجلة في المخزن
                  </td>
                </tr>
              ) : (
                rows.map(p => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onRefresh={refresh}
                    canManage={canManage}
                    canDelete={canDelete}
                    showPurchasePrice={showPurchasePrice}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ProductsView
