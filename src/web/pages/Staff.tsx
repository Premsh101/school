import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDate } from '../../shared/dates';
import type { StaffRow, UserRow } from '../../shared/types';
import { api, query } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Icon } from '../components/icons';
import {
  Badge,
  Button,
  Check,
  Empty,
  ErrorNote,
  fieldErrors,
  avatarTone,
  initials,
  Loading,
  PageHead,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from '../components/ui';

export function StaffPage() {
  const boot = useBoot();
  const [branchId, setBranchId] = useState('');
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['staff', branchId],
    queryFn: () => api.get<StaffRow[]>(`/staff${query({ branch_id: branchId })}`),
  });
  const canEdit = boot.can('staff.edit');
  return (
    <div>
      <PageHead title={t('Staff')}>
        {canEdit && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            {t('Add staff')}
          </Button>
        )}
      </PageHead>
      {boot.branches.length > 1 && (
        <div className="filters">
          <SelectField
            label={t('Branch')}
            value={branchId}
            placeholder={t('All branches')}
            onChange={setBranchId}
            options={boot.branches.map((b) => ({ value: String(b.id), label: b.name }))}
          />
        </div>
      )}
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : list.data && list.data.length > 0 ? (
        <ul className="list">
          {list.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="item"
                disabled={!canEdit}
                onClick={() => setEditing(s)}
              >
                <span className={`avatar ${avatarTone(s.name)}`} aria-hidden="true">
                  {initials(s.name)}
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {s.name}
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {[
                      s.designation,
                      s.is_teaching ? t('Teaching') : t('Non-teaching'),
                      s.phone,
                      boot.branches.length > 1 ? boot.branchName(s.branch_id) : '',
                      s.joining_date
                        ? t('Joined {date}', { date: formatDate(s.joining_date) })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {!s.active && <Badge tone="grey">{t('Not working now')}</Badge>}
                {s.username && <Badge>{s.username}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('No staff members yet. Add teachers and office staff here.')}</Empty>
      )}
      {editing && (
        <StaffSheet staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function StaffSheet({ staff, onClose }: { staff: StaffRow | null; onClose: () => void }) {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: staff?.name ?? '',
    phone: staff?.phone ?? '',
    designation: staff?.designation ?? '',
    branch_id: String(
      staff?.branch_id ?? (boot.activeBranches.length === 1 ? boot.activeBranches[0]!.id : ''),
    ),
    joining_date: staff?.joining_date ?? '',
    is_teaching: staff ? !!staff.is_teaching : true,
    user_id: staff?.user_id ? String(staff.user_id) : '',
    active: staff ? !!staff.active : true,
  });
  const set =
    <K extends keyof typeof f>(key: K) =>
    (value: (typeof f)[K]) =>
      setF((old) => ({ ...old, [key]: value }));
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UserRow[]>('/users'),
    enabled: boot.can('users.manage'),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        branch_id: Number(f.branch_id),
        user_id: f.user_id ? Number(f.user_id) : null,
      };
      return staff ? api.put(`/staff/${staff.id}`, body) : api.post('/staff', body);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['staff'] });
      await client.invalidateQueries({ queryKey: ['home'] });
      toast(t('Saved'));
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  return (
    <Sheet title={staff ? t('Edit staff member') : t('Add staff member')} onClose={onClose}>
      <TextField
        label={t('Name')}
        value={f.name}
        onChange={set('name')}
        error={err.name}
        required
      />
      <TextField
        label={t('Designation')}
        hint={t('For example Teacher, Clerk, Driver')}
        value={f.designation}
        onChange={set('designation')}
      />
      <TextField
        label={t('Phone')}
        value={f.phone}
        onChange={set('phone')}
        error={err.phone}
        inputMode="tel"
      />
      {boot.activeBranches.length > 1 && (
        <SelectField
          label={t('Branch')}
          value={f.branch_id}
          placeholder={t('Choose branch')}
          error={err.branch_id}
          onChange={set('branch_id')}
          options={boot.activeBranches.map((b) => ({ value: String(b.id), label: b.name }))}
        />
      )}
      <TextField
        label={t('Joining date')}
        type="date"
        value={f.joining_date}
        onChange={set('joining_date')}
        error={err.joining_date}
      />
      <Check label={t('Teaches classes')} checked={f.is_teaching} onChange={set('is_teaching')} />
      {users.data && (
        <SelectField
          label={t('Login for this person')}
          hint={t('Optional. Create the login first under Logins.')}
          value={f.user_id}
          placeholder={t('No login')}
          error={err.user_id}
          onChange={set('user_id')}
          options={users.data.map((u) => ({
            value: String(u.id),
            label: `${u.name} (${u.username})`,
          }))}
        />
      )}
      {staff && (
        <Check label={t('Working at the school now')} checked={f.active} onChange={set('active')} />
      )}
      <ErrorNote error={save.error} />
      <Button variant="primary" block busy={save.isPending} onClick={() => save.mutate()}>
        {t('Save')}
      </Button>
    </Sheet>
  );
}
