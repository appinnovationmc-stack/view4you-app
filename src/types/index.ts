// RealName domain types — mirror supabase/schema.sql exactly.

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
  created_at: string
  accepted_at: string | null
  completed_at: string | null
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
