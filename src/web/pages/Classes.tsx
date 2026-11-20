import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Section, Subject } from '../../shared/types';
import { api } from '../app/api';
import { useBoot } from '../app/boot';
import { t } from '../app/i18n';
import {
  Badge,
  Button,
  Check,
  ErrorNote,
  fieldErrors,
  PageHead,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from '../components/ui';

export function ClassesPage() {
  const boot = useBoot();
  const toast = useToast();
  const [branchId, setBranchId] = useState<number>(boot.activeBranches[0]?.id ?? 0);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/sections', { branch_id: branchId, class_id: addingTo, name }),
    onSuccess: async () => {
      await boot.refresh();
      toast(t('Section added'));
      setAddingTo(null);
      setName('');
    },
  });
  const toggle = useMutation({
    mutationFn: (s: Section) => api.put(`/sections/${s.id}/active`, { active: !s.active }),
    onSuccess: () => boot.refresh(),
  });
  return (
    <div className="stack">
      <PageHead title={t('Classes and sections')} />
      {boot.activeBranches.length > 1 && (
        <SelectField
          label={t('Branch')}
          value={branchId}
          onChange={(v) => setBranchId(Number(v))}
          options={boot.activeBranches.map((b) => ({ value: b.id, label: b.name }))}
        />
      )}
      <p className="muted small">
        {t(
          'Classes are the same in every branch. Each branch has its own sections. Tap a section to switch it off or on.',
        )}
      </p>
      <ErrorNote error={toggle.error} />
      <ul className="list">
        {boot.classes.map((c) => (
          <li key={c.id}>
            <div className="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <span className="title" style={{ minWidth: 80 }}>
                {c.name}
              </span>
              <span className="row grow" style={{ gap: 6 }}>
                {boot.sections
                  .filter((s) => s.branch_id === branchId && s.class_id === c.id)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn small"
                      style={
                        s.active ? undefined : { opacity: 0.5, textDecoration: 'line-through' }
                      }
                      aria-pressed={!!s.active}
                      title={
                        s.active
                          ? t('Switch off section {name}', { name: s.name })
                          : t('Switch on section {name}', { name: s.name })
                      }
                      onClick={() => toggle.mutate(s)}
                    >
                      {s.name}
                    </button>
                  ))}
              </span>
              <Button
                small
                onClick={() => setAddingTo(c.id)}
                aria-label={t('Add section to {name}', { name: c.name })}
              >
                {t('Add')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {addingTo && (
        <Sheet
          title={t('Add section to {name}', { name: boot.className(addingTo) })}
          onClose={() => {
            setAddingTo(null);
            add.reset();
          }}
        >
          <TextField
            label={t('Section name')}
            hint={t('For example B')}
            value={name}
            onChange={(v) => setName(v.toUpperCase())}
            error={fieldErrors(add.error).name}
            maxLength={10}
          />
          <ErrorNote error={add.error} />
          <Button variant="primary" block busy={add.isPending} onClick={() => add.mutate()}>
            {t('Add section')}
          </Button>
        </Sheet>
      )}
      {boot.can('school.manage') && <Subjects />}
    </div>
  );
}

function Subjects() {
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const list = useQuery({ queryKey: ['subjects'], queryFn: () => api.get<Subject[]>('/subjects') });
  return (
    <section className="stack">
      <div className="row">
        <h2>{t('Subjects')}</h2>
        <Button small className="right" onClick={() => setEditing('new')}>
          {t('Add subject')}
        </Button>
      </div>
      <p className="muted small">
        {t('Subjects will be used for the timetable and lectures later.')}
      </p>
      <ErrorNote error={list.error} />
      {list.data && list.data.length > 0 && (
        <ul className="list">
          {list.data.map((s) => (
            <li key={s.id}>
              <button type="button" className="item" onClick={() => setEditing(s)}>
                <span className="grow title">{s.name}</span>
                {s.code && <Badge>{s.code}</Badge>}
                {!s.active && <Badge tone="grey">{t('Not used')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SubjectSheet
          subject={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function SubjectSheet({ subject, onClose }: { subject: Subject | null; onClose: () => void }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    name: subject?.name ?? '',
    code: subject?.code ?? '',
    active: subject ? !!subject.active : true,
  });
  const save = useMutation({
    mutationFn: () => (subject ? api.put(`/subjects/${subject.id}`, f) : api.post('/subjects', f)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['subjects'] });
      onClose();
    },
  });
  return (
    <Sheet title={subject ? t('Edit subject') : t('Add subject')} onClose={onClose}>
      <TextField
        label={t('Subject name')}
        value={f.name}
        onChange={(name) => setF({ ...f, name })}
        error={fieldErrors(save.error).name}
      />
      <TextField
        label={t('Short code')}
        hint={t('Optional, for example ENG')}
        value={f.code}
        onChange={(code) => setF({ ...f, code: code.toUpperCase() })}
        maxLength={10}
      />
      {subject && (
        <Check
          label={t('In use')}
          checked={f.active}
          onChange={(active) => setF({ ...f, active })}
        />
      )}
      <ErrorNote error={save.error} />
      <Button variant="primary" block busy={save.isPending} onClick={() => save.mutate()}>
        {t('Save')}
      </Button>
    </Sheet>
  );
}
