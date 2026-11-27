import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { StudentFeeDetail, TransportRoute } from '../../shared/fees-api';
import { formatINR } from '../../shared/format';
import type { StudentDetail } from '../../shared/types';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { PlaceFields, placeToInput, type Place } from '../components/PlaceFields';
import {
  Button,
  ErrorNote,
  fieldErrors,
  Loading,
  PageHead,
  SelectField,
  TextField,
  useToast,
} from '../components/ui';

const emptyPerson = {
  admission_no: '',
  name: '',
  father_name: '',
  mother_name: '',
  phone: '',
  phone2: '',
  address: '',
  dob: '',
  gender: '',
};

/** Add a student (details + class for the chosen session) or edit a student's details. */
export function StudentFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const boot = useBoot();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const [person, setPerson] = useState(emptyPerson);
  const [place, setPlace] = useState<Place>({
    branch_id: boot.activeBranches.length === 1 ? boot.activeBranches[0]!.id : '',
    class_id: '',
    section_id: '',
    roll_no: '',
    admission_type: 'new',
  });
  const set = (key: keyof typeof person) => (value: string) =>
    setPerson((old) => ({ ...old, [key]: value }));
  // Fees that are not on the rate chart: dues from earlier years (old students) and transport.
  const canExtras = !editing && boot.modules.fees !== false && boot.can('fees.edit');
  const [previousDues, setPreviousDues] = useState('');
  const [routeId, setRouteId] = useState('');
  const routes = useQuery({
    queryKey: ['fees', 'transport-routes'],
    queryFn: () => api.get<TransportRoute[]>('/fees/transport-routes'),
    enabled: canExtras,
  });
  const routeChoices = (routes.data ?? []).filter(
    (x) => x.active && (!place.branch_id || x.branch_id === place.branch_id),
  );

  const existing = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get<StudentDetail>(`/students/${id}`),
    enabled: editing,
  });
  useEffect(() => {
    if (existing.data) {
      const s = existing.data.student;
      setPerson({ ...s, dob: s.dob ?? '' });
    }
  }, [existing.data]);

  const dues = place.admission_type === 'old' ? Number(previousDues) || 0 : 0;
  const route = routeChoices.find((x) => String(x.id) === routeId);
  const save = useMutation({
    mutationFn: async () => {
      if (editing)
        return {
          res: await api.put<{ ok: true; id?: number }>(`/students/${id}`, person),
          extras: true,
        };
      const res = await api.post<{ ok: true; id?: number }>('/students', {
        ...person,
        session_id: boot.session?.id,
        enrolment: placeToInput(place),
      });
      if (!canExtras || (dues <= 0 && !route)) return { res, extras: true };
      // The student is saved; now add the previous dues and transport to their fees. If this
      // part fails the student is not lost: the fees can be completed under Edit fees.
      try {
        const student = await api.get<StudentDetail>(`/students/${res.id}`);
        const enrolment = student.enrolments[0]!;
        const fees = await api.get<StudentFeeDetail>(`/fees/students/${enrolment.id}`);
        await api.put(`/fees/students/${enrolment.id}`, {
          months: fees.plan.months,
          discount_reason: fees.discount_reason,
          transport_route_id: route ? route.id : null,
          items: fees.plan.items.map((i) => ({
            type: i.type,
            amount:
              i.type === 'previous_dues'
                ? dues
                : i.type === 'transport' && route
                  ? route.monthly_fee
                  : i.amount,
            discount_type: i.discount_type,
            discount_value: i.discount_value,
          })),
        });
        return { res, extras: true };
      } catch {
        return { res, extras: false };
      }
    },
    onSuccess: async ({ res, extras }) => {
      await client.invalidateQueries();
      toast(
        !extras
          ? t('Student added, but the extra fees could not be saved. Add them under Edit fees.')
          : editing
            ? t('Changes saved')
            : t('Student added'),
      );
      navigate(`/students/${editing ? id : res.id}`, { replace: true });
    },
  });
  const err = fieldErrors(save.error);

  if (editing && existing.isPending) return <Loading />;
  if (editing && existing.error) return <ErrorNote error={existing.error} />;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHead
        title={editing ? t('Edit student') : t('Add student')}
        back={editing ? `/students/${id}` : '/students'}
      />
      <div className="card stack">
        <h2>{t('Student details')}</h2>
        <TextField
          label={t("Student's name")}
          value={person.name}
          onChange={set('name')}
          error={err.name}
          required
          autoComplete="off"
        />
        <div className="grid-wide stack">
          <TextField
            label={t("Father's name")}
            value={person.father_name}
            onChange={set('father_name')}
            error={err.father_name}
            autoComplete="off"
          />
          <TextField
            label={t("Mother's name")}
            value={person.mother_name}
            onChange={set('mother_name')}
            error={err.mother_name}
            autoComplete="off"
          />
          <TextField
            label={t('Phone')}
            value={person.phone}
            onChange={set('phone')}
            error={err.phone}
            inputMode="tel"
            maxLength={15}
          />
          <TextField
            label={t('Second phone')}
            value={person.phone2}
            onChange={set('phone2')}
            error={err.phone2}
            inputMode="tel"
            maxLength={15}
          />
          <TextField
            label={t('Date of birth')}
            type="date"
            value={person.dob}
            onChange={set('dob')}
            error={err.dob}
            max={boot.today}
          />
          <SelectField
            label={t('Gender')}
            value={person.gender}
            placeholder={t('Not set')}
            onChange={set('gender')}
            options={[
              { value: 'male', label: t('Male') },
              { value: 'female', label: t('Female') },
            ]}
          />
        </div>
        <TextField
          label={t('Address')}
          value={person.address}
          onChange={set('address')}
          error={err.address}
        />
        <TextField
          label={t('Admission number')}
          hint={editing ? undefined : t('Leave empty to get the next number automatically.')}
          value={person.admission_no}
          onChange={set('admission_no')}
          error={err.admission_no}
          maxLength={20}
        />
      </div>
      {!editing && (
        <div className="card stack">
          <h2>{t('Class for session {name}', { name: boot.session?.name ?? '' })}</h2>
          <PlaceFields value={place} onChange={setPlace} errors={err} />
          {canExtras && place.admission_type === 'old' && (
            <TextField
              label={t('Old dues (₹)')}
              hint={t(
                'Fees this student still owes from earlier years, if any. They are collected before the other fees.',
              )}
              value={previousDues}
              onChange={(v) => setPreviousDues(v.replace(/\D/g, '').slice(0, 7))}
              inputMode="numeric"
            />
          )}
          {canExtras && routes.data && routeChoices.length > 0 && (
            <SelectField
              label={t('Transport route')}
              hint={t('Leave empty if the student does not use school transport.')}
              value={routeId}
              placeholder={t('No transport')}
              onChange={setRouteId}
              options={routeChoices.map((x) => ({
                value: String(x.id),
                label: `${x.source} → ${x.destination} (${formatINR(x.monthly_fee)} ${t('a month')})`,
              }))}
            />
          )}
        </div>
      )}
      <ErrorNote error={save.error} />
      <Button type="submit" variant="primary" block busy={save.isPending}>
        {editing ? t('Save changes') : t('Add student')}
      </Button>
    </form>
  );
}
