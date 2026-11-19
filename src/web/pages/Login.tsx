import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../app/api';
import { t } from '../app/i18n';
import { Button, ErrorNote, TextField } from '../components/ui';

export function LoginPage({ school }: { school: { name: string; logo: string } }) {
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.post('/auth/login', { username, password }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <div className="center-page">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        {school.logo && (
          <img
            src={school.logo}
            alt=""
            width={72}
            height={72}
            style={{ margin: '0 auto', objectFit: 'contain' }}
          />
        )}
        <h1 className="stamp-title">{school.name || t('School')}</h1>
        <p className="muted" style={{ textAlign: 'center' }}>
          {t('Sign in to continue')}
        </p>
        <TextField
          label={t('Username')}
          value={username}
          onChange={setUsername}
          autoComplete="username"
          autoCapitalize="none"
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
        <Button type="submit" variant="primary" block busy={login.isPending}>
          {t('Sign in')}
        </Button>
        <p className="muted small">
          {t('Forgot your password? Ask the admin to set a new one for you.')}
        </p>
      </form>
    </div>
  );
}
