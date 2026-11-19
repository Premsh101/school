import { NavLink, Link, Outlet } from 'react-router-dom';
import { Icon } from '../components/icons';
import { useBoot } from './boot';
import { t } from './i18n';
import { GROUP_TITLES, navItems, type NavItem } from './nav';

export function Layout() {
  const boot = useBoot();
  const items = navItems(boot.can, boot.modules);
  const main = items.filter((i) => i.group === 'main');
  const tabs = main.slice(0, 4);
  const groups = (['main', 'school', 'admin', 'me'] as const).map((g) => ({
    g,
    list: items.filter((i) => i.group === g),
  }));

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          {boot.school.logo && <img src={boot.school.logo} alt="" />}
          <span>{boot.school.name || t('School')}</span>
        </Link>
        {boot.sessions.length > 0 && (
          <select
            aria-label={t('Session')}
            value={boot.session?.id ?? ''}
            onChange={(e) => boot.setSessionId(Number(e.target.value))}
          >
            {boot.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_current ? '' : ` (${t('not current')})`}
              </option>
            ))}
          </select>
        )}
      </header>
      <div className="body">
        <nav className="sidenav" aria-label={t('Menu')}>
          {groups.map(({ g, list }) =>
            list.length === 0 ? null : (
              <div key={g}>
                {GROUP_TITLES[g] && <h3>{t(GROUP_TITLES[g])}</h3>}
                {list.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
              </div>
            ),
          )}
        </nav>
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

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={EXACT.includes(item.to)}
      className={({ isActive }) => (isActive ? 'active' : '')}
    >
      <Icon name={item.icon} />
      {item.label}
    </NavLink>
  );
}
