// Demo data for local development and screenshots: two branches, last year's and this
// year's session, about 45 students (some with last year's history), staff and logins.
//
//   npm run db:migrate && npm run seed
//
// It writes seed/.seed.sql and loads it into the LOCAL database only. Run it on an empty
// database. Never use this against production.
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
  return seed % n;
};
const pick = (list) => list[rnd(list.length)];

insert('settings', { key: 'school_name', value: 'Soni Pariya Public School' });
insert('settings', { key: 'school_address', value: 'Kamalganj, Farrukhabad, Uttar Pradesh' });

const branches = [
  { id: 1, name: 'Kamalganj', code: 'KMG', address: 'Main Road, Kamalganj', phone: '9000000001' },
  {
    id: 2,
    name: 'Fatehgarh',
    code: 'FTG',
    address: 'Station Road, Fatehgarh',
    phone: '9000000002',
  },
];
for (const b of branches) {
  insert('branches', { ...b, active: 1, created_at: now });
  sql.push(
    `INSERT INTO sections (branch_id, class_id, name) SELECT ${b.id}, id, 'A' FROM classes;`,
  );
}
sql.push("INSERT INTO sections (branch_id, class_id, name) VALUES (1, 8, 'B');");

insert('academic_sessions', {
  id: 1,
  name: '2025-26',
  start_year: 2025,
  start_month: 4,
  is_current: 0,
  created_at: now,
});
insert('academic_sessions', {
  id: 2,
  name: '2026-27',
  start_year: 2026,
  start_month: 4,
  is_current: 1,
  created_at: now,
});

const users = [
  { id: 1, username: 'admin', name: 'Owner', role: 'admin', branches: [] },
  { id: 2, username: 'principal', name: 'Meena Sharma', role: 'principal', branches: [1] },
  { id: 3, username: 'accountant', name: 'Sunita Yadav', role: 'accountant', branches: [1] },
  { id: 4, username: 'teacher', name: 'Rakesh Gupta', role: 'teacher', branches: [1] },
  { id: 5, username: 'principal2', name: 'Anil Dubey', role: 'principal', branches: [2] },
];
for (const u of users) {
  insert('users', {
    id: u.id,
    username: u.username,
    name: u.name,
    password_hash: hash('demo12345'),
    role: u.role,
    active: 1,
    created_at: now,
    updated_at: now,
  });
  for (const b of u.branches) insert('user_branches', { user_id: u.id, branch_id: b });
}

const staff = [
  ['Meena Sharma', 'Principal', 1, 0, 2],
  ['Sunita Yadav', 'Accountant', 1, 0, 3],
  ['Rakesh Gupta', 'Teacher', 1, 1, 4],
  ['Kavita Mishra', 'Teacher', 1, 1, null],
  ['Ramesh Pal', 'Peon', 1, 0, null],
  ['Anil Dubey', 'Principal', 2, 0, 5],
  ['Shabnam Bano', 'Teacher', 2, 1, null],
];
staff.forEach(([name, designation, branch_id, is_teaching, user_id], i) =>
  insert('staff', {
    name,
    phone: `98${String(10000000 + i * 137)}`,
    designation,
    branch_id,
    joining_date: `20${18 + (i % 6)}-07-01`,
    is_teaching,
    user_id,
    active: 1,
    created_at: now,
    updated_at: now,
  }),
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
let id = 0;
for (const [branch, cls, count] of groups) {
  for (let i = 0; i < count; i++) {
    id++;
    const girl = rnd(2) === 1;
    const surname = pick(surnames);
    insert('students', {
      id,
      admission_no: String(1000 + id),
      name: `${pick(girl ? girls : boys)} ${surname}`,
      father_name: `${pick(fathers)} ${surname}`,
      mother_name: `${pick(girls)} Devi`,
      phone: `97${String(10000000 + id * 7919)}`,
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
        `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, result, created_at, updated_at) VALUES (${id}, 1, ${branch}, ${lastClass}, ${sectionOf(branch, lastClass, section)}, NULL, 'new', 'studying', '${repeated ? 'fail' : 'pass'}', ${q(now)}, ${q(now)});`,
      );
    }
    const left = id % 15 === 0;
    sql.push(
      `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, left_date, created_at, updated_at) VALUES (${id}, 2, ${branch}, ${cls}, ${sectionOf(branch, cls, section)}, ${roll}, '${old ? 'old' : 'new'}', '${left ? 'left' : 'studying'}', ${left ? "'2026-08-10'" : 'NULL'}, ${q(now)}, ${q(now)});`,
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
console.log(`Wrote seed/.seed.sql: ${id} students, ${staff.length} staff, ${users.length} logins.`);
console.log('Sign in as admin, principal, accountant or teacher. Password for all: demo12345');
