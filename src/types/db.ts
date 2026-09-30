/**
 * TypeScript types cho database rows
 * Reflect đúng schema trong migration 001
 */

export type UserRole = 'admin' | 'staff';
export type ShiftStatus = 'open' | 'assigned' | 'completed' | 'cancelled';
export type AttendanceStatus = 'present' | 'late' | 'early_leave' | 'absent' | 'pending';
export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PayrollStatus = 'draft' | 'finalized';

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
  hourly_rate: bigint;          // bigint VND [10-backend.md]
  ot_rate_multiplier: string;   // NUMERIC từ pg trả về string
  leave_balance: number;
  must_change_password: boolean;
  is_active: boolean;
  face_descriptor: number[] | null;  // Float32Array[128] lưu JSON
  telegram_chat_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// User không có password — dùng khi trả response
export type SafeUser = Omit<User, 'password_hash' | 'face_descriptor'>;

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
}

export interface ShiftTemplate {
  id: string;
  store_id: number;
  name: string;
  color: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftTemplateSegment {
  id: string;
  template_id: string;
  start_time: string;  // 'HH:mm' format
  end_time: string;
  sort_order: number;
}

export interface Shift {
  id: string;
  store_id: number;
  template_id: string | null;
  assigned_to: string | null;
  status: ShiftStatus;
  work_date: Date;   // DATE từ pg
  notes: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftSegment {
  id: string;
  shift_id: string;
  starts_at: Date;  // TIMESTAMPTZ
  ends_at: Date;
  sort_order: number;
}

export interface Attendance {
  id: string;
  store_id: number;
  shift_id: string;
  user_id: string;
  status: AttendanceStatus;
  checkin_at: Date | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_accuracy: number | null;
  checkin_face_ok: boolean | null;
  checkin_distance_m: number | null;
  checkout_at: Date | null;
  checkout_lat: number | null;
  checkout_lng: number | null;
  checkout_accuracy: number | null;
  checkout_face_ok: boolean | null;
  checkout_distance_m: number | null;
  actual_minutes: number | null;
  ot_minutes: number;
  deduction_vnd: bigint;
  notes: string | null;
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

// ─── Pagination ────────────────────────────────────────────────────────────
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
