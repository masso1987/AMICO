import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';

export type JobName = 'collect' | 'payout' | 'status' | 'refund' | 'message';
export interface JobData {
  transactionId?: string;
  operationId?: string;
  refundId?: string;
  messageId?: string;
}
export type JobHandler = (name: JobName, data: JobData) => Promise<void>;

export const QUEUE_NAME = 'provider-ops';

/**
 * Provider calls always run outside request handlers. With USE_QUEUE=true they go
 * through BullMQ (deterministic job ids prevent duplicate enqueues); with
 * USE_QUEUE=false (tests) the handler runs inline after the caller's DB commit.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly log = new Logger(JobsService.name);
  private readonly handlers = new Map<JobName, JobHandler>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.USE_QUEUE) {
      this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
    }
  }

  /** Each module registers the job names it owns. One worker serves them all. */
  registerHandler(names: JobName[], handler: JobHandler) {
    for (const n of names) this.handlers.set(n, handler);
    if (this.env.USE_QUEUE && this.env.RUN_WORKERS && !this.worker) {
      this.worker = new Worker(
        QUEUE_NAME,
        async (job: Job<JobData>) => this.dispatch(job.name as JobName, job.data),
        { connection: this.connection!.duplicate(), concurrency: 4 },
      );
      this.worker.on('failed', (job, err) => this.log.error(`Job ${job?.name}/${job?.id} failed: ${err.message}`));
    }
  }

  private dispatch(name: JobName, data: JobData) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler for job ${name}`);
    return h(name, data);
  }

  async enqueue(name: JobName, data: JobData, opts: { jobId: string; delayMs?: number }): Promise<void> {
    if (!this.handlers.has(name)) throw new Error(`No handler registered for job ${name}`);
    if (!this.queue) {
      await this.dispatch(name, data);
      return;
    }
    await this.queue.add(name, data, {
      jobId: opts.jobId.replace(/:/g, '_'),
      delay: opts.delayMs ?? 0,
      attempts: 1, // retries are explicit and status-checked, never blind
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async ping(): Promise<boolean> {
    if (!this.connection) return true;
    return (await this.connection.ping()) === 'PONG';
  }

  /** Queue depth for monitoring. Null when jobs run inline (tests). */
  async counts(): Promise<{ waiting: number; active: number; delayed: number; failed: number } | null> {
    if (!this.queue) return null;
    const c = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return { waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
