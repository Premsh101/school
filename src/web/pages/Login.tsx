import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../app/api';
import { schoolLogo } from '../app/boot';
import { useSignOut } from '../app/signout';
import { t } from '../app/i18n';
import { Button, ErrorNote, fieldErrors, SelectField, TextField } from '../components/ui';

const ALL = 'all';
const LAST_SCHOOL = 'last-school';

function lastSchool(): string {
  try {
    return localStorage.getItem(LAST_SCHOOL) ?? '';
  } catch {
    return '';
  }
}

/**
 * Sign in. There is no sign-up: the admin creates every login. The person also picks the
 * school to work in, and sees only that school's data. "All schools" is for admin and
 * management; the server checks every choice.
 */
export function LoginPage({
  school,
  branches,
}: {
  school: { name: string; logo: string };
  branches: { id: number; name: string }[];
}) {
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const remembered = lastSchool();
  const [branch, setBranch] = useState<string>(
    remembered === ALL || branches.some((b) => String(b.id) === remembered)
      ? remembered
      : branches.length === 1
        ? String(branches[0]!.id)
        : '',
  );
  const login = useMutation({
    mutationFn: () =>
      api.post('/auth/login', {
        username,
        password,
        branch_id: branch === ALL ? null : Number(branch),
      }),
    onSuccess: () => {
      try {
        localStorage.setItem(LAST_SCHOOL, branch);
      } catch {
        /* private mode: the choice is simply not remembered */
      }
      return client.invalidateQueries();
    },
  });
  return (
    <AuthShell school={school} schools={branches.map((b) => b.name)}>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.35rem' }}>{t('Sign in')}</h2>
          <p className="muted small">{t('Choose your school, then enter your login.')}</p>
        </div>
        <SelectField
          label={t('School')}
          value={branch}
          placeholder={t('Choose your school')}
          onChange={setBranch}
          options={[
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
            ...(branches.length > 1
              ? [{ value: ALL, label: t('All schools (admin and management)') }]
              : []),
          ]}
        />
        <TextField
          label={t('Username')}
          value={username}
          onChange={setUsername}
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          required
        />
        <TextField
          label={t('Password')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <ErrorNote error={login.error} />
        <Button type="submit" variant="primary" block busy={login.isPending} disabled={!branch}>
          {t('Sign in')}
        </Button>
        <p className="muted small">
          {t(
            'No login yet, or forgot your password? Ask the admin; logins are made by the admin only.',
          )}
        </p>
      </form>
    </AuthShell>
  );
}

/** First sign-in with a password someone else chose: the person must set their own. */
export function NewPasswordPage({
  name,
  school,
}: {
  name: string;
  school: { name: string; logo: string };
}) {
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const save = useMutation({
    mutationFn: () => {
      if (next !== again)
        throw new Error(t('The two new passwords are not the same. Type them again.'));
      return api.post('/auth/password', { current_password: current, new_password: next });
    },
    onSuccess: () => client.invalidateQueries(),
  });
  const logout = useSignOut();
  const err = fieldErrors(save.error);
  return (
    <AuthShell school={school} schools={[]}>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 style={{ fontSize: '1.35rem' }}>{t('Set your own password')}</h2>
        <p className="muted">
          {t(
            'Welcome, {name}. You signed in with a password given to you. Choose your own now; only you will know it.',
            { name },
          )}
        </p>
        <TextField
          label={t('Password you just used')}
          type="password"
          value={current}
          onChange={setCurrent}
          error={err.current_password}
          autoComplete="current-password"
          required
        />
        <TextField
          label={t('New password')}
          hint={t('At least 8 characters. Write it down somewhere safe.')}
          type="password"
          value={next}
          onChange={setNext}
          error={err.new_password}
          autoComplete="new-password"
          required
        />
        <TextField
          label={t('New password again')}
          type="password"
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
          required
        />
        <ErrorNote error={save.error} />
        <Button type="submit" variant="primary" block busy={save.isPending}>
          {t('Save and continue')}
        </Button>
        <Button block busy={logout.isPending} onClick={() => logout.mutate()}>
          {t('Sign out')}
        </Button>
      </form>
    </AuthShell>
  );
}

/** The sign-in screens: school logo and name on a navy panel, the form beside or below it. */
function AuthShell({
  school,
  schools,
  children,
}: {
  school: { name: string; logo: string };
  schools: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="auth">
      <section className="auth-brand">
        <img src={schoolLogo(school.logo)} alt="" width={220} height={220} />
        <h1>{school.name || t('School')}</h1>
        <p>{t('Students, fees and reports for every school, on your phone.')}</p>
        {schools.length > 0 && (
          <div className="schools">
            {schools.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        )}
      </section>
      <div className="auth-form">{children}</div>
    </div>
  );
}
