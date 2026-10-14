// CheckVertical domain types — mirror supabase/schema.sql exactly.

export type UserRole = 'buyer' | 'inspector'

export interface Profile {
  id: string
  role: UserRole
  name: string
  first_name: string
  init: string
  email: string
  phone: string | null
  cert: string | null
  licence: string | null
  experience: string | null
  region: string | null
  specialty: string | null
  bio: string | null
  rating: number
  jobs_completed: number
  price: number | null
  eta_minutes: number | null
  online: boolean
  top_rated: boolean
  approved?: boolean
  badges?: InspectorBadge[]
  created_at: string
}

export interface Vehicle {
  vin: string
  make: string
  model: string
  year: number
  colour: string | null
  mileage: number | null
  engine: string | null
  transmission: string | null
  first_tracked_by: string | null
  created_at: string
}

export interface VehicleHistory {
  vin: string
  found: boolean
  source: string
  owners: number | null
  first_registered: string | null
  province: string | null
  stolen: boolean
  taxi_history: boolean
  colour_changes: number
  outstanding_finance: boolean
  finance_house: string | null
  fetched_at: string
}

export interface VehicleAccident {
  id: string
  vin: string
  date: string
  severity: 'Minor' | 'Major'
  description: string | null
}

export interface OdometerReading {
  id: string
  vin: string
  date: string
  km: number
}

export type BookingStatus = 'pending' | 'accepted' | 'en_route' | 'in_progress' | 'done' | 'cancelled'

export interface Booking {
  id: string
  buyer_id: string
  inspector_id: string | null
  vin: string
  location: string
  notes: string | null
  status: BookingStatus
  inspection_fee: number
  travel_fee: number
  platform_fee: number
  paid: boolean
  payment_status?: 'unpaid' | 'paid' | 'legacy_unverified' | 'refund_due' | 'refunded'
  amount_due?: number | null
  venue_kind?: VenueKind
  venue_name?: string | null
  auction_at?: string | null
  lot_number?: string | null
  needed_by?: string | null
  addon_fee?: number
  roadworthy_requested?: boolean
  station_id?: string | null
  station_fee_quote?: number | null
  tier_id?: string | null
  inspector_payout?: number | null
  platform_gross?: number | null
  founding?: boolean
  created_at: string
  accepted_at: string | null
  completed_at: string | null
}

export type VenueKind = 'private' | 'dealership' | 'auction'
export interface InspectorBadge { kind: 'identity_verified' | 'eov' | 'trade_qualified'; grade?: 'A' | 'B' | 'C' | null }
export interface TestingStation {
  id: string; name: string; address: string; city: string | null; province: string | null; phone: string | null
  grade: 'A' | 'B' | 'C'; registration_number: string; hours: string | null; test_fee: number
  vehicle_classes: string | null; lat: number | null; lng: number | null
}
export interface BookingOptions { roadworthy_addon_fee: number; travel_fee: number; platform_fee: number }
export interface RoadworthyCertificate {
  id: string; certificate_number: string; result: 'pass' | 'fail'; issued_on: string; expires_on: string | null
  storage_path: string; status: 'submitted' | 'verified' | 'rejected'; reject_reason: string | null
  station_name: string | null; station_grade: string | null
}
export interface ReportExtras {
  venue: { kind: VenueKind; name: string | null; auction_at: string | null; lot_number: string | null }
  inspector_badges: InspectorBadge[]
  roadworthy_certificate: null | {
    certificate_number: string; result: 'pass' | 'fail'; issued_on: string; expires_on: string | null
    verified: boolean; station_name: string | null; station_grade: string | null
  }
}

export type FindingStatus = 'pass' | 'warn' | 'fail'

export interface InspectionFinding {
  id: string
  inspection_id: string
  area: string
  status: FindingStatus
  note: string | null
}

export interface Inspection {
  id: string
  booking_id: string
  vin: string
  inspector_id: string
  score: number
  verdict: string | null
  full_price: number
  report_price: number
  payer_cut: number
  inspector_cut: number
  created_at: string
  // Detailed-report columns (supabase/report_schema.sql); null on legacy 12-area inspections.
  report_number?: string | null
  odometer_km?: number | null
  roadworthy_status?: 'pass' | 'fail' | null
  faults?: string[]
  warnings?: string[]
  submitted_at?: string | null
  findings?: InspectionFinding[]
}

export interface ReportPurchase {
  id: string
  inspection_id: string
  buyer_id: string
  amount_paid: number
  payer_earning: number
  inspector_earning: number
  purchased_at: string
}

export type NotificationType = 'earn' | 'track' | 'sys'

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  icon: string
  title: string
  body: string
  read: boolean
  created_at: string
}

export const INSPECTION_AREAS = [
  'Engine', 'Transmission', 'Brakes', 'Tyres', 'Suspension', 'Electricals',
  'Body & Paint', 'Interior', 'Lights', 'Exhaust', 'Battery', 'Charging System',
] as const

export const VEHICLE_MAKES = [
  'BMW', 'Ford', 'Honda', 'Hyundai', 'Kia', 'Mazda', 'Mercedes-Benz',
  'Nissan', 'Toyota', 'Volkswagen',
] as const
