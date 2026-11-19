# Fees (phase 1)

Rate chart, student fees with per-fee discounts, collection and receipts, dashboard and
reports. All money is whole rupees. Nothing financial is ever deleted.

## Who can do what

| Role           | See fees, dashboard, reports | Collect | Edit a student's fees | Cancel a receipt | Edit the rate chart |
| -------------- | ---------------------------- | ------- | --------------------- | ---------------- | ------------------- |
| Owner / Admin  | all branches                 | yes     | yes                   | yes              | yes                 |
| Principal      | own branches                 | yes     | yes                   | yes              | no                  |
| Accountant     | own branches                 | yes     | yes                   | no               | no                  |
| Teacher, Staff | no                           | no      | no                    | no               | no                  |

## Rate chart

- **Where:** More → Fee rate chart, for the session chosen in the top bar.
- **One chart per branch per session**, so Kannauj can charge differently from Kamalganj.
  A new branch starts with a copy of another branch's chart.
- Columns: registration, admission, board fee / registration, annual charge, practical,
  practical (higher option), TBDB etc., monthly fee; separately for new and old students.
- Neighbouring classes with the same fees are shown together ("Class 1 to 5"). To give
  one class different fees, open the group, untick the other classes and save.
- The edit sheet can set the same fees in other branches at the same time.
- **"At admission"** = all one-time charges + the first month, as on the printed chart.
- The first session starts with the printed 2026-27 chart (`DEFAULT_RATE_CHART` in
  `src/shared/fees.ts`). Opening a new session copies each branch's chart forward.
- **Editing the chart never changes students already enrolled.**

### Printed chart, session 2026-27

| Class group     | Type | Reg. | Adm. | Board | Annual | Practical | Higher practical | TBDB | Monthly | At admission |
| --------------- | ---- | ---- | ---- | ----- | ------ | --------- | ---------------- | ---- | ------- | ------------ |
| Nursery to KG 2 | New  | 100  | 2500 | 0     | 0      | 0         | 0                | 500  | 700     | 3800         |
| Nursery to KG 2 | Old  | 0    | 0    | 0     | 1800   | 0         | 0                | 0    | 700     | 2500         |
| Class 1 to 5    | New  | 100  | 3000 | 0     | 0      | 0         | 0                | 500  | 800     | 4400         |
| Class 1 to 5    | Old  | 0    | 0    | 0     | 2000   | 0         | 0                | 0    | 800     | 2800         |
| Class 6 to 8    | New  | 100  | 3200 | 0     | 0      | 0         | 0                | 600  | 900     | 4800         |
| Class 6 to 8    | Old  | 0    | 0    | 0     | 2200   | 0         | 0                | 0    | 900     | 3100         |
| Class 9         | New  | 200  | 3500 | 1000  | 0      | 600       | 0                | 700  | 1200    | 7200         |
| Class 9         | Old  | 0    | 0    | 1000  | 2500   | 600       | 0                | 0    | 1200    | 5300         |
| Class 10        | New  | 200  | 4000 | 1200  | 0      | 600       | 0                | 800  | 1200    | 8000         |
| Class 10        | Old  | 0    | 0    | 1200  | 2800   | 600       | 0                | 0    | 1200    | 5800         |
| Class 11        | New  | 200  | 4500 | 1000  | 0      | 600       | 900              | 800  | 1400    | 8500 / 8800  |
| Class 11        | Old  | 0    | 0    | 1000  | 3000   | 600       | 900              | 0    | 1400    | 6000 / 6300  |
| Class 12        | New  | 200  | 5000 | 1500  | 0      | 600       | 900              | 800  | 1400    | 9500 / 9800  |
| Class 12        | Old  | 0    | 0    | 1500  | 3500   | 600       | 900              | 0    | 1400    | 7000 / 7300  |

## Fee rules

All of these live in one pure module, `src/shared/fees.ts`, with unit tests in
`tests/money.test.ts`. The server always recomputes; screens only preview.

- **A student's fees** are copied from their branch's chart when they are added,
  imported or promoted: each one-time charge + monthly fee × months (12 by default,
  changeable per student). Class 11 and 12 choose practical 600 or 900.
- **Discount per fee type**, as % off or ₹ off. The monthly discount applies to every
  month. Percent discounts round to the nearest rupee. The type, the value and the
  resulting rupees are all stored. Shortcuts: same discount on all fees, clear discounts,
  reset to rate chart. A reason (sibling, staff ward, merit…) is kept.
- **Counter discount:** an extra ₹ or % off the amount being cleared, recorded on the receipt.
- **Due as of today** = net one-time charges + net monthly fee × months started so far
  (the current month counts, never more than the student's months).
- **Pending for the year** = net fee − paid − counter discounts.
- **Overdue** = due as of today − (paid + counter discounts), if positive.
- **Oldest first:** payments clear registration, admission, board, annual, practical,
  TBDB, then April, May, … Each month shows as Paid, Part paid, Due, Upcoming or Waived
  (months beyond the student's months, or with a 100% discount).
- A payment cannot be more than pending. The receipt date cannot be in the future.
  UPI, bank and cheque payments need a reference number.
- **Receipt number** = branch code + running number per branch (`KMG-00163`). A cancelled
  receipt keeps its number; numbers are never reused.
- **Cancel** (admin and principal): needs a reason; the receipt stays, struck through, and
  the balance recalculates.
- **A student marked Left** owes nothing further; what they paid stays in collections.
- A student's fee cannot be lowered below what they have already settled.
- **Late fee** is not built. It would be one more entry type in a student's `items` list.

## Screens

- **Fees** (dashboard): collected vs total, overdue now, due later, discounts; today /
  last 7 days / this month; last 14 days and by month; payment modes; branches compared;
  class-wise position; largest dues with phone; latest receipts. Admin can look at all
  branches or one.
- **Collect fee:** search by name, father, roll or phone; with no search, the students
  overdue today, largest first.
- **Student fee page:** summary, collect form (quick buttons Due today, One month, Full),
  month boxes, fees and discounts with balance, payments, Print statement.
- **Edit fees:** one card per fee with amount, discount type and value, and what the
  student pays; totals and due at admission.
- **Receipt:** narrow printable layout (thermal or A5) with the amount in words (Indian
  system), Send on WhatsApp and Copy text.
- **Fee reports:** collection register, day-wise collection by mode, pending dues (due
  today or whole year, minimum amount), fee register, class-wise and branch-wise summary,
  discounts given, collected by staff member, cancelled receipts. Each has filters,
  "Download for Excel" (a CSV file) and Print.
- **Fee rate chart.**

## Data

- `fee_rates`: session + branch + class + new/old → the eight amounts.
- `student_fees`: one row per enrolment. `items` is a JSON list of
  `{ type, amount, discount_type, discount_value, discount }`; totals are kept beside it
  for fast lists; `paid` and `counter_discount` are recalculated from `receipts` whenever
  a receipt is saved or cancelled.
- `receipts`: never deleted; `cancelled_at`, `cancelled_by_name`, `cancel_reason`.

The lists, dashboard and reports work the position out in SQL (`positionSql` in
`service.ts`) with the same rules as `feePosition()`; an API test checks they agree.

## API (under `/api/fees`)

| Route                                                                                                   | Permission        |
| ------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET /rates`, `GET /dashboard`, `GET /students/:enrolmentId`, `GET /receipts/:id`, `GET /reports/:name` | `fees.view`       |
| `GET /collect`, `POST /receipts`                                                                        | `fees.collect`    |
| `PUT /students/:enrolmentId`, `POST /sync`                                                              | `fees.edit`       |
| `POST /receipts/:id/cancel`                                                                             | `fees.cancel`     |
| `PUT /rates`, `POST /rates/start`                                                                       | `fees.rates.edit` |

## Decisions made for the owner (change if wrong)

- Each branch has its own rate chart.
- The monthly fee is charged for 12 months unless changed for a student.
- Accountants may edit a student's fees and discounts; every change is in the activity log
  and the Discounts report.
- Not built: import of the v1 fees backup (`reference/school-fees-v1/` is not in the
  repository), late fees, SMS.
