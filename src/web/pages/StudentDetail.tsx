import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDate } from '../../shared/dates';
import type { Enrolment, StudentDetail } from '../../shared/types';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { webModules } from '../modules';
import { PlaceFields, placeToInput, type Place } from '../components/PlaceFields';
import {
  Badge,
  Button,
  ErrorNote,
  fieldErrors,
  Loading,
  PageHead,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from '../components/ui';

export function StudentDetailPage() {
  const { id } = useParams();
  const boot = useBoot();
  const [editing, setEditing] = useState<Enrolment | null>(null);
  const [adding, setAdding] = useState(false);
  const detail = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get<StudentDetail>(`/students/${id}`),
  });

  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const { student: s, enrolments } = detail.data;
  const canEdit = boot.can('students.edit');
  const moduleLinks = webModules
    .filter((m) => boot.modules[m.id] !== false)
    .flatMap((m) => m.studentLinks ?? [])
    .filter((link) => !link.permission || boot.can(link.permission));
  const inChosenSession = enrolments.some((e) => e.session_id === boot.session?.id);
  const gender = { male: t('Boy'), female: t('Girl'), other: t('Other'), '': '' }[s.gender];

  return (
    <div className="stack">
      <PageHead title={s.name} back="/students">
        {canEdit && (
          <Link to={`/students/${s.id}/edit`} className="btn">
            {t('Edit details')}
          </Link>
        )}
      </PageHead>
      <div className="card">
        <dl className="kv">
          <dt>{t('Admission no')}</dt>
          <dd>{s.admission_no}</dd>
          <dt>{t("Father's name")}</dt>
          <dd>{s.father_name || '–'}</dd>
          <dt>{t("Mother's name")}</dt>
          <dd>{s.mother_name || '–'}</dd>
          <dt>{t('Phone')}</dt>
          <dd>
            {s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : '–'}
            {s.phone2 && (
              <>
                {', '}
                <a href={`tel:${s.phone2}`}>{s.phone2}</a>
              </>
            )}
          </dd>
          <dt>{t('Date of birth')}</dt>
          <dd>{formatDate(s.dob) || '–'}</dd>
          <dt>{t('Gender')}</dt>
          <dd>{gender || '–'}</dd>
          <dt>{t('Address')}</dt>
          <dd>{s.address || '–'}</dd>
        </dl>
      </div>

      <section className="stack">
        <div className="row">
          <h2>{t('Class history')}</h2>
          {canEdit && !inChosenSession && boot.session && (
            <Button small className="right" onClick={() => setAdding(true)}>
              {t('Add to {session}', { session: boot.session.name })}
            </Button>
          )}
        </div>
        <p className="muted small">{t('One line for each year at the school, newest first.')}</p>
        <ol className="timeline">
          {enrolments.map((e, i) => (
            <li key={e.id} className={i === 0 ? '' : 'past'}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{e.session_name}</strong>
                <div>
                  {boot.className(e.class_id)} {e.section_name}
                  {e.roll_no ? ` · ${t('Roll {n}', { n: e.roll_no })}` : ''}
                </div>
                <div className="muted small">
                  {boot.branchName(e.branch_id)} ·{' '}
                  {e.admission_type === 'new' ? t('New admission') : t('Old student')}
                </div>
                <div className="row" style={{ marginTop: 4, gap: 6 }}>
                  {e.status === 'left' ? (
                    <Badge tone="grey">
                      {t('Left on {date}', { date: formatDate(e.left_date) })}
                    </Badge>
                  ) : (
                    e.result === null && <Badge>{t('Studying')}</Badge>
                  )}
                  {e.result === 'pass' && <Badge tone="green">{t('Passed')}</Badge>}
                  {e.result === 'fail' && (
                    <Badge tone="red">{t('Failed, repeated the class')}</Badge>
                  )}
                </div>
              </div>
              {moduleLinks.map((link) => (
                <Link key={link.label} to={link.to(e.id)} className="btn small">
                  {t(link.label)}
                </Link>
              ))}
              {canEdit && boot.branches.some((b) => b.id === e.branch_id) && (
                <Button
                  small
                  onClick={() => setEditing(e)}
                  aria-label={t('Edit {session}', { session: e.session_name })}
                >
                  {t('Edit')}
                </Button>
              )}
            </li>
          ))}
        </ol>
      </section>
      {editing && (
        <EnrolmentSheet studentId={s.id} enrolment={editing} onClose={() => setEditing(null)} />
      )}
      {adding && (
        <EnrolmentSheet studentId={s.id} enrolment={null} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

/** Edit one year's class record, or add the student to the session chosen in the top bar. */
function EnrolmentSheet({
  studentId,
  enrolment,
  onClose,
}: {
  studentId: number;
  enrolment: Enrolment | null;
  onClose: () => void;
}) {
  const boot = useBoot();
  const client = useQueryClient();
  const toast = useToast();
  const [place, setPlace] = useState<Place>(
    enrolment
      ? {
          branch_id: enrolment.branch_id,
          class_id: enrolment.class_id,
          section_id: enrolment.section_id,
          roll_no: enrolment.roll_no ? String(enrolment.roll_no) : '',
          admission_type: enrolment.admission_type,
        }
      : {
          branch_id: boot.activeBranches.length === 1 ? boot.activeBranches[0]!.id : '',
          class_id: '',
          section_id: '',
          roll_no: '',
          admission_type: 'old',
        },
  );
  const [status, setStatus] = useState(enrolment?.status ?? 'studying');
  const [leftDate, setLeftDate] = useState(enrolment?.left_date ?? boot.today);
  const [result, setResult] = useState<string>(enrolment?.result ?? '');
  const save = useMutation({
    mutationFn: () =>
      enrolment
        ? api.put(`/enrolments/${enrolment.id}`, {
            ...placeToInput(place),
            status,
            left_date: status === 'left' ? leftDate : null,
            result: result || null,
          })
        : api.post(`/students/${studentId}/enrolments`, {
            ...placeToInput(place),
            session_id: boot.session?.id,
          }),
    onSuccess: async () => {
      await client.invalidateQueries();
      toast(t('Saved'));
      onClose();
    },
  });
  return (
    <Sheet
      title={
        enrolment
          ? t('Class record for {session}', { session: enrolment.session_name })
          : t('Add to {session}', { session: boot.session?.name ?? '' })
      }
      onClose={onClose}
    >
      <PlaceFields value={place} onChange={setPlace} errors={fieldErrors(save.error)} />
      {enrolment && (
        <>
          <SelectField
            label={t('Status')}
            value={status}
            onChange={(v) => setStatus(v === 'left' ? 'left' : 'studying')}
            options={[
              { value: 'studying', label: t('Studying') },
              { value: 'left', label: t('Left the school') },
            ]}
          />
          {status === 'left' && (
            <TextField
              label={t('Date of leaving')}
              type="date"
              value={leftDate}
              onChange={setLeftDate}
              max={boot.today}
              error={fieldErrors(save.error).left_date}
            />
          )}
          <SelectField
            label={t('Year-end result')}
            hint={t(
              'Normally set by "Promote to next session". Change it here only to correct a mistake.',
            )}
            value={result}
            placeholder={t('Not decided yet')}
            onChange={setResult}
            options={[
              { value: 'pass', label: t('Passed') },
              { value: 'fail', label: t('Failed') },
            ]}
          />
        </>
      )}
      <ErrorNote error={save.error} />
      <Button variant="primary" block busy={save.isPending} onClick={() => save.mutate()}>
        {t('Save')}
      </Button>
    </Sheet>
  );
}
