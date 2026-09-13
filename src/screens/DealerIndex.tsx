import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, ScreenHeader } from '../components/ui'
import { Stamp } from '../components/Stamp'
import type { Dealership } from '../types'

export function DealerIndex() {
  const [dealerships, setDealerships] = useState<Dealership[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('dealerships')
      .select('*')
      .order('transparency_rating', { ascending: false })
      .then(({ data }) => {
        setDealerships((data as Dealership[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader title="Dealership Index" subtitle="Know who you're dealing with" />

      {loading && <p className="text-[var(--color-steel-400)] text-[13px]">Loading…</p>}

      {!loading && dealerships.length === 0 && (
        <Card className="text-center py-8">
          <p className="text-white font-display font-semibold mb-1">Index is building</p>
          <p className="text-[var(--color-steel-400)] text-[13px]">Ratings appear as inspections are completed.</p>
        </Card>
      )}

      <div className="grid gap-3 mt-2">
        {dealerships.map((d) => (
          <Card key={d.id} className="p-4 flex items-center gap-4">
            <Stamp variant={d.transparency_rating && d.transparency_rating >= 4 ? 'verified' : 'pending'} size={48} />
            <div className="flex-1 min-w-0">
              <p className="font-display font-semibold text-[15px] truncate">{d.name}</p>
              {d.contact_person && (
                <p className="text-[12px] text-[var(--color-steel-400)] mt-0.5">{d.contact_person}</p>
              )}
              {d.transparency_rating != null && (
                <p className="text-[12px] text-[var(--color-blue-400)] mt-1">
                  Transparency {d.transparency_rating.toFixed(1)} / 5
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
