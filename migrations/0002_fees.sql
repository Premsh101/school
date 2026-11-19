-- Phase 1 (fees), part 1: the rate chart.
-- One row per session + class + new/old student. Amounts are whole rupees.
-- Editing the chart never changes students already enrolled; their fees are copied
-- from it at enrolment (built in the next part of this phase).

CREATE TABLE fee_rates (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
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
  UNIQUE (session_id, class_id, admission_type)
);
