'use client';

import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { fmtNumber, t } from '@/lib/i18n';
import type { SessionStatus, SessionSummary } from '@/lib/types';

const STATUS_CLASSES: Record<SessionStatus, string> = {
  running: 'ok live', starting: 'info live', stopping: 'warn live', finished: 'accent', error: 'err'
};

export function StatusPill({ status }: { status: SessionStatus }) {
  return <span className={`pill ${STATUS_CLASSES[status] || ''}`}><span className="dot" />{t('status.' + status)}</span>;
}

/** Device / network pills for a session (nothing for a plain desktop session). */
export function EmulationPills({ session }: { session: SessionSummary }) {
  const e = session.emulation;
  if (!e) return null;
  const pills: ReactNode[] = [];
  if (e.device !== 'desktop') pills.push(<span key="d" className="pill info">{e.deviceLabel}</span>);
  if (e.network !== 'none') pills.push(<span key="n" className="pill warn">{t('netp.' + e.network)}</span>);
  if (e.blockPatterns.length) pills.push(<span key="b" className="pill"><Icon name="x" />{fmtNumber(e.blockPatterns.length)}</span>);
  return pills.length ? <span className="pills">{pills}</span> : null;
}

export function HeadersTable({ headers }: { headers: Record<string, string> | null | undefined }) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return <div className="muted small">{t('common.noData')}</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 320 }}>
      <table className="table">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--accent-2)' }}>{k}</td>
              <td className="mono ltr" style={{ wordBreak: 'break-all' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" />;
}

export function Empty({ icon, children, className = '' }: { icon?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`empty ${className}`}>
      {icon && <Icon name={icon} />}
      {children && <div>{children}</div>}
    </div>
  );
}

export function Stat({ icon, label, value, cls = '' }: { icon: string; label: string; value: ReactNode; cls?: string }) {
  return (
    <div className={`stat ${cls}`}>
      <span className="label"><Icon name={icon} />{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

/** A segmented control. */
export function Seg<T extends string>({ value, options, onChange, id }: {
  value: T;
  options: { key: T; label: ReactNode }[];
  onChange: (v: T) => void;
  id?: string;
}) {
  return (
    <div className="seg" id={id}>
      {options.map(o => (
        <button key={o.key} type="button" className={o.key === value ? 'active' : ''} data-k={o.key} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, disabled, onChange, id }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <span className="switch">
      <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span />
    </span>
  );
}
