/**
 * live.gateway.ts
 *
 * WebSocket /ws/live (Nest WsAdapter). Text messages are JSON {t: ...} commands (see LiveMessage);
 * the adapter maps every one of them to the "live" event and handles one message per client at a
 * time, so input is applied in order.
 */

import type { IncomingMessage } from 'http';
import { Inject } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { warn } from '../../utils/logger';
import { hostProblem, originProblem } from '../common/security';
import { LiveMessage, LiveService } from './live.service';

/** Same Host / Origin rules as the HTTP API; browsers always send Origin on WebSocket upgrades. */
function verifyClient(info: { req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) {
  const host = hostProblem(info.req);
  if (host) return done(false, 403, 'Host not allowed');
  if (originProblem(info.req)) return done(false, 403, 'Cross-origin connection rejected');
  done(true);
}

/** WsAdapter message parser: every JSON text frame is a "live" event; binary frames are ignored. */
export function parseLiveMessage(data: unknown): { event: string; data: unknown } | void {
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) return;
  try {
    const msg = JSON.parse(data.toString());
    if (msg && typeof msg === 'object' && typeof msg.t === 'string') return { event: 'live', data: msg };
  } catch {
    // not JSON: dropped
  }
}

@WebSocketGateway({ path: '/ws/live', maxPayload: 256 * 1024, verifyClient })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(@Inject(LiveService) private readonly live: LiveService) {}

  handleConnection(ws: WebSocket): void {
    this.live.add(ws);
    ws.on('error', () => this.live.remove(ws));
  }

  handleDisconnect(ws: WebSocket): void {
    this.live.remove(ws);
  }

  @SubscribeMessage('live')
  async onMessage(@ConnectedSocket() ws: WebSocket, @MessageBody() msg: LiveMessage): Promise<void> {
    try {
      await this.live.handle(ws, msg);
    } catch (e) {
      const message = (e as Error).message.split('\n')[0];
      warn(`live input failed: ${message}`);
      this.live.sendJSON(ws, { t: 'error', message });
    }
  }
}
