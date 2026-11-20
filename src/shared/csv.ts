import type { ImportRowInput } from './schemas';

/** Small RFC 4180 CSV parser: quoted fields, doubled quotes, commas and newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? '' : String(c);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Rows sent to the server per request during an import. */
export const IMPORT_CHUNK = 100;

type ImportField = Exclude<keyof ImportRowInput, 'line'>;

/** Column headings we accept in an import file, in the order of the template. */
export const IMPORT_COLUMNS: { field: ImportField; heading: string; aliases: string[] }[] = [
  {
    field: 'admission_no',
    heading: 'Admission no',
    aliases: ['admissionno', 'admno', 'srno', 'sr'],
  },
  { field: 'name', heading: 'Name', aliases: ['studentname', 'student'] },
  {
    field: 'father_name',
    heading: "Father's name",
    aliases: ['fathersname', 'fathername', 'father'],
  },
  {
    field: 'mother_name',
    heading: "Mother's name",
    aliases: ['mothersname', 'mothername', 'mother'],
  },
  { field: 'phone', heading: 'Phone', aliases: ['mobile', 'mobileno', 'phoneno', 'contact'] },
  { field: 'phone2', heading: 'Phone 2', aliases: ['phone2', 'mobile2', 'altphone'] },
  { field: 'address', heading: 'Address', aliases: ['village'] },
  { field: 'dob', heading: 'Date of birth', aliases: ['dateofbirth', 'dob', 'birthdate'] },
  { field: 'gender', heading: 'Gender', aliases: ['sex'] },
  { field: 'class', heading: 'Class', aliases: ['std', 'standard'] },
  { field: 'section', heading: 'Section', aliases: ['sec'] },
  { field: 'roll_no', heading: 'Roll no', aliases: ['rollno', 'roll', 'rollnumber'] },
  {
    field: 'admission_type',
    heading: 'New or old',
    aliases: ['neworold', 'admissiontype', 'type'],
  },
];

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Turns a table (first row = headings) into import rows. Unknown columns are ignored and
 * reported, so the office can fix a heading and try again.
 */
export function tableToImportRows(table: unknown[][]): {
  rows: ImportRowInput[];
  unknownHeadings: string[];
  missingHeadings: string[];
} {
  const [header = [], ...body] = table;
  const unknownHeadings: string[] = [];
  const map: (ImportField | null)[] = header.map((h) => {
    const key = normal(String(h ?? ''));
    const col = IMPORT_COLUMNS.find((c) => normal(c.heading) === key || c.aliases.includes(key));
    if (!col && key) unknownHeadings.push(String(h));
    return col?.field ?? null;
  });
  const missingHeadings = (['name', 'class'] as const)
    .filter((f) => !map.includes(f))
    .map((f) => IMPORT_COLUMNS.find((c) => c.field === f)!.heading);
  const rows: ImportRowInput[] = [];
  body.forEach((cells, i) => {
    const row = { line: i + 2 } as ImportRowInput;
    for (const col of IMPORT_COLUMNS) row[col.field] = '';
    let any = false;
    cells.forEach((cell, c) => {
      const field = map[c];
      if (!field) return;
      const value = cellToString(cell);
      if (value) any = true;
      row[field] = value;
    });
    if (any) rows.push(row);
  });
  return { rows, unknownHeadings, missingHeadings };
}

function cellToString(cell: unknown): string {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/** Matches what people type for a class ("5", "V", "class 5", "kg1", "nur") to our class names. */
export function matchClassName(input: string, classNames: string[]): string | null {
  const key = normal(input)
    .replace(/^class/, '')
    .replace(/(st|nd|rd|th)$/, '');
  if (!key) return null;
  const roman: Record<string, string> = {
    i: '1',
    ii: '2',
    iii: '3',
    iv: '4',
    v: '5',
    vi: '6',
    vii: '7',
    viii: '8',
    ix: '9',
    x: '10',
    xi: '11',
    xii: '12',
  };
  const special: Record<string, string> = {
    nursery: 'Nursery',
    nur: 'Nursery',
    nry: 'Nursery',
    kg1: 'KG 1',
    lkg: 'KG 1',
    kg2: 'KG 2',
    ukg: 'KG 2',
  };
  const wanted = special[key] ?? `Class ${roman[key] ?? key}`;
  return classNames.find((n) => n.toLowerCase() === wanted.toLowerCase()) ?? null;
}
