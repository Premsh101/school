import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sparkline } from './charts';
import { Icon } from './icons';

/** A headline number with an icon, an optional change badge and a small trend line. */
export function Kpi({
  label,
  value,
  icon,
  tone,
  sub,
  delta,
  spark,
  to,
}: {
  label: string;
  value: string;
  icon: string;
  /** paid / overdue colour the icon only; the number keeps the text colour. */
  tone?: 'paid' | 'overdue' | 'gold';
  sub?: ReactNode;
  /** Percentage change against the previous period; null hides the badge. */
  delta?: { pct: number; label: string } | null;
  spark?: number[];
  to?: string;
}) {
  const body = (
    <>
      <span className="kpi-top">
        <span className="kpi-icon">
          <Icon name={icon} />
        </span>
        {label}
      </span>
      <span className="kpi-value">{value}</span>
      {(sub || delta) && (
        <span className="kpi-sub row" style={{ gap: 6 }}>
          {delta && (
            <span
              className={`delta ${delta.pct > 0 ? 'up' : delta.pct < 0 ? 'down' : ''}`}
              title={delta.label}
            >
              {delta.pct > 0 ? '▲' : delta.pct < 0 ? '▼' : '•'} {Math.abs(delta.pct)}%
            </span>
          )}
          {sub}
        </span>
      )}
      {spark && <Sparkline values={spark} />}
    </>
  );
  const cls = `kpi ${tone ?? ''}`;
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Pick one of a few options, like a period. */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A select styled as a rounded pill, for filter bars. */
export function PillSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <span className="pill-select">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Change from the previous period as a whole percentage, or null when there is nothing to compare. */
export function percentChange(now: number, before: number | null | undefined) {
  if (before === null || before === undefined || before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}
