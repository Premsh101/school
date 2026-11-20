import { formatINR } from '../../../shared/format';
import { t } from '../../app/i18n';

export const inr = (n: number) => formatINR(n);

/** A headline number with its label. `tone` colours only the number's marker, not the text. */
export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: 'paid' | 'overdue';
  sub?: string;
}) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

export const classLabel = (className: string, section: string, roll: number | null) =>
  `${className} ${section}${roll ? ` · ${t('Roll {n}', { n: roll })}` : ''}`;
