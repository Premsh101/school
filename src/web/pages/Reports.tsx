import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toCsv } from '../../shared/csv';
import { formatDate } from '../../shared/dates';
import { MODE_LABELS, PAYMENT_MODES } from '../../shared/fees';
import { formatINR } from '../../shared/format';
import {
  CORE_REPORTS,
  type ReportColumn,
  type ReportDef,
  type ReportResult,
} from '../../shared/reports';
import { api, query } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Icon } from '../components/icons';
import {
  Button,
  Empty,
  ErrorNote,
  Loading,
  PageHead,
  SelectField,
  TextField,
} from '../components/ui';
import { webModules } from '../modules';
import { downloadFile } from './Backup';

interface Group {
  id: string;
  title: string;
  icon: string;
  endpoint: string;
  list: readonly ReportDef[];
}

/** Every group of reports this person may open: students first, then each module's. */
function useGroups(): Group[] {
  const boot = useBoot();
  const groups: Group[] = [];
  if (boot.can('students.view')) {
    groups.push({
      id: 'core',
      title: t('Students'),
      icon: 'students',
      endpoint: '/reports',
      list: CORE_REPORTS,
    });
  }
  for (const m of webModules) {
    if (!m.reports || boot.modules[m.id] === false || !boot.can(m.reports.permission)) continue;
    groups.push({
      id: m.id,
      title: t(m.reports.title),
      icon: m.reports.icon,
      endpoint: m.reports.endpoint,
      list: m.reports.list,
    });
  }
  return groups;
}

const REPORT_ICONS: Record<string, string> = {
  students: 'students',
  strength: 'classes',
  left: 'userLeft',
  collection: 'receipt',
  daywise: 'calendar',
  pending: 'alert',
  register: 'table',
  classwise: 'chart',
  branchwise: 'branch',
  discounts: 'tag',
  staff: 'staff',
  cancelled: 'close',
};

export function ReportsPage() {
  const [params] = useSearchParams();
  const groups = useGroups();
  const key = params.get('r');
  if (key) {
    const [groupId, reportId] = key.split('.');
    const group = groups.find((g) => g.id === groupId);
    const report = group?.list.find((r) => r.id === reportId);
    if (group && report) return <ReportView key={key} group={group} report={report} />;
  }
  const only = params.get('g');
  const shown = only ? groups.filter((g) => g.id === only) : groups;
  return (
    <div>
      <PageHead
        title={t('Reports')}
        sub={t('Open a report, filter it, then download it for Excel or print it.')}
      />
      {shown.length === 0 && <Empty icon="report">{t('There are no reports you can open.')}</Empty>}
      {shown.map((g) => (
        <section key={g.id} style={{ marginBottom: 24 }}>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            {g.title}
          </p>
          <div className="report-cards">
            {g.list.map((r) => (
              <Link key={r.id} to={`/reports?r=${g.id}.${r.id}`} className="report-card">
                <span className="kpi-icon">
                  <Icon name={REPORT_ICONS[r.id] ?? 'report'} />
                </span>
                <span>
                  <strong>{t(r.name)}</strong>
                  <span>{t(r.description)}</span>
                </span>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      {only && (
        <Link to="/reports" className="btn">
          {t('All reports')}
        </Link>
      )}
    </div>
  );
}

const show = (column: ReportColumn, value: string | number | null): string => {
  if (value === null || value === '') return '';
  if (column.kind === 'money') return formatINR(Number(value));
  if (column.kind === 'number') return Number(value).toLocaleString('en-IN');
  if (column.kind === 'date') return formatDate(String(value));
  if (column.key === 'mode')
    return t(MODE_LABELS[value as keyof typeof MODE_LABELS] ?? String(value));
  if (column.key === 'type') return value === 'new' ? t('New') : t('Old');
  if (column.key === 'status') return value === 'left' ? t('Left') : t('Studying');
  if (column.key === 'gender')
    return value === 'male'
      ? t('Boy')
      : value === 'female'
        ? t('Girl')
        : value === 'other'
          ? t('Other')
          : '';
  return String(value);
};
/** Long text columns that may wrap; everything else stays on one line. */
const WRAP = ['address', 'reason', 'given_as'];
const isNumeric = (c: ReportColumn) => c.kind === 'money' || c.kind === 'number';

function ReportView({ group, report }: { group: Group; report: ReportDef }) {
  const boot = useBoot();
  const has = (f: string) => (report.filters as readonly string[]).includes(f);
  const [f, setF] = useState({
    branch_id: '',
    class_id: '',
    section_id: '',
    from: '',
    to: '',
    mode: '',
    basis: 'today',
    min: '',
    status: 'studying',
  });
  const set = (key: keyof typeof f) => (value: string) => setF((old) => ({ ...old, [key]: value }));
  const sections =
    f.branch_id && f.class_id ? boot.sectionsOf(Number(f.branch_id), Number(f.class_id)) : [];
  const build = () => ({
    session_id: boot.session?.id,
    branch_id: has('branch') ? f.branch_id : '',
    class_id: has('class') ? f.class_id : '',
    section_id: has('section') ? f.section_id : '',
    from: has('dates') ? f.from : '',
    to: has('dates') ? f.to : '',
    mode: has('mode') ? f.mode : '',
    basis: has('basis') ? f.basis : '',
    min: has('min') ? f.min : '',
    status: has('status') ? f.status : '',
  });
  // The report runs straight away with the default filters, and again on "Show report".
  // It always follows the session chosen in the top bar, even for reports without a filter form.
  const [asked, setAsked] = useState(build);
  const params = { ...asked, session_id: boot.session?.id };
  const result = useQuery({
    queryKey: ['report', group.id, report.id, params],
    queryFn: () => api.get<ReportResult>(`${group.endpoint}/${report.id}${query(params)}`),
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const data = result.data;
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    let list = needle
      ? data.rows.filter((r) =>
          Object.values(r).some((v) => v !== null && String(v).toLowerCase().includes(needle)),
        )
      : data.rows;
    if (sort) {
      list = [...list].sort((a, b) => {
        const x = a[sort.key] ?? '';
        const y = b[sort.key] ?? '';
        return (
          (typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * sort.dir
        );
      });
    }
    return list;
  }, [data, search, sort]);
  const totals =
    data?.columns.filter(
      (c) =>
        c.kind === 'money' ||
        ['students', 'receipts', 'total', 'boys', 'girls', 'new', 'old', 'left'].includes(c.key),
    ) ?? [];
  const sum = (key: string) => rows.reduce((t2, r) => t2 + (Number(r[key]) || 0), 0);
  const download = () => {
    if (!data) return;
    // Plain numbers in the file so Excel can add them up.
    const out = rows.map((row) =>
      data.columns.map((c) => (isNumeric(c) ? row[c.key] : show(c, row[c.key] ?? null))),
    );
    downloadFile(
      `${report.id}-${boot.today}.csv`,
      '﻿' + toCsv([data.columns.map((c) => t(c.label)), ...out]),
      'text/csv',
    );
  };

  return (
    <div>
      <PageHead
        title={t(report.name)}
        back={`/reports${group.id === 'core' ? '' : `?g=${group.id}`}`}
        sub={t(report.description)}
      >
        <Button onClick={download} disabled={!data || rows.length === 0}>
          <Icon name="download" />
          {t('Excel')}
        </Button>
        <Button onClick={() => window.print()} disabled={!data || rows.length === 0}>
          <Icon name="print" />
          {t('Print')}
        </Button>
      </PageHead>

      {report.filters.length > 0 && (
        <form
          className="card report-filters no-print"
          onSubmit={(e) => {
            e.preventDefault();
            setAsked(build());
          }}
        >
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
          {has('status') && (
            <SelectField
              label={t('Students')}
              value={f.status}
              onChange={set('status')}
              options={[
                { value: 'studying', label: t('Studying') },
                { value: 'left', label: t('Left') },
                { value: 'all', label: t('Everyone') },
              ]}
            />
          )}
          {has('branch') && boot.branches.length > 1 && (
            <SelectField
              label={t('School')}
              value={f.branch_id}
              placeholder={t('All schools')}
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
          <Button type="submit" variant="primary" busy={result.isFetching}>
            <Icon name="filter" />
            {t('Show report')}
          </Button>
        </form>
      )}

      <ErrorNote error={result.error} />
      {result.isPending && <Loading rows={2} />}
      {data && (
        <>
          <div className="report-summary">
            <span className="badge">
              {t('{n} rows', { n: rows.length.toLocaleString('en-IN') })}
            </span>
            {totals.slice(0, 4).map((c) => (
              <span key={c.key} className="badge grey">
                {t(c.label)}:{' '}
                <strong className="tabular">
                  {c.kind === 'money' ? formatINR(sum(c.key)) : sum(c.key).toLocaleString('en-IN')}
                </strong>
              </span>
            ))}
            <span className="report-search no-print">
              <Icon name="search" />
              <input
                type="search"
                aria-label={t('Search in this report')}
                placeholder={t('Search in this report')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
          </div>
          <h2 className="print-only">
            {boot.school.name} · {data.title}
          </h2>
          {data.truncated && (
            <p className="note warn" style={{ marginBottom: 12 }}>
              {t(
                'Only the first {n} rows are shown. Choose a school, class or shorter dates to see the rest.',
                { n: data.rows.length },
              )}
            </p>
          )}
          {rows.length === 0 ? (
            <Empty icon="report">
              {search ? t('No rows match your search.') : t('Nothing to show for these choices.')}
            </Empty>
          ) : (
            <div className="table-wrap report-table">
              <table>
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th
                        key={c.key}
                        className={isNumeric(c) ? 'num' : undefined}
                        aria-sort={
                          sort?.key === c.key
                            ? sort.dir === 1
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          className="th-sort"
                          onClick={() =>
                            setSort(
                              sort?.key === c.key
                                ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 }
                                : { key: c.key, dir: isNumeric(c) ? -1 : 1 },
                            )
                          }
                        >
                          {t(c.label)}
                          <span aria-hidden="true">
                            {sort?.key === c.key ? (sort.dir === 1 ? '↑' : '↓') : ''}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td
                          key={c.key}
                          className={
                            isNumeric(c) ? 'num' : WRAP.includes(c.key) ? 'wrap' : undefined
                          }
                        >
                          {c.key === 'phone' || c.key === 'phone2' ? (
                            row[c.key] ? (
                              <a href={`tel:${row[c.key]}`}>{row[c.key]}</a>
                            ) : (
                              ''
                            )
                          ) : (
                            show(c, row[c.key] ?? null)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {totals.length > 0 && (
                  <tfoot>
                    <tr>
                      {data.columns.map((c, i) => (
                        <td key={c.key} className={isNumeric(c) ? 'num' : undefined}>
                          {totals.includes(c)
                            ? c.kind === 'money'
                              ? formatINR(sum(c.key))
                              : sum(c.key).toLocaleString('en-IN')
                            : i === 0
                              ? t('Total')
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
