import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toCsv } from '../../../shared/csv';
import { formatDate } from '../../../shared/dates';
import { MODE_LABELS, PAYMENT_MODES } from '../../../shared/fees';
import {
  REPORTS,
  type ReportColumn,
  type ReportId,
  type ReportResult,
} from '../../../shared/fees-api';
import { api, query } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import {
  Button,
  Empty,
  ErrorNote,
  Loading,
  PageHead,
  SelectField,
  TextField,
} from '../../components/ui';
import { downloadFile } from '../../pages/Backup';
import { inr } from './shared';

const show = (column: ReportColumn, value: string | number | null): string => {
  if (value === null || value === '') return '';
  if (column.kind === 'money') return inr(Number(value));
  if (column.kind === 'date') return formatDate(String(value));
  if (column.key === 'mode')
    return t(MODE_LABELS[value as keyof typeof MODE_LABELS] ?? String(value));
  if (column.key === 'type') return value === 'new' ? t('New') : t('Old');
  if (column.key === 'status') return value === 'left' ? t('Left') : t('Studying');
  return String(value);
};

export function ReportsPage() {
  const boot = useBoot();
  const [reportId, setReportId] = useState<ReportId>('collection');
  const [f, setF] = useState({
    branch_id: '',
    class_id: '',
    section_id: '',
    from: '',
    to: '',
    mode: '',
    basis: 'today',
    min: '',
  });
  const [asked, setAsked] = useState<Record<string, string | number | undefined> | null>(null);
  const report = REPORTS.find((r) => r.id === reportId)!;
  const has = (filter: string) => (report.filters as readonly string[]).includes(filter);
  const set = (key: keyof typeof f) => (value: string) => setF((old) => ({ ...old, [key]: value }));
  const sections =
    f.branch_id && f.class_id ? boot.sectionsOf(Number(f.branch_id), Number(f.class_id)) : [];

  const result = useQuery({
    queryKey: ['fees', 'report', asked],
    queryFn: () =>
      api.get<ReportResult>(
        `/fees/reports/${asked!.report}${query({ ...asked, report: undefined })}`,
      ),
    enabled: !!asked,
  });
  const run = () =>
    setAsked({
      report: reportId,
      session_id: boot.session?.id,
      branch_id: has('branch') ? f.branch_id : '',
      class_id: has('class') ? f.class_id : '',
      section_id: has('section') ? f.section_id : '',
      from: has('dates') ? f.from : '',
      to: has('dates') ? f.to : '',
      mode: has('mode') ? f.mode : '',
      basis: has('basis') ? f.basis : '',
      min: has('min') ? f.min : '',
      at: Date.now(), // run again even if nothing changed
    });

  const data = result.data;
  const moneyColumns =
    data?.columns.filter(
      (c) => c.kind === 'money' || c.key === 'students' || c.key === 'receipts',
    ) ?? [];
  const total = (key: string) => data!.rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
  const download = () => {
    if (!data) return;
    // Plain numbers in the file so Excel can add them up.
    const rows = data.rows.map((row) =>
      data.columns.map((c) =>
        c.kind === 'money' || c.kind === 'number' ? row[c.key] : show(c, row[c.key] ?? null),
      ),
    );
    downloadFile(
      `${report.id}-${boot.today}.csv`,
      '﻿' + toCsv([data.columns.map((c) => t(c.label)), ...rows]),
      'text/csv',
    );
  };

  return (
    <div className="stack">
      <PageHead title={t('Fee reports')} />
      <div className="card stack no-print">
        <SelectField
          label={t('Report')}
          value={reportId}
          onChange={(v) => {
            setReportId(v as ReportId);
            setAsked(null);
          }}
          options={REPORTS.map((r) => ({ value: r.id, label: t(r.name) }))}
        />
        <div className="grid2">
          {has('dates') && (
            <TextField
              label={t('From date')}
              hint={t('Empty = start of session')}
              type="date"
              value={f.from}
              onChange={set('from')}
              max={boot.today}
            />
          )}
          {has('dates') && (
            <TextField
              label={t('To date')}
              hint={t('Empty = today')}
              type="date"
              value={f.to}
              onChange={set('to')}
              max={boot.today}
            />
          )}
          {has('basis') && (
            <SelectField
              label={t('Show')}
              value={f.basis}
              onChange={set('basis')}
              options={[
                { value: 'today', label: t('Due as of today') },
                { value: 'year', label: t('Pending for the whole year') },
              ]}
            />
          )}
          {has('min') && (
            <TextField
              label={t('Minimum amount (₹)')}
              value={f.min}
              onChange={(v) => set('min')(v.replace(/\D/g, ''))}
              inputMode="numeric"
            />
          )}
          {has('branch') && boot.branches.length > 1 && (
            <SelectField
              label={t('Branch')}
              value={f.branch_id}
              placeholder={t('All branches')}
              onChange={(v) => setF((old) => ({ ...old, branch_id: v, section_id: '' }))}
              options={boot.branches.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          )}
          {has('class') && (
            <SelectField
              label={t('Class')}
              value={f.class_id}
              placeholder={t('All classes')}
              onChange={(v) => setF((old) => ({ ...old, class_id: v, section_id: '' }))}
              options={boot.classes.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          )}
          {has('section') && sections.length > 1 && (
            <SelectField
              label={t('Section')}
              value={f.section_id}
              placeholder={t('All sections')}
              onChange={set('section_id')}
              options={sections.map((s) => ({ value: String(s.id), label: s.name }))}
            />
          )}
          {has('mode') && (
            <SelectField
              label={t('Paid by')}
              value={f.mode}
              placeholder={t('All modes')}
              onChange={set('mode')}
              options={PAYMENT_MODES.map((m) => ({ value: m, label: t(MODE_LABELS[m]) }))}
            />
          )}
        </div>
        <Button variant="primary" block busy={result.isFetching} onClick={run}>
          {t('Show report')}
        </Button>
      </div>

      <ErrorNote error={result.error} />
      {asked && result.isPending && <Loading />}
      {data && (
        <>
          <div className="row">
            <h2>
              {boot.school.name ? `${boot.school.name} · ` : ''}
              {data.title}
            </h2>
            <span className="row right no-print">
              <Button small onClick={download} disabled={data.rows.length === 0}>
                {t('Download for Excel')}
              </Button>
              <Button small onClick={() => window.print()} disabled={data.rows.length === 0}>
                {t('Print')}
              </Button>
            </span>
          </div>
          {data.truncated && (
            <p className="note warn">
              {t(
                'Only the first {n} rows are shown. Choose a branch, class or shorter dates to see the rest.',
                { n: data.rows.length },
              )}
            </p>
          )}
          {data.rows.length === 0 ? (
            <Empty>{t('Nothing to show for these choices.')}</Empty>
          ) : (
            <div className="table-wrap report">
              <table>
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th
                        key={c.key}
                        className={c.kind === 'money' || c.kind === 'number' ? 'num' : undefined}
                      >
                        {t(c.label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td
                          key={c.key}
                          className={c.kind === 'money' || c.kind === 'number' ? 'num' : undefined}
                        >
                          {show(c, row[c.key] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {moneyColumns.length > 0 && (
                  <tfoot>
                    <tr>
                      {data.columns.map((c, i) => (
                        <td key={c.key} className={moneyColumns.includes(c) ? 'num' : undefined}>
                          {moneyColumns.includes(c)
                            ? c.kind === 'money'
                              ? inr(total(c.key))
                              : total(c.key)
                            : i === 0
                              ? t('Total ({n} rows)', { n: data.rows.length })
                              : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
