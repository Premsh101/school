import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditRow, Paged } from '../../shared/types';
import { api } from '../app/api';
import { t } from '../app/i18n';
import { Empty, ErrorNote, Loading, PageHead, Pager } from '../components/ui';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function AuditPage() {
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api.get<Paged<AuditRow>>(`/audit?page=${page}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHead title={t('Activity log')} />
      <p className="muted small" style={{ marginBottom: 8 }}>
        {t(
          'Who added, changed or cancelled what, newest first. Entries cannot be edited or removed.',
        )}
      </p>
      <ErrorNote error={log.error} />
      {log.isPending ? (
        <Loading />
      ) : log.data && log.data.rows.length > 0 ? (
        <>
          <ul className="list">
            {log.data.rows.map((r) => (
              <li key={r.id}>
                <div className="item" style={{ cursor: 'default' }}>
                  <span className="grow">
                    <span style={{ display: 'block', fontWeight: 600 }}>{r.summary}</span>
                    <span className="sub" style={{ display: 'block' }}>
                      {r.user_name || t('System')} · {when(r.at)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Pager
            page={log.data.page}
            pageSize={log.data.page_size}
            total={log.data.total}
            onPage={setPage}
          />
        </>
      ) : (
        <Empty>{t('Nothing has been recorded yet.')}</Empty>
      )}
    </div>
  );
}
