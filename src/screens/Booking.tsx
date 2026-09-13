import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Card, Field, ScreenHeader } from '../components/ui'
import type { BookingCategory, Service } from '../types'
import { CATEGORY_LABEL } from '../types'

type Step = 'services' | 'details' | 'review'

interface FormState {
  first_name: string
  last_name: string
  phone: string
  email: string
  suburb: string
  city: string
  seller_name: string
  viewing_address: string
  vehicle_make: string
  vehicle_model: string
  vehicle_year: string
  vehicle_vin: string
  preferred_date_1: string
  preferred_date_2: string
  preferred_date_3: string
  message: string
}

const EMPTY_FORM: FormState = {
  first_name: '', last_name: '', phone: '', email: '',
  suburb: '', city: '', seller_name: '', viewing_address: '',
  vehicle_make: '', vehicle_model: '', vehicle_year: '', vehicle_vin: '',
  preferred_date_1: '', preferred_date_2: '', preferred_date_3: '', message: '',
}

export function Booking() {
  const { category } = useParams<{ category: BookingCategory }>()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('services')
  const [services, setServices] = useState<Service[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!category) return
    supabase
      .from('services')
      .select('*')
      .eq('category', category)
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => setServices((data as Service[]) ?? []))
  }, [category])

  if (!category) return null

  const chosenServices = services.filter((s) => selected.has(s.id))
  const total = chosenServices.reduce((sum, s) => sum + Number(s.price_excl_vat), 0)

  function toggleService(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: booking, error: bookingErr } = await supabase
        .from('bookings')
        .insert({
          customer_id: userData.user?.id ?? null,
          category,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          email: form.email,
          suburb: form.suburb,
          city: form.city,
          seller_name: form.seller_name || null,
          viewing_address: form.viewing_address || null,
          vehicle_make: category === 'vehicle' ? form.vehicle_make : null,
          vehicle_model: category === 'vehicle' ? form.vehicle_model : null,
          vehicle_year: category === 'vehicle' ? form.vehicle_year : null,
          vehicle_vin: category === 'vehicle' ? form.vehicle_vin : null,
          preferred_date_1: form.preferred_date_1 || null,
          preferred_date_2: form.preferred_date_2 || null,
          preferred_date_3: form.preferred_date_3 || null,
          message: form.message || null,
          total_excl_vat: total,
        })
        .select()
        .single()

      if (bookingErr) throw bookingErr

      if (chosenServices.length > 0) {
        const rows = chosenServices.map((s) => ({
          booking_id: booking.id,
          service_id: s.id,
          service_name_snapshot: s.name,
          price_excl_vat_snapshot: s.price_excl_vat,
        }))
        const { error: lineErr } = await supabase.from('booking_services').insert(rows)
        if (lineErr) throw lineErr
      }

      navigate(`/bookings/${booking.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong submitting your booking.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <ScreenHeader
        title={`Book ${CATEGORY_LABEL[category]} Inspection`}
        subtitle={step === 'services' ? 'Choose the services you need' : step === 'details' ? 'Tell us where and when' : 'Review before you submit'}
      />

      <StepDots step={step} />

      {step === 'services' && (
        <div className="mt-6">
          {services.length === 0 && (
            <p className="text-[var(--color-steel-400)] text-[13px]">No services configured for this category yet.</p>
          )}
          <div className="flex flex-col gap-3">
            {services.map((s) => {
              const isSelected = selected.has(s.id)
              return (
                <Card
                  key={s.id}
                  onClick={() => toggleService(s.id)}
                  className={`flex items-center justify-between ${isSelected ? 'border-[var(--color-blue-500)]' : ''}`}
                >
                  <div className="pr-3">
                    <p className="font-display font-semibold text-[14px] text-white">{s.name}</p>
                    {s.description && <p className="text-[12px] text-[var(--color-steel-400)] mt-0.5">{s.description}</p>}
                    <p className="font-mono text-[12px] text-[var(--color-blue-400)] mt-1.5">
                      From R{Number(s.price_excl_vat).toLocaleString('en-ZA')} excl. VAT
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-[var(--color-blue-500)] border-[var(--color-blue-500)]' : 'border-[var(--color-navy-line)]'
                    }`}
                  >
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-navy)]/95 backdrop-blur border-t border-[var(--color-navy-line)] px-5 pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 12px) + 16px)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] text-[var(--color-steel-400)]">Total (excl. VAT)</span>
              <span className="font-mono font-semibold text-white">R{total.toLocaleString('en-ZA')}</span>
            </div>
            <Button full disabled={selected.size === 0} onClick={() => setStep('details')}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'details' && (
        <div className="mt-6">
          <SectionLabel>Your details</SectionLabel>
          <Field label="First name" value={form.first_name} onChange={(v) => update('first_name', v)} required />
          <Field label="Surname" value={form.last_name} onChange={(v) => update('last_name', v)} required />
          <Field label="Phone number" value={form.phone} onChange={(v) => update('phone', v)} type="tel" required />
          <Field label="Email" value={form.email} onChange={(v) => update('email', v)} type="email" required />
          <Field label="Suburb" value={form.suburb} onChange={(v) => update('suburb', v)} />
          <Field label="City" value={form.city} onChange={(v) => update('city', v)} />

          <SectionLabel>Where it's being inspected</SectionLabel>
          <Field label="Dealership / seller's name" value={form.seller_name} onChange={(v) => update('seller_name', v)} />
          <Field label="Viewing address" value={form.viewing_address} onChange={(v) => update('viewing_address', v)} />

          {category === 'vehicle' && (
            <>
              <SectionLabel>Vehicle</SectionLabel>
              <Field label="Make" value={form.vehicle_make} onChange={(v) => update('vehicle_make', v)} />
              <Field label="Model" value={form.vehicle_model} onChange={(v) => update('vehicle_model', v)} />
              <Field label="Year" value={form.vehicle_year} onChange={(v) => update('vehicle_year', v)} />
              <Field label="VIN number" value={form.vehicle_vin} onChange={(v) => update('vehicle_vin', v)} />
            </>
          )}

          <SectionLabel>Preferred dates</SectionLabel>
          <Field label="Option 1" value={form.preferred_date_1} onChange={(v) => update('preferred_date_1', v)} type="date" required />
          <Field label="Option 2" value={form.preferred_date_2} onChange={(v) => update('preferred_date_2', v)} type="date" />
          <Field label="Option 3" value={form.preferred_date_3} onChange={(v) => update('preferred_date_3', v)} type="date" />

          <SectionLabel>Anything else?</SectionLabel>
          <Field label="Message / additional information" value={form.message} onChange={(v) => update('message', v)} />

          <div className="flex gap-3 mt-2">
            <Button variant="ghost" onClick={() => setStep('services')}>Back</Button>
            <Button
              full
              disabled={!form.first_name || !form.last_name || !form.phone || !form.email || !form.preferred_date_1}
              onClick={() => setStep('review')}
            >
              Review
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="mt-6">
          <Card className="mb-4">
            <SectionLabel>Services</SectionLabel>
            {chosenServices.map((s) => (
              <div key={s.id} className="flex justify-between text-[13px] py-1.5">
                <span className="text-white">{s.name}</span>
                <span className="font-mono text-[var(--color-steel-400)]">R{Number(s.price_excl_vat).toLocaleString('en-ZA')}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 mt-2 border-t border-[var(--color-navy-line)]">
              <span className="font-display font-semibold text-white">Total (excl. VAT)</span>
              <span className="font-mono font-semibold text-[var(--color-blue-400)]">R{total.toLocaleString('en-ZA')}</span>
            </div>
          </Card>

          <Card className="mb-4">
            <SectionLabel>Contact</SectionLabel>
            <ReviewRow label="Name" value={`${form.first_name} ${form.last_name}`} />
            <ReviewRow label="Phone" value={form.phone} />
            <ReviewRow label="Email" value={form.email} />
            {form.seller_name && <ReviewRow label="Seller" value={form.seller_name} />}
            <ReviewRow label="Preferred date" value={form.preferred_date_1} />
          </Card>

          {error && <p className="text-[var(--color-danger)] text-[13px] mb-3">{error}</p>}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep('details')}>Back</Button>
            <Button full disabled={submitting} onClick={submit}>
              {submitting ? 'Submitting…' : 'Submit Booking'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['services', 'details', 'review']
  return (
    <div className="flex gap-2">
      {order.map((s) => (
        <div
          key={s}
          className={`h-1 rounded-full flex-1 ${order.indexOf(s) <= order.indexOf(step) ? 'bg-[var(--color-blue-500)]' : 'bg-[var(--color-navy-line)]'}`}
        />
      ))}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-blue-400)] mb-3 mt-1">{children}</p>
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px] py-1.5">
      <span className="text-[var(--color-steel-400)]">{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  )
}
