import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ROLE_PERMISSIONS, type Permission, type StaffRole } from '@amico/contracts';
import { DomainError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export interface CustomerPrincipal {
  kind: 'customer';
  id: string;
}
export interface StaffPrincipal {
  kind: 'staff';
  id: string;
  roles: StaffRole[];
  permissions: Set<Permission>;
}
export type Principal = CustomerPrincipal | StaffPrincipal;

const AUTH_META = 'amico:auth';
interface AuthMeta {
  kind: 'customer' | 'staff';
  permissions: Permission[];
}

/** Customer-only route. */
export const CustomerAuth = () =>
  applyDecorators(SetMetadata(AUTH_META, { kind: 'customer', permissions: [] } satisfies AuthMeta), UseGuards(AuthGuard), ApiBearerAuth());

/** Staff-only route requiring ALL listed permissions. */
export const StaffAuth = (...permissions: Permission[]) =>
  applyDecorators(SetMetadata(AUTH_META, { kind: 'staff', permissions } satisfies AuthMeta), UseGuards(AuthGuard), ApiBearerAuth());

export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): CustomerPrincipal => ctx.switchToHttp().getRequest().principal);
export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffPrincipal => ctx.switchToHttp().getRequest().principal);

export function permissionsFor(roles: StaffRole[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<AuthMeta | undefined>(AUTH_META, [ctx.getHandler(), ctx.getClass()]);
    if (!meta) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHENTICATED', 'Missing bearer token', HttpStatus.UNAUTHORIZED);

    let payload: { sub: string; typ: 'customer' | 'staff' };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
    }
    if (payload.typ !== meta.kind) throw new DomainError('FORBIDDEN', 'This endpoint is not available to this account type', HttpStatus.FORBIDDEN);

    if (meta.kind === 'customer') {
      const c = await this.prisma.customer.findUnique({ where: { id: payload.sub }, select: { id: true, active: true } });
      if (!c?.active) throw new DomainError('UNAUTHENTICATED', 'Account inactive', HttpStatus.UNAUTHORIZED);
      req.principal = { kind: 'customer', id: c.id } satisfies CustomerPrincipal;
      return true;
    }

    // Staff: roles are re-read on every request so revocation is immediate.
    const s = await this.prisma.staffUser.findUnique({ where: { id: payload.sub }, select: { id: true, active: true, roles: true } });
    if (!s?.active) throw new DomainError('UNAUTHENTICATED', 'Account inactive', HttpStatus.UNAUTHORIZED);
    const permissions = permissionsFor(s.roles);
    const missing = meta.permissions.filter((p) => !permissions.has(p));
    if (missing.length) throw new DomainError('FORBIDDEN', `Missing permission: ${missing.join(', ')}`, HttpStatus.FORBIDDEN);
    req.principal = { kind: 'staff', id: s.id, roles: s.roles, permissions } satisfies StaffPrincipal;
    return true;
  }
}
