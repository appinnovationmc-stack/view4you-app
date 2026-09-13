export type BookingCategory =
  | 'vehicle'
  | 'property'
  | 'accommodation'
  | 'high_value_item'
  | 'consultation'

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'assigned'
  | 'in_progress'
  | 'report_ready'
  | 'completed'
  | 'cancelled'

export type PaymentMethod = 'payshap' | 'card' | 'manual'
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed'

export interface Service {
  id: string
  category: BookingCategory
  name: string
  description: string | null
  price_excl_vat: number
  active: boolean
  sort_order: number
}

export interface Dealership {
  id: string
  name: string
  contact_person: string | null
  contact_number: string | null
  is_private_seller: boolean
  transparency_rating: number | null
  index_notes: string | null
}

export interface Booking {
  id: string
  customer_id: string | null
  category: BookingCategory
  status: BookingStatus
  first_name: string
  last_name: string
  phone: string
  email: string
  physical_address: string | null
  suburb: string | null
  city: string | null
  postal_code: string | null
  dealership_id: string | null
  seller_name: string | null
  seller_contact_person: string | null
  seller_contact_number: string | null
  viewing_address: string | null
  viewing_suburb: string | null
  viewing_city: string | null
  viewing_postal_code: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: string | null
  vehicle_colour: string | null
  vehicle_vin: string | null
  preferred_date_1: string | null
  preferred_date_2: string | null
  preferred_date_3: string | null
  scheduled_date: string | null
  message: string | null
  total_excl_vat: number
  assigned_inspector_id: string | null
  created_at: string
}

export interface BookingServiceLine {
  id: string
  booking_id: string
  service_id: string
  price_excl_vat: number
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

export const CATEGORY_LABEL: Record<BookingCategory, string> = {
  vehicle: 'Vehicle',
  property: 'Property',
  accommodation: 'Accommodation',
  high_value_item: 'High-Value Item',
  consultation: 'Consultation',
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  report_ready: 'Report Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
