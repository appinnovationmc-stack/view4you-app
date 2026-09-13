import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, ScreenHeader, StatusPill } from '../components/ui'
import type { Booking } from '../types'
import { CATEGORY_LABEL, STATUS_LABEL } from '../types'

export function MyBookings() {
  const navigate = useNavigate()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setBookings((data as Booking[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader title="Your Bookings" subtitle="Track inspections and view reports" />

      {loading && <p className="text-[var(--color-steel-400)] text-[13px]">Loading…</p>}

      {!loading && bookings.length === 0 && (
        <Card className="text-center py-8">
          <p className="text-white font-display font-semibold mb-1">No bookings yet</p>
          <p className="text-[var(--color-steel-400)] text-[13px]">Book your first inspection from the Home tab.</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {bookings.map((b) => (
          <Card key={b.id} onClick={() => navigate(`/bookings/${b.id}`)}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-blue-400)]">
                {CATEGORY_LABEL[b.category]}
              </span>
              <StatusPill status={b.status} label={STATUS_LABEL[b.status]} />
            </div>
            <p className="font-display font-semibold text-white text-[15px]">
              {b.vehicle_make ? `${b.vehicle_make} ${b.vehicle_model ?? ''}`.trim() : b.seller_name || 'Inspection Request'}
            </p>
            <p className="text-[12px] text-[var(--color-steel-400)] mt-1">
              {b.preferred_date_1 ? `Requested for ${b.preferred_date_1}` : ''}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
