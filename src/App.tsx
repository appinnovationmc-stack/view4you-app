import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { Home } from './screens/Home'
import { Booking } from './screens/Booking'
import { MyBookings } from './screens/MyBookings'
import { BookingDetail } from './screens/BookingDetail'
import { DealerIndex } from './screens/DealerIndex'
import { Profile } from './screens/Profile'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[var(--color-navy)]">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book/:category" element={<Booking />} />
          <Route path="/bookings" element={<MyBookings />} />
          <Route path="/bookings/:id" element={<BookingDetail />} />
          <Route path="/index" element={<DealerIndex />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
