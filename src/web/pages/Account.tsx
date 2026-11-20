import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLE_LABELS } from '../../shared/permissions';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { useSignOut } from '../app/signout';
import { t } from '../app/i18n';
import {
  Button,
  ErrorNote,
  fieldErrors,
  PageHead,
  SelectField,
  TextField,
  useToast,
} from '../components/ui';

type Theme = 'auto' | 'light' | 'dark';

export function applyTheme(theme: Theme): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
export function savedTheme(): Theme {
  try {
    const value = localStorage.getItem('theme');
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function AccountPage() {
  const boot = useBoot();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [theme, setTheme] = useState<Theme>(savedTheme());
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { current_password: current, new_password: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast(t('Password changed. Other devices have been signed out.'));
    },
  });
  const logout = useSignOut();
  const err = fieldErrors(change.error);
  return (
    <div className="stack">
      <PageHead title={t('My account')} />
      <div className="card">
        <dl className="kv">
          <dt>{t('Name')}</dt>
          <dd>{boot.user.name}</dd>
          <dt>{t('Username')}</dt>
          <dd>{boot.user.username}</dd>
          <dt>{t('Role')}</dt>
          <dd>{t(ROLE_LABELS[boot.user.role])}</dd>
          <dt>{t('Working in')}</dt>
          <dd>{boot.currentBranch?.name ?? t('All schools')}</dd>
          <dt>{t('Schools')}</dt>
          <dd>
            {boot.user.all_schools
              ? t('All schools')
              : boot.myBranches.map((b) => b.name).join(', ')}
          </dd>
        </dl>
      </div>
      <div className="card stack">
        <SelectField
          label={t('Screen colours')}
          value={theme}
          onChange={(v) => {
            const value = v as Theme;
            setTheme(value);
            applyTheme(value);
            try {
              localStorage.setItem('theme', value);
            } catch {
              /* private mode: the choice lasts until the page is closed */
            }
          }}
          options={[
            { value: 'auto', label: t('Same as phone') },
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
          ]}
        />
      </div>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <h2>{t('Change password')}</h2>
        <TextField
          label={t('Current password')}
          type="password"
          value={current}
          onChange={setCurrent}
          error={err.current_password}
          autoComplete="current-password"
          required
        />
        <TextField
          label={t('New password')}
          hint={t('At least 8 characters')}
          type="password"
          value={next}
          onChange={setNext}
          error={err.new_password}
          autoComplete="new-password"
          required
        />
        <ErrorNote error={change.error} />
        <Button type="submit" variant="primary" block busy={change.isPending}>
          {t('Change password')}
        </Button>
      </form>
      <Button variant="danger" block busy={logout.isPending} onClick={() => logout.mutate()}>
        {t('Sign out')}
      </Button>
    </div>
  );
}
