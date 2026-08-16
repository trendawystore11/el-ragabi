import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import FilterBar from '@/ui/components/FilterBar'
import { Search, Plus } from 'lucide-react'

function render(ui) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(ui)
  })
  return {
    host,
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('FilterBar (ui/components/FilterBar.jsx) — الشريط الأفقي الموحد', () => {
  it('يعرض العنوان والوصف والأيقونة في الصف العلوي', () => {
    const { host, unmount } = render(
      <FilterBar
        icon={<Search className="w-5 h-5" />}
        title="سجل الطلبات"
        subtitle="متابعة الفواتير والديون"
      >
        <input placeholder="بحث" />
      </FilterBar>
    )
    expect(host.textContent).toContain('سجل الطلبات')
    expect(host.textContent).toContain('متابعة الفواتير والديون')
    expect(host.querySelector('h1')).toBeTruthy()
    expect(host.querySelectorAll('input')).toHaveLength(1)
    unmount()
  })

  it('يعرض أزرار الإجراءات (إضافة / إعادة ضبط) في الصف العلوي', () => {
    const { host, unmount } = render(
      <FilterBar
        title="الموردين"
        actions={
          <>
            <button type="button">إعادة ضبط الفلتر</button>
            <button type="button">إضافة مورد جديد</button>
          </>
        }
      >
        <input placeholder="بحث" />
      </FilterBar>
    )
    expect(host.textContent).toContain('إعادة ضبط الفلتر')
    expect(host.textContent).toContain('إضافة مورد جديد')
    unmount()
  })

  it('يرتب عناصر الفلترة في شبكة مستجيبة (مصفوفة) وليس تكديساً عمودياً', () => {
    const { host, unmount } = render(
      <FilterBar title="المنتجات" cols="sm:grid-cols-2 lg:grid-cols-3">
        <input placeholder="بحث" />
        <select aria-label="المورد">
          <option value="">الكل</option>
        </select>
        <button type="button">النواقص فقط</button>
      </FilterBar>
    )
    const grid = host.querySelector('.grid')
    expect(grid).toBeTruthy()
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('sm:grid-cols-2')
    expect(grid.className).toContain('lg:grid-cols-3')
    expect(grid.children.length).toBe(3)
    unmount()
  })

  it('يعمل بدون عنوان (أزرار إجراءات فقط + الشبكة) للشاشات التي تحتفظ بهيدر منفصل', () => {
    const { host, unmount } = render(
      <FilterBar
        actions={<button type="button">إعادة ضبط الفلتر</button>}
        cols="sm:grid-cols-1 lg:grid-cols-3"
      >
        <input placeholder="من تاريخ" />
        <input placeholder="إلى تاريخ" />
      </FilterBar>
    )
    expect(host.querySelector('h1')).toBeNull()
    expect(host.textContent).toContain('إعادة ضبط الفلتر')
    const grid = host.querySelector('.grid')
    expect(grid).toBeTruthy()
    expect(grid.children.length).toBe(2)
    unmount()
  })

  it('كل شاشة تحتفظ بترتيب عناصرها: البحث أولاً ثم القوائم المنسدلة', () => {
    const { host, unmount } = render(
      <FilterBar title="العملاء">
        <input placeholder="بحث بالاسم" />
        <select aria-label="التصنيف">
          <option value="">الكل</option>
        </select>
        <button type="button">إضافة عميل جديد</button>
      </FilterBar>
    )
    const inputs = Array.from(host.querySelectorAll('input,select,button'))
    expect(inputs[0].tagName).toBe('INPUT')
    expect(inputs[0].getAttribute('placeholder')).toBe('بحث بالاسم')
    expect(inputs[1].tagName).toBe('SELECT')
    expect(inputs[2].textContent).toContain('إضافة عميل جديد')
    unmount()
  })
})
