import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { MessagingService } from '../messaging/messaging.service';
import { MonitoringModule, MonitoringService } from '../monitoring/monitoring.module';
import { MaintenanceModule, MaintenanceService } from '../maintenance/maintenance.module';
import { BundlesModule, BundlesService } from '../bundles/bundles.module';

/**
 * Background loops, run only where RUN_WORKERS=true (the worker process, or the single
 * API process on small installs). Each loop skips a round if the previous one is still running.
 *   every 5 s   send queued SMS / WhatsApp
 *   every 60 s  health sample + alerts, maintenance notices
 *   every 6 h   bundle catalogue sync from providers
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly busy = new Set<string>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly messaging: MessagingService,
    private readonly monitoring: MonitoringService,
    private readonly maintenance: MaintenanceService,
    private readonly bundles: BundlesService,
  ) {}

  onApplicationBootstrap() {
    if (!this.env.RUN_WORKERS || this.env.NODE_ENV === 'test') return;
    this.every('messages', 5_000, () => this.messaging.flush());
    this.every('monitoring', 60_000, async () => {
      await this.maintenance.tick();
      await this.monitoring.sample();
    });
    this.every('bundles', 6 * 3_600_000, () => this.bundles.sync(undefined, null, 'Scheduled sync'), 30_000);
    this.log.log('Background loops started');
  }

  private every(name: string, ms: number, fn: () => Promise<unknown>, firstDelayMs = 2_000) {
    const run = async () => {
      if (this.busy.has(name)) return;
      this.busy.add(name);
      try {
        await fn();
      } catch (e) {
        this.log.error(`${name} loop failed: ${(e as Error).message}`);
      } finally {
        this.busy.delete(name);
      }
    };
    this.timers.push(setTimeout(run, firstDelayMs));
    this.timers.push(setInterval(run, ms));
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }
}

@Module({ imports: [MonitoringModule, MaintenanceModule, BundlesModule], providers: [SchedulerService] })
export class SchedulerModule {}
