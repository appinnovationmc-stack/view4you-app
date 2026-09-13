import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, StatusPill, ScreenHeader } from '../components/ui'
import type { Booking } from '../types'

export function MyBookings() {
  const navigate = useNavigate()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      setBookings(data || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader title="My Bookings" />
      {loading ? (
        <p className="text-[var(--color-steel-400)] text-sm">Loading...</p>
      ) : bookings.length === 0 ? (
        <p className="text-[var(--color-steel-400)] text-sm mt-8 text-center">No bookings yet.</p>
      ) : (
        <div className="grid gap-3">
          {bookings.map((b) => (
            <Card
              key={b.id}
              onClick={() => navigate(`/bookings/${b.id}`)}
              className="p-4 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] text-[var(--color-blue-400)]">{b.reference}</p>
                  <p className="font-medium text-[15px] mt-1">{b.customer_name}</p>
                  <p className="text-[12px] text-[var(--color-steel-400)] mt-0.5">{b.category.replace('_', ' ')}</p>
                </div>
                <StatusPill status={b.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
