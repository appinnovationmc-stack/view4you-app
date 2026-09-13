import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/bookings', label: 'Bookings', icon: BookingsIcon },
  { to: '/index', label: 'Dealer Index', icon: IndexIcon },
  { to: '/profile', label: 'Profile', icon: ProfileIcon },
]

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-[var(--color-navy-raised)]/95 backdrop-blur border-t border-[var(--color-navy-line)] flex justify-around items-center px-2"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 10px)', paddingTop: 8 }}
    >
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-3 py-1.5 ${isActive ? 'text-[var(--color-blue-400)]' : 'text-[var(--color-steel-600)]'}`
          }
        >
          <Icon />
          <span className="font-body text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function BookingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16M8 3v3M16 3v3" strokeLinecap="round" />
    </svg>
  )
}
function IndexIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-5-5" strokeLinecap="round" />
    </svg>
  )
}
function ProfileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" strokeLinecap="round" />
    </svg>
  )
}
