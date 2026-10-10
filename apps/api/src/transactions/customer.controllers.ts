import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CreateTransactionSchema, PaginationSchema, QuoteRequestSchema, SubmitSourceReferenceSchema, type CreateTransactionInput, type QuoteRequest, type SubmitSourceReferenceInput } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { CurrentCustomer, CustomerAuth, type CustomerPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { DomainError } from '../common/errors';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotesService } from './quotes.service';
import { TransactionsService } from './transactions.service';

const IdempotencyKey = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_\-:.]+$/);

@ApiTags('customer / quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @CustomerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(@Body(new ZodPipe(QuoteRequestSchema)) body: QuoteRequest, @CurrentCustomer() c: CustomerPrincipal) {
    return this.quotes.create(c.id, body);
  }
}

@ApiTags('customer / transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @CustomerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated key; replays return the same transaction' })
  create(
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(CreateTransactionSchema)) body: CreateTransactionInput,
    @CurrentCustomer() c: CustomerPrincipal,
  ) {
    const parsed = IdempotencyKey.safeParse(key);
    if (!parsed.success) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 chars)', HttpStatus.BAD_REQUEST);
    return this.transactions.createFromQuote(c.id, parsed.data, body.quoteId);
  }

  @Get()
  @CustomerAuth()
  list(@Query(new ZodPipe(PaginationSchema)) q: z.infer<typeof PaginationSchema>, @CurrentCustomer() c: CustomerPrincipal) {
    return this.transactions.listForCustomer(c.id, q.page, q.pageSize);
  }

  @Get(':id')
  @CustomerAuth()
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentCustomer() c: CustomerPrincipal) {
    return this.transactions.present(id, c.id);
  }

  @Post(':id/source-reference')
  @CustomerAuth()
  submitReference(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SubmitSourceReferenceSchema)) body: SubmitSourceReferenceInput,
    @CurrentCustomer() c: CustomerPrincipal,
  ) {
    return this.transactions.submitSourceReference(c.id, id, body);
  }
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

@ApiTags('customer / evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Optional proof of transfer. Stored privately; it is supporting material, never proof of receipt. */
  @Post()
  @CustomerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentCustomer() c: CustomerPrincipal) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED_MIME.has(file.mimetype) || !looksLike(file.mimetype, file.buffer)) {
      throw new DomainError('UNSUPPORTED_FILE', 'Upload a JPEG, PNG or PDF', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (file.size > this.env.MAX_EVIDENCE_BYTES) throw new DomainError('FILE_TOO_LARGE', 'File too large', HttpStatus.PAYLOAD_TOO_LARGE);
    const storageKey = `${c.id}/${randomUUID()}`;
    await mkdir(join(this.env.UPLOAD_DIR, c.id), { recursive: true });
    await writeFile(join(this.env.UPLOAD_DIR, storageKey), file.buffer, { mode: 0o600 });
    // TODO(P5): malware scan + move to private object storage with signed URLs.
    const row = await this.prisma.evidenceFile.create({
      data: { customerId: c.id, storageKey, mimeType: file.mimetype, sizeBytes: file.size, sha256: sha256(file.buffer) },
    });
    return { id: row.id, sha256: row.sha256, sizeBytes: row.sizeBytes };
  }
}

/** Magic-byte check so a renamed file can't pass as an image. */
function looksLike(mime: string, buf: Buffer): boolean {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (mime === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'application/pdf') return buf.subarray(0, 4).toString() === '%PDF';
  return false;
}

@ApiTags('customer / notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @CustomerAuth()
  list(@CurrentCustomer() c: CustomerPrincipal) {
    return this.prisma.notification.findMany({ where: { customerId: c.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
