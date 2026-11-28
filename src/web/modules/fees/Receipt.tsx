import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../../shared/dates';
import { amountInWords, MODE_LABELS } from '../../../shared/fees';
import type { ReceiptDetail } from '../../../shared/fees-api';
import { api } from '../../app/api';
import { schoolLogo, useBoot } from '../../app/boot';
import { t } from '../../app/i18n';
import { Button, ErrorNote, Loading, PageHead, useToast } from '../../components/ui';
import { classLabel, inr } from './shared';

/** Text version of the receipt, for WhatsApp or SMS. */
function receiptText(d: ReceiptDetail, className: string): string {
  const r = d.receipt;
  return [
    d.school.name,
    t('Fee receipt {no}, {date}', { no: r.receipt_no, date: formatDate(r.date) }),
    `${d.student.name}, ${className} ${d.student.section_name}`,
    t('Received {amount} by {mode}', { amount: inr(r.amount), mode: t(MODE_LABELS[r.mode]) }) +
      (r.late_fee ? `, ${t('including late fee {amount}', { amount: inr(r.late_fee) })}` : '') +
      (r.counter_discount
        ? `, ${t('discount {amount}', { amount: inr(r.counter_discount) })}`
        : ''),
    r.covers ? t('For: {covers}', { covers: r.covers }) : '',
    t('Balance for the year: {amount}', { amount: inr(d.pending) }),
    t('Thank you.'),
  ]
    .filter(Boolean)
    .join('\n');
}

/** A printable receipt: narrow enough for a thermal printer, fine on A5 too. */
export function ReceiptPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const boot = useBoot();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['fees', 'receipt', id],
    queryFn: () => api.get<ReceiptDetail>(`/fees/receipts/${id}`),
  });
  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const d = detail.data;
  const { receipt: r, student: s } = d;
  const cancelled = !!r.cancelled_at;
  const text = receiptText(d, boot.className(s.class_id));
  const phone = s.phone.replace(/\D/g, '').slice(-10);
  const line = (label: string, value: string) => (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
  return (
    <div className="stack">
      <div className="no-print">
        <PageHead
          title={t('Receipt {no}', { no: r.receipt_no })}
          back={`/fees/student/${s.enrolment_id}`}
        />
        {search.get('new') && !cancelled && (
          <p className="note ok">{t('Saved. Print the receipt or send it on WhatsApp.')}</p>
        )}
      </div>
      <article className={`receipt ${cancelled ? 'cancelled' : ''}`}>
        <header>
          <img src={schoolLogo(d.school.logo)} alt="" width={56} height={56} />
          <div>
            <strong className="receipt-school">{d.school.name}</strong>
            <span>
              {[d.branch.address || d.school.address, d.branch.phone].filter(Boolean).join(' · ')}
            </span>
          </div>
        </header>
        <div className="receipt-title">
          <strong>{t('Fee receipt')}</strong>
          <span>{s.session_name}</span>
        </div>
        {cancelled && (
          <p className="receipt-cancelled">
            {t('CANCELLED')}
            <span>
              {t('by {name} on {date}: {reason}', {
                name: r.cancelled_by_name ?? '',
                date: formatDate(r.cancelled_at),
                reason: r.cancel_reason ?? '',
              })}
            </span>
          </p>
        )}
        <dl className="kv">
          {line(t('Receipt no'), r.receipt_no)}
          {line(t('Date'), formatDate(r.date))}
          {line(t('Student'), s.name)}
          {s.father_name && line(t("Father's name"), s.father_name)}
          {line(t('Class'), classLabel(boot.className(s.class_id), s.section_name, s.roll_no))}
          {line(t('Admission no'), s.admission_no)}
          {r.covers && line(t('Received for'), r.covers)}
          {line(t('Paid by'), `${t(MODE_LABELS[r.mode])}${r.reference ? ` (${r.reference})` : ''}`)}
          {r.late_fee > 0 && line(t('Late fee included'), inr(r.late_fee))}
          {r.counter_discount > 0 && line(t('Discount given'), inr(r.counter_discount))}
          {r.note && line(t('Note'), r.note)}
        </dl>
        <div className="receipt-amount">
          <span>{t('Amount received')}</span>
          <strong className={cancelled ? 'strike' : ''}>{inr(r.amount)}</strong>
        </div>
        <p className="receipt-words">{amountInWords(r.amount)}</p>
        <dl className="kv">
          {line(t('Balance for the year'), inr(d.pending))}
          {d.overdue > 0 && line(t('Overdue today'), inr(d.overdue))}
          {d.late_fee > 0 && line(t('Late fee still owed'), inr(d.late_fee))}
        </dl>
        <footer>
          <span>{t('Received by: {name}', { name: r.collected_by_name })}</span>
          <span>{t('Signature')}</span>
        </footer>
      </article>
      <div className="stack no-print">
        <Button variant="primary" block onClick={() => window.print()}>
          {t('Print receipt')}
        </Button>
        <a
          className="btn block"
          href={`https://wa.me/${phone.length === 10 ? `91${phone}` : ''}?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('Send on WhatsApp')}
        </a>
        <Button
          block
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast(t('Receipt text copied'));
            } catch {
              toast(t('Could not copy. Use the WhatsApp button instead.'));
            }
          }}
        >
          {t('Copy receipt text')}
        </Button>
        {boot.can('fees.collect') && (
          <Link to="/fees/collect" className="btn block">
            {t('Collect from another student')}
          </Link>
        )}
      </div>
    </div>
  );
}
