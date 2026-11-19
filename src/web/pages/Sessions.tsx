import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sessionName } from '../../shared/dates';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Badge, Button, ErrorNote, PageHead, useToast } from '../components/ui';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function SessionsPage() {
  const boot = useBoot();
  const toast = useToast();
  const latest = boot.sessions[0];
  const nextYear = (latest?.start_year ?? new Date().getFullYear() - 1) + 1;
  const open = useMutation({
    mutationFn: () =>
      api.post('/sessions', { start_year: nextYear, start_month: latest?.start_month ?? 4 }),
    onSuccess: async () => {
      await boot.refresh();
      toast(t('Session {name} is open', { name: sessionName(nextYear) }));
    },
  });
  const makeCurrent = useMutation({
    mutationFn: (id: number) => api.post(`/sessions/${id}/current`),
    onSuccess: async () => {
      await boot.refresh();
      toast(t('Current session changed'));
    },
  });
  return (
    <div className="stack">
      <PageHead title={t('Sessions')} />
      <p className="note info">
        {t(
          'At the end of the school year: 1. Open the next session. 2. Promote each class (pass, fail, left). 3. Make the new session the current one.',
        )}{' '}
        <Link to="/promotion">{t('Go to Promote to next session')}</Link>
      </p>
      <ErrorNote error={open.error ?? makeCurrent.error} />
      <ul className="list">
        {boot.sessions.map((s) => (
          <li key={s.id}>
            <div className="item" style={{ cursor: 'default' }}>
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>
                  {s.name}
                </span>
                <span className="sub" style={{ display: 'block' }}>
                  {t('Starts in {month} {year}', {
                    month: t(MONTHS[s.start_month - 1] ?? ''),
                    year: s.start_year,
                  })}
                </span>
              </span>
              {s.is_current ? (
                <Badge tone="green">{t('Current')}</Badge>
              ) : (
                <Button
                  small
                  busy={makeCurrent.isPending && makeCurrent.variables === s.id}
                  onClick={() => {
                    if (
                      window.confirm(
                        t('Make {name} the current session? Everyone will see it by default.', {
                          name: s.name,
                        }),
                      )
                    )
                      makeCurrent.mutate(s.id);
                  }}
                >
                  {t('Make current')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        block
        busy={open.isPending}
        onClick={() => {
          if (window.confirm(t('Open session {name}?', { name: sessionName(nextYear) })))
            open.mutate();
        }}
      >
        {t('Open session {name}', { name: sessionName(nextYear) })}
      </Button>
    </div>
  );
}
