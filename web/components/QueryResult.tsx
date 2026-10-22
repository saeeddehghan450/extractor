'use client';

// Result of a read-only query (Cypher or SQL): header with row count and timing, table or graph view.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Empty, Seg } from './ui';
import { collectGraph, drawGraph, isNode, isPath, isRel, labelColor, nodeCaption } from '@/lib/forceGraph';
import { fmtNumber, t } from '@/lib/i18n';
import type { QueryResult as Result } from '@/lib/types';

/** Table cell for graph values (nodes, relationships, paths) and plain JSON values. */
export function ValueCell({ value: v }: { value: unknown }) {
  if (v == null) return <span className="muted">null</span>;
  if (isNode(v)) {
    return <><span className="gnode" style={{ '--c': labelColor(v.labels[0] || '') } as React.CSSProperties}>{v.labels.join(':')}</span>{' '}<span className="ltr">{nodeCaption(v).slice(0, 120)}</span></>;
  }
  if (isRel(v)) return <code>[:{v.type}]</code>;
  if (isPath(v)) return <code>{t('graph.path', { n: v.relationships.length })}</code>;
  if (typeof v === 'boolean') return <>{v ? '✓' : '✗'}</>;
  if (typeof v === 'object') return <code className="ltr">{JSON.stringify(v).slice(0, 400)}</code>;
  return <span className="ltr">{String(v).slice(0, 400)}</span>;
}

function GraphCanvas({ rows }: { rows: Record<string, unknown>[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const g = collectGraph(rows);
  useEffect(() => drawGraph(canvas.current!, tip.current!, collectGraph(rows)), [rows]);
  return (
    <div className="graph-canvas-wrap">
      <canvas id="gCanvas" ref={canvas} />
      <div className="graph-tip" ref={tip} />
      <div className="graph-legend">
        {[...new Set([...g.nodes.values()].map(n => n.labels[0] || ''))].map(l => (
          <span key={l} className="gnode" style={{ '--c': labelColor(l) } as React.CSSProperties}>{l}</span>
        ))}
      </div>
    </div>
  );
}

export function QueryResultView({ result, title, onExplain, graph = false }: {
  result: Result;
  title?: string;
  onExplain: () => void;
  /** offer the graph view (Cypher results) */
  graph?: boolean;
}) {
  const g = graph ? collectGraph(result.rows) : null;
  const canGraph = !!g && g.nodes.size > 0;
  // results with relationships start in the graph view
  const [mode, setMode] = useState<'table' | 'graph'>(() => (canGraph && !title && g!.rels.size > 0 ? 'graph' : 'table'));
  const view = canGraph ? mode : 'table';
  let body: ReactNode;
  if (!result.rows.length) body = <Empty>{t('graph.noRows')}</Empty>;
  else if (view === 'graph') body = <GraphCanvas rows={result.rows} />;
  else {
    body = (
      <div className="table-wrap" style={{ maxHeight: 560 }}>
        <table className="table">
          <thead><tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={i}>{result.columns.map(c => <td key={c} className="gcell"><ValueCell value={r[c]} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <Icon name={view === 'graph' ? 'network' : 'layers'} /><h3>{title || t('graph.result')}</h3>
        <span className="muted small">{t('graph.rows', { n: fmtNumber(result.rows.length) })}{result.truncated ? ' +' : ''} · {fmtNumber(result.ms)} ms</span>
        <span className="spacer" />
        {canGraph && <Seg id="gMode" value={view} onChange={setMode} options={[{ key: 'table', label: t('graph.table') }, { key: 'graph', label: t('graph.graph') }]} />}
        <button className="btn sm ghost" id="gExplain" onClick={onExplain}><Icon name="zap" />{t('graph.explain')}</button>
      </div>
      {body}
    </>
  );
}
