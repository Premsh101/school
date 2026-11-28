-- Late fees, transport routes and cancelled registrations (owner's requests, 2026-11-27).

-- Late fee: ₹5 a day after the 20th of the month, taken on the receipt next to the fees.
-- receipts.amount stays the money received (cash tally); late_fee is the part of it that is a
-- late fee, so the fees cleared by a receipt are amount - late_fee + counter_discount.
ALTER TABLE receipts ADD COLUMN late_fee INTEGER NOT NULL DEFAULT 0 CHECK (late_fee >= 0);
-- student_fees.paid keeps meaning "money received for fees", so it now excludes late fees.
ALTER TABLE student_fees ADD COLUMN late_fee_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE student_fees ADD COLUMN late_fee_waived INTEGER NOT NULL DEFAULT 0;

-- Every waiver stays on record with who gave it and why.
CREATE TABLE late_fee_waivers (
  id INTEGER PRIMARY KEY,
  enrolment_id INTEGER NOT NULL REFERENCES enrolments(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX late_fee_waivers_enrolment ON late_fee_waivers (enrolment_id);

-- Transport: routes the admin sets up once, then chosen per student. The fee is charged every
-- month with the tuition fee; the student keeps a copy of source and destination.
CREATE TABLE transport_routes (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  monthly_fee INTEGER NOT NULL CHECK (monthly_fee >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (branch_id, source, destination)
);
ALTER TABLE student_fees ADD COLUMN transport_route_id INTEGER REFERENCES transport_routes(id);
ALTER TABLE student_fees ADD COLUMN transport_from TEXT NOT NULL DEFAULT '';
ALTER TABLE student_fees ADD COLUMN transport_to TEXT NOT NULL DEFAULT '';

-- A registration can be cancelled with a reason. The student is then marked as left (so they owe
-- nothing further and what they paid stays in collections) and these say it was a cancellation.
ALTER TABLE enrolments ADD COLUMN cancelled_at TEXT;
ALTER TABLE enrolments ADD COLUMN cancel_reason TEXT;
ALTER TABLE enrolments ADD COLUMN cancelled_by_name TEXT;
