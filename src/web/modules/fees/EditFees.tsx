import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CHARGE_LABELS,
  CHARGE_TYPES,
  dueAtAdmission,
  itemsFromRate,
  planTotals,
  withDiscounts,
  type ChargeType,
  type DiscountType,
  type FeeItem,
} from '../../../shared/fees';
import type { StudentFeeDetail } from '../../../shared/fees-api';
import { api } from '../../app/api';
import { t } from '../../app/i18n';
import {
  Button,
  ErrorNote,
  Loading,
  PageHead,
  SelectField,
  TextField,
  useToast,
} from '../../components/ui';
import { inr } from './shared';

interface Row {
  type: ChargeType;
  amount: string;
  discount_type: DiscountType;
  discount_value: string;
}
const toRows = (items: FeeItem[]): Row[] =>
  CHARGE_TYPES.map((type) => {
    const i = items.find((x) => x.type === type);
    return {
      type,
      amount: String(i?.amount ?? 0),
      discount_type: i?.discount_type ?? 'none',
      discount_value: i?.discount_value ? String(i.discount_value) : '',
    };
  });
const toItems = (rows: Row[]) =>
  rows.map((r) => ({
    type: r.type,
    amount: Number(r.amount) || 0,
    discount_type: r.discount_type,
    discount_value: r.discount_type === 'none' ? 0 : Number(r.discount_value) || 0,
  }));

const REASONS = ['Sibling', 'Staff ward', 'Merit', 'Financial need', 'Management'];
const DISCOUNT_OPTIONS: { value: DiscountType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'percent', label: '% off' },
  { value: 'amount', label: '₹ off' },
];

/** A student's fees for the session: amount and discount for each fee type, and months. */
export function EditFeesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['fees', 'student', id],
    queryFn: () => api.get<StudentFeeDetail>(`/fees/students/${id}`),
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [months, setMonths] = useState('12');
  const [reason, setReason] = useState('');
  const [allType, setAllType] = useState<DiscountType>('percent');
  const [allValue, setAllValue] = useState('');
  useEffect(() => {
    if (!detail.data) return;
    setRows(toRows(detail.data.plan.items));
    setMonths(String(detail.data.plan.months));
    setReason(detail.data.discount_reason);
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/fees/students/${id}`, {
        months: Number(months) || 0,
        discount_reason: reason,
        items: toItems(rows),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['fees'] });
      toast(t('Fees saved'));
      navigate(`/fees/student/${id}`, { replace: true });
    },
  });

  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const d = detail.data;
  // A preview only: the server works the totals out again when saving.
  const plan = { items: withDiscounts(toItems(rows)), months: Math.min(12, Number(months) || 0) };
  const totals = planTotals(plan);
  const hasDiscount = plan.items.some((i) => i.discount > 0);
  const change = (type: ChargeType, patch: Partial<Row>) =>
    setRows((old) => old.map((r) => (r.type === type ? { ...r, ...patch } : r)));
  const rate = d.rate;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHead
        title={t('Fees of {name}', { name: d.student.name })}
        back={`/fees/student/${id}`}
      />
      <p className="muted" style={{ marginTop: -8 }}>
        {d.student.session_name} ·{' '}
        {d.student.admission_type === 'new' ? t('New admission') : t('Old student')}
      </p>

      <div className="card stack">
        <div className="row">
          <h2>{t('Shortcuts')}</h2>
        </div>
        <div className="fee-all">
          <SelectField
            label={t('Same discount on all fees')}
            value={allType}
            onChange={(v) => setAllType(v as DiscountType)}
            options={DISCOUNT_OPTIONS.slice(1).map((o) => ({ value: o.value, label: t(o.label) }))}
          />
          <TextField
            label={allType === 'percent' ? t('Percent') : t('Rupees')}
            value={allValue}
            onChange={(v) => setAllValue(v.replace(/\D/g, ''))}
            inputMode="numeric"
          />
          <Button
            disabled={!allValue}
            onClick={() =>
              setRows((old) =>
                old.map((r) =>
                  Number(r.amount) > 0
                    ? { ...r, discount_type: allType, discount_value: allValue }
                    : r,
                ),
              )
            }
          >
            {t('Apply')}
          </Button>
        </div>
        <div className="row">
          <Button
            small
            onClick={() =>
              setRows((old) =>
                old.map((r) => ({ ...r, discount_type: 'none', discount_value: '' })),
              )
            }
          >
            {t('Clear discounts')}
          </Button>
          {rate && (
            <Button
              small
              onClick={() => {
                setRows(toRows(itemsFromRate(rate)));
                setMonths('12');
              }}
            >
              {t('Reset to rate chart')}
            </Button>
          )}
        </div>
      </div>

      {rows.map((r) => {
        const item = plan.items.find((i) => i.type === r.type)!;
        const label = t(CHARGE_LABELS[r.type]);
        const monthly = r.type === 'monthly';
        return (
          <div key={r.type} className="card fee-row">
            <strong className="fee-row-title">
              {monthly ? t('Monthly fee (each month)') : label}
            </strong>
            {r.type === 'practical' && rate && rate.practical_alt > 0 ? (
              <SelectField
                label={t('{fee}: amount', { fee: label })}
                value={r.amount}
                onChange={(v) => change(r.type, { amount: v })}
                options={[
                  ...new Set([String(rate.practical), String(rate.practical_alt), r.amount]),
                ].map((v) => ({ value: v, label: inr(Number(v)) }))}
              />
            ) : (
              <TextField
                label={t('{fee}: amount', { fee: label })}
                value={r.amount}
                onChange={(v) => change(r.type, { amount: v.replace(/\D/g, '') })}
                inputMode="numeric"
                maxLength={7}
              />
            )}
            <SelectField
              label={t('{fee}: discount', { fee: label })}
              value={r.discount_type}
              onChange={(v) => change(r.type, { discount_type: v as DiscountType })}
              options={DISCOUNT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
            />
            {r.discount_type !== 'none' && (
              <TextField
                label={
                  r.discount_type === 'percent'
                    ? t('{fee}: percent off', { fee: label })
                    : t('{fee}: rupees off', { fee: label })
                }
                value={r.discount_value}
                onChange={(v) => change(r.type, { discount_value: v.replace(/\D/g, '') })}
                inputMode="numeric"
                maxLength={7}
              />
            )}
            <p className="fee-row-pays">
              {t('Student pays')}: <strong>{inr(item.amount - item.discount)}</strong>
              {monthly && ` ${t('a month')}`}
              {item.discount > 0 && (
                <span className="muted small">
                  {' '}
                  ({t('{amount} off', { amount: inr(item.discount) })})
                </span>
              )}
            </p>
          </div>
        );
      })}

      <div className="card stack">
        <TextField
          label={t('Months charged')}
          hint={t(
            'Normally 12. Fewer months are counted from the start of the session; the rest show as waived.',
          )}
          value={months}
          onChange={(v) => setMonths(v.replace(/\D/g, '').slice(0, 2))}
          inputMode="numeric"
        />
        {hasDiscount && (
          <div className="field">
            <label htmlFor="discount-reason">{t('Reason for the discount')}</label>
            <input
              id="discount-reason"
              list="discount-reasons"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={100}
            />
            <datalist id="discount-reasons">
              {REASONS.map((x) => (
                <option key={x} value={t(x)} />
              ))}
            </datalist>
          </div>
        )}
        <dl className="kv">
          <dt>{t('Fee for the year')}</dt>
          <dd>{inr(totals.gross)}</dd>
          <dt>{t('Discount')}</dt>
          <dd>{inr(totals.discount)}</dd>
          <dt>{t('Student pays')}</dt>
          <dd>
            <strong>{inr(totals.net)}</strong>
          </dd>
          <dt>{t('Due at admission')}</dt>
          <dd>{inr(dueAtAdmission(plan))}</dd>
          <dt>{t('Already paid')}</dt>
          <dd>{inr(d.position.settled)}</dd>
        </dl>
      </div>
      <ErrorNote error={save.error} />
      <Button type="submit" variant="primary" block busy={save.isPending}>
        {t('Save fees')}
      </Button>
    </form>
  );
}
