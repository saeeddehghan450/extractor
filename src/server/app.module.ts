import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AgentController, ToolsController } from './ai/ai.controller';
import { AgentService } from './ai/agent.service';
import { ErrorFilter } from './common/error.filter';
import { ApiTokenGuard } from './common/security';
import { ConfigController } from './dashboard/config.controller';
import { SessionController } from './dashboard/session.controller';
import { SessionsController } from './dashboard/sessions.controller';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { GraphController } from './graph/graph.controller';
import { LiveGateway } from './live/live.gateway';
import { LiveService } from './live/live.service';
import { ScraperController } from './scraper/scraper.controller';
import { StorageController } from './storage/storage.controller';
import { StorageService } from './storage/storage.service';

@Module({
  controllers: [
    ConfigController,
    SessionController,
    SessionsController,
    EventsController,
    ScraperController,
    GraphController,
    StorageController,
    ToolsController,
    AgentController
  ],
  providers: [
    EventsService,
    LiveService,
    LiveGateway,
    StorageService,
    AgentService,
    ApiTokenGuard,
    { provide: APP_FILTER, useClass: ErrorFilter }
  ]
})
export class AppModule {}
