import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { Branch } from '../../shared/types';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Icon } from '../components/icons';
import {
  Badge,
  Button,
  Check,
  ErrorNote,
  fieldErrors,
  PageHead,
  Sheet,
  TextField,
  useToast,
} from '../components/ui';

export function BranchesPage() {
  const boot = useBoot();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  return (
    <div>
      <PageHead title={t('Branches')}>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          {t('Add branch')}
        </Button>
      </PageHead>
      <ul className="list">
        {boot.myBranches.map((b) => (
          <li key={b.id}>
            <button type="button" className="item" onClick={() => setEditing(b)}>
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>
                  {b.name}
                </span>
                <span className="sub" style={{ display: 'block' }}>
                  {[b.address, b.phone].filter(Boolean).join(' · ') || t('No address yet')}
                </span>
              </span>
              {!b.active && <Badge tone="grey">{t('Closed')}</Badge>}
              {!!b.is_demo && <Badge tone="grey">{t('Demo')}</Badge>}
              <Badge>{b.code}</Badge>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <BranchSheet branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function BranchSheet({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const boot = useBoot();
  const toast = useToast();
  const [f, setF] = useState({
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
    active: branch ? !!branch.active : true,
    is_demo: branch ? !!branch.is_demo : false,
  });
  const set =
    <K extends keyof typeof f>(key: K) =>
    (value: (typeof f)[K]) =>
      setF((old) => ({ ...old, [key]: value }));
  const save = useMutation({
    mutationFn: () => (branch ? api.put(`/branches/${branch.id}`, f) : api.post('/branches', f)),
    onSuccess: async () => {
      await boot.refresh();
      toast(t('Saved'));
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  return (
    <Sheet title={branch ? t('Edit branch') : t('Add branch')} onClose={onClose}>
      <TextField
        label={t('Branch name')}
        value={f.name}
        onChange={set('name')}
        error={err.name}
        required
      />
      <TextField
        label={t('Short code')}
        hint={
          branch
            ? t('Printed on receipt numbers. Changing it affects new receipts only.')
            : t('2 to 6 letters, printed on receipt numbers, for example KMG')
        }
        value={f.code}
        onChange={(v) => set('code')(v.toUpperCase())}
        error={err.code}
        maxLength={6}
        required
      />
      <TextField label={t('Address')} value={f.address} onChange={set('address')} />
      <TextField
        label={t('Phone')}
        value={f.phone}
        onChange={set('phone')}
        error={err.phone}
        inputMode="tel"
      />
      {branch && <Check label={t('Branch is open')} checked={f.active} onChange={set('active')} />}
      <Check
        label={t('Demo school: sample data, left out of "All schools"')}
        checked={f.is_demo}
        onChange={set('is_demo')}
      />
      {!branch && (
        <p className="muted small">
          {t(
            'Every class in the new branch starts with section A. Add more under Classes and sections.',
          )}
        </p>
      )}
      <ErrorNote error={save.error} />
      <Button variant="primary" block busy={save.isPending} onClick={() => save.mutate()}>
        {t('Save')}
      </Button>
    </Sheet>
  );
}
