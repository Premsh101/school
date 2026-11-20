-- Phase 0: core tables. Never edit this file after it has been applied in production;
-- add a new numbered migration instead.

CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE academic_sessions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,              -- '2026-27'
  start_year INTEGER NOT NULL UNIQUE,     -- 2026
  start_month INTEGER NOT NULL DEFAULT 4, -- 1-12, April by default
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE
);

INSERT INTO classes (id, name, sort_order) VALUES
  (1, 'Nursery', 1), (2, 'KG 1', 2), (3, 'KG 2', 3),
  (4, 'Class 1', 4), (5, 'Class 2', 5), (6, 'Class 3', 6), (7, 'Class 4', 7),
  (8, 'Class 5', 8), (9, 'Class 6', 9), (10, 'Class 7', 10), (11, 'Class 8', 11),
  (12, 'Class 9', 12), (13, 'Class 10', 13), (14, 'Class 11', 14), (15, 'Class 12', 15);

CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (branch_id, class_id, name)
);

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- admin, management or accountant. Checked in code (src/shared/permissions.ts) rather than
  -- here, so later modules can add roles such as teacher without rebuilding this table.
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  -- 1 = must set a new password at the next sign-in (new logins, reset passwords).
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_branches (
  user_id INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- The school chosen at sign-in. Everything the person sees is limited to it.
  -- NULL = all schools, which only admin and management may choose.
  branch_id INTEGER REFERENCES branches(id),
  created_at INTEGER NOT NULL,  -- unix seconds
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions (user_id);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL           -- unix seconds
);
CREATE INDEX login_attempts_username ON login_attempts (username, at);
CREATE INDEX login_attempts_ip ON login_attempts (ip, at);

-- A student is one person. Each academic session they attend has one enrolment row,
-- so class, section, roll number and result are kept year by year.
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  admission_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  father_name TEXT NOT NULL DEFAULT '',
  mother_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone2 TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  dob TEXT,                               -- YYYY-MM-DD
  gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'male', 'female', 'other')),
  photo_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX students_name ON students (name COLLATE NOCASE);
CREATE INDEX students_phone ON students (phone);

CREATE TABLE enrolments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  section_id INTEGER NOT NULL REFERENCES sections(id),
  roll_no INTEGER,
  admission_type TEXT NOT NULL DEFAULT 'new' CHECK (admission_type IN ('new', 'old')),
  status TEXT NOT NULL DEFAULT 'studying' CHECK (status IN ('studying', 'left')),
  left_date TEXT,
  -- Year-end result, set by the promotion tool: pass moves to the next class,
  -- fail repeats the same class in the next session.
  result TEXT CHECK (result IN ('pass', 'fail')),
  result_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, session_id)
);
CREATE INDEX enrolments_place ON enrolments (session_id, branch_id, class_id, section_id);
CREATE UNIQUE INDEX enrolments_roll ON enrolments (session_id, branch_id, class_id, section_id, roll_no)
  WHERE roll_no IS NOT NULL;

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  joining_date TEXT,
  is_teaching INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER UNIQUE REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX staff_branch ON staff (branch_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,              -- ISO timestamp (UTC)
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,          -- create, update, cancel, sign_in, ...
  entity TEXT NOT NULL,          -- student, enrolment, branch, ...
  entity_id INTEGER,
  branch_id INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  details TEXT                   -- JSON
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
