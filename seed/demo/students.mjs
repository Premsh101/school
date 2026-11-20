// Sample students and staff for the Demo School (see seed/demo/build.sh). Writes
// seed/demo/.students.sql. Everything refers to the school by its code DEMO, never by id.
import { writeFileSync } from 'node:fs';

const q = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const NOW = '2026-04-01T04:30:00.000Z';
const DEMO = "(SELECT id FROM branches WHERE code = 'DEMO')";
const SESSION = "(SELECT id FROM academic_sessions WHERE name = '2026-27')";
const GUARD = "WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'demo.loading')";
const sql = [];

// A small fixed random generator so the demo data is the same every time.
let seed = 2026;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor(seed / 65536) % n;
};
const pick = (list) => list[rnd(list.length)];

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

// Three students in every class, Nursery (1) to Class 12 (15).
let n = 0;
for (let cls = 1; cls <= 15; cls++) {
  for (let roll = 1; roll <= 3; roll++) {
    n++;
    const girl = rnd(2) === 1;
    const surname = pick(surnames);
    const adm = `DEMO-${String(n).padStart(4, '0')}`;
    const student = {
      admission_no: adm,
      name: `${pick(girl ? girls : boys)} ${surname}`,
      father_name: `${pick(fathers)} ${surname}`,
      mother_name: `${pick(girls)} Devi`,
      phone: `90000${String(10000 + n * 37).slice(-5)}`,
      address: pick(villages),
      dob: `${2026 - (cls + 3)}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`,
      gender: girl ? 'female' : 'male',
      created_at: NOW,
      updated_at: NOW,
    };
    sql.push(
      `INSERT INTO students (${Object.keys(student).join(', ')}) SELECT ${Object.values(student).map(q).join(', ')} ${GUARD};`,
    );
    // Two in three were here last year (Old); the rest joined this year (New).
    const old = cls > 1 && rnd(3) > 0;
    const left = n % 16 === 0;
    sql.push(
      `INSERT INTO enrolments (student_id, session_id, branch_id, class_id, section_id, roll_no, admission_type, status, left_date, created_at, updated_at)
SELECT (SELECT id FROM students WHERE admission_no = ${q(adm)}), ${SESSION}, ${DEMO}, ${cls},
       (SELECT id FROM sections WHERE branch_id = ${DEMO} AND class_id = ${cls} AND name = 'A'),
       ${roll}, ${q(old ? 'old' : 'new')}, ${q(left ? 'left' : 'studying')}, ${left ? q('2026-08-10') : 'NULL'}, ${q(NOW)}, ${q(NOW)} ${GUARD};`,
    );
  }
}

const staff = [
  ['Kavita Sharma', 'Principal', 1],
  ['Manoj Tiwari', 'Teacher', 1],
  ['Rekha Gupta', 'Teacher', 1],
  ['Sanjay Verma', 'Accountant', 0],
  ['Ramesh Pal', 'Peon', 0],
];
staff.forEach(([name, designation, teaching], i) =>
  sql.push(
    `INSERT INTO staff (name, phone, designation, branch_id, joining_date, is_teaching, active, created_at, updated_at)
SELECT ${q(name)}, ${q(`90001${String(20000 + i * 113)}`)}, ${q(designation)}, ${DEMO}, ${q(`20${19 + i}-07-01`)}, ${teaching}, 1, ${q(NOW)}, ${q(NOW)} ${GUARD};`,
  ),
);

writeFileSync(new URL('./.students.sql', import.meta.url), sql.join('\n') + '\n');
console.log(`Wrote seed/demo/.students.sql: ${n} students, ${staff.length} staff.`);
