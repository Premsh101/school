import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../app/api';
import { schoolLogo, useBoot } from '../app/boot';
import { t } from '../app/i18n';
import {
  Button,
  Check,
  ErrorNote,
  fieldErrors,
  PageHead,
  TextField,
  useToast,
} from '../components/ui';
import { webModules } from '../modules';

/** Shrinks a chosen picture to a small square PNG so it can be stored with the settings. */
async function fileToLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 160;
  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function SettingsPage() {
  const boot = useBoot();
  const toast = useToast();
  const [name, setName] = useState(boot.school.name);
  const [address, setAddress] = useState(boot.school.address);
  const [logo, setLogo] = useState(boot.school.logo);
  const [modules, setModules] = useState(boot.modules);
  const [logoError, setLogoError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.put('/settings', { school_name: name, school_address: address, logo, modules }),
    onSuccess: async () => {
      await boot.refresh();
      toast(t('Settings saved'));
    },
  });
  const err = fieldErrors(save.error);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHead title={t('Settings')} />
      <div className="card stack">
        <h2>{t('School')}</h2>
        <TextField
          label={t('School name')}
          value={name}
          onChange={setName}
          error={err.school_name}
          required
        />
        <TextField
          label={t('Address')}
          hint={t('Printed on receipts and reports')}
          value={address}
          onChange={setAddress}
        />
        <div className="field">
          <label htmlFor="logo-file">{t('Logo')}</label>
          <div className="row">
            <img
              src={schoolLogo(logo)}
              alt={t('Current logo')}
              width={56}
              height={56}
              style={{ objectFit: 'contain' }}
            />
            <input
              id="logo-file"
              type="file"
              accept="image/*"
              style={{ flex: 1, minWidth: 0 }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setLogo(await fileToLogo(file));
                  setLogoError('');
                } catch {
                  setLogoError(t('That file is not a picture. Choose a PNG or JPG file.'));
                }
              }}
            />
            {logo && (
              <Button small onClick={() => setLogo('')}>
                {t('Use the standard logo')}
              </Button>
            )}
          </div>
          {(logoError || err.logo) && <span className="err">{logoError || err.logo}</span>}
        </div>
      </div>
      <div className="card stack">
        <h2>{t('Modules')}</h2>
        {webModules.length === 0 ? (
          <p className="muted">
            {t(
              'Fees, attendance, lectures and leave will appear here as they are added. Each can be switched on or off.',
            )}
          </p>
        ) : (
          webModules.map((m) => (
            <Check
              key={m.id}
              label={t(m.name)}
              checked={modules[m.id] !== false}
              onChange={(on) => setModules({ ...modules, [m.id]: on })}
            />
          ))
        )}
      </div>
      <ErrorNote error={save.error} />
      <Button type="submit" variant="primary" block busy={save.isPending}>
        {t('Save settings')}
      </Button>
    </form>
  );
}
