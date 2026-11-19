import type { Role } from './permissions';

export interface Branch {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  active: number;
}
export interface AcademicSession {
  id: number;
  name: string;
  start_year: number;
  start_month: number;
  is_current: number;
}
export interface SchoolClass {
  id: number;
  name: string;
  sort_order: number;
}
export interface Section {
  id: number;
  branch_id: number;
  class_id: number;
  name: string;
  active: number;
}
export interface Subject {
  id: number;
  name: string;
  code: string;
  active: number;
}
export interface Me {
  id: number;
  username: string;
  name: string;
  role: Role;
  permissions: string[];
  /** Branch IDs the user may work in. */
  branch_ids: number[];
}
export interface Bootstrap {
  needs_setup: boolean;
  user: Me | null;
  school: { name: string; address: string; logo: string };
  branches: Branch[];
  sessions: AcademicSession[];
  classes: SchoolClass[];
  sections: Section[];
  modules: Record<string, boolean>;
  today: string;
}
export interface UserRow {
  id: number;
  username: string;
  name: string;
  role: Role;
  active: number;
  branch_ids: number[];
}
export interface StudentListRow {
  enrolment_id: number;
  student_id: number;
  admission_no: string;
  name: string;
  father_name: string;
  phone: string;
  branch_id: number;
  class_id: number;
  section_id: number;
  section_name: string;
  roll_no: number | null;
  admission_type: 'new' | 'old';
  status: 'studying' | 'left';
  result: 'pass' | 'fail' | null;
}
export interface Paged<T> {
  rows: T[];
  page: number;
  page_size: number;
  total: number;
}
export interface Student {
  id: number;
  admission_no: string;
  name: string;
  father_name: string;
  mother_name: string;
  phone: string;
  phone2: string;
  address: string;
  dob: string | null;
  gender: '' | 'male' | 'female' | 'other';
}
export interface Enrolment {
  id: number;
  student_id: number;
  session_id: number;
  session_name: string;
  branch_id: number;
  class_id: number;
  section_id: number;
  section_name: string;
  roll_no: number | null;
  admission_type: 'new' | 'old';
  status: 'studying' | 'left';
  left_date: string | null;
  result: 'pass' | 'fail' | null;
}
export interface StudentDetail {
  student: Student;
  /** Newest session first. */
  enrolments: Enrolment[];
}
export interface StaffRow {
  id: number;
  name: string;
  phone: string;
  designation: string;
  branch_id: number;
  joining_date: string | null;
  is_teaching: number;
  user_id: number | null;
  username: string | null;
  active: number;
}
export interface AuditRow {
  id: number;
  at: string;
  user_name: string;
  action: string;
  entity: string;
  entity_id: number | null;
  branch_id: number | null;
  summary: string;
}
export interface ImportRowError {
  line: number;
  message: string;
}
export interface ImportResult {
  errors: ImportRowError[];
  valid: number;
  imported: number;
}
export interface PromotionCandidate {
  enrolment_id: number;
  student_id: number;
  admission_no: string;
  name: string;
  father_name: string;
  section_name: string;
  roll_no: number | null;
  status: 'studying' | 'left';
  result: 'pass' | 'fail' | null;
  /** Already has an enrolment in the target session. */
  already_moved: number;
}
export interface PromotionResult {
  promoted: number;
  repeating: number;
  passed_out: number;
  left: number;
  skipped: number;
}
export interface HomeSummary {
  students: { branch_id: number; count: number }[];
  staff: { branch_id: number; count: number }[];
}
export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
