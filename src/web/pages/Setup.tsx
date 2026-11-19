import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { sessionName, sessionStartYearFor, todayIST } from '../../shared/dates';
import { api } from '../app/api';
import { t } from '../app/i18n';
import { Button, ErrorNote, fieldErrors, SelectField, TextField } from '../components/ui';
import { RestorePanel } from './Backup';

export function SetupPage() {
  const client = useQueryClient();
  const thisYear = sessionStartYearFor(todayIST());
  const [mode, setMode] = useState<'new' | 'restore'>('new');
  const [f, setF] = useState({
    school_name: 'Soni Pariya Public School',
    owner_name: '',
    username: '',
    password: '',
    branch_name: '',
    branch_code: '',
    branch_address: '',
    branch_phone: '',
    session_start_year: thisYear,
  });
  const set = (key: keyof typeof f) => (value: string) => setF((old) => ({ ...old, [key]: value }));
  const setup = useMutation({
    mutationFn: () =>
      api.post('/setup', {
        school_name: f.school_name,
        owner_name: f.owner_name,
        username: f.username,
        password: f.password,
        branch: {
          name: f.branch_name,
          code: f.branch_code,
          address: f.branch_address,
          phone: f.branch_phone,
        },
        session_start_year: Number(f.session_start_year),
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const err = fieldErrors(setup.error);

  if (mode === 'restore') {
    return (
      <div className="center-page">
        <div className="card stack">
          <h1 className="stamp-title">{t('Restore from a backup')}</h1>
          <RestorePanel onDone={() => client.invalidateQueries()} />
          <Button block onClick={() => setMode('new')}>
            {t('Back to new school setup')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="center-page">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          setup.mutate();
        }}
      >
        <h1 className="stamp-title">{t('Set up your school')}</h1>
        <p className="muted">
          {t(
            'This screen appears only once. It creates the owner login, the first branch and the first session.',
          )}
        </p>
        <TextField
          label={t('School name')}
          value={f.school_name}
          onChange={set('school_name')}
          error={err.school_name}
          required
        />
        <h2>{t('Owner login')}</h2>
        <TextField
          label={t('Your name')}
          value={f.owner_name}
          onChange={set('owner_name')}
          error={err.owner_name}
          autoComplete="name"
          required
        />
        <TextField
          label={t('Username')}
          hint={t('Small letters and numbers, for example prem')}
          value={f.username}
          onChange={set('username')}
          error={err.username}
          autoCapitalize="none"
          autoComplete="username"
          required
        />
        <TextField
          label={t('Password')}
          hint={t('At least 8 characters. Write it down somewhere safe.')}
          type="password"
          value={f.password}
          onChange={set('password')}
          error={err.password}
          autoComplete="new-password"
          required
        />
        <h2>{t('First branch')}</h2>
        <TextField
          label={t('Branch name')}
          hint={t('For example Kamalganj')}
          value={f.branch_name}
          onChange={set('branch_name')}
          error={err['branch.name']}
          required
        />
        <TextField
          label={t('Short code')}
          hint={t('2 to 6 letters, printed on receipt numbers, for example KMG')}
          value={f.branch_code}
          onChange={(v) => set('branch_code')(v.toUpperCase())}
          error={err['branch.code']}
          maxLength={6}
          required
        />
        <TextField label={t('Address')} value={f.branch_address} onChange={set('branch_address')} />
        <TextField
          label={t('Phone')}
          value={f.branch_phone}
          onChange={set('branch_phone')}
          error={err['branch.phone']}
          inputMode="tel"
        />
        <SelectField
          label={t('Current session')}
          value={f.session_start_year}
          onChange={set('session_start_year')}
          options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({
            value: y,
            label: sessionName(y),
          }))}
        />
        <ErrorNote error={setup.error} />
        <Button type="submit" variant="primary" block busy={setup.isPending}>
          {t('Create school')}
        </Button>
        <Button block onClick={() => setMode('restore')}>
          {t('I have a backup file to restore')}
        </Button>
      </form>
    </div>
  );
}
