import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Paged, StudentListRow } from '../../shared/types';
import { api, query } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Icon } from '../components/icons';
import {
  Badge,
  Empty,
  ErrorNote,
  avatarTone,
  initials,
  Loading,
  PageHead,
  Pager,
  SelectField,
  TextField,
} from '../components/ui';

export function StudentsPage() {
  const boot = useBoot();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('studying');
  const [page, setPage] = useState(1);

  // Wait until typing pauses before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const sessionId = boot.session?.id;
  const params = {
    session_id: sessionId,
    branch_id: branchId,
    class_id: classId,
    section_id: sectionId,
    status,
    q,
    page,
  };
  const list = useQuery({
    queryKey: ['students', params],
    queryFn: () => api.get<Paged<StudentListRow>>(`/students${query(params)}`),
    enabled: !!sessionId,
    placeholderData: keepPreviousData,
  });
  const sections = branchId && classId ? boot.sectionsOf(Number(branchId), Number(classId)) : [];
  const change = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  return (
    <div>
      <PageHead title={t('Students')}>
        {boot.can('students.edit') && (
          <Link to="/students/new" className="btn primary">
            <Icon name="plus" />
            {t('Add student')}
          </Link>
        )}
      </PageHead>
      <div className="filters">
        <div className="wide">
          <TextField
            label={t('Search')}
            value={search}
            onChange={setSearch}
            type="search"
            placeholder={t('Name, father, phone, admission or roll no')}
          />
        </div>
        {boot.branches.length > 1 && (
          <SelectField
            label={t('Branch')}
            value={branchId}
            placeholder={t('All branches')}
            onChange={change((v) => {
              setBranchId(v);
              setSectionId('');
            })}
            options={boot.branches.map((b) => ({ value: String(b.id), label: b.name }))}
          />
        )}
        <SelectField
          label={t('Class')}
          value={classId}
          placeholder={t('All classes')}
          onChange={change((v) => {
            setClassId(v);
            setSectionId('');
          })}
          options={boot.classes.map((c) => ({ value: String(c.id), label: c.name }))}
        />
        {sections.length > 1 && (
          <SelectField
            label={t('Section')}
            value={sectionId}
            placeholder={t('All sections')}
            onChange={change(setSectionId)}
            options={sections.map((s) => ({ value: String(s.id), label: s.name }))}
          />
        )}
        <SelectField
          label={t('Status')}
          value={status}
          onChange={change(setStatus)}
          options={[
            { value: 'studying', label: t('Studying') },
            { value: 'left', label: t('Left') },
            { value: 'all', label: t('Everyone') },
          ]}
        />
      </div>
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : list.data && list.data.rows.length > 0 ? (
        <>
          <p className="muted small" style={{ marginBottom: 6 }}>
            {t('{n} students in {session}', {
              n: list.data.total,
              session: boot.session?.name ?? '',
            })}
          </p>
          <ul className="list">
            {list.data.rows.map((s) => (
              <li key={s.enrolment_id}>
                <Link to={`/students/${s.student_id}`} className="item">
                  <span className={`avatar ${avatarTone(s.name)}`} aria-hidden="true">
                    {initials(s.name)}
                  </span>
                  <span className="grow">
                    <span className="title" style={{ display: 'block' }}>
                      {s.name}
                    </span>
                    <span className="sub" style={{ display: 'block' }}>
                      {[
                        `${boot.className(s.class_id)} ${s.section_name}`,
                        s.roll_no ? t('Roll {n}', { n: s.roll_no }) : '',
                        s.father_name ? t('F: {name}', { name: s.father_name }) : '',
                        boot.branches.length > 1 ? boot.branchName(s.branch_id) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {s.status === 'left' && <Badge tone="grey">{t('Left')}</Badge>}
                  <Icon name="chevron" />
                </Link>
              </li>
            ))}
          </ul>
          <Pager
            page={list.data.page}
            pageSize={list.data.page_size}
            total={list.data.total}
            onPage={setPage}
          />
        </>
      ) : (
        <Empty>
          {q || classId || branchId
            ? t('No students match. Try a different search or clear the filters.')
            : t('No students in this session yet. Add one, or import a list from Excel.')}
        </Empty>
      )}
    </div>
  );
}
