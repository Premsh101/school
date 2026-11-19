import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CollectRow } from '../../../shared/fees-api';
import type { Paged } from '../../../shared/types';
import { api, query } from '../../app/api';
import { useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import { Icon } from '../../components/icons';
import {
  Badge,
  Empty,
  ErrorNote,
  initials,
  Loading,
  PageHead,
  Pager,
  SelectField,
  TextField,
} from '../../components/ui';
import { classLabel, inr } from './shared';

/** Find a student to collect from. With no search it lists the students overdue today. */
export function CollectPage() {
  const boot = useBoot();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  const params = { session_id: boot.session?.id, branch_id: branchId, q, page };
  const list = useQuery({
    queryKey: ['fees', 'collect', params],
    queryFn: () => api.get<Paged<CollectRow>>(`/fees/collect${query(params)}`),
    enabled: !!boot.session,
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHead title={t('Collect fee')} />
      <div className="filters">
        <div className="wide">
          <TextField
            label={t('Find student')}
            value={search}
            onChange={setSearch}
            type="search"
            placeholder={t('Name, father, roll no or phone')}
            autoFocus
          />
        </div>
        {boot.branches.length > 1 && (
          <SelectField
            label={t('Branch')}
            value={branchId}
            placeholder={t('All branches')}
            onChange={(v) => {
              setBranchId(v);
              setPage(1);
            }}
            options={boot.branches.map((b) => ({ value: String(b.id), label: b.name }))}
          />
        )}
      </div>
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : list.data && list.data.rows.length > 0 ? (
        <>
          <p className="muted small" style={{ marginBottom: 6 }}>
            {q
              ? t('{n} students found', { n: list.data.total })
              : t('{n} students are overdue today, largest first', { n: list.data.total })}
          </p>
          <ul className="list">
            {list.data.rows.map((s) => (
              <li key={s.enrolment_id}>
                <Link to={`/fees/student/${s.enrolment_id}`} className="item">
                  <span className="avatar" aria-hidden="true">
                    {initials(s.name)}
                  </span>
                  <span className="grow">
                    <span className="title" style={{ display: 'block' }}>
                      {s.name}
                    </span>
                    <span className="sub" style={{ display: 'block' }}>
                      {[
                        classLabel(boot.className(s.class_id), s.section_name, s.roll_no),
                        s.father_name ? t('F: {name}', { name: s.father_name }) : '',
                        boot.branches.length > 1 ? boot.branchName(s.branch_id) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', flex: 'none' }}>
                    {s.status === 'left' ? (
                      <Badge tone="grey">{t('Left')}</Badge>
                    ) : s.overdue > 0 ? (
                      <>
                        <strong className="overdue-text">{inr(s.overdue)}</strong>
                        <span className="muted small" style={{ display: 'block' }}>
                          {t('overdue')}
                        </span>
                      </>
                    ) : s.pending > 0 ? (
                      <>
                        <strong>{inr(s.pending)}</strong>
                        <span className="muted small" style={{ display: 'block' }}>
                          {t('due later')}
                        </span>
                      </>
                    ) : (
                      <Badge tone="green">{t('Fully paid')}</Badge>
                    )}
                  </span>
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
          {q
            ? t('No student matches. Check the spelling or try the phone number.')
            : t('Nobody is overdue today. Search above to collect from any student.')}
        </Empty>
      )}
    </div>
  );
}
