# Fees (phase 1)

Built so far: **the rate chart**. Still to come: student fees with per-fee discounts,
collection and receipts, dashboard, reports.

## Rate chart

The chart says what each class pays in a session, separately for new and old students:
registration, admission, board fee / registration, annual charge, practical, practical
(higher option), TBDB etc., and the monthly fee. Amounts are whole rupees.

- **Where:** More → Fee rate chart. It shows the session chosen in the top bar.
- **Who:** the admin can edit; principals and accountants can see and print it.
- **Groups:** neighbouring classes with exactly the same fees are shown together
  ("Class 1 to 5"), like the printed chart. To give one class different fees, open the
  group, untick the other classes and save; the group splits by itself.
- **"At admission"** = all one-time charges + the first month, as printed on the paper
  chart. For Class 11 and 12 a second total is shown for the higher practical option.
- **Starting values:** the first session is filled with the printed 2026-27 chart
  (`DEFAULT_RATE_CHART` in `src/shared/fees.ts`). Opening a new session copies the previous
  session's chart forward. A session without a chart shows a button to do the same.
- **Editing never changes students already enrolled.** Their fees will be copied from the
  chart when they are enrolled (next part of this phase).
- Every change is written to the activity log.

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

A unit test checks that the app's totals equal the totals printed on the paper chart.

## API (under `/api/fees`)

| Route               | Permission        | What it does                                  |
| ------------------- | ----------------- | --------------------------------------------- |
| `GET /rates`        | `fees.view`       | Chart of one session (`?session_id=`)         |
| `PUT /rates`        | `fees.rates.edit` | Set new and old fees for the chosen classes   |
| `POST /rates/start` | `fees.rates.edit` | Fill an empty chart from the previous session |

## Open questions for the owner

- Is the chart the same for every branch (Kamalganj and Kannauj)? It is one chart per
  session for the whole school now.
- Is the monthly fee charged for 12 months, or fewer?
