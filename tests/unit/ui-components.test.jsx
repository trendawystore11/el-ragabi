import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Layers, Search } from 'lucide-react'

// React 19 requires this flag for act() to run without warnings in jsdom.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import Button from '@/ui/components/Button'
import Input from '@/ui/components/Input'
import Select from '@/ui/components/Select'
import Badge from '@/ui/components/Badge'
import Card from '@/ui/components/Card'
import Modal from '@/ui/components/Modal'
import ToastContainer from '@/ui/components/ToastContainer'
import { useToastStore, showToast, dismissToast } from '@/ui/components/toastStore'

function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return {
    host,
    root,
    rerender(node) {
      act(() => {
        root.render(node)
      })
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

// React tracks controlled input values; the native setter + input event mirrors
// what @testing-library's fireEvent does to trigger onChange reliably.
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

describe('Button (ui/components/Button.jsx)', () => {
  it('renders children with type=button by default', () => {
    const { host, unmount } = mount(<Button>حفظ</Button>)
    const btn = host.querySelector('button')
    expect(btn.textContent).toBe('حفظ')
    expect(btn.type).toBe('button')
    unmount()
  })

  it('applies variant and size classes', () => {
    const { host, unmount } = mount(
      <Button variant="primary" size="sm">
        صغير
      </Button>
    )
    expect(host.querySelector('button').className).toContain('bg-brand-600')
    expect(host.querySelector('button').className).toContain('px-3 py-1.5')
    unmount()
  })

  it('calls onClick and respects disabled', () => {
    let calls = 0
    const { host, rerender, unmount } = mount(<Button onClick={() => calls++}>أ</Button>)
    click(host.querySelector('button'))
    expect(calls).toBe(1)

    rerender(
      <Button disabled onClick={() => calls++}>
        أ
      </Button>
    )
    const btn = host.querySelector('button')
    expect(btn.disabled).toBe(true)
    click(btn)
    expect(calls).toBe(1)
    unmount()
  })

  it('loading renders a spinner and disables', () => {
    const { host, unmount } = mount(<Button loading>حفظ</Button>)
    const btn = host.querySelector('button')
    expect(btn.disabled).toBe(true)
    expect(btn.querySelector('.animate-spin')).toBeTruthy()
    unmount()
  })

  it('fullWidth adds w-full and icon renders', () => {
    const { host, unmount } = mount(
      <Button icon={Layers} fullWidth>
        تصدير
      </Button>
    )
    const btn = host.querySelector('button')
    expect(btn.className).toContain('w-full')
    expect(btn.querySelector('svg')).toBeTruthy()
    unmount()
  })
})

describe('Input (ui/components/Input.jsx)', () => {
  it('renders label bound to the input', () => {
    const { host, unmount } = mount(<Input label="الاسم" />)
    const input = host.querySelector('input')
    const label = host.querySelector('label')
    expect(label.getAttribute('for')).toBe(input.id)
    expect(label.textContent).toBe('الاسم')
    unmount()
  })

  it('reflects value and reports onChange', () => {
    let received = ''
    const { host, unmount } = mount(<Input value="أ" onChange={v => (received = v)} />)
    const input = host.querySelector('input')
    expect(input.value).toBe('أ')
    type(input, 'ب')
    expect(received).toBe('ب')
    unmount()
  })

  it('renders error, icon and text-left; hint is suppressed when error present', () => {
    const { host, unmount } = mount(<Input error="خطأ" hint="تلميح" icon={Search} textLeft />)
    expect(host.textContent).toContain('خطأ')
    expect(host.textContent).not.toContain('تلميح')
    expect(host.querySelector('svg')).toBeTruthy()
    expect(host.querySelector('input').className).toContain('text-left')
    unmount()
  })

  it('renders the hint when there is no error', () => {
    const { host, unmount } = mount(<Input hint="تلميح" />)
    expect(host.textContent).toContain('تلميح')
    unmount()
  })

  it('marks required inputs with an asterisk', () => {
    const { host, unmount } = mount(<Input label="الموبايل" required />)
    expect(host.textContent).toContain('*')
    unmount()
  })
})

describe('Select (ui/components/Select.jsx)', () => {
  it('maps string and object options', () => {
    const { host, unmount } = mount(
      <Select options={['أ', 'ب']} />
    )
    const options = host.querySelectorAll('option')
    expect(options).toHaveLength(2)
    expect(options[0].value).toBe('أ')
    unmount()
  })

  it('renders {value,label} options and placeholder', () => {
    const { host, unmount } = mount(
      <Select
        placeholder="اختر..."
        options={[
          { value: 'a', label: 'ألف' },
          { value: 'b', label: 'باء' },
        ]}
      />
    )
    const options = host.querySelectorAll('option')
    expect(options[0].textContent).toBe('اختر...')
    expect(options[1].value).toBe('a')
    expect(options[1].textContent).toBe('ألف')
    unmount()
  })

  it('reports onChange with the selected value', () => {
    let received = ''
    const { host, unmount } = mount(
      <Select options={['أ', 'ب']} onChange={v => (received = v)} />
    )
    const select = host.querySelector('select')
    select.value = 'ب'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(received).toBe('ب')
    unmount()
  })

  it('renders label and error', () => {
    const { host, unmount } = mount(<Select label="الحالة" options={['أ']} error="مطلوب" />)
    expect(host.textContent).toContain('الحالة')
    expect(host.textContent).toContain('مطلوب')
    unmount()
  })
})

describe('Badge (ui/components/Badge.jsx)', () => {
  it('applies the neutral badge base plus variant colors', () => {
    const { host, unmount } = mount(<Badge variant="success">تم</Badge>)
    const el = host.querySelector('.badge')
    expect(el).toBeTruthy()
    expect(el.className).toContain('emerald')
    expect(el.textContent).toBe('تم')
    unmount()
  })

  it('defaults to neutral', () => {
    const { host, unmount } = mount(<Badge>عام</Badge>)
    expect(host.querySelector('.badge').className).toContain('slate')
    unmount()
  })
})

describe('Card (ui/components/Card.jsx)', () => {
  it('renders title, subtitle, icon and actions', () => {
    const { host, unmount } = mount(
      <Card title="المبيعات" subtitle="اليوم" icon={Layers} actions={<button>تحديث</button>}>
        <p>المحتوى</p>
      </Card>
    )
    expect(host.querySelector('.card')).toBeTruthy()
    expect(host.textContent).toContain('المبيعات')
    expect(host.textContent).toContain('اليوم')
    expect(host.textContent).toContain('تحديث')
    expect(host.textContent).toContain('المحتوى')
    unmount()
  })

  it('renders body without a header when no title given', () => {
    const { host, unmount } = mount(<Card>محتوى</Card>)
    expect(host.textContent).toContain('محتوى')
    unmount()
  })
})

describe('Modal (ui/components/Modal.jsx)', () => {
  it('renders nothing while closed', () => {
    const { host, unmount } = mount(
      <Modal open={false} title="نافذة">
        نص
      </Modal>
    )
    const container = document.getElementById('modal-container')
    expect(container.querySelector('.modal-animate')).toBeNull()
    unmount()
  })

  it('portals title, body and footer when open', () => {
    const { unmount } = mount(
      <Modal open title="تفاصيل" icon={Layers} footer={<button>حفظ</button>}>
        <p>جسم النافذة</p>
      </Modal>
    )
    const container = document.getElementById('modal-container')
    expect(container.querySelector('.modal-animate')).toBeTruthy()
    expect(container.textContent).toContain('تفاصيل')
    expect(container.textContent).toContain('جسم النافذة')
    expect(container.textContent).toContain('حفظ')
    expect(container.querySelector('svg')).toBeTruthy()
    unmount()
  })

  it('calls onClose on X button', () => {
    let closed = 0
    const { unmount } = mount(<Modal open title="نافذة" onClose={() => closed++} />)
    const container = document.getElementById('modal-container')
    const closeBtn = container.querySelector('button[aria-label="إغلاق"]')
    click(closeBtn)
    expect(closed).toBe(1)
    unmount()
  })

  it('calls onClose on backdrop click', () => {
    let closed = 0
    const { unmount } = mount(<Modal open title="نافذة" onClose={() => closed++} />)
    const container = document.getElementById('modal-container')
    const overlay = container.querySelector('.modal-animate')
    click(overlay)
    expect(closed).toBe(1)
    unmount()
  })

  it('does not close when clicking inside the panel', () => {
    let closed = 0
    const { unmount } = mount(<Modal open title="نافذة" onClose={() => closed++} />)
    const container = document.getElementById('modal-container')
    const panel = container.querySelector('.relative.w-full')
    click(panel)
    expect(closed).toBe(0)
    unmount()
  })
})

describe('toast system (toastStore + ToastContainer)', () => {
  it('renders a toast with its message and type styling', () => {
    const mounted = mount(<ToastContainer />)
    act(() => {
      showToast('تم الحفظ بنجاح', 'success', 0)
    })
    const container = document.getElementById('toast-container')
    expect(container.textContent).toContain('تم الحفظ بنجاح')
    expect(container.querySelector('.toast-close-btn')).toBeTruthy()
    // success type → emerald styling
    expect(container.querySelector('[class*="emerald-950"]')).toBeTruthy()
    act(() => {
      dismissToast(useToastStore.getState().toasts[0].id)
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
    mounted.unmount()
  })

  it('auto-dismisses after the duration', () => {
    vi.useFakeTimers()
    const mounted = mount(<ToastContainer />)
    try {
      act(() => {
        showToast('رسالة مؤقتة', 'info', 1000)
      })
      expect(useToastStore.getState().toasts).toHaveLength(1)
      act(() => {
        vi.advanceTimersByTime(1001)
      })
      expect(useToastStore.getState().toasts).toHaveLength(0)
    } finally {
      mounted.unmount()
      vi.useRealTimers()
    }
  })

  it('supports warning and error variants', () => {
    const mounted = mount(<ToastContainer />)
    act(() => {
      showToast('تحذير', 'warning', 0)
      showToast('خطأ', 'error', 0)
    })
    const container = document.getElementById('toast-container')
    expect(container.textContent).toContain('تحذير')
    expect(container.textContent).toContain('خطأ')
    expect(container.querySelector('[class*="amber-950"]')).toBeTruthy()
    expect(container.querySelector('[class*="rose-950"]')).toBeTruthy()
    act(() => {
      useToastStore.getState().clear()
    })
    mounted.unmount()
  })
})
