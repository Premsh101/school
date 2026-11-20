import type { Allocation, FeeAmounts, FeePlan, FeePosition, PaymentMode } from './fees';

// Shapes of the fees API answers, shared by the Worker and the web app.

export interface FeeRateRow extends FeeAmounts {
  branch_id: number;
  class_id: number;
  admission_type: 'new' | 'old';
}

export interface ReceiptRow {
  id: number;
  receipt_no: string;
  date: string;
  amount: number;
  counter_discount: number;
  mode: PaymentMode;
  reference: string;
  note: string;
  collected_by_name: string;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  /** What the receipt cleared, e.g. "Admission, April to June". Empty for cancelled receipts. */
  covers: string;
}

export interface FeeStudent {
  enrolment_id: number;
  student_id: number;
  admission_no: string;
  name: string;
  father_name: string;
  phone: string;
  phone2: string;
  branch_id: number;
  class_id: number;
  section_name: string;
  roll_no: number | null;
  admission_type: 'new' | 'old';
  status: 'studying' | 'left';
  session_id: number;
  session_name: string;
  start_year: number;
  start_month: number;
}

export interface StudentFeeDetail {
  student: FeeStudent;
  plan: FeePlan;
  discount_reason: string;
  /** The rate chart row for this student's class, or null if the chart has none. */
  rate: FeeAmounts | null;
  position: FeePosition;
  allocation: Allocation;
  due_at_admission: number;
  quick: { due_today: number; one_month: number; full: number };
  /** Newest first, cancelled ones included. */
  receipts: ReceiptRow[];
}

export interface CollectRow {
  enrolment_id: number;
  student_id: number;
  name: string;
  father_name: string;
  phone: string;
  branch_id: number;
  class_id: number;
  section_name: string;
  roll_no: number | null;
  status: 'studying' | 'left';
  pending: number;
  overdue: number;
}

export interface ReceiptDetail {
  receipt: ReceiptRow;
  student: FeeStudent;
  branch: { name: string; address: string; phone: string };
  school: { name: string; address: string; logo: string };
  /** The student's position now, after this receipt. */
  pending: number;
  overdue: number;
}

export interface MoneySums {
  students: number;
  fee: number;
  discount: number;
  net: number;
  paid: number;
  counter_discount: number;
  pending: number;
  overdue: number;
}

export interface FeesDashboard {
  total: MoneySums;
  /** Students in the session who have no fees set up yet. */
  missing_fees: number;
  by_branch: (MoneySums & { branch_id: number })[];
  by_class: (MoneySums & { class_id: number })[];
  today: number;
  last_7_days: number;
  this_month: number;
  /** One entry per month of the session. */
  by_month: { year: number; month: number; amount: number }[];
  last_14_days: { date: string; amount: number }[];
  by_mode: { mode: PaymentMode; amount: number; receipts: number }[];
  largest_dues: (CollectRow & { phone2: string })[];
  latest_receipts: {
    id: number;
    receipt_no: string;
    date: string;
    name: string;
    amount: number;
    mode: PaymentMode;
    cancelled: number;
  }[];
}

export type ReportColumnKind = 'text' | 'money' | 'number' | 'date';
export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
}
export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  /** True when there were more rows than the limit; narrow the filters to see the rest. */
  truncated: boolean;
}

export const REPORTS = [
  { id: 'collection', name: 'Collection register', filters: ['dates', 'branch', 'class', 'mode'] },
  { id: 'daywise', name: 'Day-wise collection by mode', filters: ['dates', 'branch'] },
  { id: 'pending', name: 'Pending dues', filters: ['basis', 'min', 'branch', 'class', 'section'] },
  { id: 'register', name: 'Fee register', filters: ['branch', 'class', 'section'] },
  { id: 'classwise', name: 'Class-wise summary', filters: ['branch'] },
  { id: 'branchwise', name: 'Branch-wise summary', filters: [] },
  { id: 'discounts', name: 'Discounts given', filters: ['branch', 'class'] },
  { id: 'staff', name: 'Collected by staff member', filters: ['dates', 'branch'] },
  { id: 'cancelled', name: 'Cancelled receipts', filters: ['dates', 'branch'] },
] as const;
export type ReportId = (typeof REPORTS)[number]['id'];
