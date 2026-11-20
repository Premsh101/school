import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { ROLE_LABELS } from '../../shared/permissions';
import { Icon } from '../components/icons';
import { initials, useToast } from '../components/ui';
import { applyTheme } from '../pages/Account';
import { api } from './api';
import { schoolLogo, useBoot } from './boot';
import { t } from './i18n';
import { useSignOut } from './signout';
import { GROUP_TITLES, navItems, type NavItem } from './nav';

const ALL = 'all';

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme) return theme === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function Layout() {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const [dark, setDark] = useState(isDark);
  // The school chosen at sign-in can be changed here by anyone allowed more than one.
  const schools = boot.myBranches.filter((b) => b.active);
  const switchable = boot.user.all_schools || schools.length > 1;
  const switchSchool = useMutation({
    mutationFn: (branchId: number | null) => api.post('/auth/school', { branch_id: branchId }),
    onSuccess: async () => {
      await client.invalidateQueries();
      toast(t('School changed'));
    },
    onError: (e) => toast(e instanceof Error ? e.message : t('Could not change school')),
  });
  const signOut = useSignOut();
  const items = navItems(boot.can, boot.modules);
  const tabs = items.filter((i) => i.group === 'main').slice(0, 4);
  const groups = (['main', 'school', 'admin', 'me'] as const).map((g) => ({
    g,
    list: items.filter((i) => i.group === g && i.to !== '/account'),
  }));
  const logo = schoolLogo(boot.school.logo);
  const where = boot.currentBranch?.name ?? t('All schools');

  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
    setDark(!dark);
  };

  return (
    <div className="shell">
      <nav className="sidenav" aria-label={t('Menu')}>
        <Link to="/" className="side-brand">
          <img src={logo} alt="" width={52} height={52} />
          <span>
            <strong>{boot.school.name || t('School')}</strong>
            <span>{where}</span>
          </span>
        </Link>
        {groups.map(({ g, list }) =>
          list.length === 0 ? null : (
            <div key={g}>
              {GROUP_TITLES[g] && <h3>{t(GROUP_TITLES[g])}</h3>}
              {list.map((item) => (
                <NavItemLink key={item.to} item={item} className="nav" />
              ))}
            </div>
          ),
        )}
        <Link to="/account" className="side-user">
          <span className="avatar" aria-hidden="true">
            {initials(boot.user.name)}
          </span>
          <span>
            {boot.user.name}
            <small>{t(ROLE_LABELS[boot.user.role])}</small>
          </span>
        </Link>
        <button
          type="button"
          className="side-signout"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          <Icon name="logout" />
          {signOut.isPending ? t('Signing out…') : t('Sign out')}
        </button>
      </nav>

      <div className="content">
        <header className="topbar">
          <Link to="/" className="brand" aria-label={t('Home')}>
            <img src={logo} alt="" width={36} height={36} />
            {!switchable && <span>{where}</span>}
          </Link>
          {switchable ? (
            <span className="pill-select school">
              <select
                aria-label={t('School')}
                value={boot.user.branch_id ?? ALL}
                disabled={switchSchool.isPending}
                onChange={(e) =>
                  switchSchool.mutate(e.target.value === ALL ? null : Number(e.target.value))
                }
              >
                {schools.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                {boot.user.all_schools && <option value={ALL}>{t('All schools')}</option>}
              </select>
            </span>
          ) : (
            <span className="spacer" />
          )}
          {boot.sessions.length > 0 && (
            <span className="pill-select">
              <select
                aria-label={t('Session')}
                value={boot.session?.id ?? ''}
                onChange={(e) => boot.setSessionId(Number(e.target.value))}
              >
                {boot.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.is_current ? '' : ` (${t('old')})`}
                  </option>
                ))}
              </select>
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={dark ? t('Use light colours') : t('Use dark colours')}
            title={dark ? t('Use light colours') : t('Use dark colours')}
          >
            <Icon name={dark ? 'sun' : 'moon'} />
          </button>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>

      <nav className="tabbar" aria-label={t('Menu')}>
        {tabs.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
        <NavLink to="/more" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="more" />
          {t('More')}
        </NavLink>
      </nav>
    </div>
  );
}

/** Entries that have other entries beneath them (/students, /fees) light up only on their own page. */
const EXACT = ['/', '/students', '/fees'];

function NavItemLink({ item, className = '' }: { item: NavItem; className?: string }) {
  return (
    <NavLink
      to={item.to}
      end={EXACT.includes(item.to)}
      className={({ isActive }) => `${className} ${isActive ? 'active' : ''}`.trim()}
    >
      <Icon name={item.icon} />
      {item.label}
    </NavLink>
  );
}
