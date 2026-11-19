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

/** How much of a total is done, as a thin bar with the figures written beside it. */
export function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="meter" role="img" aria-label={`${label}: ${percent}%`}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="muted small">{percent}%</span>
    </div>
  );
}

/**
 * A small single-series bar chart. One hue, bars anchored to the baseline, the value of
 * each bar on hover or focus, and the highest bar labelled. The same numbers are always
 * available as text (aria-label and the tooltip), so nothing depends on colour.
 */
export function Bars({
  data,
  caption,
}: {
  data: { label: string; hint: string; value: number }[];
  caption: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.findIndex((d) => d.value === max);
  return (
    <figure className="bars">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="bars-plot">
        {data.map((d, i) => (
          <div key={i} className="bars-col" tabIndex={0} aria-label={`${d.hint}: ${inr(d.value)}`}>
            <span className="bars-tip">
              {d.hint}
              <br />
              <strong>{inr(d.value)}</strong>
            </span>
            {i === peak && d.value > 0 && <span className="bars-peak">{inr(d.value)}</span>}
            <div
              className="bars-bar"
              style={{ height: `${d.value > 0 ? Math.max(3, (d.value / max) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="bars-axis" aria-hidden="true">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
      {max === 1 && data.every((d) => d.value === 0) && (
        <p className="muted small">{t('Nothing collected in this period yet.')}</p>
      )}
    </figure>
  );
}

export const classLabel = (className: string, section: string, roll: number | null) =>
  `${className} ${section}${roll ? ` · ${t('Roll {n}', { n: roll })}` : ''}`;
