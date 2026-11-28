import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { TransportRoute } from '../../../shared/fees-api';
import { api } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import { Icon } from '../../components/icons';
import {
  Badge,
  Button,
  Check,
  Empty,
  ErrorNote,
  fieldErrors,
  Loading,
  PageHead,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from '../../components/ui';
import { inr } from './shared';

/** Transport routes: where the bus goes from and to, and the monthly fee. The admin sets them up once. */
export function TransportRoutesPage() {
  const boot = useBoot();
  const canEdit = boot.can('fees.rates.edit');
  const [editing, setEditing] = useState<TransportRoute | 'new' | null>(null);
  const routes = useQuery({
    queryKey: ['fees', 'transport-routes'],
    queryFn: () => api.get<TransportRoute[]>('/fees/transport-routes'),
  });
  return (
    <div className="stack">
      <PageHead
        title={t('Transport routes')}
        sub={t(
          'Each route has a start, an end and a monthly fee. Choose it on a student’s fees; the fee is charged every month with the tuition.',
        )}
      >
        {canEdit && boot.activeBranches.length > 0 && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            {t('Add route')}
          </Button>
        )}
      </PageHead>
      <ErrorNote error={routes.error} />
      {routes.isPending ? (
        <Loading />
      ) : routes.data && routes.data.length > 0 ? (
        <ul className="list">
          {routes.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="item"
                disabled={!canEdit}
                onClick={() => setEditing(r)}
              >
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="bus" />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {r.source} → {r.destination}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {inr(r.monthly_fee)} {t('a month')}
                    {boot.branches.length > 1 ? ` · ${boot.branchName(r.branch_id)}` : ''}
                  </span>
                </span>
                {!r.active && <Badge tone="grey">{t('Closed')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          {canEdit
            ? t('No routes yet. Tap Add route to set up the first one.')
            : t('No routes yet. Ask the admin to add them.')}
        </Empty>
      )}
      {editing && (
        <RouteSheet route={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function RouteSheet({ route, onClose }: { route: TransportRoute | null; onClose: () => void }) {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    branch_id:
      route?.branch_id ?? (boot.activeBranches.length === 1 ? boot.activeBranches[0]!.id : 0),
    source: route?.source ?? '',
    destination: route?.destination ?? '',
    monthly_fee: route ? String(route.monthly_fee) : '',
    active: route ? !!route.active : true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, monthly_fee: Number(f.monthly_fee) || 0 };
      return route
        ? api.put(`/fees/transport-routes/${route.id}`, body)
        : api.post('/fees/transport-routes', body);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['fees', 'transport-routes'] });
      toast(t('Saved'));
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  return (
    <Sheet title={route ? t('Edit route') : t('Add route')} onClose={onClose}>
      {!route && boot.activeBranches.length > 1 && (
        <SelectField
          label={t('School')}
          value={f.branch_id ? String(f.branch_id) : ''}
          placeholder={t('Choose a school')}
          onChange={(v) => setF((old) => ({ ...old, branch_id: Number(v) }))}
          error={err.branch_id}
          options={boot.activeBranches.map((b) => ({ value: String(b.id), label: b.name }))}
        />
      )}
      <TextField
        label={t('From (source)')}
        hint={t('For example the village or stop where the bus starts')}
        value={f.source}
        onChange={(v) => setF((old) => ({ ...old, source: v }))}
        error={err.source}
        required
      />
      <TextField
        label={t('To (destination)')}
        hint={t('Usually the school')}
        value={f.destination}
        onChange={(v) => setF((old) => ({ ...old, destination: v }))}
        error={err.destination}
        required
      />
      <TextField
        label={t('Monthly fee (₹)')}
        hint={
          route
            ? t('Students already on this route keep their fee until it is changed on their fees.')
            : undefined
        }
        value={f.monthly_fee}
        onChange={(v) => setF((old) => ({ ...old, monthly_fee: v.replace(/\D/g, '') }))}
        error={err.monthly_fee}
        inputMode="numeric"
        required
      />
      {route && (
        <Check
          label={t('Route is open')}
          checked={f.active}
          onChange={(v) => setF((old) => ({ ...old, active: v }))}
        />
      )}
      <ErrorNote error={save.error} />
      <Button
        variant="primary"
        block
        busy={save.isPending}
        disabled={!f.branch_id || !f.source.trim() || !f.destination.trim() || f.monthly_fee === ''}
        onClick={() => save.mutate()}
      >
        {t('Save')}
      </Button>
    </Sheet>
  );
}
