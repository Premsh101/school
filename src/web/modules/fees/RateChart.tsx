import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  admissionTotal,
  FEE_KEYS,
  FEE_LABELS,
  groupRates,
  type FeeAmounts,
  type FeeKey,
  type FeeRate,
  type RateGroup,
} from '../../../shared/fees';
import { formatINR } from '../../../shared/format';
import { api } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import {
  Button,
  Check,
  Empty,
  ErrorNote,
  fieldErrors,
  Loading,
  PageHead,
  Sheet,
  useToast,
} from '../../components/ui';

const money = (n: number) => (n === 0 ? '–' : formatINR(n));

/** "₹8,500", or two lines "₹8,500 / or ₹8,800" when there is a higher practical option. */
function Total({ amounts }: { amounts: FeeAmounts }) {
  return (
    <>
      {formatINR(admissionTotal(amounts))}
      {amounts.practical_alt > 0 && (
        <>
          <br />
          {t('or {amount}', { amount: formatINR(admissionTotal(amounts, true)) })}
        </>
      )}
    </>
  );
}

/** The fee rate chart of the session chosen in the top bar. Admin can edit it. */
export function RateChartPage() {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const session = boot.session;
  const canEdit = boot.can('fees.rates.edit');
  const [editing, setEditing] = useState<RateGroup | null>(null);
  const rates = useQuery({
    queryKey: ['fees', 'rates', session?.id],
    queryFn: () => api.get<FeeRate[]>(`/fees/rates?session_id=${session?.id}`),
    enabled: !!session,
  });
  const start = useMutation({
    mutationFn: () => api.post('/fees/rates/start', { session_id: session?.id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['fees', 'rates'] });
      toast(t('Rate chart is ready'));
    },
  });

  if (!session) return <Empty>{t('Open a session first.')}</Empty>;
  const groups = rates.data ? groupRates(rates.data, boot.classes) : [];
  return (
    <div className="stack">
      <PageHead title={t('Fee rate chart {session}', { session: session.name })}>
        {rates.data && rates.data.length > 0 && (
          <Button onClick={() => window.print()}>{t('Print')}</Button>
        )}
      </PageHead>
      <p className="muted small no-print">
        {canEdit
          ? t(
              'Tap Edit to change the fees of a class group. "At admission" is all one-time charges plus the first month. Changes apply to students added afterwards; fees of students already enrolled do not change.',
            )
          : t(
              'Only the admin can change the chart. "At admission" is all one-time charges plus the first month.',
            )}
      </p>
      <ErrorNote error={rates.error ?? start.error} />
      {rates.isPending ? (
        <Loading />
      ) : rates.data && rates.data.length === 0 ? (
        <div className="card stack">
          <p>{t('Session {session} has no rate chart yet.', { session: session.name })}</p>
          {canEdit ? (
            <Button variant="primary" block busy={start.isPending} onClick={() => start.mutate()}>
              {t('Start from the previous chart')}
            </Button>
          ) : (
            <p className="muted">{t('Ask the admin to set it up.')}</p>
          )}
        </div>
      ) : (
        <div className="rate-cards">
          {groups.map((g) => (
            <section key={g.class_ids.join('-')} className="card rate-card">
              <div className="row">
                <h2>{g.label}</h2>
                {canEdit && (
                  <Button
                    small
                    className="right no-print"
                    onClick={() => setEditing(g)}
                    aria-label={t('Edit fees of {name}', { name: g.label })}
                  >
                    {t('Edit')}
                  </Button>
                )}
              </div>
              <table className="rate-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Fee')}</th>
                    <th scope="col" className="num">
                      {t('New')}
                    </th>
                    <th scope="col" className="num">
                      {t('Old')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FEE_KEYS.filter((key) => g.new[key] > 0 || g.old[key] > 0).map((key) => (
                    <tr key={key}>
                      <th scope="row">{t(FEE_LABELS[key])}</th>
                      <td className="num">{money(g.new[key])}</td>
                      <td className="num">{money(g.old[key])}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{t('At admission')}</th>
                    <td className="num">
                      <Total amounts={g.new} />
                    </td>
                    <td className="num">
                      <Total amounts={g.old} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>
          ))}
        </div>
      )}
      {editing && session && (
        <RateSheet group={editing} sessionId={session.id} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

type Draft = Record<FeeKey, string>;
const toDraft = (a: FeeAmounts): Draft =>
  Object.fromEntries(FEE_KEYS.map((k) => [k, a[k] === 0 ? '' : String(a[k])])) as Draft;
const toAmounts = (d: Draft): FeeAmounts =>
  Object.fromEntries(FEE_KEYS.map((k) => [k, Number(d[k]) || 0])) as FeeAmounts;

function RateSheet({
  group,
  sessionId,
  onClose,
}: {
  group: RateGroup;
  sessionId: number;
  onClose: () => void;
}) {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const [classIds, setClassIds] = useState(group.class_ids);
  const [fresh, setFresh] = useState(toDraft(group.new));
  const [old, setOld] = useState(toDraft(group.old));
  const save = useMutation({
    mutationFn: () =>
      api.put('/fees/rates', {
        session_id: sessionId,
        class_ids: classIds,
        new: toAmounts(fresh),
        old: toAmounts(old),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['fees', 'rates'] });
      toast(t('Rate chart saved'));
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  const input = (
    label: string,
    kind: string,
    draft: Draft,
    setDraft: (d: Draft) => void,
    key: FeeKey,
    prefix: string,
  ) => (
    <input
      aria-label={`${label}, ${kind}`}
      aria-invalid={err[`${prefix}.${key}`] ? true : undefined}
      inputMode="numeric"
      placeholder="0"
      maxLength={7}
      value={draft[key]}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/\D/g, '') })}
    />
  );
  return (
    <Sheet title={t('Fees for {name}', { name: group.label })} onClose={onClose}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: '0.92rem' }}>
          {t('Classes these fees apply to')}
        </legend>
        <div className="row" style={{ gap: '0 16px' }}>
          {boot.classes
            .filter((cl) => group.class_ids.includes(cl.id))
            .map((cl) => (
              <Check
                key={cl.id}
                label={cl.name}
                checked={classIds.includes(cl.id)}
                onChange={(on) =>
                  setClassIds(on ? [...classIds, cl.id] : classIds.filter((x) => x !== cl.id))
                }
              />
            ))}
        </div>
        {group.class_ids.length > 1 && (
          <span className="hint">
            {t('Untick a class to keep its fees as they are and give it different fees later.')}
          </span>
        )}
      </fieldset>
      <div className="rate-edit">
        <span />
        <strong>{t('New student')}</strong>
        <strong>{t('Old student')}</strong>
        {FEE_KEYS.map((key) => (
          <div key={key} style={{ display: 'contents' }}>
            <span>{t(FEE_LABELS[key])}</span>
            {input(t(FEE_LABELS[key]), t('New student'), fresh, setFresh, key, 'new')}
            {input(t(FEE_LABELS[key]), t('Old student'), old, setOld, key, 'old')}
          </div>
        ))}
        <strong>{t('At admission')}</strong>
        <strong className="num">
          <Total amounts={toAmounts(fresh)} />
        </strong>
        <strong className="num">
          <Total amounts={toAmounts(old)} />
        </strong>
      </div>
      <p className="muted small">
        {t(
          'Amounts are in whole rupees. Leave a box empty if the fee does not apply. The higher practical option is for Class 11 and 12 students who take the costlier practical.',
        )}
      </p>
      <ErrorNote error={save.error} />
      <Button
        variant="primary"
        block
        busy={save.isPending}
        disabled={classIds.length === 0}
        onClick={() => save.mutate()}
      >
        {t('Save')}
      </Button>
    </Sheet>
  );
}
