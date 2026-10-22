/**
 * config.controller.ts
 *
 *   GET  /api/meta            collectors, presets, devices, networks, version
 *   GET  /api/config          config.json without secrets
 *   PUT  /api/config          partial update
 *   POST /api/presets/:key    apply a collector preset
 */

import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { COLLECTORS } from '../../collectors/registry';
import { DEVICE_PRESETS, NETWORK_PRESETS } from '../../core/emulation';
import { packageVersion } from '../../core/session';
import { OUTPUT_DIR } from '../../core/sessionStore';
import { maskUrl } from '../../storage/settings';
import { Config, isHeadlessForced, loadConfig, updateConfig } from '../../utils/configManager';
import { PRESETS, applyPreset, isPresetName } from '../../utils/presets';

/** The config without secrets (passwords and keys are replaced by flags, URLs are masked). */
export function publicConfig(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  if (cfg.neo4j) {
    const { password, ...neo4j } = cfg.neo4j;
    out.neo4j = { ...neo4j, hasPassword: !!password };
  }
  if (cfg.storage) {
    const { postgres, s3, ...rest } = cfg.storage;
    const { secretAccessKey, ...s3Public } = s3 || {};
    out.storage = {
      ...rest,
      ...(postgres ? { postgres: { enabled: postgres.enabled, url: postgres.url ? maskUrl(postgres.url) : undefined } } : {}),
      ...(s3 ? { s3: { ...s3Public, hasSecret: !!secretAccessKey } } : {})
    };
  }
  return out;
}

@Controller('api')
export class ConfigController {
  @Get('meta')
  meta() {
    return {
      collectors: COLLECTORS,
      presets: Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description, collectors: p.collectors })),
      outputDir: OUTPUT_DIR,
      forceHeadless: isHeadlessForced(),
      devices: Object.entries(DEVICE_PRESETS).map(([key, d]) => ({ key, label: d.label })),
      networks: Object.entries(NETWORK_PRESETS).map(([key, n]) => ({ key, label: n.label })),
      version: packageVersion()
    };
  }

  @Get('config')
  getConfig() {
    return publicConfig(loadConfig());
  }

  @Put('config')
  putConfig(@Body() body: Parameters<typeof updateConfig>[0]) {
    return publicConfig(updateConfig(body && typeof body === 'object' ? body : {}));
  }

  @HttpCode(200)
  @Post('presets/:key')
  preset(@Param('key') key: string) {
    if (!isPresetName(key)) throw new NotFoundException('Unknown preset');
    applyPreset(key);
    return publicConfig(loadConfig());
  }
}
