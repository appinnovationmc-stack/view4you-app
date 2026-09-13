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
          <p className="text-[var(--color-steel-400)] text-[13px]">
            Ratings appear here as dealerships are inspected and reviewed.
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {dealerships.map((d) => (
          <Card key={d.id} className="flex items-center justify-between">
            <div>
              <p className="font-display font-semibold text-white text-[15px]">{d.name}</p>
              {d.index_notes && <p className="text-[12px] text-[var(--color-steel-400)] mt-1 max-w-[200px]">{d.index_notes}</p>}
            </div>
            {d.transparency_rating != null && (
              <Stamp
                variant={d.transparency_rating >= 3.5 ? 'verified' : d.transparency_rating >= 2 ? 'pending' : 'flagged'}
                size={52}
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
