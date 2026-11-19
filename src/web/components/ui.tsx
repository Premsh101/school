import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../app/api';
import { t } from '../app/i18n';
import { Icon } from './icons';

export function Button({
  variant,
  block,
  small,
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger';
  block?: boolean;
  small?: boolean;
  busy?: boolean;
}) {
  const cls = ['btn', variant, block && 'block', small && 'small'].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={rest.disabled || busy}>
      {busy ? t('Please wait…') : children}
    </button>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  ...rest
}: FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    value: string;
    onChange: (value: string) => void;
  }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        {...rest}
      />
      {error ? (
        <span className="err" id={`${id}-note`}>
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={`${id}-note`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function SelectField<V extends string | number>({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hideLabel,
}: FieldProps & {
  value: V | '';
  onChange: (value: string) => void;
  options: { value: V; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="err">{error}</span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Shows what went wrong and how to fix it. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : t('Something went wrong. Please try again.');
  return (
    <p className="note error" role="alert">
      {message}
    </p>
  );
}

export const fieldErrors = (error: unknown): Record<string, string> =>
  error instanceof ApiFailure ? error.fields : {};

export function PageHead({
  title,
  back,
  children,
}: {
  title: string;
  back?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      {back && (
        <Link to={back} className="back" aria-label={t('Back')}>
          <Icon name="back" />
        </Link>
      )}
      <h1>{title}</h1>
      {children && <div className="actions no-print">{children}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <p className="empty" role="status">
      {t('Loading…')}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Badge({
  tone,
  children,
}: {
  tone?: 'green' | 'red' | 'grey';
  children: ReactNode;
}) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={t('Pages')}>
      <Button small disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('Previous')}
      </Button>
      <span className="muted small">{t('Page {page} of {pages}', { page, pages })}</span>
      <Button small disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('Next')}
      </Button>
    </nav>
  );
}

/** A panel that slides up from the bottom on phones and sits in the middle on desktop. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="btn small right" onClick={onClose} aria-label={t('Close')}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body stack">{children}</div>
    </dialog>
  );
}

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">{message && <div className="toast">{message}</div>}</div>
    </ToastContext.Provider>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
