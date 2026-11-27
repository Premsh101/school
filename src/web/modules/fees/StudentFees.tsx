import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDate } from '../../../shared/dates';
import {
  CHARGE_LABELS,
  LATE_FEE_AFTER_DAY,
  LATE_FEE_PER_DAY,
  computeDiscount,
  MODE_LABELS,
  MONTH_NAMES,
  PAYMENT_MODES,
  type DiscountType,
  type MonthStatus,
  type PaymentMode,
} from '../../../shared/fees';
import type { ReceiptRow, StudentFeeDetail } from '../../../shared/fees-api';
import { api } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import {
  Badge,
  Button,
  ErrorNote,
  fieldErrors,
  Loading,
  PageHead,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from '../../components/ui';
import { classLabel, inr, Stat } from './shared';

const STATUS_LABELS: Record<MonthStatus, string> = {
  paid: 'Paid',
  part: 'Part paid',
  due: 'Due',
  upcoming: 'Upcoming',
  waived: 'Waived',
};

export function StudentFeesPage() {
  const { id } = useParams();
  const boot = useBoot();
  const [cancelling, setCancelling] = useState<ReceiptRow | null>(null);
  const [waiving, setWaiving] = useState(false);
  const detail = useQuery({
    queryKey: ['fees', 'student', id],
    queryFn: () => api.get<StudentFeeDetail>(`/fees/students/${id}`),
  });
  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const d = detail.data;
  const { student: s, position: p } = d;
  const left = s.status === 'left';
  const late = d.late_fee;
  return (
    <div className="stack">
      <PageHead title={s.name} back="/fees/collect">
        <Button onClick={() => window.print()}>{t('Print statement')}</Button>
      </PageHead>
      <p className="muted" style={{ marginTop: -8 }}>
        {[
          classLabel(boot.className(s.class_id), s.section_name, s.roll_no),
          s.session_name,
          s.father_name ? t('F: {name}', { name: s.father_name }) : '',
          s.phone,
          boot.branches.length > 1 ? boot.branchName(s.branch_id) : '',
        ]
          .filter(Boolean)
          .join(' · ')}{' '}
        <Link to={`/students/${s.student_id}`} className="no-print">
          {t('Student details')}
        </Link>
      </p>
      {left && (
        <p className="note info">
          {s.cancel_reason
            ? t(
                'The registration was cancelled: {reason}. The student owes nothing further. What they paid stays in the collections.',
                { reason: s.cancel_reason },
              )
            : t(
                'This student has left the school and owes nothing further. What they paid stays in the collections.',
              )}
        </p>
      )}

      <section className="card stack">
        <div className="stats">
          <Stat label={t('Fee for the year')} value={inr(p.fee)} />
          <Stat
            label={t('Discount')}
            value={inr(p.discount + p.counter_discount)}
            sub={d.discount_reason || undefined}
          />
          <Stat label={t('Paid')} value={inr(p.paid)} tone="paid" />
          <Stat label={t('Pending for the year')} value={inr(p.pending)} />
          <Stat
            label={t('Overdue today')}
            value={inr(p.overdue)}
            tone={p.overdue > 0 ? 'overdue' : undefined}
            sub={t('Due as of today: {amount}', { amount: inr(p.due_today) })}
          />
          {late.accrued > 0 && (
            <Stat
              label={t('Late fee owed')}
              value={inr(late.outstanding)}
              tone={late.outstanding > 0 ? 'overdue' : undefined}
              sub={
                late.paid || late.waived
                  ? t('{paid} paid, {waived} waived', {
                      paid: inr(late.paid),
                      waived: inr(late.waived),
                    })
                  : undefined
              }
            />
          )}
        </div>
        {d.transport && (
          <p className="muted small">
            {t('Transport: {from} to {to}', { from: d.transport.from, to: d.transport.to })}
          </p>
        )}
      </section>

      {boot.can('fees.collect') && !left && (p.pending > 0 || late.outstanding > 0) && (
        <CollectForm detail={d} />
      )}
      {!left && p.pending === 0 && (
        <p className="note ok">{t('Fully paid for {session}.', { session: s.session_name })}</p>
      )}

      <section className="stack">
        <h2>{t('Months')}</h2>
        <div className="months">
          {d.allocation.months.map((m) => (
            <div key={m.index} className={`month ${m.status}`}>
              <strong>{t(MONTH_NAMES[m.month - 1]!).slice(0, 3)}</strong>
              <span>{t(STATUS_LABELS[m.status])}</span>
              {m.status === 'part' && (
                <span className="small">
                  {t('{paid} of {net}', { paid: inr(m.paid), net: inr(m.net) })}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {late.accrued > 0 && (
        <section className="stack">
          <div className="row">
            <h2>{t('Late fee')}</h2>
            {boot.can('fees.waive') && late.outstanding > 0 && (
              <Button small className="right no-print" onClick={() => setWaiving(true)}>
                {t('Waive late fee')}
              </Button>
            )}
          </div>
          <p className="muted small">
            {t(
              '{rate} a day for every day after the {day}th of the month that a month’s fee is unpaid, up to the day it is paid.',
              { rate: inr(LATE_FEE_PER_DAY), day: LATE_FEE_AFTER_DAY },
            )}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Month')}</th>
                  <th>{t('Paid on')}</th>
                  <th className="num">{t('Days late')}</th>
                  <th className="num">{t('Late fee')}</th>
                </tr>
              </thead>
              <tbody>
                {late.months.map((m) => (
                  <tr key={m.index}>
                    <th scope="row">
                      {t(MONTH_NAMES[m.month - 1]!)} {m.year}
                    </th>
                    <td>{m.cleared_on ? formatDate(m.cleared_on) : t('Not paid yet')}</td>
                    <td className="num">{m.days}</td>
                    <td className="num">{inr(m.fee)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    {t('Total late fee')}
                  </th>
                  <td className="num">{inr(late.accrued)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {d.waivers.length > 0 && (
            <ul className="list">
              {d.waivers.map((w) => (
                <li key={w.id}>
                  <div className="item" style={{ cursor: 'default' }}>
                    <span className="grow">
                      <span className="title" style={{ display: 'block' }}>
                        {t('{amount} waived', { amount: inr(w.amount) })}
                      </span>
                      <span className="sub" style={{ display: 'block', whiteSpace: 'normal' }}>
                        {w.reason} · {w.by_name} · {formatDate(w.at.slice(0, 10))}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="stack">
        <div className="row">
          <h2>{t('Fees and discounts')}</h2>
          {boot.can('fees.edit') && (
            <Link to={`/fees/student/${s.enrolment_id}/edit`} className="btn small right no-print">
              {t('Edit fees')}
            </Link>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Fee')}</th>
                <th className="num">{t('Amount')}</th>
                <th className="num">{t('Discount')}</th>
                <th className="num">{t('To pay')}</th>
                <th className="num">{t('Balance')}</th>
              </tr>
            </thead>
            <tbody>
              {d.allocation.one_time.map((c) => (
                <tr key={c.type}>
                  <th scope="row">{t(CHARGE_LABELS[c.type])}</th>
                  <td className="num">{inr(c.amount)}</td>
                  <td className="num">{c.discount ? inr(c.discount) : '–'}</td>
                  <td className="num">{inr(c.net)}</td>
                  <td className="num">{c.balance ? inr(c.balance) : t('Paid')}</td>
                </tr>
              ))}
              {d.plan.items
                .filter((i) => i.type === 'monthly' || (i.type === 'transport' && i.amount > 0))
                .map((i) => (
                  <tr key={i.type}>
                    <th scope="row">
                      {i.type === 'transport'
                        ? t('Transport × {n} months', { n: d.plan.months })
                        : t('Monthly fee × {n} months', { n: d.plan.months })}
                    </th>
                    <td className="num">{inr(i.amount)}</td>
                    <td className="num">{i.discount ? inr(i.discount) : '–'}</td>
                    <td className="num">{inr((i.amount - i.discount) * d.plan.months)}</td>
                    <td className="num">
                      {i.type === 'transport'
                        ? '–'
                        : inr(
                            d.allocation.months.reduce(
                              (sum, m) => sum + (m.status === 'waived' ? 0 : m.net - m.paid),
                              0,
                            ),
                          )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {d.transport && (
          <p className="muted small">
            {t(
              'Transport ({from} to {to}) is paid with the monthly fee: a month is paid when both are paid. The balance shown on the monthly line includes it.',
              { from: d.transport.from, to: d.transport.to },
            )}
          </p>
        )}
      </section>

      <section className="stack">
        <h2>{t('Payments')}</h2>
        {d.receipts.length === 0 ? (
          <p className="muted">{t('No payments yet.')}</p>
        ) : (
          <ul className="list">
            {d.receipts.map((r) => (
              <li key={r.id}>
                <div className="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <Link
                    to={`/fees/receipt/${r.id}`}
                    className="grow"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    <span
                      className={`title ${r.cancelled_at ? 'strike' : ''}`}
                      style={{ display: 'block' }}
                    >
                      {inr(r.amount)}
                      {r.late_fee > 0 &&
                        ` (${t('{amount} late fee', { amount: inr(r.late_fee) })})`}
                      {r.counter_discount > 0 &&
                        ` + ${t('{amount} discount', { amount: inr(r.counter_discount) })}`}
                    </span>
                    <span className="sub" style={{ display: 'block', whiteSpace: 'normal' }}>
                      {r.receipt_no} · {formatDate(r.date)} · {t(MODE_LABELS[r.mode])}
                      {r.reference ? ` ${r.reference}` : ''} · {r.collected_by_name}
                    </span>
                    <span className="sub" style={{ display: 'block', whiteSpace: 'normal' }}>
                      {r.cancelled_at
                        ? t('Cancelled by {name}: {reason}', {
                            name: r.cancelled_by_name ?? '',
                            reason: r.cancel_reason ?? '',
                          })
                        : r.covers}
                    </span>
                  </Link>
                  {r.cancelled_at ? (
                    <Badge tone="grey">{t('Cancelled')}</Badge>
                  ) : (
                    boot.can('fees.cancel') && (
                      <Button
                        small
                        variant="danger"
                        className="no-print"
                        onClick={() => setCancelling(r)}
                      >
                        {t('Cancel')}
                      </Button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {cancelling && <CancelSheet receipt={cancelling} onClose={() => setCancelling(null)} />}
      {waiving && <WaiveSheet detail={d} onClose={() => setWaiving(false)} />}
    </div>
  );
}

type LateChoice = 'take' | 'waive' | 'later';

function CollectForm({ detail }: { detail: StudentFeeDetail }) {
  const boot = useBoot();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { quick, position, student } = detail;
  const owed = detail.late_fee.outstanding;
  const [amount, setAmount] = useState(String(quick.due_today || quick.one_month));
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(boot.today);
  const [extra, setExtra] = useState(false);
  const [basis, setBasis] = useState<'payment' | 'total'>('payment');
  const [discountType, setDiscountType] = useState<DiscountType>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [lateChoice, setLateChoice] = useState<LateChoice>('take');
  const [note, setNote] = useState('');
  const settle = Number(amount) || 0;
  const value = Number(discountValue) || 0;
  // "This payment": the discount comes out of the amount being cleared.
  // "Overall": it is worked out on everything still pending and comes off the total fees.
  const discount = extra
    ? computeDiscount(basis === 'total' ? position.pending : settle, discountType, value)
    : 0;
  const feeCash = basis === 'total' && extra ? settle : Math.max(0, settle - discount);
  const cleared = basis === 'total' && extra ? settle + discount : settle;
  const lateTaken = owed > 0 && lateChoice === 'take' ? owed : 0;
  const waiveLate = owed > 0 && lateChoice === 'waive';
  const takeNow = feeCash + lateTaken;
  const save = useMutation({
    mutationFn: () =>
      api.post<{ ok: true; id: number }>('/fees/receipts', {
        enrolment_id: student.enrolment_id,
        date,
        settle_amount: settle,
        discount_basis: extra ? basis : 'payment',
        counter_discount_type: extra && discount > 0 ? discountType : 'none',
        counter_discount_value: extra && discount > 0 ? value : 0,
        late_fee: lateTaken,
        waive_late_fee: waiveLate,
        mode,
        reference,
        note,
      }),
    onSuccess: async (res) => {
      await client.invalidateQueries({ queryKey: ['fees'] });
      navigate(`/fees/receipt/${res.id}?new=1`);
    },
  });
  const err = fieldErrors(save.error);
  const quickButton = (label: string, amountValue: number) =>
    amountValue > 0 && (
      <Button
        small
        aria-pressed={settle === amountValue}
        onClick={() => setAmount(String(amountValue))}
      >
        {label} {inr(amountValue)}
      </Button>
    );
  const canSave = cleared > 0 || lateTaken > 0;
  return (
    <form
      className="card stack no-print"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>{t('Collect fee')}</h2>
      <div className="row">
        {quickButton(t('Due today'), quick.due_today)}
        {quick.one_month !== quick.due_today && quickButton(t('One month'), quick.one_month)}
        {quick.full !== quick.due_today &&
          quick.full !== quick.one_month &&
          quickButton(t('Full'), quick.full)}
      </div>
      <TextField
        label={
          extra && basis === 'total' ? t('Amount received for fees (₹)') : t('Amount to clear (₹)')
        }
        hint={t('Up to {max} is pending.', { max: inr(position.pending) })}
        value={amount}
        onChange={(v) => setAmount(v.replace(/\D/g, ''))}
        error={err.settle_amount}
        inputMode="numeric"
        required
      />
      {owed > 0 && (
        <SelectField
          label={t('Late fee owed: {amount}', { amount: inr(owed) })}
          hint={t('{rate} a day after the {day}th of each month.', {
            rate: inr(LATE_FEE_PER_DAY),
            day: LATE_FEE_AFTER_DAY,
          })}
          value={lateChoice}
          onChange={(v) => setLateChoice(v as LateChoice)}
          error={err.late_fee}
          options={[
            { value: 'take', label: t('Take it now') },
            ...(boot.can('fees.waive') ? [{ value: 'waive', label: t('Waive it') }] : []),
            { value: 'later', label: t('Leave it for later') },
          ]}
        />
      )}
      <div className="grid2">
        <SelectField
          label={t('Paid by')}
          value={mode}
          onChange={(v) => setMode(v as PaymentMode)}
          options={PAYMENT_MODES.map((m) => ({ value: m, label: t(MODE_LABELS[m]) }))}
        />
        <TextField
          label={t('Receipt date')}
          type="date"
          value={date}
          onChange={setDate}
          max={boot.today}
          error={err.date}
          required
        />
      </div>
      {mode !== 'cash' && (
        <TextField
          label={t('Reference number')}
          hint={t('UPI or bank transaction number, or cheque number')}
          value={reference}
          onChange={setReference}
          error={err.reference}
        />
      )}
      {extra ? (
        <>
          <SelectField
            label={t('Discount on')}
            hint={
              basis === 'total'
                ? t('Worked out on the {amount} still pending, and taken off the total fees.', {
                    amount: inr(position.pending),
                  })
                : t('Taken out of the amount being cleared.')
            }
            value={basis}
            onChange={(v) => setBasis(v === 'total' ? 'total' : 'payment')}
            options={[
              { value: 'total', label: t('Total fees (overall discount)') },
              { value: 'payment', label: t('This payment only') },
            ]}
          />
          <div className="grid2">
            <SelectField
              label={t('Discount')}
              value={discountType}
              onChange={(v) => setDiscountType(v as DiscountType)}
              options={[
                { value: 'amount', label: t('In rupees (₹)') },
                { value: 'percent', label: t('In percent (%)') },
              ]}
            />
            <TextField
              label={discountType === 'percent' ? t('Percent off') : t('Rupees off')}
              value={discountValue}
              onChange={(v) => setDiscountValue(v.replace(/\D/g, ''))}
              error={err.counter_discount_value}
              inputMode="numeric"
            />
          </div>
        </>
      ) : (
        <Button
          small
          onClick={() => {
            setExtra(true);
            setBasis('total');
          }}
        >
          {t('Give a discount')}
        </Button>
      )}
      {(extra || note || waiveLate) && (
        <TextField
          label={t('Note')}
          hint={t('For example the reason for the discount or for waiving the late fee')}
          value={note}
          onChange={setNote}
        />
      )}
      <p className="take">
        {t('Take from parent')}: <strong>{inr(takeNow)}</strong>
        {(discount > 0 || lateTaken > 0) && (
          <span className="muted small">
            {' '}
            (
            {[
              feeCash > 0 || cleared > 0 ? t('{amount} fees', { amount: inr(feeCash) }) : '',
              lateTaken > 0 ? t('{amount} late fee', { amount: inr(lateTaken) }) : '',
              discount > 0 ? t('{amount} discount given', { amount: inr(discount) }) : '',
            ]
              .filter(Boolean)
              .join(' + ')}
            )
          </span>
        )}
      </p>
      {extra && cleared > 0 && (
        <p className="muted small">
          {t('Pending after this: {amount}', {
            amount: inr(Math.max(0, position.pending - cleared)),
          })}
        </p>
      )}
      <ErrorNote error={save.error} />
      <Button type="submit" variant="primary" block busy={save.isPending} disabled={!canSave}>
        {t('Save and show receipt')}
      </Button>
    </form>
  );
}

/** Waives a late fee (all of it or part) with a reason. Admin and management only. */
function WaiveSheet({ detail, onClose }: { detail: StudentFeeDetail; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const owed = detail.late_fee.outstanding;
  const [part, setPart] = useState('');
  const [reason, setReason] = useState('');
  const waive = useMutation({
    mutationFn: () =>
      api.post(`/fees/students/${detail.student.enrolment_id}/late-fee-waiver`, {
        amount: part ? Number(part) : undefined,
        reason,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['fees'] });
      toast(t('Late fee waived'));
      onClose();
    },
  });
  const err = fieldErrors(waive.error);
  return (
    <Sheet title={t('Waive late fee')} onClose={onClose}>
      <p>
        {t('{amount} late fee is owed by {name}. A waiver stays on record with your name.', {
          amount: inr(owed),
          name: detail.student.name,
        })}
      </p>
      <TextField
        label={t('Amount to waive (₹)')}
        hint={t('Leave empty to waive all {amount}.', { amount: inr(owed) })}
        value={part}
        onChange={(v) => setPart(v.replace(/\D/g, ''))}
        error={err.amount}
        inputMode="numeric"
      />
      <TextField
        label={t('Why is it being waived?')}
        value={reason}
        onChange={setReason}
        error={err.reason}
      />
      <ErrorNote error={waive.error} />
      <Button
        variant="primary"
        block
        busy={waive.isPending}
        disabled={reason.trim().length < 3}
        onClick={() => waive.mutate()}
      >
        {part ? t('Waive {amount}', { amount: inr(Number(part)) }) : t('Waive all')}
      </Button>
    </Sheet>
  );
}

function CancelSheet({ receipt, onClose }: { receipt: ReceiptRow; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.post(`/fees/receipts/${receipt.id}/cancel`, { reason }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['fees'] });
      toast(t('Receipt cancelled'));
      onClose();
    },
  });
  return (
    <Sheet title={t('Cancel receipt {no}', { no: receipt.receipt_no })} onClose={onClose}>
      <p>
        {t(
          'The receipt of {amount} stays on record, struck through, and the student’s balance goes back up. This cannot be undone.',
          { amount: inr(receipt.amount) },
        )}
      </p>
      <TextField
        label={t('Why is it being cancelled?')}
        value={reason}
        onChange={setReason}
        error={fieldErrors(cancel.error).reason}
      />
      <ErrorNote error={cancel.error} />
      <Button
        variant="danger"
        block
        busy={cancel.isPending}
        disabled={reason.trim().length < 3}
        onClick={() => cancel.mutate()}
      >
        {t('Cancel this receipt')}
      </Button>
    </Sheet>
  );
}
