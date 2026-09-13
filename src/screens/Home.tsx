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
          <h1 className="font-display font-bold text-[26px] text-white mt-1">Know what<br />you're buying.</h1>
        </div>
        <Stamp variant="verified" size={64} />
      </div>

      <p className="text-[var(--color-steel-400)] text-[14px] mt-4 mb-6 max-w-[92%]">
        Independent, transparent inspections across South Africa — book in minutes, get a full digital report.
      </p>

      <h2 className="font-display font-semibold text-[15px] text-white mb-3">Book an inspection</h2>
      <div className="grid grid-cols-2 gap-3">
        {CATEGORIES.map(({ key, title, blurb, icon: Icon }) => (
          <Card key={key} onClick={() => navigate(`/book/${key}`)} className="flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-blue-glow)] flex items-center justify-center text-[var(--color-blue-400)]">
              <Icon />
            </div>
            <div>
              <p className="font-display font-semibold text-[14px] text-white">{title}</p>
              <p className="text-[11.5px] text-[var(--color-steel-400)] mt-0.5 leading-snug">{blurb}</p>
            </div>
          </Card>
        ))}
        <Card onClick={() => navigate('/index')} className="flex flex-col gap-3 border-[var(--color-blue-600)]">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-blue-glow)] flex items-center justify-center text-[var(--color-blue-400)]">
            <IndexSearchIcon />
          </div>
          <div>
            <p className="font-display font-semibold text-[14px] text-white">Dealership Index</p>
            <p className="text-[11.5px] text-[var(--color-steel-400)] mt-0.5 leading-snug">Know who you're dealing with</p>
          </div>
        </Card>
      </div>
    </div>
  )
}

function iconProps() {
  return { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const
}
function CarIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 16v-3l2-5h12l2 5v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16h16v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="16" r="1.3" />
      <circle cx="16" cy="16" r="1.3" />
    </svg>
  )
}
function HouseIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function KeyIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="8" cy="14" r="3.3" />
      <path d="M10.3 11.7 18 4M15.5 6.5 18 4M18 9l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function GemIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 9l4-5h8l4 5-8 11-8-11Z" strokeLinejoin="round" />
      <path d="M4 9h16M9.5 4 8 9l4 11 4-11-1.5-5" strokeLinejoin="round" />
    </svg>
  )
}
function ChatIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 5h16v11H8l-4 4V5Z" strokeLinejoin="round" />
    </svg>
  )
}
function IndexSearchIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-5-5" strokeLinecap="round" />
    </svg>
  )
}
