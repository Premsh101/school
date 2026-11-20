import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiFailure } from './app/api';
import { BootProvider, useBoot, useBootstrap } from './app/boot';
import { t } from './app/i18n';
import { Layout } from './app/Layout';
import { ErrorNote, Loading, ToastProvider } from './components/ui';
import { webModules } from './modules';
import { AccountPage, applyTheme, savedTheme } from './pages/Account';
import { AuditPage } from './pages/Audit';
import { BackupPage } from './pages/Backup';
import { BranchesPage } from './pages/Branches';
import { ClassesPage } from './pages/Classes';
import { HomePage, MorePage } from './pages/Home';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { PromotionPage } from './pages/Promotion';
import { SessionsPage } from './pages/Sessions';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { StaffPage } from './pages/Staff';
import { StudentDetailPage } from './pages/StudentDetail';
import { StudentFormPage } from './pages/StudentForm';
import { StudentsPage } from './pages/Students';
import { UsersPage } from './pages/Users';
import './styles.css';

applyTheme(savedTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        !(error instanceof ApiFailure && error.status > 0 && error.status < 500) && count < 2,
    },
  },
});

/** Shows a page only to people who hold the permission. */
function Guard({ permission, children }: { permission?: string; children: React.ReactNode }) {
  const { can } = useBoot();
  if (permission && !can(permission)) {
    return (
      <p className="note warn">
        {t('You do not have permission to open this page. Ask the admin if you need it.')}
      </p>
    );
  }
  return <>{children}</>;
}

function App() {
  const boot = useBootstrap();
  const name = boot.data?.school.name;
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);

  if (boot.isPending) return <Loading />;
  if (boot.isError) {
    return (
      <div className="center-page">
        <ErrorNote error={boot.error} />
      </div>
    );
  }
  if (boot.data.needs_setup)
    return <SetupPage preset={boot.data.preset} schoolName={boot.data.school.name} />;
  if (!boot.data.user) return <LoginPage school={boot.data.school} />;

  const page = (permission: string | undefined, element: React.ReactNode) => (
    <Guard permission={permission}>{element}</Guard>
  );
  return (
    <BootProvider data={boot.data}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="more" element={<MorePage />} />
          <Route path="students" element={page('students.view', <StudentsPage />)} />
          <Route path="students/new" element={page('students.edit', <StudentFormPage />)} />
          <Route path="students/import" element={page('students.import', <ImportPage />)} />
          <Route path="students/:id" element={page('students.view', <StudentDetailPage />)} />
          <Route path="students/:id/edit" element={page('students.edit', <StudentFormPage />)} />
          <Route path="promotion" element={page('students.promote', <PromotionPage />)} />
          <Route path="staff" element={page('staff.view', <StaffPage />)} />
          <Route path="classes" element={page('structure.edit', <ClassesPage />)} />
          <Route path="users" element={page('users.manage', <UsersPage />)} />
          <Route path="branches" element={page('school.manage', <BranchesPage />)} />
          <Route path="sessions" element={page('school.manage', <SessionsPage />)} />
          <Route path="settings" element={page('school.manage', <SettingsPage />)} />
          <Route path="audit" element={page('audit.view', <AuditPage />)} />
          <Route path="backup" element={page('backup.manage', <BackupPage />)} />
          <Route path="account" element={<AccountPage />} />
          {webModules
            .filter((m) => boot.data.modules[m.id] !== false)
            .flatMap((m) =>
              m.routes.map((r) => (
                <Route
                  key={`${m.id}/${r.path}`}
                  path={`${m.id}/${r.path}`}
                  element={page(r.permission, <r.component />)}
                />
              )),
            )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BootProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
