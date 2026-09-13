import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/bookings', label: 'Bookings', icon: 'calendar' },
  { to: '/index', label: 'Index', icon: 'search' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-[var(--color-navy-line)] bg-[var(--color-navy)]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-colors ${
                isActive ? 'text-[var(--color-blue-400)]' : 'text-[var(--color-steel-400)]'
              }`
            }
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <use href={`/icons.svg#${item.icon}`} />
            </svg>
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
