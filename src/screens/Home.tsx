import { useNavigate } from 'react-router-dom'
import type { ReactElement } from 'react'
import { Card } from '../components/ui'
import { Stamp } from '../components/Stamp'
import type { BookingCategory } from '../types'

const CATEGORIES: { key: BookingCategory; title: string; blurb: string; icon: () => ReactElement }[] = [
  { key: 'vehicle', title: 'Vehicle', blurb: 'Pre-purchase & post-repair inspections', icon: CarIcon },
  { key: 'property', title: 'Property', blurb: 'Structural, roof, damp & more', icon: HouseIcon },
  { key: 'accommodation', title: 'Accommodation', blurb: 'Holiday & rental condition checks', icon: KeyIcon },
  { key: 'high_value_item', title: 'High-Value Item', blurb: 'Condition & authenticity checks', icon: GemIcon },
  { key: 'consultation', title: 'Consultation', blurb: 'Expert advisory before you buy', icon: ChatIcon },
]

export function Home() {
  const navigate = useNavigate()

  return (
    <div className="px-5 pt-6 pb-28">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-blue-400)]">We Inspect. You Decide.</p>
          <h1 className="font-display font-bold text-[26px] text-white mt-1">Know what<br />you&apos;re buying.</h1>
        </div>
        <Stamp variant="verified" size={64} />
      </div>

      <p className="text-[var(--color-steel-400)] text-[14px] mt-4 mb-6 max-w-[92%]">
        Independent, transparent inspections across South Africa — book in minutes, get a full digital report.
      </p>

      <div className="grid gap-3">
        {CATEGORIES.map((cat) => (
          <Card
            key={cat.key}
            onClick={() => navigate(`/book/${cat.key}`)}
            className="flex items-center gap-4 p-4 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <div className="w-11 h-11 rounded-xl bg-[var(--color-navy-raised)] flex items-center justify-center text-[var(--color-blue-400)]">
              {cat.icon()}
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-[15px]">{cat.title}</h3>
              <p className="text-[12px] text-[var(--color-steel-400)] mt-0.5">{cat.blurb}</p>
            </div>
            <svg className="w-4 h-4 text-[var(--color-steel-400)]" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Card>
        ))}
      </div>

      <button
        onClick={() => navigate('/index')}
        className="mt-6 w-full py-3.5 rounded-xl border border-[var(--color-navy-line)] text-[14px] font-medium text-[var(--color-blue-400)]"
      >
        Browse Dealership Index
      </button>
    </div>
  )
}

function CarIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 17h14M7 17l1.5-6h7L17 17M9 11V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <circle cx="8" cy="17" r="1.5" /><circle cx="16" cy="17" r="1.5" />
    </svg>
  )
}
function HouseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3 12 9-8 9 8v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M9 21v-8h6v8" />
    </svg>
  )
}
function KeyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="8" cy="10" r="3" /><path d="M11 10h8l-2 2 2 2" />
    </svg>
  )
}
function GemIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3h12l3 6-9 12L3 9z" /><path d="M3 9h18" />
    </svg>
  )
}
function ChatIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12a8 8 0 1 1-3.2-6.4L21 4v8z" />
    </svg>
  )
}
