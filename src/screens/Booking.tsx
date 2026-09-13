import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Card, Field, ScreenHeader } from '../components/ui'
import type { BookingCategory, Service } from '../types'
import { CATEGORY_LABEL } from '../types'

export function Booking() {
  const { category } = useParams<{ category: string }>()
  const navigate = useNavigate()
  const cat = (category || 'vehicle') as BookingCategory

  const [step, setStep] = useState(0)
  const [services, setServices] = useState<Service[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // customer
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  // seller / vehicle
  const [sellerName, setSellerName] = useState('')
  const [sellerPhone, setSellerPhone] = useState('')
  const [viewingAddress, setViewingAddress] = useState('')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleYear, setVehicleYear] = useState('')
  const [vehicleVin, setVehicleVin] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    supabase
      .from('services')
      .select('*')
      .eq('category', cat)
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => {
        setServices((data as Service[]) ?? [])
        setLoading(false)
      })
  }, [cat])

  const total = services
    .filter((s) => selected.has(s.id))
    .reduce((sum, s) => sum + Number(s.price_excl_vat), 0)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    setError('')
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .insert({
        customer_id: user?.id ?? null,
        category: cat,
        status: 'pending',
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
        seller_name: sellerName || null,
        seller_contact_number: sellerPhone || null,
        viewing_address: viewingAddress || null,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        vehicle_year: vehicleYear || null,
        vehicle_vin: vehicleVin || null,
        preferred_date_1: preferredDate || null,
        message: message || null,
        total_excl_vat: total,
      })
      .select()
      .single()

    if (bErr || !booking) {
      setError(bErr?.message ?? 'Failed to create booking')
      setSubmitting(false)
      return
    }

    const lines = services
      .filter((s) => selected.has(s.id))
      .map((s) => ({
        booking_id: booking.id,
        service_id: s.id,
        price_excl_vat: s.price_excl_vat,
        service_name_snapshot: s.name,
        price_excl_vat_snapshot: s.price_excl_vat,
      }))

    if (lines.length) {
      await supabase.from('booking_services').insert(lines)
    }

    setSubmitting(false)
    navigate(`/bookings/${booking.id}`)
  }

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader
        title={`Book ${CATEGORY_LABEL[cat]}`}
        subtitle={step === 0 ? 'Select services' : step === 1 ? 'Your details' : 'Review & submit'}
      />

      {step === 0 && (
        <>
          {loading && <p className="text-[var(--color-steel-400)] text-sm">Loading services…</p>}
          <div className="grid gap-3">
            {services.map((s) => {
              const on = selected.has(s.id)
              return (
                <Card
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  className={on ? 'border-[var(--color-blue-500)]' : ''}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display font-semibold text-[15px]">{s.name}</p>
                      {s.description && (
                        <p className="text-[12px] text-[var(--color-steel-400)] mt-1">{s.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[14px] text-[var(--color-blue-400)]">
                        R{Number(s.price_excl_vat).toLocaleString('en-ZA')}
                      </p>
                      <div
                        className={`mt-2 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          on ? 'border-[var(--color-blue-500)] bg-[var(--color-blue-500)]' : 'border-[var(--color-navy-line)]'
                        }`}
                      >
                        {on && <span className="text-white text-[10px]">✓</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          <div className="mt-6 flex items-center justify-between">
            <p className="font-mono text-[14px] text-[var(--color-steel-400)]">
              Total R{total.toLocaleString('en-ZA')} excl. VAT
            </p>
            <Button disabled={selected.size === 0} onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <Field label="First name" value={firstName} onChange={setFirstName} required />
          <Field label="Last name" value={lastName} onChange={setLastName} required />
          <Field label="Phone" value={phone} onChange={setPhone} required />
          <Field label="Email" value={email} onChange={setEmail} type="email" required />
          <Field label="Seller / dealership name" value={sellerName} onChange={setSellerName} />
          <Field label="Seller contact" value={sellerPhone} onChange={setSellerPhone} />
          <Field label="Viewing address" value={viewingAddress} onChange={setViewingAddress} />
          {cat === 'vehicle' && (
            <>
              <Field label="Vehicle make" value={vehicleMake} onChange={setVehicleMake} />
              <Field label="Model" value={vehicleModel} onChange={setVehicleModel} />
              <Field label="Year" value={vehicleYear} onChange={setVehicleYear} />
              <Field label="VIN" value={vehicleVin} onChange={setVehicleVin} />
            </>
          )}
          <Field label="Preferred date" value={preferredDate} onChange={setPreferredDate} type="date" />
          <Field label="Message / notes" value={message} onChange={setMessage} />
          <div className="flex gap-3 mt-2">
            <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
            <Button full onClick={() => setStep(2)} disabled={!firstName || !lastName || !phone || !email}>
              Review
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <Card className="mb-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-blue-400)] mb-3">Summary</p>
            <p className="text-[14px] text-white mb-1">{firstName} {lastName}</p>
            <p className="text-[13px] text-[var(--color-steel-400)]">{email} · {phone}</p>
            {sellerName && <p className="text-[13px] text-[var(--color-steel-400)] mt-2">Seller: {sellerName}</p>}
            <div className="mt-4 pt-3 border-t border-[var(--color-navy-line)]">
              {services.filter((s) => selected.has(s.id)).map((s) => (
                <div key={s.id} className="flex justify-between text-[13px] py-1">
                  <span>{s.name}</span>
                  <span className="font-mono">R{Number(s.price_excl_vat).toLocaleString('en-ZA')}</span>
                </div>
              ))}
              <div className="flex justify-between font-display font-semibold mt-2 pt-2 border-t border-[var(--color-navy-line)]">
                <span>Total excl. VAT</span>
                <span className="text-[var(--color-blue-400)]">R{total.toLocaleString('en-ZA')}</span>
              </div>
            </div>
          </Card>
          {error && <p className="text-[var(--color-danger)] text-sm mb-3">{error}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button full onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit booking'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
