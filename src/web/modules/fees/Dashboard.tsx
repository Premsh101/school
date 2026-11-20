import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../../shared/dates';
import { MODE_LABELS, MONTH_NAMES, PAYMENT_MODES } from '../../../shared/fees';
import type { FeesDashboard, MoneySums } from '../../../shared/fees-api';
import { api, query } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import {
  Badge,
  Button,
  Empty,
  ErrorNote,
  Loading,
  PageHead,
  SelectField,
} from '../../components/ui';
import { Bars, classLabel, inr, Meter, Stat } from './shared';

function useDashboard(branchId: string) {
  const boot = useBoot();
  const params = { session_id: boot.session?.id, branch_id: branchId };
  return useQuery({
    queryKey: ['fees', 'dashboard', params],
    queryFn: () => api.get<FeesDashboard>(`/fees/dashboard${query(params)}`),
    enabled: !!boot.session,
  });
}

function PositionTable({ rows, first }: { rows: (MoneySums & { name: string })[]; first: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{first}</th>
            <th className="num">{t('To pay')}</th>
            <th className="num">{t('Collected')}</th>
            <th className="num">{t('Overdue')}</th>
            <th>{t('Collected %')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">
                {r.name} <span className="muted">({r.students})</span>
              </th>
              <td className="num">{inr(r.net)}</td>
              <td className="num">{inr(r.paid)}</td>
              <td className="num">{inr(r.overdue)}</td>
              <td style={{ minWidth: 90 }}>
                <Meter value={r.paid + r.counter_discount} total={r.net} label={r.name} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage() {
  const boot = useBoot();
  const client = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const dash = useDashboard(branchId);
  const sync = useMutation({
    mutationFn: () => api.post('/fees/sync', { session_id: boot.session?.id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['fees'] }),
  });
  const d = dash.data;
  return (
    <div className="stack">
      <PageHead title={t('Fees {session}', { session: boot.session?.name ?? '' })}>
        {boot.can('fees.collect') && (
          <Link to="/fees/collect" className="btn primary">
            {t('Collect fee')}
          </Link>
        )}
      </PageHead>
      {boot.branches.length > 1 && (
        <SelectField
          label={t('Branch')}
          value={branchId}
          placeholder={t('All branches')}
          onChange={setBranchId}
          options={boot.branches.map((b) => ({ value: String(b.id), label: b.name }))}
        />
      )}
      <ErrorNote error={dash.error ?? sync.error} />
      {dash.isPending && <Loading />}
      {d && d.missing_fees > 0 && (
        <div className="note warn stack">
          {t('{n} students have no fees set up yet, so they are not counted here.', {
            n: d.missing_fees,
          })}
          {boot.can('fees.edit') && (
            <Button small busy={sync.isPending} onClick={() => sync.mutate()}>
              {t('Set up their fees from the rate chart')}
            </Button>
          )}
        </div>
      )}
      {d && d.total.students === 0 && <Empty>{t('No students in this session yet.')}</Empty>}
      {d && d.total.students > 0 && (
        <>
          <section className="card stack">
            <h2>{t('Collected so far')}</h2>
            <div className="stats">
              <Stat
                label={t('Collected')}
                value={inr(d.total.paid)}
                tone="paid"
                sub={t('of {total} for the year', { total: inr(d.total.net) })}
              />
              <Stat label={t('Overdue now')} value={inr(d.total.overdue)} tone="overdue" />
              <Stat
                label={t('Due later this year')}
                value={inr(d.total.pending - d.total.overdue)}
              />
              <Stat
                label={t('Discounts given')}
                value={inr(d.total.discount + d.total.counter_discount)}
                sub={
                  d.total.counter_discount
                    ? t('{amount} at the counter', { amount: inr(d.total.counter_discount) })
                    : undefined
                }
              />
            </div>
            <Meter
              value={d.total.paid + d.total.counter_discount}
              total={d.total.net}
              label={t('Collected')}
            />
          </section>

          <section className="card stack">
            <h2>{t('Collection')}</h2>
            <div className="stats">
              <Stat label={t('Today')} value={inr(d.today)} />
              <Stat label={t('Last 7 days')} value={inr(d.last_7_days)} />
              <Stat label={t('This month')} value={inr(d.this_month)} />
            </div>
            <h3 className="chart-title">{t('Last 14 days')}</h3>
            <Bars
              caption={t('Collection in the last 14 days')}
              data={d.last_14_days.map((x) => ({
                label: String(Number(x.date.slice(8))),
                hint: formatDate(x.date),
                value: x.amount,
              }))}
            />
            <h3 className="chart-title">{t('By month')}</h3>
            <Bars
              caption={t('Collection by month of the session')}
              data={d.by_month.map((m) => ({
                label: t(MONTH_NAMES[m.month - 1]!).slice(0, 3),
                hint: `${t(MONTH_NAMES[m.month - 1]!)} ${m.year}`,
                value: m.amount,
              }))}
            />
          </section>

          <section className="card stack">
            <h2>{t('How it was paid')}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Mode')}</th>
                    <th className="num">{t('Receipts')}</th>
                    <th className="num">{t('Amount')}</th>
                    <th>{t('Share')}</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYMENT_MODES.map((mode) => {
                    const m = d.by_mode.find((x) => x.mode === mode);
                    return (
                      <tr key={mode}>
                        <th scope="row">{t(MODE_LABELS[mode])}</th>
                        <td className="num">{m?.receipts ?? 0}</td>
                        <td className="num">{inr(m?.amount ?? 0)}</td>
                        <td style={{ minWidth: 90 }}>
                          <Meter
                            value={m?.amount ?? 0}
                            total={d.total.paid}
                            label={t(MODE_LABELS[mode])}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {d.by_branch.length > 1 && (
            <section className="stack">
              <h2>{t('Branches compared')}</h2>
              <PositionTable
                first={t('Branch')}
                rows={d.by_branch.map((b) => ({ ...b, name: boot.branchName(b.branch_id) }))}
              />
            </section>
          )}
          <section className="stack">
            <h2>{t('Class-wise position')}</h2>
            <PositionTable
              first={t('Class')}
              rows={boot.classes.flatMap((cl) =>
                d.by_class
                  .filter((x) => x.class_id === cl.id)
                  .map((x) => ({ ...x, name: cl.name })),
              )}
            />
          </section>

          <section className="stack">
            <h2>{t('Largest dues')}</h2>
            {d.largest_dues.length === 0 ? (
              <Empty>{t('Nobody is overdue today.')}</Empty>
            ) : (
              <ul className="list">
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
                        <strong className="overdue-text">{inr(s.overdue)}</strong>
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

          <section className="stack">
            <h2>{t('Latest receipts')}</h2>
            {d.latest_receipts.length === 0 ? (
              <Empty>{t('No receipts yet.')}</Empty>
            ) : (
              <ul className="list">
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
                          {r.receipt_no} · {formatDate(r.date)} · {t(MODE_LABELS[r.mode])}
                        </span>
                      </span>
                      {r.cancelled ? <Badge tone="grey">{t('Cancelled')}</Badge> : null}
                      <strong className={r.cancelled ? 'strike muted' : ''}>{inr(r.amount)}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Small card on the home page. */
export function FeesHomeWidget() {
  const dash = useDashboard('');
  const d = dash.data;
  if (!d || d.total.students === 0) return null;
  return (
    <Link to="/fees" className="card stack" style={{ color: 'inherit', textDecoration: 'none' }}>
      <h2>{t('Fees')}</h2>
      <div className="stats">
        <Stat label={t('Collected today')} value={inr(d.today)} tone="paid" />
        <Stat label={t('This month')} value={inr(d.this_month)} />
        <Stat label={t('Overdue now')} value={inr(d.total.overdue)} tone="overdue" />
      </div>
    </Link>
  );
}
