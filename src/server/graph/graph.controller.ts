/**
 * graph.controller.ts - Neo4j knowledge graph
 *
 *   GET  /api/graph/status                         connection, counts, settings (never the password)
 *   PUT  /api/graph/config   {enabled, uri, user, password, database, autoSync}
 *   POST /api/graph/sync     {sessionId?} | {all: true}
 *   POST /api/graph/query    {cypher, params?, limit?}   read-only
 *   GET  /api/graph/insights                       ready-made analyses
 *   POST /api/graph/insights {id, sessionId?, limit?}
 *   GET  /api/graph/schema
 */

import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { updateConfig } from '../../utils/configManager';
import { closeDriver, graphStatus, runReadQuery } from '../../graph/neo4jClient';
import { listInsights, runInsight } from '../../graph/insights';
import { GRAPH_SCHEMA, syncAll, syncSession } from '../../graph/sync';

const URI_RE = /^(bolt|neo4j)(\+s|\+ssc)?:\/\/[^\s/]+(:\d+)?\/?$/i;

@Controller('api/graph')
export class GraphController {
  @Get('status')
  status() {
    return graphStatus();
  }

  @Put('config')
  async config(@Body() body: any) {
    if (typeof body?.uri === 'string' && body.uri.trim() && !URI_RE.test(body.uri.trim())) {
      throw new BadRequestException('URI must look like bolt://host:7687 or neo4j://host:7687 (+s / +ssc for TLS)');
    }
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    updateConfig({
      neo4j: {
        enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
        uri: str(body?.uri),
        user: str(body?.user),
        database: str(body?.database),
        autoSync: typeof body?.autoSync === 'boolean' ? body.autoSync : undefined,
        password: body?.password === null ? null : str(body?.password)
      }
    });
    await closeDriver();
    return graphStatus();
  }

  @HttpCode(200)
  @Post('sync')
  sync(@Body() body: any) {
    if (body?.all) return syncAll();
    return syncSession(typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId : undefined);
  }

  @HttpCode(200)
  @Post('query')
  query(@Body() body: any) {
    const params = body?.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
    return runReadQuery(String(body?.cypher ?? ''), params, { limit: Number(body?.limit) || 500 });
  }

  @Get('insights')
  insights() {
    return listInsights();
  }

  @HttpCode(200)
  @Post('insights')
  insight(@Body() body: any) {
    return runInsight(String(body?.id ?? ''), typeof body?.sessionId === 'string' ? body.sessionId : null, Number(body?.limit) || 500);
  }

  @Get('schema')
  schema() {
    return { schema: GRAPH_SCHEMA };
  }
}
