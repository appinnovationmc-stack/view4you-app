export type BookingCategory =
  | 'vehicle'
  | 'property'
  | 'accommodation'
  | 'high_value_item'
  | 'consultation'

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export interface Service {
  id: string
  name: string
  description: string | null
  category: BookingCategory
  price_cents: number
  active: boolean
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: 'customer' | 'inspector' | 'admin'
}

export interface Booking {
  id: string
  user_id: string
  category: BookingCategory
  status: BookingStatus
  reference: string
  customer_name: string
  customer_email: string
  customer_phone: string | null
  seller_name: string | null
  seller_phone: string | null
  location: string | null
  notes: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  vehicle_vin: string | null
  created_at: string
  updated_at: string
}

export interface BookingService {
  id: string
  booking_id: string
  service_id: string
  price_cents: number
  service?: Service
}

export interface Report {
  id: string
  booking_id: string
  status: 'draft' | 'published'
  summary: string | null
  findings: string | null
  file_url: string | null
  published_at: string | null
  created_at: string
}

export interface Dealership {
  id: string
  name: string
  location: string | null
  rating: number | null
  inspections_count: number
  verified: boolean
}
