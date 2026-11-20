import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionName } from '../../shared/dates';
import type { PromotionCandidate, PromotionResult } from '../../shared/types';
import { api, query } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { Badge, Button, Empty, ErrorNote, Loading, PageHead, SelectField } from '../components/ui';

type Outcome = 'pass' | 'fail' | 'left';

/**
 * Year-end tool: mark each student of a class as Pass, Fail or Left, then move the whole
 * class into the next session in one step. This year's record stays as history.
 */
export function PromotionPage() {
  const boot = useBoot();
  const client = useQueryClient();
  const from = boot.session;
  const to = boot.sessions.find((s) => from && s.start_year === from.start_year + 1);
  const [branchId, setBranchId] = useState<string>(
    boot.activeBranches.length === 1 ? String(boot.activeBranches[0]!.id) : '',
  );
  const [classId, setClassId] = useState('');
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [done, setDone] = useState<PromotionResult | null>(null);

  const ready = !!from && !!to && !!branchId && !!classId;
  const params = {
    from_session_id: from?.id,
    to_session_id: to?.id,
    branch_id: branchId,
    class_id: classId,
  };
  const candidates = useQuery({
    queryKey: ['promotion', params],
    queryFn: () => api.get<PromotionCandidate[]>(`/promotion/candidates${query(params)}`),
    enabled: ready,
  });
  // Everyone starts as Pass (or keeps the result saved earlier); change only the exceptions.
  useEffect(() => {
    if (!candidates.data) return;
    setOutcomes(
      Object.fromEntries(
        candidates.data.map((c) => [
          c.enrolment_id,
          c.status === 'left' ? 'left' : (c.result ?? 'pass'),
        ]),
      ),
    );
  }, [candidates.data]);

  const classIndex = boot.classes.findIndex((c) => c.id === Number(classId));
  const nextClass = boot.classes[classIndex + 1];
  const movable = (candidates.data ?? []).filter((c) => !c.already_moved);
  const count = (o: Outcome) => movable.filter((c) => outcomes[c.enrolment_id] === o).length;

  const promote = useMutation({
    mutationFn: () =>
      api.post<PromotionResult>('/promotion', {
        from_session_id: from!.id,
        to_session_id: to!.id,
        branch_id: Number(branchId),
        class_id: Number(classId),
        outcomes: movable.map((c) => ({
          enrolment_id: c.enrolment_id,
          outcome: outcomes[c.enrolment_id] ?? 'pass',
        })),
      }),
    onSuccess: async (res) => {
      setDone(res);
      await client.invalidateQueries();
    },
  });

  const pick = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setDone(null);
    promote.reset();
  };

  return (
    <div className="stack">
      <PageHead title={t('Promote to next session')} />
      {!from ? null : !to ? (
        <p className="note warn">
          {t('Session {next} is not open yet. Open it first, then come back here.', {
            next: sessionName(from.start_year + 1),
          })}{' '}
          {boot.can('school.manage') ? (
            <Link to="/sessions">{t('Go to Sessions')}</Link>
          ) : (
            t('Ask the admin to open it.')
          )}
        </p>
      ) : (
        <p className="note info">
          {t(
            'Moving students from {from} to {to}. Passed students go to the next class, failed students stay in the same class, and students who left are not moved. This year stays in each student’s history.',
            { from: from.name, to: to.name },
          )}
        </p>
      )}
      <div className="grid2">
        {boot.activeBranches.length > 1 && (
          <SelectField
            label={t('Branch')}
            value={branchId}
            placeholder={t('Choose branch')}
            onChange={pick(setBranchId)}
            options={boot.activeBranches.map((b) => ({ value: String(b.id), label: b.name }))}
          />
        )}
        <SelectField
          label={t('Class')}
          value={classId}
          placeholder={t('Choose class')}
          onChange={pick(setClassId)}
          options={boot.classes.map((c) => ({ value: String(c.id), label: c.name }))}
        />
      </div>

      {ready && candidates.isPending && <Loading />}
      <ErrorNote error={candidates.error} />
      {done && (
        <p className="note ok" role="status">
          {t(
            'Done. {promoted} promoted, {repeating} staying in the same class, {passed_out} passed out of school, {left} left.',
            { ...done },
          )}
        </p>
      )}
      {candidates.data && candidates.data.length === 0 && (
        <Empty>
          {t('No students in this class for {session}.', { session: from?.name ?? '' })}
        </Empty>
      )}
      {candidates.data && candidates.data.length > 0 && (
        <>
          <div className="row">
            <Button
              small
              onClick={() =>
                setOutcomes((old) =>
                  Object.fromEntries(
                    Object.entries(old).map(([id, o]) => [id, o === 'left' ? 'left' : 'pass']),
                  ),
                )
              }
            >
              {t('Mark all as pass')}
            </Button>
            <span className="muted small">
              {t('{pass} pass · {fail} fail · {left} left', {
                pass: count('pass'),
                fail: count('fail'),
                left: count('left'),
              })}
            </span>
          </div>
          <ul className="list">
            {candidates.data.map((c) => (
              <li key={c.enrolment_id}>
                <div className="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <span className="grow">
                    <span className="title" style={{ display: 'block' }}>
                      {c.name}
                    </span>
                    <span className="sub" style={{ display: 'block' }}>
                      {[
                        t('Section {name}', { name: c.section_name }),
                        c.roll_no ? t('Roll {n}', { n: c.roll_no }) : '',
                        c.father_name ? t('F: {name}', { name: c.father_name }) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {c.already_moved ? (
                    <Badge tone="green">{t('Already moved')}</Badge>
                  ) : c.status === 'left' ? (
                    <Badge tone="grey">{t('Left')}</Badge>
                  ) : (
                    <span
                      className="seg"
                      role="group"
                      aria-label={t('Result for {name}', { name: c.name })}
                    >
                      {(['pass', 'fail', 'left'] as const).map((o) => (
                        <button
                          key={o}
                          type="button"
                          className={o}
                          aria-pressed={outcomes[c.enrolment_id] === o}
                          onClick={() => setOutcomes((old) => ({ ...old, [c.enrolment_id]: o }))}
                        >
                          {o === 'pass' ? t('Pass') : o === 'fail' ? t('Fail') : t('Left')}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <ErrorNote error={promote.error} />
          {movable.length > 0 && to && (
            <div className="card stack">
              <p>
                {nextClass
                  ? t(
                      '{pass} students will go to {next}, {fail} will stay in {same}, {left} will be marked as left.',
                      {
                        pass: count('pass'),
                        next: nextClass.name,
                        fail: count('fail'),
                        same: boot.className(Number(classId)),
                        left: count('left'),
                      },
                    )
                  : t(
                      '{pass} students will pass out of the school, {fail} will stay in {same}, {left} will be marked as left.',
                      {
                        pass: count('pass'),
                        fail: count('fail'),
                        same: boot.className(Number(classId)),
                        left: count('left'),
                      },
                    )}
              </p>
              <Button
                variant="primary"
                block
                busy={promote.isPending}
                onClick={() => {
                  if (window.confirm(t('Move this class to session {to} now?', { to: to.name })))
                    promote.mutate();
                }}
              >
                {t('Move class to {to}', { to: to.name })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
