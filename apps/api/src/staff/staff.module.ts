import { Body, Controller, Get, HttpStatus, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Msisdn } from '@amico/contracts';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { hashPassword, temporaryPassword } from '../auth/staff-auth';
import { Conflict, DomainError, Forbidden, NotFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { StaffUser } from '../generated/prisma/client';

const Roles = z.array(z.string().trim().min(2).max(40)).min(1, 'Pick at least one role').max(10).transform((r) => [...new Set(r)].sort());
const AlertChannels = z.array(z.enum(['SMS', 'WHATSAPP'])).max(2).transform((c) => [...new Set(c)]);
const Reason = z.string().trim().min(5, 'Give a short reason').max(500);
const CreateSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  fullName: z.string().trim().min(2).max(120),
  roles: Roles,
  phone: Msisdn.nullable().optional(),
  alertChannels: AlertChannels.optional(),
});
const UpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    roles: Roles.optional(),
    active: z.boolean().optional(),
    phone: Msisdn.nullable().optional(),
    alertChannels: AlertChannels.optional(),
    reason: Reason,
  })
  .refine((b) => ['fullName', 'roles', 'active', 'phone', 'alertChannels'].some((k) => b[k as keyof typeof b] !== undefined), 'Nothing to change');
const ReasonSchema = z.object({ reason: Reason });

/** What the staff page sees. Hashes and TOTP secrets never leave the service. */
function view(s: StaffUser) {
  return {
    id: s.id,
    email: s.email,
    fullName: s.fullName,
    roles: s.roles,
    active: s.active,
    twoFactorEnabled: s.totpEnabledAt !== null,
    phone: s.phone,
    alertChannels: s.alertChannels,
    mustChangePassword: s.mustChangePassword,
    lastLoginAt: s.lastLoginAt,
    createdAt: s.createdAt,
  };
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.staffUser.findMany({ orderBy: [{ active: 'desc' }, { email: 'asc' }] });
    return rows.map(view);
  }

  /** Returns the temporary password exactly once; it must be replaced at first sign-in. */
  async create(actorId: string, input: z.infer<typeof CreateSchema>, ip?: string) {
    if (await this.prisma.staffUser.findUnique({ where: { email: input.email } })) throw Conflict('EMAIL_TAKEN', 'A staff account already uses this email');
    await this.assertRolesExist(input.roles);
    const password = temporaryPassword();
    const s = await this.prisma.staffUser.create({
      data: {
        email: input.email, fullName: input.fullName, roles: input.roles, passwordHash: await hashPassword(password), mustChangePassword: true,
        phone: input.phone ?? null, alertChannels: input.alertChannels ?? [],
      },
    });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'staff.created', entityType: 'StaffUser', entityId: s.id, after: { email: s.email, fullName: s.fullName, roles: s.roles }, ip });
    return { staff: view(s), temporaryPassword: password };
  }

  async update(actorId: string, id: string, input: z.infer<typeof UpdateSchema>, ip?: string) {
    if (id === actorId) throw Forbidden('SELF_CHANGE', 'Ask another administrator to change your own roles or status');
    if (input.roles) await this.assertRolesExist(input.roles);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      const roles = input.roles ?? before.roles;
      const active = input.active ?? before.active;
      if (before.active && before.roles.includes('ADMIN') && (!active || !roles.includes('ADMIN'))) await this.assertAnotherAdmin(tx, id);
      // Fewer roles or deactivation must take effect now, not when the token expires.
      const narrowing = !active || before.roles.some((r) => !roles.includes(r));
      const s = await tx.staffUser.update({
        where: { id },
        data: {
          fullName: input.fullName ?? before.fullName, roles, active,
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.alertChannels !== undefined ? { alertChannels: input.alertChannels } : {}),
          ...(narrowing ? { sessionVersion: { increment: 1 } } : {}),
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF', actorId, action: 'staff.updated', entityType: 'StaffUser', entityId: id, ip,
          before: { fullName: before.fullName, roles: before.roles, active: before.active, phone: before.phone, alertChannels: before.alertChannels },
          after: { fullName: s.fullName, roles: s.roles, active: s.active, phone: s.phone, alertChannels: s.alertChannels, reason: input.reason },
        },
        tx,
      );
      return view(s);
    });
  }

  async resetPassword(actorId: string, id: string, reason: string, ip?: string) {
    if (id === actorId) throw Forbidden('SELF_CHANGE', 'Use My account to change your own password');
    const password = temporaryPassword();
    const s = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const s = await tx.staffUser.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, sessionVersion: { increment: 1 } } });
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'staff.password.reset', entityType: 'StaffUser', entityId: id, after: { reason }, ip }, tx);
      return s;
    });
    return { staff: view(s), temporaryPassword: password };
  }

  /** For a lost phone: the person sets up a new authenticator at their next sign-in. */
  async resetTwoFactor(actorId: string, id: string, reason: string, ip?: string) {
    if (id === actorId) throw Forbidden('SELF_CHANGE', 'Ask another administrator to reset your two-step sign-in');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const s = await tx.staffUser.update({
        where: { id },
        data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } },
      });
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'staff.2fa.reset', entityType: 'StaffUser', entityId: id, after: { reason }, ip }, tx);
      return view(s);
    });
  }

  private async assertRolesExist(roles: string[]) {
    const found = await this.prisma.accessRole.findMany({ where: { key: { in: roles } }, select: { key: true } });
    const missing = roles.filter((r) => !found.some((f) => f.key === r));
    if (missing.length) throw new DomainError('UNKNOWN_ROLE', `Unknown role: ${missing.join(', ')}`);
  }

  private async lock(tx: Tx, id: string): Promise<StaffUser> {
    // Row lock so two admins can't race each other (e.g. both demoting the last two admins).
    await tx.$queryRaw`SELECT id FROM "StaffUser" WHERE id = ${id} FOR UPDATE`;
    const s = await tx.staffUser.findUnique({ where: { id } });
    if (!s) throw NotFound('Staff account');
    return s;
  }

  private async assertAnotherAdmin(tx: Tx, excludingId: string) {
    // Lock every active admin row: concurrent demotions serialise here.
    const others = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StaffUser" WHERE active AND 'ADMIN' = ANY(roles) AND id <> ${excludingId} FOR UPDATE`;
    if (others.length === 0) throw new DomainError('LAST_ADMIN', 'This is the last active administrator. Add another administrator first.', HttpStatus.CONFLICT);
  }
}

@ApiTags('admin / staff')
@Controller('admin/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @StaffAuth('STAFF_MANAGE')
  list() {
    return this.staff.list();
  }

  @Post()
  @StaffAuth('STAFF_MANAGE')
  create(@CurrentStaff() me: StaffPrincipal, @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>, @Req() req: Request) {
    return this.staff.create(me.id, body, req.ip);
  }

  @Patch(':id')
  @StaffAuth('STAFF_MANAGE')
  update(@CurrentStaff() me: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>, @Req() req: Request) {
    return this.staff.update(me.id, id, body, req.ip);
  }

  @Post(':id/reset-password')
  @StaffAuth('STAFF_MANAGE')
  resetPassword(@CurrentStaff() me: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>, @Req() req: Request) {
    return this.staff.resetPassword(me.id, id, body.reason, req.ip);
  }

  @Post(':id/reset-2fa')
  @StaffAuth('STAFF_MANAGE')
  resetTwoFactor(@CurrentStaff() me: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>, @Req() req: Request) {
    return this.staff.resetTwoFactor(me.id, id, body.reason, req.ip);
  }
}

@Module({ controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
