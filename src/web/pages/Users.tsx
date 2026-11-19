import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { manageableRoles, ROLE_LABELS, type Role } from '../../shared/permissions';
import type { UserRow } from '../../shared/types';
import { api } from '../app/api';
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
  Loading,
  PageHead,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from '../components/ui';

export function UsersPage() {
  const boot = useBoot();
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const list = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  return (
    <div>
      <PageHead title={t('Logins')}>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          {t('Add login')}
        </Button>
      </PageHead>
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : list.data && list.data.length > 0 ? (
        <ul className="list">
          {list.data.map((u) => (
            <li key={u.id}>
              <button type="button" className="item" onClick={() => setEditing(u)}>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {u.name} <span className="muted">({u.username})</span>
                  </span>
                  <span className="sub" style={{ display: 'block' }}>
                    {t(ROLE_LABELS[u.role])}
                    {u.role !== 'admin' && ` · ${u.branch_ids.map(boot.branchName).join(', ')}`}
                  </span>
                </span>
                {!u.active && <Badge tone="grey">{t('Switched off')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('No logins yet. Add one for each person who will use the app.')}</Empty>
      )}
      {editing && (
        <UserSheet user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function UserSheet({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const roles = manageableRoles(boot.user.role);
  const [f, setF] = useState({
    name: user?.name ?? '',
    username: user?.username ?? '',
    role: (user?.role ?? roles[roles.length > 1 ? 2 : 0] ?? 'staff') as Role,
    branch_ids:
      user?.branch_ids ?? (boot.activeBranches.length === 1 ? [boot.activeBranches[0]!.id] : []),
    password: '',
    active: user ? !!user.active : true,
  });
  const set =
    <K extends keyof typeof f>(key: K) =>
    (value: (typeof f)[K]) =>
      setF((old) => ({ ...old, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, branch_ids: f.role === 'admin' ? [] : f.branch_ids };
      return user ? api.put(`/users/${user.id}`, body) : api.post('/users', body);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['users'] });
      toast(t('Saved'));
      onClose();
    },
  });
  const err = fieldErrors(save.error);
  return (
    <Sheet title={user ? t('Edit login') : t('Add login')} onClose={onClose}>
      <TextField
        label={t('Name')}
        value={f.name}
        onChange={set('name')}
        error={err.name}
        required
      />
      <TextField
        label={t('Username')}
        hint={t('Small letters and numbers, no spaces')}
        value={f.username}
        onChange={set('username')}
        error={err.username}
        autoCapitalize="none"
        autoComplete="off"
        required
      />
      <SelectField
        label={t('Role')}
        value={f.role}
        onChange={(v) => set('role')(v as Role)}
        options={roles.map((r) => ({ value: r, label: t(ROLE_LABELS[r]) }))}
        error={err.role}
      />
      {f.role !== 'admin' && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ fontWeight: 600, fontSize: '0.92rem' }}>
            {t('Branches this person works in')}
          </legend>
          {boot.activeBranches.map((b) => (
            <Check
              key={b.id}
              label={b.name}
              checked={f.branch_ids.includes(b.id)}
              onChange={(on) =>
                set('branch_ids')(
                  on ? [...f.branch_ids, b.id] : f.branch_ids.filter((x) => x !== b.id),
                )
              }
            />
          ))}
          {err.branch_ids && <span className="err">{t('Choose at least one branch')}</span>}
        </fieldset>
      )}
      <TextField
        label={user ? t('New password') : t('Password')}
        hint={
          user
            ? t('Leave empty to keep the current password. A new password signs this person out.')
            : t('At least 8 characters. Tell it to the person; they can change it later.')
        }
        type="password"
        value={f.password}
        onChange={set('password')}
        error={err.password}
        autoComplete="new-password"
      />
      {user && (
        <Check label={t('Login is switched on')} checked={f.active} onChange={set('active')} />
      )}
      <ErrorNote error={save.error} />
      <Button variant="primary" block busy={save.isPending} onClick={() => save.mutate()}>
        {t('Save')}
      </Button>
    </Sheet>
  );
}
