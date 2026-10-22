'use client';

// Lazy, collapsible JSON tree viewer: children are only rendered when a node is opened, and long
// lists are paged, so very large documents stay fast.

import { createContext, useContext, useState } from 'react';
import { t } from '@/lib/i18n';

const PAGE = 200;

type Container = Record<string, unknown> | unknown[];
const isContainer = (v: unknown): v is Container => v !== null && typeof v === 'object';

/** How many nodes may still open by themselves (keeps "expand all" bounded on huge documents). */
const Budget = createContext<{ left: number }>({ left: 0 });

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="null">null</span>;
  switch (typeof value) {
    case 'string': return <span className="str">&quot;{value.length > 3000 ? value.slice(0, 3000) + '…' : value}&quot;</span>;
    case 'number': return <span className="num">{value}</span>;
    case 'boolean': return <span className="bool">{String(value)}</span>;
    default: return <span className="null">{String(value)}</span>;
  }
}

function Children({ value, depth }: { value: Container; depth: number }) {
  const [shown, setShown] = useState(PAGE);
  const entries: [string | number, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  return (
    <div className="node">
      {entries.slice(0, shown).map(([k, v]) => (
        <Entry key={k} name={k} value={v} isIndex={Array.isArray(value)} depth={depth - 1} />
      ))}
      {entries.length > shown && (
        <div className="more" onClick={() => setShown(shown + PAGE)}>{t('common.showMore', { n: entries.length - shown })}</div>
      )}
    </div>
  );
}

function Entry({ name, value, isIndex, depth }: { name: string | number | null; value: unknown; isIndex: boolean; depth: number }) {
  const budget = useContext(Budget);
  const [open, setOpen] = useState(() => {
    if (depth <= 0 || !isContainer(value) || budget.left <= 0) return false;
    budget.left--;
    return true;
  });
  const label = name === null ? null : isIndex
    ? <><span className="meta">{name}</span>: </>
    : <><span className="key">&quot;{name}&quot;</span>: </>;
  if (!isContainer(value)) return <div>{label}<Primitive value={value} /></div>;
  const size = Array.isArray(value) ? value.length : Object.keys(value).length;
  if (!size) return <div>{label}<span className="meta">{Array.isArray(value) ? '[]' : '{}'}</span></div>;
  return (
    <div className={open ? 'open' : ''}>
      <span className="toggle" onClick={() => setOpen(!open)}>
        {label}{Array.isArray(value) ? '[…] ' : '{…} '}
        <span className="meta">{Array.isArray(value) ? t('common.items', { n: size }) : t('common.keys', { n: size })}</span>
      </span>
      {open && <Children value={value} depth={depth} />}
    </div>
  );
}

/**
 * `depth` levels are open at first. With `expanded`, every level opens (up to 3000 nodes);
 * remount it (change its key) to apply a new setting.
 */
export function JsonView({ data, depth = 1, expanded = false }: { data: unknown; depth?: number; expanded?: boolean }) {
  return (
    <Budget.Provider value={{ left: expanded ? 3000 : 1000 }}>
      <div className="json">
        <Entry name={null} value={data} isIndex={false} depth={expanded ? 64 : depth} />
      </div>
    </Budget.Provider>
  );
}
