import { useState } from 'react';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Button, ErrorNote, PageHead } from '../components/ui';

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface BackupFile {
  format: string;
  version: number;
  exported_at: string;
  school: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export function BackupPage() {
  const boot = useBoot();
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  // The backup is fetched table by table in small pages and put together here in the browser.
  async function download() {
    setError(null);
    setDone(false);
    try {
      const manifest = await api.get<{
        format: string;
        version: number;
        tables: { name: string; rows: number }[];
      }>('/backup');
      const file: BackupFile = {
        format: manifest.format,
        version: manifest.version,
        exported_at: new Date().toISOString(),
        school: boot.school.name,
        tables: {},
      };
      for (const table of manifest.tables) {
        const rows: Record<string, unknown>[] = [];
        let after: number | null = 0;
        while (after !== null) {
          setProgress(
            t('Reading {table} ({done} of {total})…', {
              table: table.name,
              done: rows.length,
              total: table.rows,
            }),
          );
          const page: { rows: Record<string, unknown>[]; next: number | null } = await api.get(
            `/backup/${table.name}?after=${after}`,
          );
          rows.push(...page.rows);
          after = page.next;
        }
        file.tables[table.name] = rows;
      }
      downloadFile(`school-backup-${boot.today}.json`, JSON.stringify(file), 'application/json');
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setProgress('');
    }
  }

  return (
    <div className="stack">
      <PageHead title={t('Backup')} />
      <div className="card stack">
        <h2>{t('Download a backup')}</h2>
        <p>
          {t(
            'Saves everything (students, staff, logins, settings, activity log) in one file. Do this every week and keep the file somewhere safe, for example in Google Drive.',
          )}
        </p>
        <p className="note warn">
          {t('The file contains phone numbers and addresses. Do not share it.')}
        </p>
        <Button variant="primary" block busy={!!progress} onClick={() => void download()}>
          {t('Download backup file')}
        </Button>
        {progress && (
          <p className="muted small" role="status">
            {progress}
          </p>
        )}
        {done && (
          <p className="note ok" role="status">
            {t('Backup downloaded. Check your Downloads folder.')}
          </p>
        )}
        <ErrorNote error={error} />
      </div>
      <div className="card stack">
        <h2>{t('Restore a backup')}</h2>
        <p>
          {t(
            'A backup can only be put back into an empty database, so that live data is never overwritten by mistake. On a new, empty installation the first screen offers "I have a backup file to restore".',
          )}
        </p>
      </div>
    </div>
  );
}

const RESTORE_CHUNK = 400;

/** Shown on the first-run screen: loads a backup file into the empty database. */
export function RestorePanel({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function restore() {
    if (!file) return;
    setError(null);
    try {
      let backup: BackupFile;
      try {
        backup = JSON.parse(await file.text()) as BackupFile;
      } catch {
        throw new Error(
          t(
            'This file could not be read. Choose the .json file that was downloaded from the Backup page.',
          ),
        );
      }
      if (backup.format !== 'school-app-backup' || typeof backup.tables !== 'object') {
        throw new Error(
          t(
            'This is not a backup from this app. Choose the .json file that was downloaded from the Backup page.',
          ),
        );
      }
      const { token, tables } = await api.post<{ token: string; tables: string[] }>(
        '/restore/begin',
      );
      for (const table of tables) {
        const rows = backup.tables[table] ?? [];
        for (let i = 0; i < rows.length; i += RESTORE_CHUNK) {
          setProgress(
            t('Restoring {table} ({done} of {total})…', { table, done: i, total: rows.length }),
          );
          await api.post('/restore/chunk', {
            token,
            table,
            rows: rows.slice(i, i + RESTORE_CHUNK),
          });
        }
      }
      await api.post('/restore/finish', { token });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setProgress('');
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        {t(
          'Choose the backup file (.json). Everything in it is loaded, and you then sign in with the same usernames and passwords as before.',
        )}
      </p>
      <div className="field">
        <label htmlFor="restore-file">{t('Backup file')}</label>
        <input
          id="restore-file"
          type="file"
          accept=".json,application/json"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <ErrorNote error={error} />
      {progress && (
        <p className="muted small" role="status">
          {progress}
        </p>
      )}
      <Button
        variant="primary"
        block
        disabled={!file}
        busy={!!progress}
        onClick={() => void restore()}
      >
        {t('Restore this backup')}
      </Button>
    </div>
  );
}
