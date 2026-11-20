-- Initial school: what the school already has on its first day, loaded with the first
-- release so nobody has to type it in.
--
--   * the school's name and address
--   * the two schools (branches), Kamalganj (KMG) and Kannauj (KNJ), each with section A
--     in every class
--   * the 2026-27 session, set as the current one
--   * the printed 2026-27 fee rate chart, for both schools
--   * the first admin login: admin@sps.com, password admin@123 (asked for by the owner).
--     Only a PBKDF2 hash of the password is stored, and the app makes the admin choose a
--     new password at the first sign-in, so admin@123 stops working straight away.
--
-- Everything below is skipped when a login already exists (a school that was set up before
-- this migration), and INSERT OR IGNORE never overwrites a row that is already there.
-- The admin login is added last, because the other statements check that no login exists.
-- Names, codes and every fee can be changed later in the app. Never edit this file after
-- it has been applied in production; change data in the app instead.

INSERT OR IGNORE INTO settings (key, value)
SELECT 'school_name', 'Soni Pariya Public School' WHERE NOT EXISTS (SELECT 1 FROM users);
INSERT OR IGNORE INTO settings (key, value)
SELECT 'school_address', 'Kamalganj, Farrukhabad, Uttar Pradesh' WHERE NOT EXISTS (SELECT 1 FROM users);

INSERT OR IGNORE INTO branches (id, name, code, address, phone, active, created_at)
SELECT 1, 'Kamalganj', 'KMG', 'Kamalganj, Farrukhabad', '', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users);
INSERT OR IGNORE INTO branches (id, name, code, address, phone, active, created_at)
SELECT 2, 'Kannauj', 'KNJ', 'Kannauj', '', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users);

INSERT OR IGNORE INTO academic_sessions (name, start_year, start_month, is_current, created_at)
SELECT '2026-27', 2026, 4, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users);

-- Section A in every class of both branches, so students can be added straight away.
INSERT OR IGNORE INTO sections (branch_id, class_id, name)
SELECT b.id, c.id, 'A' FROM branches b, classes c
WHERE b.code IN ('KMG', 'KNJ') AND NOT EXISTS (SELECT 1 FROM users);

-- The printed fee chart for 2026-27. Classes are given by their order
-- (Nursery = 1, KG 1 = 2, KG 2 = 3, Class 1 = 4 ... Class 12 = 15).
-- Columns: first class, last class, new/old, registration, admission, board, annual,
--          practical, higher practical, TBDB etc., monthly fee.
INSERT OR IGNORE INTO fee_rates
  (session_id, branch_id, class_id, admission_type, registration, admission, board, annual,
   practical, practical_alt, tbdb, monthly, updated_at)
WITH chart (from_order, to_order, admission_type, registration, admission, board, annual,
            practical, practical_alt, tbdb, monthly) AS (
  VALUES
    (1, 3, 'new', 100, 2500, 0, 0, 0, 0, 500, 700),
    (1, 3, 'old', 0, 0, 0, 1800, 0, 0, 0, 700),
    (4, 8, 'new', 100, 3000, 0, 0, 0, 0, 500, 800),
    (4, 8, 'old', 0, 0, 0, 2000, 0, 0, 0, 800),
    (9, 11, 'new', 100, 3200, 0, 0, 0, 0, 600, 900),
    (9, 11, 'old', 0, 0, 0, 2200, 0, 0, 0, 900),
    (12, 12, 'new', 200, 3500, 1000, 0, 600, 0, 700, 1200),
    (12, 12, 'old', 0, 0, 1000, 2500, 600, 0, 0, 1200),
    (13, 13, 'new', 200, 4000, 1200, 0, 600, 0, 800, 1200),
    (13, 13, 'old', 0, 0, 1200, 2800, 600, 0, 0, 1200),
    (14, 14, 'new', 200, 4500, 1000, 0, 600, 900, 800, 1400),
    (14, 14, 'old', 0, 0, 1000, 3000, 600, 900, 0, 1400),
    (15, 15, 'new', 200, 5000, 1500, 0, 600, 900, 800, 1400),
    (15, 15, 'old', 0, 0, 1500, 3500, 600, 900, 0, 1400)
)
SELECT s.id, b.id, c.id, g.admission_type, g.registration, g.admission, g.board, g.annual,
       g.practical, g.practical_alt, g.tbdb, g.monthly, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM academic_sessions s
JOIN branches b ON b.code IN ('KMG', 'KNJ')
JOIN chart g
JOIN classes c ON c.sort_order BETWEEN g.from_order AND g.to_order
WHERE s.name = '2026-27' AND NOT EXISTS (SELECT 1 FROM users);

INSERT INTO audit_log (at, user_name, action, entity, summary)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'System', 'create', 'school',
       'Loaded the school, Kamalganj and Kannauj, session 2026-27, the fee chart and the admin login'
WHERE NOT EXISTS (SELECT 1 FROM users);

-- The first admin login. The password is admin@123, stored only as a hash. must_change_password
-- = 1 makes the admin set their own password at the first sign-in.
INSERT INTO users (username, name, password_hash, role, active, must_change_password, created_at, updated_at)
SELECT 'admin@sps.com', 'Admin',
       'pbkdf2-sha256$20000$I9FK5Q3PsTus3fhFqbX4fw==$Ms+lwaXZPPz/zNH4ndFwBvR2uPMxS2CeHpM0JEOIaiE=',
       'admin', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM users);
