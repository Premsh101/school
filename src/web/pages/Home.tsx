import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDate } from '../../shared/dates';
import type { HomeSummary } from '../../shared/types';
import { api, query } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { GROUP_TITLES, navItems } from '../app/nav';
import { BarChart, ChartCard, Donut } from '../components/charts';
import { Kpi } from '../components/dash';
import { Icon } from '../components/icons';
import { ErrorNote } from '../components/ui';
import { webModules } from '../modules';

const count = (n: number) => n.toLocaleString('en-IN');

function greeting(): string {
  const hour = Number(
    new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }),
  );
  if (hour < 12) return t('Good morning');
  if (hour < 17) return t('Good afternoon');
  return t('Good evening');
}

export function HomePage() {
  const boot = useBoot();
  const current = boot.sessions.find((s) => s.is_current);
  const sessionId = boot.session?.id;
  const home = useQuery({
    queryKey: ['home', sessionId, boot.user.branch_id],
    queryFn: () => api.get<HomeSummary>(`/home${query({ session_id: sessionId })}`),
  });
  const h = home.data;
  const studying = h?.students.reduce((sum, r) => sum + r.count, 0) ?? 0;
  const staff = h?.staff.reduce((sum, r) => sum + r.count, 0) ?? 0;
  const widgets = webModules
    .filter((m) => boot.modules[m.id] !== false)
    .flatMap((m) => m.dashboardWidgets)
    .filter((w) => !w.permission || boot.can(w.permission));
  const canStudents = boot.can('students.view');
  const classRows = h
    ? boot.classes
        .map((c) => ({ c, row: h.by_class.find((x) => x.class_id === c.id) }))
        .filter((x) => x.row)
    : [];

  return (
    <div>
      <div className="hello">
        <div>
          <p className="eyebrow">{formatDate(boot.today)}</p>
          <h1>
            {greeting()}, {boot.user.name.split(' ')[0]}
          </h1>
          <p className="muted">
            {boot.currentBranch?.name ?? t('All schools')} ·{' '}
            {t('Session {name}', { name: boot.session?.name ?? '' })}
          </p>
        </div>
        <div className="quick">
          {boot.can('fees.collect') && boot.modules.fees !== false && (
            <Link to="/fees/collect" className="btn primary">
              <Icon name="collect" />
              {t('Collect fee')}
            </Link>
          )}
          {boot.can('students.edit') && (
            <Link to="/students/new" className="btn">
              <Icon name="plus" />
              {t('Add student')}
            </Link>
          )}
          {canStudents && (
            <Link to="/reports" className="btn">
              <Icon name="report" />
              {t('Reports')}
            </Link>
          )}
        </div>
      </div>

      {boot.session && current && boot.session.id !== current.id && (
        <p className="note warn" style={{ marginBottom: 14 }}>
          {t(
            'You are looking at session {name}, which is not the current one. Change it at the top of the screen.',
            {
              name: boot.session.name,
            },
          )}
        </p>
      )}
      <ErrorNote error={home.error} />

      {canStudents && (
        <div className="kpis">
          <Kpi
            label={t('Students studying')}
            icon="students"
            value={h ? count(studying) : '–'}
            to="/students"
          />
          <Kpi
            label={t('New admissions')}
            icon="plus"
            tone="gold"
            value={h ? count(h.new_admissions) : '–'}
            sub={h ? t('{n} old students', { n: count(h.old_students) }) : undefined}
          />
          {boot.can('staff.view') ? (
            <Kpi label={t('Staff')} icon="staff" value={h ? count(staff) : '–'} to="/staff" />
          ) : (
            <Kpi label={t('Classes')} icon="classes" value={h ? count(h.by_class.length) : '–'} />
          )}
          <Kpi
            label={t('Left this session')}
            icon="logout"
            tone="overdue"
            value={h ? count(h.left) : '–'}
            to="/reports?r=core.left"
          />
        </div>
      )}

      {widgets.map((w) => (
        <w.component key={w.id} />
      ))}

      {canStudents && h && studying > 0 && (
        <div className="dash-grid">
          <ChartCard
            className="span-2"
            title={t('Students by class')}
            sub={t('Studying now, boys and girls')}
            legend={[
              { label: t('Boys'), color: 'var(--series-1)' },
              { label: t('Girls'), color: 'var(--series-2)' },
              { label: t('Not set'), color: 'var(--series-neutral)' },
            ]}
            table={{
              columns: [t('Class'), t('Boys'), t('Girls'), t('Total')],
              rows: classRows.map(({ c, row }) => [c.name, row!.boys, row!.girls, row!.count]),
            }}
          >
            <BarChart
              stacked
              height={220}
              format={(n) => count(n)}
              axisFormat={(n) => count(n)}
              summary={t('Students in each class')}
              series={[
                { name: t('Boys'), color: 'var(--series-1)' },
                { name: t('Girls'), color: 'var(--series-2)' },
                { name: t('Not set'), color: 'var(--series-neutral)' },
              ]}
              data={classRows.map(({ c, row }) => ({
                label: c.name,
                short: c.name.replace('Class ', '').replace('Nursery', 'Nur'),
                values: [row!.boys, row!.girls, row!.count - row!.boys - row!.girls],
              }))}
            />
          </ChartCard>
          <ChartCard
            title={boot.branches.length > 1 ? t('Students by school') : t('New and old students')}
          >
            <Donut
              size={160}
              centerLabel={t('Students')}
              format={(n) => count(n)}
              summary={t('{n} students', { n: studying })}
              items={
                boot.branches.length > 1
                  ? h.students.map((r, i) => ({
                      label: boot.branchName(r.branch_id),
                      value: r.count,
                      color: [
                        'var(--series-1)',
                        'var(--series-2)',
                        'var(--series-3)',
                        'var(--series-4)',
                      ][i % 4]!,
                    }))
                  : [
                      {
                        label: t('New admissions'),
                        value: h.new_admissions,
                        color: 'var(--series-1)',
                      },
                      { label: t('Old students'), value: h.old_students, color: 'var(--series-2)' },
                    ]
              }
            />
          </ChartCard>
        </div>
      )}

      <ShortcutGrid />
    </div>
  );
}

/** Big tappable tiles for the school's everyday work. */
function ShortcutGrid() {
  const boot = useBoot();
  const items = navItems(boot.can, boot.modules).filter((i) => i.group === 'school');
  if (items.length === 0) return null;
  return (
    <section style={{ marginTop: 22 }}>
      <h2 style={{ marginBottom: 10 }}>{t('School work')}</h2>
      <div className="shortcuts">
        {items.map((item) => (
          <Link key={item.to} to={item.to} className="shortcut">
            <span className="kpi-icon">
              <Icon name={item.icon} />
            </span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </section>
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
            {GROUP_TITLES[group] && <p className="eyebrow">{t(GROUP_TITLES[group])}</p>}
            <div className="shortcuts">
              {list.map((item) => (
                <Link key={item.to} to={item.to} className="shortcut">
                  <span className="kpi-icon">
                    <Icon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
