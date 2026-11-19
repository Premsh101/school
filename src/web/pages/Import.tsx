import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { IMPORT_CHUNK, IMPORT_COLUMNS, parseCsv, tableToImportRows, toCsv } from '../../shared/csv';
import type { ImportRowInput } from '../../shared/schemas';
import type { ImportResult, ImportRowError } from '../../shared/types';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Button, ErrorNote, PageHead, SelectField } from '../components/ui';
import { downloadFile } from './Backup';

async function readTable(file: File): Promise<unknown[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    // Loaded only when an Excel file is chosen, to keep the app small.
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as unknown[][];
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error(
      t(
        'Old .xls files cannot be read. Open the file in Excel and save it as .xlsx or .csv, then choose it again.',
      ),
    );
  }
  return parseCsv(await file.text());
}

/** Problems that span the whole file, which the server cannot see chunk by chunk. */
function crossFileErrors(rows: ImportRowInput[]): ImportRowError[] {
  const errors: ImportRowError[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row.admission_no.trim().toLowerCase();
    if (!key) continue;
    const first = seen.get(key);
    if (first)
      errors.push({
        line: row.line,
        message: t('Admission number {no} is also on line {line}.', {
          no: row.admission_no,
          line: first,
        }),
      });
    else seen.set(key, row.line);
  }
  return errors;
}

export function ImportPage() {
  const boot = useBoot();
  const client = useQueryClient();
  const [branchId, setBranchId] = useState<string>(
    boot.activeBranches.length === 1 ? String(boot.activeBranches[0]!.id) : '',
  );
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRowInput[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [errors, setErrors] = useState<ImportRowError[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  const [imported, setImported] = useState<number | null>(null);

  const reset = () => {
    setRows([]);
    setNotes([]);
    setErrors(null);
    setFailure(null);
    setImported(null);
  };

  async function send(commit: boolean): Promise<{ errors: ImportRowError[]; imported: number }> {
    const all: ImportRowError[] = [];
    let count = 0;
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      setBusy(
        t('{done} of {total} rows…', {
          done: Math.min(i + IMPORT_CHUNK, rows.length),
          total: rows.length,
        }),
      );
      const res = await api.post<ImportResult>(`/students/import${commit ? '?commit=1' : ''}`, {
        branch_id: Number(branchId),
        session_id: boot.session?.id,
        rows: rows.slice(i, i + IMPORT_CHUNK),
      });
      all.push(...res.errors);
      count += res.imported;
    }
    return { errors: all, imported: count };
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = tableToImportRows(await readTable(file));
      if (parsed.missingHeadings.length > 0) {
        throw new Error(
          t(
            'The file needs a column called {names}. The first row must have the column headings. Download the sample file to see the layout.',
            { names: parsed.missingHeadings.join(' and ') },
          ),
        );
      }
      if (parsed.rows.length === 0)
        throw new Error(t('The file has headings but no students under them.'));
      setRows(parsed.rows);
      setNotes(
        parsed.unknownHeadings.length
          ? [
              t('These columns are not used and will be skipped: {names}', {
                names: parsed.unknownHeadings.join(', '),
              }),
            ]
          : [],
      );
    } catch (e) {
      setFailure(e);
    }
  }

  async function run(commit: boolean) {
    setFailure(null);
    setErrors(null);
    try {
      const cross = crossFileErrors(rows);
      // Always check the whole file first, so nothing is saved if any row is wrong.
      const check = await send(false);
      const found = [...cross, ...check.errors].sort((a, b) => a.line - b.line);
      setErrors(found);
      if (commit && found.length === 0) {
        const res = await send(true);
        setImported(res.imported);
        setRows([]);
        await client.invalidateQueries();
      }
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy('');
    }
  }

  const template = () =>
    downloadFile(
      'students-sample.csv',
      toCsv([
        IMPORT_COLUMNS.map((c) => c.heading),
        [
          '101',
          'Asha Kumari',
          'Ram Kumar',
          'Sita Devi',
          '9876543210',
          '',
          'Kamalganj',
          '23/08/2015',
          'Girl',
          '5',
          'A',
          '1',
          'Old',
        ],
      ]),
      'text/csv',
    );

  return (
    <div className="stack">
      <PageHead title={t('Import students')} back="/students" />
      <div className="card stack">
        <p>
          {t(
            'Add many students at once from an Excel (.xlsx) or CSV file. The first row must have column headings. Students go into session {session}.',
            { session: boot.session?.name ?? '' },
          )}
        </p>
        <p className="muted small">
          {t('Needed columns: Name and Class. Others are optional: {names}.', {
            names: IMPORT_COLUMNS.filter((c) => !['name', 'class'].includes(c.field))
              .map((c) => c.heading)
              .join(', '),
          })}
        </p>
        <Button onClick={template}>{t('Download sample file')}</Button>
        {boot.activeBranches.length > 1 && (
          <SelectField
            label={t('Branch')}
            value={branchId}
            placeholder={t('Choose branch')}
            onChange={setBranchId}
            options={boot.activeBranches.map((b) => ({ value: String(b.id), label: b.name }))}
          />
        )}
        <div className="field">
          <label htmlFor="import-file">{t('Student list file')}</label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
      </div>

      <ErrorNote error={failure} />
      {notes.map((n) => (
        <p key={n} className="note warn">
          {n}
        </p>
      ))}
      {imported !== null && (
        <p className="note ok" role="status">
          {t('{n} students were imported.', { n: imported })}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <h2>{t('{n} students found in {file}', { n: rows.length, file: fileName })}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Line')}</th>
                  <th>{t('Name')}</th>
                  <th>{t('Father')}</th>
                  <th>{t('Class')}</th>
                  <th>{t('Roll')}</th>
                  <th>{t('Phone')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td>{r.father_name}</td>
                    <td>
                      {r.class} {r.section}
                    </td>
                    <td>{r.roll_no}</td>
                    <td>{r.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 && <p className="muted small">{t('Showing the first 8 rows.')}</p>}

          {errors && errors.length > 0 && (
            <>
              <p className="note error" role="alert">
                {t(
                  '{n} rows have problems. Nothing has been saved. Correct them in the file and choose it again.',
                  { n: new Set(errors.map((e) => e.line)).size },
                )}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Line')}</th>
                      <th>{t('What is wrong')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((e, i) => (
                      <tr key={i}>
                        <td>{e.line}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {errors && errors.length === 0 && (
            <p className="note ok">{t('All rows are correct and ready to import.')}</p>
          )}
          {!branchId && <p className="note warn">{t('Choose the branch first.')}</p>}
          <div className="row">
            <Button disabled={!branchId || !!busy} onClick={() => void run(false)}>
              {t('Check file')}
            </Button>
            <Button
              variant="primary"
              disabled={!branchId || !!busy || (errors !== null && errors.length > 0)}
              onClick={() => void run(true)}
            >
              {busy || t('Import {n} students', { n: rows.length })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
