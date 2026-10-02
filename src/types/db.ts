export type UserRole = 'admin' | 'staff';
export type ShiftStatus =
  | 'open'
  | 'assigned'
  | 'scheduled'
  | 'leave_approved'
  | 'swapped_out'
  | 'completed'
  | 'cancelled';
export type ShiftSource = 'default' | 'manual' | 'swap';
export type AttendanceStatus = 'present' | 'late' | 'early_leave' | 'absent' | 'pending';
export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PayrollStatus = 'draft' | 'finalized';
export type AdjustmentType =
  | 'forgot_checkin'
  | 'forgot_checkout'
  | 'forgot_both'
  | 'official_late_early'
  | 'overtime';
export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface Store {
  id: number;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  store_id: number;
  email: string;
  password_hash: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  hourly_rate: number | bigint;
  ot_rate_multiplier: string;
  leave_balance: number;
  must_change_password: boolean;
  is_active: boolean;
  face_descriptor: number[] | null;
  telegram_chat_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export type SafeUser = Omit<User, 'password_hash' | 'face_descriptor'>;

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
}

export type ShiftType = 'REGULAR' | 'SPLIT' | 'FLEXIBLE';

export interface ShiftTemplate {
  id: string;
  store_id: number;
  name: string;
  color: string;
  shift_type: ShiftType;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftTemplateSegment {
  id: string;
  template_id: string;
  start_time: string;
  end_time: string;
  sort_order: number;
}

export interface Shift {
  id: string;
  store_id: number;
  template_id: string | null;
  assigned_to: string | null;
  status: ShiftStatus;
  work_date: string | Date;
  notes: string | null;
  source: ShiftSource;
  shift_type: ShiftType;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface StaffDefaultShift {
  id: number;
  store_id: number;
  user_id: string;
  weekday: number;
  shift_template_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftSegment {
  id: string;
  shift_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  sort_order: number;
}

export interface Attendance {
  id: string;
  store_id: number;
  shift_id: string;
  segment_id: string;
  user_id: string;
  status: AttendanceStatus;
  checkin_at: Date | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_accuracy: number | null;
  checkin_face_ok: boolean | null;
  checkin_distance_m: number | null;
  checkin_face_distance: number | null;
  checkout_at: Date | null;
  checkout_lat: number | null;
  checkout_lng: number | null;
  checkout_accuracy: number | null;
  checkout_face_ok: boolean | null;
  checkout_distance_m: number | null;
  checkout_face_distance: number | null;
  actual_minutes: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  ot_minutes: number;
  deduction_vnd: bigint;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FaceTemplate {
  id: string;
  store_id: number;
  user_id: string;
  descriptor: number[];
  consent_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AdjustmentRequest {
  id: string;
  store_id: number;
  user_id: string;
  shift_id: string | null;
  segment_id: string | null;
  attendance_id: string | null;
  request_type: AdjustmentType;
  reason: string;
  proposed_checkin_at: Date | null;
  proposed_checkout_at: Date | null;
  proposed_minutes: number | null;
  status: AdjustmentStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  admin_note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SwapRequest {
  id: string;
  store_id: number;
  requester_id: string;
  requester_shift: string;
  receiver_id: string | null;
  receiver_shift: string | null;
  status: SwapStatus;
  reason: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Leave {
  id: string;
  store_id: number;
  user_id: string;
  start_date: Date;
  end_date: Date;
  days_count: number;
  reason: string | null;
  status: LeaveStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Payroll {
  id: string;
  store_id: number;
  user_id: string;
  month: number;
  year: number;
  base_hours: number;
  ot_hours: number;
  base_pay_vnd: bigint;
  ot_pay_vnd: bigint;
  deductions_vnd: bigint;
  allowances_vnd: bigint;
  total_vnd: bigint;
  status: PayrollStatus;
  notes: string | null;
  finalized_by: string | null;
  finalized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
