/**
 * insights.ts
 *
 * Ready-made graph analyses. Each one is a read-only Cypher query that can be scoped to a single
 * session; the dashboard lists them and the AI agent can run them by id.
 */

import { GraphError, QueryResult, runReadQuery } from './neo4jClient';

export interface Insight {
  id: string;
  title: string;
  description: string;
  /** read-only Cypher; $sessionId is null when not scoped */
  cypher: string;
}

/** `s` restricted to $sessionId when one is given. */
const SESSION = '(s:Session) WHERE $sessionId IS NULL OR s.id = $sessionId';

export const INSIGHTS: Insight[] = [
  {
    id: 'overview',
    title: 'Sessions overview',
    description: 'Every session with its start page, request, domain, error and scraped-record counts.',
    cypher: `MATCH ${SESSION}
      CALL (s) { OPTIONAL MATCH (s)-[c:CONTACTED]->(d) RETURN count(d) AS domains, sum(CASE WHEN c.thirdParty THEN 1 ELSE 0 END) AS thirdParty }
      CALL (s) { OPTIONAL MATCH (s)-[:SCRAPED]->(:Scrape)-[:HAS_RECORD]->(r) RETURN count(r) AS records }
      RETURN s.id AS session, s.url AS url, s.status AS status, s.startedAt AS startedAt, s.requests AS requests,
             domains, thirdParty, s.errors AS errors, records
      ORDER BY s.startedAt DESC`
  },
  {
    id: 'third-party-domains',
    title: 'Third-party domains',
    description: 'Domains outside the start site, with request volume, bytes and how many sessions contacted them.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[c:CONTACTED]->(d:Domain) WHERE c.thirdParty
      RETURN d.name AS domain, d.site AS site, count(DISTINCT s) AS sessions, sum(c.requests) AS requests,
             sum(c.bytes) AS bytes, sum(c.failed) AS failed
      ORDER BY requests DESC`
  },
  {
    id: 'shared-domains',
    title: 'Domains shared across sessions',
    description: 'Domains (e.g. trackers or CDNs) contacted by more than one session, with the sites that used them.',
    cypher: `MATCH (s:Session)-[c:CONTACTED]->(d:Domain)
      WITH d, collect(DISTINCT s.host) AS sites, count(DISTINCT s) AS sessions, sum(c.requests) AS requests
      WHERE sessions > 1
      RETURN d.name AS domain, sessions, size(sites) AS siteCount, sites[0..10] AS sites, requests
      ORDER BY siteCount DESC, sessions DESC`
  },
  {
    id: 'failing-endpoints',
    title: 'Failing requests',
    description: 'Requests that failed or answered with HTTP 4xx/5xx, grouped by URL.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[:MADE]->(q:Request) WHERE q.failure IS NOT NULL OR q.status >= 400
      RETURN q.method AS method, q.url AS url, coalesce(toString(toInteger(q.status)), q.failure) AS result,
             count(*) AS times, collect(DISTINCT s.id)[0..5] AS sessions
      ORDER BY times DESC LIMIT 200`
  },
  {
    id: 'slow-requests',
    title: 'Slowest requests',
    description: 'The 50 slowest requests with their type and size.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[:MADE]->(q:Request) WHERE q.durationMs IS NOT NULL
      RETURN q.url AS url, q.type AS type, q.status AS status, q.durationMs AS ms, q.size AS bytes, s.id AS session
      ORDER BY ms DESC LIMIT 50`
  },
  {
    id: 'error-hotspots',
    title: 'Console error hotspots',
    description: 'Console errors and uncaught exceptions grouped by message and source script.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[:LOGGED]->(m:ConsoleMessage) WHERE m.type IN ['error', 'uncaught']
      RETURN m.type AS type, left(split(m.text, '\\n')[0], 200) AS message, m.source AS source,
             count(*) AS times, count(DISTINCT s) AS sessions
      ORDER BY times DESC LIMIT 100`
  },
  {
    id: 'cookies',
    title: 'Cookies and their flags',
    description: 'Cookies seen per domain, marking third-party ones and those without Secure / HttpOnly.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[sc:SAW_COOKIE]->(c:Cookie)
      OPTIONAL MATCH (s)-[ct:CONTACTED]->(:Domain {name: c.domain})
      RETURN c.domain AS domain, c.name AS name, sc.secure AS secure, sc.httpOnly AS httpOnly, sc.sameSite AS sameSite,
             sc.expires AS expires, coalesce(ct.thirdParty, NOT s.host ENDS WITH c.domain) AS thirdParty, s.id AS session
      ORDER BY thirdParty DESC, domain, name`
  },
  {
    id: 'missing-security-headers',
    title: 'Missing security headers',
    description: 'Pages whose main document is missing recommended security headers.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[:VISITED]->(p:Page)-[:MISSING_HEADER]->(h:SecurityHeader)
      RETURN p.url AS page, collect(DISTINCT h.name) AS missing, count(DISTINCT h) AS count
      ORDER BY count DESC`
  },
  {
    id: 'scripts-by-domain',
    title: 'Scripts by serving domain',
    description: 'External scripts grouped by the domain that serves them, with total size and the pages loading them.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[:VISITED]->(p:Page)-[:LOADS]->(sc:Script)-[:SERVED_FROM]->(d:Domain)
      RETURN d.name AS domain, count(DISTINCT sc) AS scripts, sum(DISTINCT sc.size) AS bytes, collect(DISTINCT p.url)[0..5] AS pages
      ORDER BY scripts DESC`
  },
  {
    id: 'scraped-records',
    title: 'Scraped records',
    description: 'Scrapes with their record counts and the domains their records link to.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[:SCRAPED]->(x:Scrape)
      OPTIONAL MATCH (x)-[:HAS_RECORD]->(:Record)-[:LINKS_TO]->(:Page)-[:ON_DOMAIN]->(d:Domain)
      RETURN x.name AS scrape, x.url AS url, x.rows AS records, x.pages AS pages, collect(DISTINCT d.name) AS linkedDomains,
             s.id AS session, x.scrapedAt AS scrapedAt
      ORDER BY scrapedAt DESC`
  },
  {
    id: 'clicks',
    title: 'Click path',
    description: 'Elements clicked during sessions, in order, with the page they were on.',
    cypher: `MATCH ${SESSION}
      MATCH (s)-[c:CLICKED]->(e:Element)
      OPTIONAL MATCH (e)-[:ON_PAGE]->(p:Page)
      RETURN s.id AS session, c.seq AS seq, e.tag AS tag, e.text AS text, e.selector AS selector, p.url AS page
      ORDER BY session, seq`
  }
];

export function listInsights(): Omit<Insight, 'cypher'>[] {
  return INSIGHTS.map(({ id, title, description }) => ({ id, title, description }));
}

export async function runInsight(id: string, sessionId?: string | null, limit = 200): Promise<QueryResult & { insight: Omit<Insight, 'cypher'>; cypher: string }> {
  const insight = INSIGHTS.find(i => i.id === id);
  if (!insight) throw new GraphError(404, `Unknown insight "${id}" (available: ${INSIGHTS.map(i => i.id).join(', ')})`);
  const result = await runReadQuery(insight.cypher, { sessionId: sessionId || null }, { limit });
  const { cypher, ...meta } = insight;
  return { ...result, insight: meta, cypher };
}
