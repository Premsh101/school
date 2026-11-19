import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { HomeSummary } from '../../shared/types';
import { ROLE_LABELS } from '../../shared/permissions';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { GROUP_TITLES, navItems } from '../app/nav';
import { Icon } from '../components/icons';
import { ErrorNote } from '../components/ui';
import { webModules } from '../modules';

export function HomePage() {
  const boot = useBoot();
  const current = boot.sessions.find((s) => s.is_current);
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeSummary>('/home') });
  const total = (rows?: { count: number }[]) => rows?.reduce((sum, r) => sum + r.count, 0) ?? 0;
  const widgets = webModules
    .filter((m) => boot.modules[m.id] !== false)
    .flatMap((m) => m.dashboardWidgets)
    .filter((w) => !w.permission || boot.can(w.permission));
  const shortcuts = navItems(boot.can, boot.modules).filter((i) => i.group === 'school');

  return (
    <div className="stack">
      <div>
        <h1>{t('Namaste, {name}', { name: boot.user.name })}</h1>
        <p className="muted">
          {t(ROLE_LABELS[boot.user.role])} · {t('Session {name}', { name: current?.name ?? '' })}
        </p>
      </div>
      {boot.session && current && boot.session.id !== current.id && (
        <p className="note warn">
          {t(
            'You are looking at session {name}, which is not the current one. Change it in the top bar.',
            { name: boot.session.name },
          )}
        </p>
      )}
      <ErrorNote error={home.error} />
      <div className="tiles">
        {boot.can('students.view') && (
          <Link to="/students" className="tile">
            <Icon name="students" />
            <span className="num">{home.data ? total(home.data.students) : '–'}</span>
            <span>{t('Students studying')}</span>
          </Link>
        )}
        {boot.can('staff.view') && (
          <Link to="/staff" className="tile">
            <Icon name="staff" />
            <span className="num">{home.data ? total(home.data.staff) : '–'}</span>
            <span>{t('Staff members')}</span>
          </Link>
        )}
        {boot.can('students.edit') && (
          <Link to="/students/new" className="tile">
            <Icon name="plus" />
            <span style={{ fontWeight: 600, marginTop: 6 }}>{t('Add a student')}</span>
          </Link>
        )}
      </div>
      {widgets.map((w) => (
        <w.component key={w.id} />
      ))}
      {boot.branches.length > 1 && home.data && boot.can('students.view') && (
        <section className="stack">
          <h2>{t('Students by branch')}</h2>
          <ul className="list">
            {boot.branches.map((b) => (
              <li key={b.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="grow title">{b.name}</span>
                  <strong>
                    {home.data.students.find((r) => r.branch_id === b.id)?.count ?? 0}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {shortcuts.length > 0 && (
        <section className="stack">
          <h2>{t('School work')}</h2>
          <MenuList items={shortcuts} />
        </section>
      )}
    </div>
  );
}

function MenuList({ items }: { items: { to: string; label: string; icon: string }[] }) {
  return (
    <ul className="list">
      {items.map((item) => (
        <li key={item.to}>
          <Link to={item.to} className="item">
            <Icon name={item.icon} />
            <span className="grow title">{item.label}</span>
            <Icon name="chevron" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The full menu, for phones where the bottom bar only fits a few entries. */
export function MorePage() {
  const boot = useBoot();
  const items = navItems(boot.can, boot.modules);
  return (
    <div className="stack">
      <h1>{t('More')}</h1>
      {(['main', 'school', 'admin', 'me'] as const).map((group) => {
        const list = items.filter((i) => i.group === group);
        if (list.length === 0) return null;
        return (
          <section className="stack" key={group}>
            {GROUP_TITLES[group] && <h2>{t(GROUP_TITLES[group])}</h2>}
            <MenuList items={list} />
          </section>
        );
      })}
    </div>
  );
}
