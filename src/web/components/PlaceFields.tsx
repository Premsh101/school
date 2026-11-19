import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import { SelectField, TextField } from './ui';

export interface Place {
  branch_id: number | '';
  class_id: number | '';
  section_id: number | '';
  roll_no: string;
  admission_type: 'new' | 'old';
}

export const placeToInput = (p: Place) => ({
  branch_id: Number(p.branch_id),
  class_id: Number(p.class_id),
  section_id: Number(p.section_id),
  roll_no: p.roll_no.trim() ? Number(p.roll_no) : null,
  admission_type: p.admission_type,
});

/** Branch, class, section, roll number and new/old: where a student sits in one session. */
export function PlaceFields({
  value,
  onChange,
  errors,
}: {
  value: Place;
  onChange: (place: Place) => void;
  errors: Record<string, string>;
}) {
  const boot = useBoot();
  const sections =
    value.branch_id && value.class_id ? boot.sectionsOf(value.branch_id, value.class_id) : [];
  const pickSection = (branchId: number | '', classId: number | ''): number | '' => {
    const list = branchId && classId ? boot.sectionsOf(branchId, classId) : [];
    return list.length === 1 ? list[0]!.id : '';
  };
  const err = (key: string) => errors[key] ?? errors[`enrolment.${key}`];
  return (
    <>
      {boot.activeBranches.length > 1 && (
        <SelectField
          label={t('Branch')}
          value={value.branch_id}
          placeholder={t('Choose branch')}
          error={err('branch_id')}
          onChange={(v) => {
            const branch_id = v ? Number(v) : '';
            onChange({ ...value, branch_id, section_id: pickSection(branch_id, value.class_id) });
          }}
          options={boot.activeBranches.map((b) => ({ value: b.id, label: b.name }))}
        />
      )}
      <div className="grid2">
        <SelectField
          label={t('Class')}
          value={value.class_id}
          placeholder={t('Choose class')}
          error={err('class_id')}
          onChange={(v) => {
            const class_id = v ? Number(v) : '';
            onChange({ ...value, class_id, section_id: pickSection(value.branch_id, class_id) });
          }}
          options={boot.classes.map((c) => ({ value: c.id, label: c.name }))}
        />
        <SelectField
          label={t('Section')}
          value={value.section_id}
          placeholder={t('Choose section')}
          error={err('section_id')}
          disabled={sections.length === 0}
          onChange={(v) => onChange({ ...value, section_id: v ? Number(v) : '' })}
          options={sections.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>
      <div className="grid2">
        <TextField
          label={t('Roll number')}
          value={value.roll_no}
          onChange={(roll_no) => onChange({ ...value, roll_no: roll_no.replace(/\D/g, '') })}
          error={err('roll_no')}
          inputMode="numeric"
          maxLength={4}
        />
        <SelectField
          label={t('New or old student')}
          value={value.admission_type}
          onChange={(v) => onChange({ ...value, admission_type: v === 'old' ? 'old' : 'new' })}
          options={[
            { value: 'new', label: t('New admission') },
            { value: 'old', label: t('Old student') },
          ]}
        />
      </div>
    </>
  );
}
