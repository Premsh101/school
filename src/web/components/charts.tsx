import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatINR } from '../../shared/format';
import { t } from '../app/i18n';
import { Icon } from './icons';

// Small, dependency-free charts. Rules they follow:
// - one value axis, starting at zero, with "nice" round ticks
// - thin marks with rounded data ends; values always readable on hover or tap
// - colour is never the only way to tell series apart: there is always a legend, and
//   every chart card can switch to a plain table

/** ₹950, ₹45K, ₹1.2L, ₹3.4Cr: short Indian money for axes and tight spaces. */
export function shortINR(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const fmt = (v: number) =>
    v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e7) return `${sign}₹${fmt(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${fmt(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${fmt(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

/** Round tick values from 0 to at least max. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag) || 1;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks.length < 2) ticks.push(step);
  return ticks;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface LegendItem {
  label: string;
  color: string;
  value?: string;
  /** A hollow swatch, for a target or "due" series. */
  ghost?: boolean;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}>
          <span
            className={`swatch ${i.ghost ? 'ghost' : ''}`}
            style={{ background: i.ghost ? undefined : i.color, borderColor: i.color }}
            aria-hidden="true"
          />
          <span>{i.label}</span>
          {i.value && <strong className="tabular">{i.value}</strong>}
        </li>
      ))}
    </ul>
  );
}

interface TooltipState {
  x: number;
  lines: ReactNode;
}

function Tooltip({ tip, width }: { tip: TooltipState | null; width: number }) {
  if (!tip) return null;
  const left = Math.max(70, Math.min(width - 70, tip.x));
  return (
    <div className="chart-tip" style={{ left }} role="status">
      {tip.lines}
    </div>
  );
}

const PAD = { top: 12, right: 10, bottom: 26, left: 52 };

export interface SeriesPoint {
  /** Full label for the tooltip, e.g. "19 Nov 2026". */
  label: string;
  /** Short label for the axis, e.g. "19". */
  short: string;
  value: number;
}

/** One series over time, as a line with a soft fill. */
export function AreaChart({
  data,
  height = 220,
  color = 'var(--series-1)',
  format = formatINR,
  axisFormat = shortINR,
  summary,
}: {
  data: SeriesPoint[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  axisFormat?: (n: number) => string;
  summary: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gradient = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const line = data
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join('');
  const area = data.length ? `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : '';
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 64))));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const pick = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    const rel = clientX - box.left - PAD.left;
    const i = Math.round((rel / Math.max(1, w)) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, i)));
  };
  const a = active === null ? null : data[active];
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={summary}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((tk) => (
            <g key={tk}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(tk)} y2={y(tk)} />
              <text x={PAD.left - 8} y={y(tk) + 4} textAnchor="end">
                {axisFormat(tk)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            (i % every === 0 && data.length - 1 - i >= every * 0.7) || i === data.length - 1 ? (
              <text
                key={i}
                x={x(i)}
                y={height - 8}
                textAnchor={i === data.length - 1 && i > 0 ? 'end' : 'middle'}
              >
                {d.short}
              </text>
            ) : null,
          )}
          <path d={area} fill={`url(#${gradient})`} />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2.25"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {max > 0 && active === null && (
            <>
              <circle
                cx={x(peak)}
                cy={y(data[peak]!.value)}
                r="4.5"
                fill={color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
              <text className="peak" x={x(peak)} y={y(data[peak]!.value) - 10} textAnchor="middle">
                {axisFormat(data[peak]!.value)}
              </text>
            </>
          )}
          {a && active !== null && (
            <>
              <line className="cross" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + h} />
              <circle
                cx={x(active)}
                cy={y(a.value)}
                r="5"
                fill={color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      )}
      <Tooltip
        width={width}
        tip={
          a && active !== null
            ? {
                x: x(active),
                lines: (
                  <>
                    <span>{a.label}</span>
                    <strong>{format(a.value)}</strong>
                  </>
                ),
              }
            : null
        }
      />
    </div>
  );
}

export interface BarDatum {
  label: string;
  short: string;
  /** One value per series, in the same order as `series`. */
  values: number[];
}
export interface BarSeries {
  name: string;
  color: string;
  /** Drawn as a wide hollow bar behind the others: a target such as "due". */
  ghost?: boolean;
}

/** Vertical bars. A ghost series (the target) sits behind the solid bars. */
export function BarChart({
  data,
  series,
  height = 240,
  format = formatINR,
  axisFormat = shortINR,
  stacked = false,
  summary,
}: {
  data: BarDatum[];
  series: BarSeries[];
  height?: number;
  format?: (n: number) => string;
  axisFormat?: (n: number) => string;
  /** Stack the solid series on top of each other instead of side by side. */
  stacked?: boolean;
  summary: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const solid = series.map((s, i) => ({ ...s, i })).filter((s) => !s.ghost);
  const ghost = series.map((s, i) => ({ ...s, i })).filter((s) => s.ghost);
  const max = Math.max(
    0,
    ...data.map((d) =>
      Math.max(
        stacked
          ? solid.reduce((t, s) => t + (d.values[s.i] ?? 0), 0)
          : Math.max(0, ...solid.map((s) => d.values[s.i] ?? 0)),
        ...ghost.map((s) => d.values[s.i] ?? 0),
      ),
    ),
  );
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const band = data.length ? w / data.length : w;
  const gap = Math.min(10, band * 0.22);
  const inner = Math.max(2, band - gap);
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const bar = (x: number, bw: number, v0: number, v1: number) => {
    const yTop = y(v1);
    const yBot = y(v0);
    const r = Math.min(4, bw / 2, Math.max(0, yBot - yTop));
    if (yBot - yTop <= 0.5) return '';
    return `M${x},${yBot}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${yBot}Z`;
  };
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 34))));
  const a = active === null ? null : data[active];
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={summary}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(tk)} y2={y(tk)} />
              <text x={PAD.left - 8} y={y(tk) + 4} textAnchor="end">
                {axisFormat(tk)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = PAD.left + i * band + gap / 2;
            const sw = stacked ? inner * 0.62 : (inner * 0.62) / Math.max(1, solid.length);
            const sx0 = x0 + (inner - (stacked ? sw : sw * solid.length)) / 2;
            let acc = 0;
            return (
              <g key={i} className={active === i ? 'on' : ''}>
                <rect
                  className="hit"
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={h}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                />
                {ghost.map((s) => (
                  <path
                    key={s.name}
                    d={bar(x0, inner, 0, d.values[s.i] ?? 0)}
                    fill={s.color}
                    opacity="0.55"
                  />
                ))}
                {solid.map((s, k) => {
                  const v = d.values[s.i] ?? 0;
                  const path = stacked
                    ? bar(sx0, sw, acc, acc + v)
                    : bar(sx0 + k * sw, Math.max(2, sw - 2), 0, v);
                  acc += v;
                  return <path key={s.name} d={path} fill={s.color} />;
                })}
                {((i % every === 0 && data.length - 1 - i >= every * 0.7) ||
                  i === data.length - 1) && (
                  <text x={x0 + inner / 2} y={height - 8} textAnchor="middle">
                    {d.short}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip
        width={width}
        tip={
          a && active !== null
            ? {
                x: PAD.left + active * band + band / 2,
                lines: (
                  <>
                    <span>{a.label}</span>
                    {series.map((s, i) => (
                      <span key={s.name} className="tip-row">
                        <i
                          style={{
                            background: s.ghost ? 'transparent' : s.color,
                            borderColor: s.color,
                          }}
                        />
                        {s.name}: <strong>{format(a.values[i] ?? 0)}</strong>
                      </span>
                    ))}
                  </>
                ),
              }
            : null
        }
      />
    </div>
  );
}

export interface DonutItem {
  label: string;
  value: number;
  color: string;
}

/** Parts of a whole. The centre shows the total, or the part under the finger. */
export function Donut({
  items,
  format = formatINR,
  centerLabel,
  size = 180,
  summary,
}: {
  items: DonutItem[];
  format?: (n: number) => string;
  centerLabel: string;
  size?: number;
  summary: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = active === null ? null : items[active];
  return (
    <div className="donut">
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={summary}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth="18"
          />
          {total > 0 &&
            items.map((item, i) => {
              const len = (item.value / total) * c;
              const seg = (
                <circle
                  key={item.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={active === i ? 22 : 18}
                  strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  style={{ cursor: 'pointer', transition: 'stroke-width .15s' }}
                />
              );
              offset += len;
              return seg;
            })}
        </svg>
        <div className="donut-center">
          <span>{shown ? shown.label : centerLabel}</span>
          <strong className="tabular">{format(shown ? shown.value : total)}</strong>
          {shown && total > 0 && <small>{Math.round((shown.value / total) * 100)}%</small>}
        </div>
      </div>
      <Legend
        items={items.map((i) => ({
          label: i.label,
          color: i.color,
          value: `${format(i.value)}${total > 0 ? ` · ${Math.round((i.value / total) * 100)}%` : ''}`,
        }))}
      />
    </div>
  );
}

export interface StackRow {
  label: string;
  /** Written at the end of the row, e.g. "52% collected". */
  note?: string;
  values: number[];
}

/** One horizontal bar per row, split into parts (for example collected, overdue, due later). */
export function StackBars({
  rows,
  series,
  format = formatINR,
}: {
  rows: StackRow[];
  series: { name: string; color: string }[];
  format?: (n: number) => string;
}) {
  return (
    <div className="stackbars">
      {rows.map((row) => {
        const total = row.values.reduce((s, v) => s + v, 0);
        const title = series.map((s, i) => `${s.name}: ${format(row.values[i] ?? 0)}`).join(', ');
        return (
          <div key={row.label} className="stackrow" title={title}>
            <span className="stack-label">{row.label}</span>
            <span className="stack-bar" role="img" aria-label={`${row.label}: ${title}`}>
              {total > 0 &&
                row.values.map((v, i) =>
                  v > 0 ? (
                    <i
                      key={i}
                      style={{ width: `${(v / total) * 100}%`, background: series[i]?.color }}
                    />
                  ) : null,
                )}
            </span>
            <span className="stack-note tabular">{row.note ?? format(total)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A tiny trend line for a number card. */
export function Sparkline({
  values,
  color = 'var(--series-1)',
}: {
  values: number[];
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gradient = useId().replace(/:/g, '');
  const h = 34;
  const max = Math.max(1, ...values);
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * width);
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const line = values
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join('');
  return (
    <div className="kpi-spark" ref={ref} aria-hidden="true">
      {width > 0 && values.length > 1 && (
        <svg width={width} height={h}>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line}L${width},${h}L0,${h}Z`} fill={`url(#${gradient})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/** A card for a chart, with an optional legend and a switch to see the numbers as a table. */
export function ChartCard({
  title,
  sub,
  legend,
  table,
  actions,
  className = '',
  children,
}: {
  title: string;
  sub?: string;
  legend?: LegendItem[];
  table?: { columns: string[]; rows: (string | number)[][] };
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${className}`}>
      <header>
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {actions}
        {table && (
          <button
            type="button"
            className="icon-btn no-print"
            aria-pressed={asTable}
            aria-label={asTable ? t('Show as chart') : t('Show as table')}
            title={asTable ? t('Show as chart') : t('Show as table')}
            onClick={() => setAsTable(!asTable)}
          >
            <Icon name={asTable ? 'chart' : 'table'} />
          </button>
        )}
      </header>
      {legend && !asTable && <Legend items={legend} />}
      {asTable && table ? (
        <div className="table-wrap flat">
          <table>
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={i ? 'num' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} className={j ? 'num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
