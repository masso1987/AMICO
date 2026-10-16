import { Body, Controller, Delete, Get, HttpStatus, Injectable, Module, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ADMIN_LOCKED_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_INFO, type Permission } from '@amico/contracts';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { Conflict, DomainError, NotFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const Permissions = z
  .array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))
  .max(ALL_PERMISSIONS.length)
  .transform((p) => [...new Set(p)].sort());
const Reason = z.string().trim().min(5, 'Give a short reason').max(500);
const CreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(''),
  permissions: Permissions,
  reason: Reason,
});
const UpdateSchema = z
  .object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(200).optional(), permissions: Permissions.optional(), reason: Reason })
  .refine((b) => b.name !== undefined || b.description !== undefined || b.permissions !== undefined, 'Nothing to change');
const DeleteSchema = z.object({ reason: Reason });

/** "Night shift checker" -> "night-shift-checker". Built-in keys are upper case, so they never collide. */
function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'role'
  );
}

/**
 * Access management: roles are named permission sets. Every change is audited and
 * guarded so the platform can never end up with nobody able to manage staff or roles.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalogue() {
    return ALL_PERMISSIONS.map((p) => ({ key: p, ...PERMISSION_INFO[p] }));
  }

  async roles() {
    const [roles, staff] = await Promise.all([
      this.prisma.accessRole.findMany({ orderBy: [{ system: 'desc' }, { name: 'asc' }] }),
      this.prisma.staffUser.findMany({ select: { roles: true, active: true } }),
    ]);
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      system: r.system,
      members: staff.filter((s) => s.active && s.roles.includes(r.key)).length,
      updatedAt: r.updatedAt,
    }));
  }

  async create(actorId: string, input: z.infer<typeof CreateSchema>, ip?: string) {
    let key = slug(input.name);
    for (let i = 2; await this.prisma.accessRole.findUnique({ where: { key } }); i++) key = `${slug(input.name).slice(0, 33)}-${i}`;
    const role = await this.prisma.accessRole.create({ data: { key, name: input.name, description: input.description, permissions: input.permissions, system: false, updatedById: actorId } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'role.created', entityType: 'AccessRole', entityId: key, after: { ...role, reason: input.reason }, ip });
    return role;
  }

  async update(actorId: string, key: string, input: z.infer<typeof UpdateSchema>, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockRole(tx, key);
      if (input.permissions && key === 'ADMIN') {
        const dropped = ADMIN_LOCKED_PERMISSIONS.filter((p) => !input.permissions!.includes(p));
        if (dropped.length) throw new DomainError('LOCKED_PERMISSION', `The Administrator role always keeps: ${dropped.join(', ')}`);
      }
      const after = await tx.accessRole.update({
        where: { key },
        data: { name: input.name ?? before.name, description: input.description ?? before.description, permissions: input.permissions ?? before.permissions, updatedById: actorId },
      });
      await this.assertSomeoneCanManage(tx);
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'role.updated', entityType: 'AccessRole', entityId: key, before, after: { ...after, reason: input.reason }, ip }, tx);
      return after;
    });
  }

  async remove(actorId: string, key: string, reason: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const role = await this.lockRole(tx, key);
      if (role.system) throw new DomainError('SYSTEM_ROLE', 'Built-in roles can be edited but not deleted');
      const holders = await tx.staffUser.count({ where: { roles: { has: key } } });
      if (holders) throw Conflict('ROLE_IN_USE', `${holders} staff account(s) still have this role. Remove it from them first.`);
      await tx.accessRole.delete({ where: { key } });
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'role.deleted', entityType: 'AccessRole', entityId: key, before: role, after: { reason }, ip }, tx);
      return { ok: true };
    });
  }

  private async lockRole(tx: Tx, key: string) {
    await tx.$queryRaw`SELECT key FROM "AccessRole" WHERE key = ${key} FOR UPDATE`;
    const role = await tx.accessRole.findUnique({ where: { key } });
    if (!role) throw NotFound('Role');
    return role;
  }

  /** After any change, at least one active, 2-step-enrolled person must still hold both management permissions. */
  private async assertSomeoneCanManage(tx: Tx) {
    const roles = await tx.accessRole.findMany({ where: { permissions: { hasEvery: [...ADMIN_LOCKED_PERMISSIONS] } }, select: { key: true } });
    const holders = roles.length
      ? await tx.staffUser.count({ where: { active: true, roles: { hasSome: roles.map((r) => r.key) } } })
      : 0;
    if (holders === 0) throw new DomainError('NO_MANAGER_LEFT', 'This change would leave nobody able to manage staff and roles', HttpStatus.CONFLICT);
  }
}

@ApiTags('admin / access')
@Controller('admin/access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('permissions')
  @StaffAuth('ACCESS_MANAGE')
  permissions() {
    return this.access.catalogue();
  }

  /** Readable by anyone who manages staff, so they can assign roles. */
  @Get('roles')
  @StaffAuth()
  roles() {
    return this.access.roles();
  }

  @Post('roles')
  @StaffAuth('ACCESS_MANAGE')
  create(@CurrentStaff() me: StaffPrincipal, @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>, @Req() req: Request) {
    return this.access.create(me.id, body, req.ip);
  }

  @Patch('roles/:key')
  @StaffAuth('ACCESS_MANAGE')
  update(@CurrentStaff() me: StaffPrincipal, @Param('key') key: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>, @Req() req: Request) {
    return this.access.update(me.id, key, body, req.ip);
  }

  @Delete('roles/:key')
  @StaffAuth('ACCESS_MANAGE')
  remove(@CurrentStaff() me: StaffPrincipal, @Param('key') key: string, @Body(new ZodPipe(DeleteSchema)) body: z.infer<typeof DeleteSchema>, @Req() req: Request) {
    return this.access.remove(me.id, key, body.reason, req.ip);
  }
}

@Module({ controllers: [AccessController], providers: [AccessService] })
export class AccessModule {}
