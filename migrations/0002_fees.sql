-- Phase 1: fees. All amounts are whole rupees. Nothing here is ever hard-deleted.

-- Rate chart: one row per session + branch + class + new/old student.
-- Editing it never changes students already enrolled; their fees are copied into
-- student_fees when they are enrolled.
CREATE TABLE fee_rates (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  admission_type TEXT NOT NULL CHECK (admission_type IN ('new', 'old')),
  registration INTEGER NOT NULL DEFAULT 0 CHECK (registration >= 0),
  admission INTEGER NOT NULL DEFAULT 0 CHECK (admission >= 0),
  board INTEGER NOT NULL DEFAULT 0 CHECK (board >= 0),
  annual INTEGER NOT NULL DEFAULT 0 CHECK (annual >= 0),
  practical INTEGER NOT NULL DEFAULT 0 CHECK (practical >= 0),
  practical_alt INTEGER NOT NULL DEFAULT 0 CHECK (practical_alt >= 0), -- higher option, 0 = none
  tbdb INTEGER NOT NULL DEFAULT 0 CHECK (tbdb >= 0),
  monthly INTEGER NOT NULL DEFAULT 0 CHECK (monthly >= 0),
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, branch_id, class_id, admission_type)
);

-- One row per enrolment: what this student is charged this session.
-- `items` is a JSON list, one entry per fee type:
--   { type, amount, discount_type: none|percent|amount, discount_value, discount }
-- (for the monthly fee, amount and discount are per month). A late fee can be added
-- later as another entry type. The totals beside it are kept so lists and reports can
-- add up thousands of students in SQL; paid and counter_discount are recalculated
-- from the receipts table every time a receipt is saved or cancelled.
CREATE TABLE student_fees (
  enrolment_id INTEGER PRIMARY KEY REFERENCES enrolments(id),
  months INTEGER NOT NULL DEFAULT 12 CHECK (months BETWEEN 0 AND 12),
  items TEXT NOT NULL,
  one_time_gross INTEGER NOT NULL,
  one_time_net INTEGER NOT NULL,
  monthly_gross INTEGER NOT NULL,
  monthly_net INTEGER NOT NULL,
  discount_reason TEXT NOT NULL DEFAULT '',
  paid INTEGER NOT NULL DEFAULT 0,
  counter_discount INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Receipts are never deleted. A cancelled receipt keeps its number and stays visible.
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,            -- branch code + running number, e.g. KMG-00163
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  seq INTEGER NOT NULL,                       -- running number within the branch
  enrolment_id INTEGER NOT NULL REFERENCES enrolments(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
  date TEXT NOT NULL,                         -- YYYY-MM-DD, never in the future
  amount INTEGER NOT NULL CHECK (amount >= 0),             -- money received
  counter_discount INTEGER NOT NULL DEFAULT 0 CHECK (counter_discount >= 0),
  counter_discount_type TEXT NOT NULL DEFAULT 'none' CHECK (counter_discount_type IN ('none', 'percent', 'amount')),
  counter_discount_value INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'bank', 'cheque')),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  collected_by INTEGER,
  collected_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by_name TEXT,
  cancel_reason TEXT,
  UNIQUE (branch_id, seq)
);
CREATE INDEX receipts_enrolment ON receipts (enrolment_id);
CREATE INDEX receipts_session_date ON receipts (session_id, date);
