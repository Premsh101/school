import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.put<{ ok: true; id?: number }>(`/students/${id}`, person)
        : api.post<{ ok: true; id?: number }>('/students', {
            ...person,
            session_id: boot.session?.id,
            enrolment: placeToInput(place),
          }),
    onSuccess: async (res) => {
      await client.invalidateQueries();
      toast(editing ? t('Changes saved') : t('Student added'));
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
              { value: 'male', label: t('Boy') },
              { value: 'female', label: t('Girl') },
              { value: 'other', label: t('Other') },
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
        </div>
      )}
      <ErrorNote error={save.error} />
      <Button type="submit" variant="primary" block busy={save.isPending}>
        {editing ? t('Save changes') : t('Add student')}
      </Button>
    </form>
  );
}
