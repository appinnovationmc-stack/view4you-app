import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, ScreenHeader, StatusPill } from '../components/ui'
import { Stamp } from '../components/Stamp'
import type { Booking, BookingServiceLine, Report } from '../types'
import { CATEGORY_LABEL, STATUS_LABEL } from '../types'

export function BookingDetail() {
  const { id } = useParams<{ id: string }>()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [lines, setLines] = useState<BookingServiceLine[]>([])
  const [report, setReport] = useState<Report | null>(null)

  useEffect(() => {
    if (!id) return
    supabase.from('bookings').select('*').eq('id', id).single().then(({ data }) => setBooking(data as Booking))
    supabase.from('booking_services').select('*').eq('booking_id', id).then(({ data }) => setLines((data as BookingServiceLine[]) ?? []))
    supabase.from('reports').select('*').eq('booking_id', id).maybeSingle().then(({ data }) => setReport(data as Report | null))
  }, [id])

  if (!booking) {
    return <div className="px-5 pt-6 text-[var(--color-steel-400)] text-[13px]">Loading…</div>
  }

  const isReportReady = booking.status === 'report_ready' || booking.status === 'completed'

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader title={CATEGORY_LABEL[booking.category] + ' Inspection'} />

      <div className="flex items-center justify-between mb-5">
        <StatusPill status={booking.status} label={STATUS_LABEL[booking.status]} />
        {isReportReady && <Stamp variant="verified" size={56} dateLabel={booking.scheduled_date ?? undefined} />}
        {(booking.status === 'assigned' || booking.status === 'in_progress') && <Stamp variant="pending" size={56} />}
      </div>

      {isReportReady && report && (
        <Card className="mb-4 border-[var(--color-verified)]">
          <p className="font-display font-semibold text-white mb-2">Inspection Report</p>
          {report.summary && <p className="text-[13px] text-[var(--color-steel-400)] mb-3 leading-relaxed">{report.summary}</p>}
          {report.file_url && (
            <a
              href={report.file_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-display font-semibold text-[13px] text-[var(--color-verified)] underline"
            >
              View full report →
            </a>
          )}
        </Card>
      )}

      <Card className="mb-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-blue-400)] mb-3">Services</p>
        {lines.map((l) => (
          <div key={l.id} className="flex justify-between text-[13px] py-1.5">
            <span className="text-white">{l.service_name_snapshot}</span>
            <span className="font-mono text-[var(--color-steel-400)]">R{Number(l.price_excl_vat_snapshot).toLocaleString('en-ZA')}</span>
          </div>
        ))}
        <div className="flex justify-between pt-2 mt-2 border-t border-[var(--color-navy-line)]">
          <span className="font-display font-semibold text-white">Total (excl. VAT)</span>
          <span className="font-mono font-semibold text-[var(--color-blue-400)]">R{Number(booking.total_excl_vat).toLocaleString('en-ZA')}</span>
        </div>
      </Card>

      {booking.category === 'vehicle' && (booking.vehicle_make || booking.vehicle_vin) && (
        <Card className="mb-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-blue-400)] mb-3">Vehicle</p>
          <Row label="Make / model" value={`${booking.vehicle_make ?? ''} ${booking.vehicle_model ?? ''}`.trim() || '—'} />
          <Row label="Year" value={booking.vehicle_year ?? '—'} />
          <Row label="VIN" value={booking.vehicle_vin ?? '—'} mono />
        </Card>
      )}

      <Card>
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-blue-400)] mb-3">Booking</p>
        <Row label="Requested by" value={`${booking.first_name} ${booking.last_name}`} />
        <Row label="Preferred date" value={booking.preferred_date_1 ?? '—'} />
        {booking.seller_name && <Row label="Seller" value={booking.seller_name} />}
        {booking.viewing_address && <Row label="Viewing address" value={booking.viewing_address} />}
      </Card>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-[13px] py-1.5">
      <span className="text-[var(--color-steel-400)]">{label}</span>
      <span className={`text-white text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
