import { Controller, Inject, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventsService } from './events.service';

/** GET /api/events - Server-Sent Events for the dashboard. */
@Controller('api')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Sse('events')
  stream(): Observable<MessageEvent> {
    return this.events.stream();
  }
}
