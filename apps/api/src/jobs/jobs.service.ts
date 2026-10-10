import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';

export type JobName = 'collect' | 'payout' | 'status' | 'refund';
export interface JobData {
  transactionId?: string;
  operationId?: string;
  refundId?: string;
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
  private handler: JobHandler | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.USE_QUEUE) {
      this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
    }
  }

  registerHandler(handler: JobHandler) {
    this.handler = handler;
    if (this.env.USE_QUEUE && this.env.RUN_WORKERS && !this.worker) {
      this.worker = new Worker(
        QUEUE_NAME,
        async (job: Job<JobData>) => handler(job.name as JobName, job.data),
        { connection: this.connection!.duplicate(), concurrency: 4 },
      );
      this.worker.on('failed', (job, err) => this.log.error(`Job ${job?.name}/${job?.id} failed: ${err.message}`));
    }
  }

  async enqueue(name: JobName, data: JobData, opts: { jobId: string; delayMs?: number }): Promise<void> {
    if (!this.handler) throw new Error('No job handler registered');
    if (!this.queue) {
      await this.handler(name, data);
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

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
