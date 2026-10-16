import { Body, Controller, Get, Global, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Msisdn } from '@amico/contracts';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { NotFound } from '../common/errors';
import { AudienceSchema, CHANNELS, MessagingService } from './messaging.service';
import { NotificationService } from './notifications.service';
import type { MessageChannel } from '../generated/prisma/client';

const Reason = z.string().trim().min(5).max(500);
const ConfigureSchema = z.object({
  enabled: z.boolean().optional(),
  live: z.boolean().optional(),
  driver: z.string().max(40).optional(),
  settings: z.record(z.unknown()).optional(),
  /** Write-only. An empty value keeps what is stored. */
  secrets: z.record(z.string().max(4_000)).optional(),
  reason: Reason,
});
const TestSchema = z.object({ to: Msisdn });
const Body1 = z.string().trim().min(2).max(640);
const SendSchema = z.object({ to: Msisdn, body: Body1, channel: z.enum(['SMS', 'WHATSAPP_THEN_SMS', 'SMS_MTN', 'SMS_ORANGE', 'WHATSAPP']).default('SMS') });
const BroadcastSchema = z.object({
  audience: AudienceSchema,
  channel: z.enum(['AUTO', 'SMS', 'WHATSAPP']).default('AUTO'),
  bodyEn: Body1,
  bodyFr: Body1,
});
const PreviewSchema = z.object({ audience: AudienceSchema });
const LogQuery = z.object({
  status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(),
  channel: z.enum(['SMS_MTN', 'SMS_ORANGE', 'WHATSAPP']).optional(),
  purpose: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

function channelParam(c: string): MessageChannel {
  if (!CHANNELS.includes(c as MessageChannel)) throw NotFound('Channel');
  return c as MessageChannel;
}

@ApiTags('admin / messaging')
@Controller('admin/messaging')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('channels')
  @StaffAuth('MESSAGING_CONFIGURE')
  channels() {
    return this.messaging.channels();
  }

  @Put('channels/:channel')
  @StaffAuth('MESSAGING_CONFIGURE')
  configure(@Param('channel') channel: string, @Body(new ZodPipe(ConfigureSchema)) body: z.infer<typeof ConfigureSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.messaging.configure(channelParam(channel), body, me.id, req.ip);
  }

  @Post('channels/:channel/test')
  @StaffAuth('MESSAGING_CONFIGURE')
  test(@Param('channel') channel: string, @Body(new ZodPipe(TestSchema)) body: z.infer<typeof TestSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.messaging.test(channelParam(channel), body.to, me.id, req.ip);
  }

  @Post('send')
  @StaffAuth('MESSAGING_SEND')
  send(@Body(new ZodPipe(SendSchema)) body: z.infer<typeof SendSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.messaging.sendDirect({ to: body.to, body: body.body, requested: body.channel }, me.id, req.ip);
  }

  @Post('broadcasts/preview')
  @StaffAuth('MESSAGING_SEND')
  async preview(@Body(new ZodPipe(PreviewSchema)) body: z.infer<typeof PreviewSchema>) {
    const people = await this.messaging.audience(body.audience);
    return { recipients: people.length, french: people.filter((p) => p.locale === 'fr').length, whatsapp: people.filter((p) => p.whatsapp).length };
  }

  @Post('broadcasts')
  @StaffAuth('MESSAGING_SEND')
  async broadcast(@Body(new ZodPipe(BroadcastSchema)) body: z.infer<typeof BroadcastSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    const b = await this.messaging.broadcast(body, me.id, req.ip);
    void this.messaging.flush(200).catch(() => undefined);
    return b;
  }

  @Get('messages')
  @StaffAuth('MESSAGING_SEND')
  log(@Query(new ZodPipe(LogQuery)) q: z.infer<typeof LogQuery>) {
    return this.messaging.messageLog(q);
  }

  @Get('stats')
  @StaffAuth('MONITORING_READ')
  stats() {
    return this.messaging.stats();
  }
}

@Global()
@Module({ controllers: [MessagingController], providers: [MessagingService, NotificationService], exports: [MessagingService, NotificationService] })
export class MessagingModule {}
