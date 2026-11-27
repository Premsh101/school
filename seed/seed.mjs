// Demo data for local development and screenshots: two branches, last year's and this
// year's session, about 45 students (some with last year's history), staff and logins.
//
//   npm run db:migrate && npm run seed
//
// It writes seed/.seed.sql and loads it into the LOCAL database only, after the migrations
// (which already load the school, both schools, the fee chart and the admin login).
// Run it once on a freshly migrated database. Never use this against production.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const ITERATIONS = 20000; // keep in step with src/worker/core/password.ts
const hash = (password) => {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password.normalize('NFKC'), salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64')}$${key.toString('base64')}`;
};
const q = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const sql = [];
const insert = (table, row) =>
  sql.push(
    `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`,
  );

// A small fixed random generator so the demo data is the same every time.
let seed = 42;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor(seed / 65536) % n;
};
const pick = (list) => list[rnd(list.length)];

// The school, both branches, the 2026-27 session and its fee chart are already loaded by
// migration 0003, so this script only adds what is missing.

sql.push("INSERT OR IGNORE INTO sections (branch_id, class_id, name) VALUES (1, 8, 'B');");

// Last year, so students can show their history. This year's session is already there.
sql.push(
  `INSERT OR IGNORE INTO academic_sessions (name, start_year, start_month, is_current, created_at) VALUES ('2025-26', 2025, 4, 0, ${q(now)});`,
);
const LAST = "(SELECT id FROM academic_sessions WHERE name = '2025-26')";
const THIS = "(SELECT id FROM academic_sessions WHERE name = '2026-27')";

// The admin login admin@sps.com (migration 0003) and the management login manager@sps.com
// (migration 0004) come with the release. For local demos they keep the passwords admin@123
// and manager@123 and are not asked to change them. The other demo logins use demo12345.
sql.push(
  "UPDATE users SET must_change_password = 0 WHERE username IN ('admin@sps.com', 'manager@sps.com');",
);
sql.push("UPDATE users SET name = 'Meena Sharma' WHERE username = 'manager@sps.com';");
const users = [
  { username: 'kamalganj@sps.com', name: 'Sunita Yadav', role: 'accountant', branches: [1] },
  { username: 'kannauj@sps.com', name: 'Anil Dubey', role: 'accountant', branches: [2] },
];
const userId = (username) => `(SELECT id FROM users WHERE username = '${username}')`;
for (const u of users) {
  insert('users', {
    username: u.username,
    name: u.name,
    password_hash: hash('demo12345'),
    role: u.role,
    active: 1,
    must_change_password: 0,
    created_at: now,
    updated_at: now,
  });
  for (const b of u.branches) {
    sql.push(
      `INSERT INTO user_branches (user_id, branch_id) VALUES (${userId(u.username)}, ${b});`,
    );
  }
}

const staff = [
  ['Meena Sharma', 'Manager', 1, 0, 'manager@sps.com'],
  ['Sunita Yadav', 'Accountant', 1, 0, 'kamalganj@sps.com'],
  ['Rakesh Gupta', 'Teacher', 1, 1, null],
  ['Kavita Mishra', 'Teacher', 1, 1, null],
  ['Ramesh Pal', 'Peon', 1, 0, null],
  ['Anil Dubey', 'Accountant', 2, 0, 'kannauj@sps.com'],
  ['Shabnam Bano', 'Teacher', 2, 1, null],
];
staff.forEach(([name, designation, branch_id, is_teaching, login], i) =>
  sql.push(
    `INSERT INTO staff (name, phone, designation, branch_id, joining_date, is_teaching, user_id, active, created_at, updated_at) VALUES (${[
      q(name),
      q(`98${String(10000000 + i * 137)}`),
      q(designation),
      branch_id,
      q(`20${18 + (i % 6)}-07-01`),
      is_teaching,
      login ? userId(login) : 'NULL',
      1,
      q(now),
      q(now),
    ].join(', ')});`,
  ),
);

const boys = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Arjun',
  'Rohit',
  'Imran',
  'Sahil',
  'Ankit',
  'Deepak',
  'Mohit',
];
const girls = [
  'Asha',
  'Pooja',
  'Neha',
  'Priya',
  'Anjali',
  'Sana',
  'Kajal',
  'Ritu',
  'Shivani',
  'Muskan',
];
const surnames = [
  'Kumar',
  'Singh',
  'Yadav',
  'Verma',
  'Khan',
  'Gupta',
  'Pal',
  'Mishra',
  'Rajput',
  'Saxena',
];
const fathers = [
  'Ram',
  'Suresh',
  'Mahesh',
  'Anil',
  'Salim',
  'Rajesh',
  'Vinod',
  'Santosh',
  'Irfan',
  'Dinesh',
];
const villages = ['Kamalganj', 'Jahanganj', 'Rajepur', 'Khudaganj', 'Bhojpur', 'Yakutganj'];

// [branch, class id, how many students]. Class ids: Nursery = 1 … Class 12 = 15.
const groups = [
  [1, 1, 4],
  [1, 3, 4],
  [1, 5, 4],
  [1, 8, 7],
  [1, 10, 5],
  [1, 12, 4],
  [1, 13, 4],
  [1, 15, 3],
  [2, 2, 3],
  [2, 6, 4],
  [2, 9, 3],
];
const rolls = new Map();
const sectionOf = (branch, cls, name) =>
  `(SELECT id FROM sections WHERE branch_id = ${branch} AND class_id = ${cls} AND name = '${name}')`;
// Student ids start high so they never clash with the Demo School's sample students (migration
// 0006), which already hold the first ids. The two sets of students can live side by side.
const FIRST_ID = 1000;
let id = FIRST_ID;
for (const [branch, cls, count] of groups) {
  for (let i = 0; i < count; i++) {
    id++;
    const girl = rnd(2) === 1;
    const surname = pick(surnames);
    insert('students', {
      id,
      admission_no: String(id),
      name: `${pick(girl ? girls : boys)} ${surname}`,
      father_name: `${pick(fathers)} ${surname}`,
      mother_name: `${pick(girls)} Devi`,
      phone: `97${String(10000000 + (id - FIRST_ID) * 7919)}`,
      phone2: '',
      address: pick(villages),
      dob: `${2026 - (cls + 2)}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`,
      gender: girl ? 'female' : 'male',
      created_at: now,
      updated_at: now,
    });
    const section = branch === 1 && cls === 8 && i >= 4 ? 'B' : 'A';
    const key = `${branch}|${cls}|${section}`;
    const roll = (rolls.get(key) ?? 0) + 1;
    rolls.set(key, roll);
    // Two in three were here last year too: most passed, a few failed and repeat the class.
    const old = cls > 1 && rnd(3) > 0;
    const repeated = old && rnd(8) === 0;
    if (old) {
      const lastClass = repeated ? cls : cls - 1;
      sql.push(
        `INSERT OR IGNORE INTO sections (branch_id, class_id, name) VALUES (${branch}, ${lastClass}, '${section}');`,
        `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, result, created_at, updated_at) VALUES (${id}, ${LAST}, ${branch}, ${lastClass}, ${sectionOf(branch, lastClass, section)}, NULL, 'new', 'studying', '${repeated ? 'fail' : 'pass'}', ${q(now)}, ${q(now)});`,
      );
    }
    const left = (id - FIRST_ID) % 15 === 14;
    sql.push(
      `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, left_date, created_at, updated_at) VALUES (${id}, ${THIS}, ${branch}, ${cls}, ${sectionOf(branch, cls, section)}, ${roll}, '${old ? 'old' : 'new'}', '${left ? 'left' : 'studying'}', ${left ? "'2026-08-10'" : 'NULL'}, ${q(now)}, ${q(now)});`,
    );
  }
}
insert('audit_log', {
  at: now,
  user_id: 1,
  user_name: 'Owner',
  action: 'create',
  entity: 'school',
  summary: 'Loaded demo data',
});

writeFileSync(new URL('./.seed.sql', import.meta.url), sql.join('\n') + '\n');
console.log(
  `Wrote seed/.seed.sql: ${id - FIRST_ID} students, ${staff.length} staff, ${users.length} logins.`,
);
console.log(
  'Sign in as admin@sps.com (password admin@123), manager@sps.com (manager@123), or kamalganj@sps.com, kannauj@sps.com (password demo12345).',
);
