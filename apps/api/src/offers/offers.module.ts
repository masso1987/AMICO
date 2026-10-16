import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProductGroup } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Offer } from '../generated/prisma/client';

const GROUPS = Object.values(ProductGroup) as [string, ...string[]];
const Reason = z.string().trim().min(5).max(500);
const Fields = z.object({
  titleEn: z.string().trim().min(3).max(80),
  titleFr: z.string().trim().min(3).max(80),
  bodyEn: z.string().trim().max(240).default(''),
  bodyFr: z.string().trim().max(240).default(''),
  operator: z.enum(['MTN', 'ORANGE']).nullable().default(null),
  badgeEn: z.string().trim().max(24).nullable().default(null),
  badgeFr: z.string().trim().max(24).nullable().default(null),
  ctaKind: z.enum(['NONE', 'BUNDLE', 'SERVICE', 'URL']).default('NONE'),
  ctaTarget: z.string().trim().max(300).nullable().default(null),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().default(null),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
  active: z.boolean().default(true),
});
function checkTarget(o: { ctaKind?: string; ctaTarget?: string | null }) {
  if (o.ctaKind === 'URL' && !/^https:\/\/[^\s]+$/.test(o.ctaTarget ?? '')) return false;
  if (o.ctaKind === 'SERVICE' && !GROUPS.includes(o.ctaTarget ?? '')) return false;
  if (o.ctaKind === 'BUNDLE' && !z.string().uuid().safeParse(o.ctaTarget).success) return false;
  return true;
}
const CreateSchema = Fields.extend({ reason: Reason }).refine(checkTarget, { message: 'The button target does not match its kind', path: ['ctaTarget'] });
const UpdateSchema = Fields.partial().extend({ reason: Reason }).refine(checkTarget, { message: 'The button target does not match its kind', path: ['ctaTarget'] });
const ReasonSchema = z.object({ reason: Reason });
const PublicQuery = z.object({ operator: z.enum(['MTN', 'ORANGE']).optional() });

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};
const MAX_IMAGE = 1024 * 1024;

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  dir() {
    return join(this.env.UPLOAD_DIR, 'offers');
  }

  /** What customers see now: active, inside its dates, ordered by staff. */
  async live(operator?: 'MTN' | 'ORANGE', now = new Date()) {
    const rows = await this.prisma.offer.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, ...(operator ? [{ OR: [{ operator }, { operator: null }] }] : [])],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 12,
    });
    return rows.map(present);
  }

  list() {
    return this.prisma.offer.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }] });
  }

  async create(input: z.infer<typeof CreateSchema>, actorId: string, ip?: string) {
    const { reason, ...data } = input;
    const o = await this.prisma.offer.create({ data: { ...data, startsAt: data.startsAt ?? new Date(), createdById: actorId } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'offer.created', entityType: 'Offer', entityId: o.id, after: { ...o, reason }, ip });
    return o;
  }

  async update(id: string, input: z.infer<typeof UpdateSchema>, actorId: string, ip?: string) {
    const before = await this.prisma.offer.findUnique({ where: { id } });
    if (!before) throw NotFound('Offer');
    const { reason, ...data } = input;
    if (!checkTarget({ ctaKind: data.ctaKind ?? before.ctaKind, ctaTarget: data.ctaTarget !== undefined ? data.ctaTarget : before.ctaTarget })) {
      throw new DomainError('INVALID_TARGET', 'The button target does not match its kind');
    }
    const after = await this.prisma.offer.update({ where: { id }, data });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'offer.updated', entityType: 'Offer', entityId: id, before, after: { ...after, reason }, ip });
    return after;
  }

  async remove(id: string, reason: string, actorId: string, ip?: string) {
    const before = await this.prisma.offer.findUnique({ where: { id } });
    if (!before) throw NotFound('Offer');
    await this.prisma.offer.delete({ where: { id } });
    if (before.imageKey) await unlink(join(this.dir(), before.imageKey)).catch(() => undefined);
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'offer.deleted', entityType: 'Offer', entityId: id, before, after: { reason }, ip });
    return { ok: true };
  }

  async setImage(id: string, file: Express.Multer.File | undefined, actorId: string, ip?: string) {
    if (!file) throw new BadRequestException('file is required');
    const type = IMAGE_TYPES[file.mimetype];
    if (!type || !type.magic(file.buffer)) throw new DomainError('UNSUPPORTED_FILE', 'Upload a PNG, JPEG or WebP image', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    if (file.size > MAX_IMAGE) throw new DomainError('FILE_TOO_LARGE', 'Images must be 1 MB or smaller', HttpStatus.PAYLOAD_TOO_LARGE);
    const before = await this.prisma.offer.findUnique({ where: { id } });
    if (!before) throw NotFound('Offer');
    const key = `${randomUUID()}.${type.ext}`;
    await mkdir(this.dir(), { recursive: true });
    await writeFile(join(this.dir(), key), file.buffer, { mode: 0o644 });
    const after = await this.prisma.offer.update({ where: { id }, data: { imageKey: key } });
    if (before.imageKey) await unlink(join(this.dir(), before.imageKey)).catch(() => undefined);
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'offer.image', entityType: 'Offer', entityId: id, after: { imageKey: key, sizeBytes: file.size }, ip });
    return after;
  }

  async image(id: string) {
    const o = await this.prisma.offer.findUnique({ where: { id }, select: { imageKey: true } });
    if (!o?.imageKey) throw NotFound('Image');
    const ext = o.imageKey.split('.').pop()!;
    const mime = Object.entries(IMAGE_TYPES).find(([, t]) => t.ext === ext)?.[0] ?? 'application/octet-stream';
    return { path: join(this.dir(), o.imageKey), mime };
  }
}

function present(o: Offer) {
  return {
    id: o.id,
    titleEn: o.titleEn,
    titleFr: o.titleFr,
    bodyEn: o.bodyEn,
    bodyFr: o.bodyFr,
    operator: o.operator,
    badgeEn: o.badgeEn,
    badgeFr: o.badgeFr,
    ctaKind: o.ctaKind,
    ctaTarget: o.ctaTarget,
    image: o.imageKey ? `/offers/${o.id}/image?v=${o.imageKey.slice(0, 8)}` : null,
    endsAt: o.endsAt,
  };
}

@ApiTags('catalogue')
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /** Public: the "available credit" showcase. */
  @Get()
  list(@Query(new ZodPipe(PublicQuery)) q: z.infer<typeof PublicQuery>) {
    return this.offers.live(q.operator);
  }

  @Get(':id/image')
  async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const img = await this.offers.image(id);
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(img.path)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }
}

@ApiTags('admin / offers')
@Controller('admin/offers')
export class OffersAdminController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @StaffAuth('TRANSACTION_READ')
  list() {
    return this.offers.list();
  }

  @Post()
  @StaffAuth('OFFER_MANAGE')
  create(@Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.offers.create(body, me.id, req.ip);
  }

  @Patch(':id')
  @StaffAuth('OFFER_MANAGE')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.offers.update(id, body, me.id, req.ip);
  }

  @Delete(':id')
  @StaffAuth('OFFER_MANAGE')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.offers.remove(id, body.reason, me.id, req.ip);
  }

  @Post(':id/image')
  @StaffAuth('OFFER_MANAGE')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE, files: 1 } }))
  image(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.offers.setImage(id, file, me.id, req.ip);
  }
}

@Module({ controllers: [OffersController, OffersAdminController], providers: [OffersService] })
export class OffersModule {}
