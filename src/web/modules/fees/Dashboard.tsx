import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { addDays, formatDate, shortDate } from '../../../shared/dates';
import { MODE_LABELS, MONTH_NAMES, PAYMENT_MODES } from '../../../shared/fees';
import type { FeesDashboard } from '../../../shared/fees-api';
import { api, query } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import {
  AreaChart,
  BarChart,
  ChartCard,
  Donut,
  StackBars,
  shortINR,
} from '../../components/charts';
import { Kpi, PillSelect, Segmented, percentChange } from '../../components/dash';
import { Icon } from '../../components/icons';
import { Badge, Button, Empty, ErrorNote, Loading, PageHead } from '../../components/ui';
import { classLabel, inr } from './shared';

type Period = 'today' | '7d' | '30d' | 'month' | 'session' | 'custom';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'session', label: 'Session' },
  { value: 'custom', label: 'Custom' },
];
const MODE_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const STATUS_SERIES = [
  { name: 'Collected', color: 'var(--paid)' },
  { name: 'Overdue', color: 'var(--overdue)' },
  { name: 'Due later', color: 'var(--series-neutral)' },
];

/** From and to dates for a period; undefined lets the server use the whole session. */
export function periodRange(period: Period, today: string, custom: { from: string; to: string }) {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'custom':
      return { from: custom.from || undefined, to: custom.to || undefined };
    default:
      return { from: undefined, to: undefined };
  }
}

export function useFeesDashboard(filters: {
  branch_id?: string;
  class_id?: string;
  mode?: string;
  from?: string;
  to?: string;
}) {
  const boot = useBoot();
  const params = { session_id: boot.session?.id, ...filters };
  return useQuery({
    queryKey: ['fees', 'dashboard', params],
    queryFn: () => api.get<FeesDashboard>(`/fees/dashboard${query(params)}`),
    enabled: !!boot.session,
    placeholderData: keepPreviousData,
  });
}

const monthName = (m: number) => t(MONTH_NAMES[m - 1] ?? '');

export function DashboardPage() {
  const boot = useBoot();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as Period | null) ?? '30d';
  const branchId = params.get('branch') ?? '';
  const classId = params.get('class') ?? '';
  const mode = params.get('mode') ?? '';
  const custom = { from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const range = periodRange(period, boot.today, custom);
  const dash = useFeesDashboard({ branch_id: branchId, class_id: classId, mode, ...range });
  const sync = useMutation({
    mutationFn: () => api.post('/fees/sync', { session_id: boot.session?.id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['fees'] }),
  });
  const d = dash.data;
  const filtered = !!(branchId || classId || mode || params.get('period'));
  const where = boot.currentBranch?.name ?? t('All schools');

  return (
    <div>
      <PageHead
        title={t('Fees')}
        sub={`${branchId ? boot.branchName(Number(branchId)) : where} · ${t('Session {name}', { name: boot.session?.name ?? '' })}`}
      >
        <Link to="/reports?g=fees" className="btn">
          <Icon name="report" />
          {t('Reports')}
        </Link>
        {boot.can('fees.collect') && (
          <Link to="/fees/collect" className="btn primary">
            <Icon name="collect" />
            {t('Collect fee')}
          </Link>
        )}
      </PageHead>

      <div className="filterbar no-print">
        <Segmented
          label={t('Period')}
          value={period}
          onChange={(v) => set('period', v === '30d' ? '' : v)}
          options={PERIODS.map((p) => ({ value: p.value, label: t(p.label) }))}
        />
        {period === 'custom' && (
          <span className="dates">
            <input
              type="date"
              aria-label={t('From date')}
              value={custom.from}
              max={boot.today}
              onChange={(e) => set('from', e.target.value)}
            />
            <input
              type="date"
              aria-label={t('To date')}
              value={custom.to}
              max={boot.today}
              onChange={(e) => set('to', e.target.value)}
            />
          </span>
        )}
        {boot.branches.length > 1 && (
          <PillSelect
            label={t('School')}
            value={branchId}
            onChange={(v) => set('branch', v)}
            options={[
              { value: '', label: t('All schools') },
              ...boot.branches.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
          />
        )}
        <PillSelect
          label={t('Class')}
          value={classId}
          onChange={(v) => set('class', v)}
          options={[
            { value: '', label: t('All classes') },
            ...boot.classes.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
        <PillSelect
          label={t('Paid by')}
          value={mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: '', label: t('All modes') },
            ...PAYMENT_MODES.map((m) => ({ value: m, label: t(MODE_LABELS[m]) })),
          ]}
        />
        {filtered && (
          <Button small onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            {t('Reset')}
          </Button>
        )}
      </div>

      <ErrorNote error={dash.error ?? sync.error} />
      {dash.isPending && <Loading rows={4} />}
      {d && d.missing_fees > 0 && (
        <div className="note warn row" style={{ marginBottom: 14 }}>
          <span className="right" style={{ marginLeft: 0, flex: 1 }}>
            {t('{n} students have no fees set up yet, so they are not counted here.', {
              n: d.missing_fees,
            })}
          </span>
          {boot.can('fees.edit') && (
            <Button small busy={sync.isPending} onClick={() => sync.mutate()}>
              {t('Set up their fees')}
            </Button>
          )}
        </div>
      )}
      {d && d.total.students === 0 && (
        <Empty icon="students">{t('No students match these filters.')}</Empty>
      )}
      {d && d.total.students > 0 && <DashboardBody d={d} />}
    </div>
  );
}

function DashboardBody({ d }: { d: FeesDashboard }) {
  const boot = useBoot();
  const settled = d.total.paid + d.total.counter_discount;
  const rate = d.total.net > 0 ? Math.round((settled / d.total.net) * 100) : 0;
  const dueLater = Math.max(0, d.total.pending - d.total.overdue);
  const change = percentChange(d.range.collected, d.range.previous_collected);
  const days = d.range.days;
  const rangeLabel =
    d.range.from === d.range.to
      ? formatDate(d.range.from)
      : `${formatDate(d.range.from)} – ${formatDate(d.range.to)}`;
  const modes = PAYMENT_MODES.map((m, i) => ({
    label: t(MODE_LABELS[m]),
    value: d.by_mode.find((x) => x.mode === m)?.amount ?? 0,
    color: MODE_COLORS[i]!,
  }));
  const classRows = boot.classes
    .map((c) => ({ c, row: d.by_class.find((x) => x.class_id === c.id) }))
    .filter((x) => x.row);

  return (
    <>
      <div className="kpis five">
        <Kpi
          label={t('Collected')}
          icon="wallet"
          tone="paid"
          value={inr(d.range.collected)}
          delta={
            change === null
              ? null
              : { pct: change, label: t('Compared with the same number of days before') }
          }
          sub={t('{n} receipts', { n: d.range.receipts })}
          spark={days.length > 1 ? days.map((x) => x.amount) : undefined}
        />
        <Kpi
          label={t('Collection rate')}
          icon="percent"
          value={`${rate}%`}
          sub={t('{paid} of {total} for the year', {
            paid: shortINR(settled),
            total: shortINR(d.total.net),
          })}
        />
        <Kpi
          label={t('Overdue now')}
          icon="alert"
          tone="overdue"
          value={inr(d.total.overdue)}
          sub={t('Due as of today')}
          to="/reports?r=fees.pending"
        />
        <Kpi
          label={t('Due later')}
          icon="clock"
          value={inr(dueLater)}
          sub={t('Rest of the year')}
        />
        <Kpi
          label={t('Discounts')}
          icon="tag"
          tone="gold"
          value={inr(d.total.discount + d.total.counter_discount)}
          sub={
            d.total.counter_discount
              ? t('{amount} at the counter', { amount: shortINR(d.total.counter_discount) })
              : t('On fees')
          }
        />
      </div>

      <div className="dash-grid">
        <ChartCard
          className="span-2"
          title={t('Daily collection')}
          sub={rangeLabel}
          table={{
            columns: [t('Date'), t('Collected')],
            rows: days.filter((x) => x.amount > 0).map((x) => [formatDate(x.date), inr(x.amount)]),
          }}
        >
          {d.range.collected === 0 ? (
            <Empty icon="chart">{t('Nothing collected in this period.')}</Empty>
          ) : (
            <AreaChart
              summary={t('Collection per day, {range}: total {total}', {
                range: rangeLabel,
                total: inr(d.range.collected),
              })}
              data={days.map((x) => ({
                label: formatDate(x.date),
                short: shortDate(x.date),
                value: x.amount,
              }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title={t('How it was paid')}
          sub={rangeLabel}
          table={{
            columns: [t('Mode'), t('Amount'), t('Receipts')],
            rows: PAYMENT_MODES.map((m) => {
              const x = d.by_mode.find((y) => y.mode === m);
              return [t(MODE_LABELS[m]), inr(x?.amount ?? 0), x?.receipts ?? 0];
            }),
          }}
        >
          <Donut
            items={modes}
            centerLabel={t('Collected')}
            format={shortINR}
            summary={modes.map((m) => `${m.label} ${inr(m.value)}`).join(', ')}
          />
        </ChartCard>

        <ChartCard
          className="span-2"
          title={t('Collected against due, by month')}
          sub={t('Due counts students still studying; one-time charges fall in the first month.')}
          legend={[
            { label: t('Due'), color: 'var(--series-neutral)', ghost: true },
            { label: t('Collected'), color: 'var(--series-1)' },
          ]}
          table={{
            columns: [t('Month'), t('Due'), t('Collected')],
            rows: d.by_month.map((m) => [
              `${monthName(m.month)} ${m.year}`,
              inr(m.due),
              inr(m.amount),
            ]),
          }}
        >
          <BarChart
            summary={t('Fees due and collected for each month of the session')}
            series={[
              { name: t('Due'), color: 'var(--series-neutral)', ghost: true },
              { name: t('Collected'), color: 'var(--series-1)' },
            ]}
            data={d.by_month.map((m) => ({
              label: `${monthName(m.month)} ${m.year}`,
              short: monthName(m.month).slice(0, 3),
              values: [m.due, m.amount],
            }))}
          />
        </ChartCard>

        <ChartCard
          title={t('Where the year stands')}
          sub={t('All fees for the session, as of today')}
        >
          <Donut
            centerLabel={t('To pay')}
            format={shortINR}
            summary={`${t('Collected')} ${inr(settled)}, ${t('Overdue')} ${inr(d.total.overdue)}, ${t('Due later')} ${inr(dueLater)}`}
            items={[
              { label: t('Collected'), value: settled, color: 'var(--paid)' },
              { label: t('Overdue'), value: d.total.overdue, color: 'var(--overdue)' },
              { label: t('Due later'), value: dueLater, color: 'var(--series-neutral)' },
            ]}
          />
        </ChartCard>

        <ChartCard
          className={d.by_branch.length > 1 ? 'span-2' : 'span-3'}
          title={t('Class-wise position')}
          sub={t('Percentage of the year collected, per class')}
          legend={STATUS_SERIES.map((s) => ({ label: t(s.name), color: s.color }))}
          table={{
            columns: [t('Class'), t('Students'), t('To pay'), t('Collected'), t('Overdue')],
            rows: classRows.map(({ c, row }) => [
              c.name,
              row!.students,
              inr(row!.net),
              inr(row!.paid + row!.counter_discount),
              inr(row!.overdue),
            ]),
          }}
        >
          <StackBars
            series={STATUS_SERIES.map((s) => ({ name: t(s.name), color: s.color }))}
            rows={classRows.map(({ c, row }) => {
              const done = row!.paid + row!.counter_discount;
              return {
                label: c.name,
                note: `${row!.net > 0 ? Math.round((done / row!.net) * 100) : 0}%`,
                values: [done, row!.overdue, Math.max(0, row!.pending - row!.overdue)],
              };
            })}
          />
        </ChartCard>

        {d.by_branch.length > 1 && (
          <ChartCard
            title={t('Schools compared')}
            legend={STATUS_SERIES.map((s) => ({ label: t(s.name), color: s.color }))}
            table={{
              columns: [t('School'), t('To pay'), t('Collected'), t('Overdue')],
              rows: d.by_branch.map((b) => [
                boot.branchName(b.branch_id),
                inr(b.net),
                inr(b.paid + b.counter_discount),
                inr(b.overdue),
              ]),
            }}
          >
            <StackBars
              series={STATUS_SERIES.map((s) => ({ name: t(s.name), color: s.color }))}
              rows={d.by_branch.map((b) => {
                const done = b.paid + b.counter_discount;
                return {
                  label: boot.branchName(b.branch_id),
                  note: `${b.net > 0 ? Math.round((done / b.net) * 100) : 0}%`,
                  values: [done, b.overdue, Math.max(0, b.pending - b.overdue)],
                };
              })}
            />
          </ChartCard>
        )}

        <section className="card chart-card span-2">
          <header>
            <div>
              <h2>{t('Largest dues')}</h2>
              <p>{t('Overdue as of today. Tap a phone number to call.')}</p>
            </div>
            <Link to="/reports?r=fees.pending" className="btn small">
              {t('Full list')}
            </Link>
          </header>
          {d.largest_dues.length === 0 ? (
            <Empty icon="wallet">{t('Nobody is overdue today.')}</Empty>
          ) : (
            <ul className="list flat">
              {d.largest_dues.map((s) => (
                <li key={s.enrolment_id}>
                  <div className="item" style={{ cursor: 'default' }}>
                    <Link
                      to={`/fees/student/${s.enrolment_id}`}
                      className="grow"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      <span className="title" style={{ display: 'block' }}>
                        {s.name}
                      </span>
                      <span className="sub" style={{ display: 'block' }}>
                        {classLabel(boot.className(s.class_id), s.section_name, s.roll_no)}
                        {s.father_name ? ` · ${t('F: {name}', { name: s.father_name })}` : ''}
                      </span>
                    </Link>
                    <span style={{ textAlign: 'right' }}>
                      <strong className="overdue-text tabular">{inr(s.overdue)}</strong>
                      {s.phone && (
                        <a href={`tel:${s.phone}`} className="small" style={{ display: 'block' }}>
                          {s.phone}
                        </a>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card chart-card">
          <header>
            <div>
              <h2>{t('Latest receipts')}</h2>
            </div>
            <Link to="/reports?r=fees.collection" className="btn small">
              {t('All')}
            </Link>
          </header>
          {d.latest_receipts.length === 0 ? (
            <Empty icon="receipt">{t('No receipts yet.')}</Empty>
          ) : (
            <ul className="list flat">
              {d.latest_receipts.map((r) => (
                <li key={r.id}>
                  <Link to={`/fees/receipt/${r.id}`} className="item">
                    <span className="grow">
                      <span
                        className={`title ${r.cancelled ? 'strike' : ''}`}
                        style={{ display: 'block' }}
                      >
                        {r.name}
                      </span>
                      <span className="sub" style={{ display: 'block' }}>
                        {r.receipt_no} · {shortDate(r.date)} · {t(MODE_LABELS[r.mode])}
                      </span>
                    </span>
                    {r.cancelled ? <Badge tone="grey">{t('Cancelled')}</Badge> : null}
                    <strong className={`tabular ${r.cancelled ? 'strike muted' : ''}`}>
                      {inr(r.amount)}
                    </strong>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** The fees part of the Home page: this month at a glance, and the last 30 days. */
export function FeesHomeWidget() {
  const boot = useBoot();
  const dash = useFeesDashboard({ from: addDays(boot.today, -29), to: boot.today });
  const d = dash.data;
  if (!d || d.total.students === 0) return null;
  const settled = d.total.paid + d.total.counter_discount;
  const dueLater = Math.max(0, d.total.pending - d.total.overdue);
  const rate = d.total.net > 0 ? Math.round((settled / d.total.net) * 100) : 0;
  return (
    <>
      <div className="kpis" style={{ marginTop: 14 }}>
        <Kpi
          label={t('Collected today')}
          icon="wallet"
          tone="paid"
          value={inr(d.today)}
          to="/fees"
        />
        <Kpi
          label={t('This month')}
          icon="trend"
          value={inr(d.this_month)}
          spark={d.range.days.map((x) => x.amount)}
          to="/fees?period=month"
        />
        <Kpi
          label={t('Overdue now')}
          icon="alert"
          tone="overdue"
          value={inr(d.total.overdue)}
          to="/reports?r=fees.pending"
        />
        <Kpi
          label={t('Collection rate')}
          icon="percent"
          value={`${rate}%`}
          sub={t('of the year')}
          to="/fees?period=session"
        />
      </div>
      <div className="dash-grid">
        <ChartCard
          className="span-2"
          title={t('Fee collection, last 30 days')}
          actions={
            <Link to="/fees" className="btn small">
              {t('Open fees')}
            </Link>
          }
          table={{
            columns: [t('Date'), t('Collected')],
            rows: d.range.days
              .filter((x) => x.amount > 0)
              .map((x) => [formatDate(x.date), inr(x.amount)]),
          }}
        >
          <AreaChart
            height={200}
            summary={t('Collection per day for the last 30 days: total {total}', {
              total: inr(d.range.collected),
            })}
            data={d.range.days.map((x) => ({
              label: formatDate(x.date),
              short: shortDate(x.date),
              value: x.amount,
            }))}
          />
        </ChartCard>
        <ChartCard title={t('Where the year stands')}>
          <Donut
            size={160}
            centerLabel={t('To pay')}
            format={shortINR}
            summary={`${t('Collected')} ${inr(settled)}, ${t('Overdue')} ${inr(d.total.overdue)}, ${t('Due later')} ${inr(dueLater)}`}
            items={[
              { label: t('Collected'), value: settled, color: 'var(--paid)' },
              { label: t('Overdue'), value: d.total.overdue, color: 'var(--overdue)' },
              { label: t('Due later'), value: dueLater, color: 'var(--series-neutral)' },
            ]}
          />
        </ChartCard>
      </div>
    </>
  );
}

export function FeeReportsRedirect() {
  return <Navigate to="/reports?g=fees" replace />;
}
