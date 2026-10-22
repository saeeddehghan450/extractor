'use client';

// Pieces shared by the live session and the saved-session pages: request details (drawer),
// console lines, snapshot JSON / screenshot viewers.

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { JsonView } from './JsonView';
import { HeadersTable } from './ui';
import { api } from '@/lib/api';
import { errMsg, fmtBytes, fmtDuration, statusClass } from '@/lib/format';
import { fmtTime, t } from '@/lib/i18n';
import type { ConsoleLine, NetworkRequest, NetworkResponse } from '@/lib/types';
import { copyText, openDrawer, toast } from '@/lib/ui';

export function RequestDetails({ sessionId, request, response }: { sessionId: string; request: Partial<NetworkRequest> | null; response: NetworkResponse | null }) {
  const r: Partial<NetworkRequest> = request || {};
  const url = r.url || response?.url || '';
  return (
    <>
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="method">{r.method || response?.method || ''}</span>
          {response && <span className={`status-code ${statusClass(response.status)}`}>{response.status} {response.statusText || ''}</span>}
          {r.failure && <span className="pill err">{r.failure}</span>}
          <span className="pill">{r.resourceType || response?.resourceType || ''}</span>
          {response?.durationMs != null && <span className="pill">{fmtDuration(response.durationMs)}</span>}
          {response?.size != null && <span className="pill">{fmtBytes(response.size)}</span>}
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => copyText(url)}><Icon name="copy" />{t('common.copy')}</button>
        </div>
        <pre className="code">{url}</pre>
      </div>
      <div><h4>{t('net.request')} · {t('net.headers')}</h4><HeadersTable headers={r.headers} /></div>
      {r.postData && <div><h4>{t('net.postData')}</h4><pre className="code">{r.postData}</pre></div>}
      {response && (
        <>
          <div><h4>{t('net.response')} · {t('net.headers')}</h4><HeadersTable headers={response.headers} /></div>
          {response.remoteAddress && <div className="small muted ltr">{response.remoteAddress.ipAddress}:{response.remoteAddress.port}</div>}
          {response.securityDetails && Object.keys(response.securityDetails).length > 0 && (
            <div><h4>TLS</h4><JsonView data={response.securityDetails} depth={1} /></div>
          )}
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>{t('net.body')}</h4><span className="spacer" />
              {response.fullBodyPath && (
                <a className="btn sm" target="_blank" rel="noopener" href={api.fileUrl(sessionId, response.fullBodyPath)}><Icon name="external" />{t('net.openFull')}</a>
              )}
            </div>
            <pre className="code">{response.bodySnippet ?? ''}</pre>
          </div>
        </>
      )}
    </>
  );
}

/** Loads a request of the running session into the drawer. */
function LiveRequest({ sessionId, id }: { sessionId: string; id: string }) {
  const [data, setData] = useState<{ request: NetworkRequest | null; response: NetworkResponse | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.liveRequest(id).then(setData).catch(e => setError(errMsg(e)));
  }, [id]);
  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="muted">{t('common.loading')}</div>;
  return <RequestDetails sessionId={sessionId} request={data.request} response={data.response} />;
}

export function openLiveRequest(sessionId: string, id: string): void {
  openDrawer(t('net.request'), <LiveRequest key={id} sessionId={sessionId} id={id} />);
}

function JsonFile({ sessionId, file }: { sessionId: string; file: string }) {
  const [data, setData] = useState<unknown>(undefined);
  useEffect(() => {
    api.json<unknown>(sessionId, file).then(setData).catch(e => toast(errMsg(e), 'err'));
  }, [sessionId, file]);
  if (data === undefined) return <div>{t('common.loading')}</div>;
  return <JsonView data={data} depth={2} />;
}

export function openJsonFile(sessionId: string, file: string): void {
  openDrawer(file, <JsonFile key={`${sessionId}/${file}`} sessionId={sessionId} file={file} />);
}

export function openScreenshot(sessionId: string, file: string): void {
  openDrawer('Screenshot', <img className="full" src={api.fileUrl(sessionId, file)} alt="" />);
}

export function ConsoleLines({ lines, empty }: { lines: ConsoleLine[]; empty?: string }) {
  if (!lines.length) return <div className="empty">{empty ?? t('console.empty')}</div>;
  return (
    <>
      {lines.map((m, i) => (
        <div key={i} className={`line ${m.type}`}>
          <span className="t">{fmtTime(m.timestamp)}</span>
          <span className="lvl">{m.pageError ? 'uncaught' : m.type}</span>
          <span>{m.text}{m.stack && <>{'\n'}<span className="muted">{m.stack}</span></>}</span>
          {m.location?.url && <span className="src" title={m.location.url}>{m.location.url.split('/').pop() || ''}:{m.location.lineNumber ?? ''}</span>}
        </div>
      ))}
    </>
  );
}
