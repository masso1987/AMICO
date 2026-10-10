import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { canonicalJson, sha256 } from '../common/crypto';
import { DomainError } from '../common/errors';
import { SkipThrottle } from '@nestjs/throttler';

const CallbackSchema = z.object({
  eventId: z.string().min(3).max(200),
  providerReference: z.string().min(3).max(200).optional(),
  idempotencyKey: z.string().min(3).max(200).optional(),
  status: z.string().max(50),
});

/**
 * Provider callbacks. A callback is only a hint: it is authenticated, de-duplicated by
 * event id, and then triggers a status query. Its payload never changes a transaction.
 * Real providers each get their own verification (signature scheme / IP allow-list) in P5.
 */
@ApiTags('provider callbacks')
@SkipThrottle()
@Controller('callbacks')
export class CallbacksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post(':providerCode')
  @HttpCode(200)
  async receive(@Param('providerCode') providerCode: string, @Headers('x-amico-signature') signature: string | undefined, @Body() body: unknown) {
    const expected = createHmac('sha256', this.env.CALLBACK_SHARED_SECRET).update(canonicalJson(body)).digest('hex');
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new DomainError('BAD_SIGNATURE', 'Invalid callback signature', HttpStatus.UNAUTHORIZED);
    }
    const parsed = CallbackSchema.safeParse(body);
    if (!parsed.success) return { accepted: false };
    const cb = parsed.data;

    try {
      await this.prisma.providerCallback.create({
        data: { providerCode, dedupeKey: `${providerCode}:${cb.eventId}`, providerReference: cb.providerReference ?? null, payloadSha256: sha256(canonicalJson(body)) },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { accepted: true, duplicate: true };
      throw e;
    }

    const op = await this.prisma.providerOperation.findFirst({
      where: {
        providerCode,
        OR: [...(cb.providerReference ? [{ providerReference: cb.providerReference }] : []), ...(cb.idempotencyKey ? [{ idempotencyKey: cb.idempotencyKey }] : [])],
      },
    });
    if (op) {
      await this.jobs.enqueue('status', { operationId: op.id }, { jobId: `status:${op.id}:cb:${cb.eventId}` });
      await this.prisma.providerCallback.update({ where: { dedupeKey: `${providerCode}:${cb.eventId}` }, data: { processedAt: new Date() } });
    }
    return { accepted: true, duplicate: false };
  }
}
