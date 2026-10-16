import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Patch, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { Msisdn } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { DomainError } from '../common/errors';
import { decrypt, encrypt } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from './auth.guard';
import { newSecret, otpauthUrl, verifyTotp } from './totp';
import type { StaffUser } from '../generated/prisma/client';

/**
 * Staff sign-in is a short sequence of steps. Each step returns either the next
 * step plus a 5-minute `challenge` token, or the final access token:
 *
 *   POST /auth/staff/login           email + password   → TOTP | TOTP_ENROLL | PASSWORD | DONE
 *   POST /auth/staff/login/totp      challenge + code   → PASSWORD | DONE
 *   POST /auth/staff/login/password  challenge + new pw → DONE
 *
 * A challenge token has typ 'staff_challenge', so the guard never accepts it as
 * an access token. Every token carries the account's sessionVersion; a password
 * change, 2FA reset or deactivation bumps it and kills every older token.
 */

export const StaffPassword = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[^a-zA-Z]/.test(p), 'Mix letters with numbers or symbols');

const LoginSchema = z.object({ email: z.string().trim().email().toLowerCase(), password: z.string().min(1).max(200) });
const TotpSchema = z.object({ challenge: z.string().min(10).max(2000), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const NewPasswordSchema = z.object({ challenge: z.string().min(10).max(2000), newPassword: StaffPassword });
const PreferencesSchema = z
  .object({
    locale: z.enum(['en', 'fr']).optional(),
    phone: Msisdn.nullable().optional(),
    alertChannels: z.array(z.enum(['SMS', 'WHATSAPP'])).max(2).transform((c) => [...new Set(c)]).optional(),
  })
  .refine((b) => b.locale !== undefined || b.phone !== undefined || b.alertChannels !== undefined, 'Nothing to change');
const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: StaffPassword });

type Stage = 'totp' | 'enroll' | 'password';
interface ChallengePayload {
  sub: string;
  typ: 'staff_challenge';
  stage: Stage;
  sv: number;
}

export type StaffLoginStep =
  | { next: 'TOTP'; challenge: string }
  | { next: 'TOTP_ENROLL'; challenge: string; secret: string; otpauthUrl: string }
  | { next: 'PASSWORD'; challenge: string }
  | { next: 'DONE'; accessToken: string; roles: string[] };

const INVALID = () => new DomainError('INVALID_CREDENTIALS', 'Invalid email or password', HttpStatus.UNAUTHORIZED);
const BAD_CODE = () => new DomainError('INVALID_CODE', 'That code is not right. Check the time on your phone and try the newest code.', HttpStatus.UNAUTHORIZED);
const EXPIRED = () => new DomainError('CHALLENGE_EXPIRED', 'Sign-in took too long. Start again.', HttpStatus.UNAUTHORIZED);
let dummyHash: Promise<string> | null = null;

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });

/** Readable one-time password: 4 groups of 4 from an alphabet without look-alike characters. */
export function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const groups = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''));
  return groups.join('-');
}

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(input: z.infer<typeof LoginSchema>, ip?: string): Promise<StaffLoginStep> {
    const s = await this.prisma.staffUser.findUnique({ where: { email: input.email } });
    const ok = (await this.verifyPassword(s?.passwordHash, input.password)) && !!s?.active;
    await this.audit.record({ actorType: 'STAFF', actorId: s?.id ?? null, action: ok ? 'staff.login.password_ok' : 'staff.login_failed', entityType: 'StaffUser', entityId: s?.id ?? null, after: { email: input.email }, ip });
    if (!ok || !s) throw INVALID();

    if (s.totpEnabledAt) return { next: 'TOTP', challenge: await this.challenge(s, 'totp') };
    if (this.env.STAFF_TOTP_REQUIRED) {
      // Not enrolled yet: hand out a pending secret (reused until enrolment succeeds).
      let secret: string;
      if (s.totpSecretEncrypted) secret = decrypt(s.totpSecretEncrypted, this.env.APP_ENCRYPTION_KEY);
      else {
        secret = newSecret();
        await this.prisma.staffUser.update({ where: { id: s.id }, data: { totpSecretEncrypted: encrypt(secret, this.env.APP_ENCRYPTION_KEY) } });
      }
      return { next: 'TOTP_ENROLL', challenge: await this.challenge(s, 'enroll'), secret, otpauthUrl: otpauthUrl(secret, s.email) };
    }
    return this.afterSecondFactor(s, ip);
  }

  async totp(input: z.infer<typeof TotpSchema>, ip?: string): Promise<StaffLoginStep> {
    const { s, stage } = await this.openChallenge(input.challenge, ['totp', 'enroll']);
    if (!s.totpSecretEncrypted) throw EXPIRED();
    const step = verifyTotp(decrypt(s.totpSecretEncrypted, this.env.APP_ENCRYPTION_KEY), input.code, { lastUsedStep: s.totpLastStep });
    if (step === null) {
      await this.audit.record({ actorType: 'STAFF', actorId: s.id, action: 'staff.login.totp_failed', entityType: 'StaffUser', entityId: s.id, ip });
      throw BAD_CODE();
    }
    // Conditional update: two concurrent requests with the same code cannot both pass.
    const updated = await this.prisma.staffUser.updateMany({
      where: { id: s.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, ...(stage === 'enroll' ? { totpEnabledAt: new Date() } : {}) },
    });
    if (updated.count !== 1) throw BAD_CODE();
    if (stage === 'enroll') await this.audit.record({ actorType: 'STAFF', actorId: s.id, action: 'staff.2fa.enrolled', entityType: 'StaffUser', entityId: s.id, ip });
    return this.afterSecondFactor(s, ip);
  }

  async setFirstPassword(input: z.infer<typeof NewPasswordSchema>, ip?: string): Promise<StaffLoginStep> {
    const { s } = await this.openChallenge(input.challenge, ['password']);
    if (await this.verifyPassword(s.passwordHash, input.newPassword)) throw new DomainError('PASSWORD_REUSED', 'Choose a password different from the temporary one');
    const updated = await this.prisma.staffUser.update({
      where: { id: s.id },
      data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    await this.audit.record({ actorType: 'STAFF', actorId: s.id, action: 'staff.password.set', entityType: 'StaffUser', entityId: s.id, ip });
    return this.done(updated, ip);
  }

  async changePassword(staffId: string, input: z.infer<typeof ChangePasswordSchema>, ip?: string) {
    const s = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } });
    if (!(await this.verifyPassword(s.passwordHash, input.currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Your current password is not right', HttpStatus.UNAUTHORIZED);
    if (input.currentPassword === input.newPassword) throw new DomainError('PASSWORD_REUSED', 'Choose a new password');
    const updated = await this.prisma.staffUser.update({
      where: { id: s.id },
      data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    await this.audit.record({ actorType: 'STAFF', actorId: s.id, action: 'staff.password.changed', entityType: 'StaffUser', entityId: s.id, ip });
    // Other sessions end; this one continues with a fresh token.
    return { accessToken: await this.accessToken(updated) };
  }

  async signOutEverywhere(staffId: string, ip?: string) {
    await this.prisma.staffUser.update({ where: { id: staffId }, data: { sessionVersion: { increment: 1 } } });
    await this.audit.record({ actorType: 'STAFF', actorId: staffId, action: 'staff.sessions.revoked', entityType: 'StaffUser', entityId: staffId, ip });
    return { ok: true };
  }

  profile(staffId: string) {
    return this.prisma.staffUser.findUniqueOrThrow({
      where: { id: staffId },
      select: { id: true, email: true, fullName: true, totpEnabledAt: true, lastLoginAt: true, createdAt: true, locale: true, phone: true, alertChannels: true },
    });
  }

  /** A staff member's own preferences: dashboard language and where to receive alerts. */
  async updatePreferences(staffId: string, input: z.infer<typeof PreferencesSchema>, ip?: string) {
    const before = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: staffId }, select: { locale: true, phone: true, alertChannels: true } });
    const phone = input.phone !== undefined ? input.phone : before.phone;
    const alertChannels = input.alertChannels ?? before.alertChannels;
    if (alertChannels.length && !phone) throw new DomainError('PHONE_REQUIRED', 'Add a phone number to receive alerts by SMS or WhatsApp');
    const after = await this.prisma.staffUser.update({
      where: { id: staffId },
      data: { locale: input.locale ?? before.locale, phone, alertChannels },
      select: { locale: true, phone: true, alertChannels: true },
    });
    await this.audit.record({ actorType: 'STAFF', actorId: staffId, action: 'staff.preferences', entityType: 'StaffUser', entityId: staffId, before, after, ip });
    return after;
  }

  // ------------------------------------------------------------------ internals

  private async afterSecondFactor(s: StaffUser, ip?: string): Promise<StaffLoginStep> {
    if (s.mustChangePassword) return { next: 'PASSWORD', challenge: await this.challenge(s, 'password') };
    return this.done(s, ip);
  }

  private async done(s: StaffUser, ip?: string): Promise<StaffLoginStep> {
    await this.prisma.staffUser.update({ where: { id: s.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ actorType: 'STAFF', actorId: s.id, action: 'staff.login', entityType: 'StaffUser', entityId: s.id, ip });
    return { next: 'DONE', accessToken: await this.accessToken(s), roles: s.roles };
  }

  private accessToken(s: StaffUser) {
    return this.jwt.signAsync({ sub: s.id, typ: 'staff', sv: s.sessionVersion }, { expiresIn: this.env.JWT_STAFF_TTL as never });
  }

  private challenge(s: StaffUser, stage: Stage) {
    return this.jwt.signAsync({ sub: s.id, typ: 'staff_challenge', stage, sv: s.sessionVersion } satisfies ChallengePayload, { expiresIn: '5m' });
  }

  private async openChallenge(token: string, stages: Stage[]): Promise<{ s: StaffUser; stage: Stage }> {
    let p: ChallengePayload;
    try {
      p = await this.jwt.verifyAsync(token);
    } catch {
      throw EXPIRED();
    }
    if (p.typ !== 'staff_challenge' || !stages.includes(p.stage)) throw EXPIRED();
    const s = await this.prisma.staffUser.findUnique({ where: { id: p.sub } });
    if (!s?.active || s.sessionVersion !== p.sv) throw EXPIRED();
    // An enrol challenge is void once the account is enrolled (and vice versa).
    if (p.stage === 'enroll' && s.totpEnabledAt) throw EXPIRED();
    if (p.stage === 'totp' && !s.totpEnabledAt) throw EXPIRED();
    return { s, stage: p.stage };
  }

  private async verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
    if (!hash) {
      // Unknown accounts take as long as known ones.
      dummyHash ??= hashPassword('not-a-real-password');
      await argon2.verify(await dummyHash, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }
}

/** Strict limit for credential steps; normal endpoints use the global per-user limit. */
export const LOGIN_LIMIT = Throttle({ default: { limit: 10, ttl: 60_000 } });

@ApiTags('auth / staff')
@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  @Post('login')
  @LOGIN_LIMIT
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>, @Req() req: Request) {
    return this.auth.login(body, req.ip);
  }

  @Post('login/totp')
  @LOGIN_LIMIT
  @HttpCode(200)
  totp(@Body(new ZodPipe(TotpSchema)) body: z.infer<typeof TotpSchema>, @Req() req: Request) {
    return this.auth.totp(body, req.ip);
  }

  @Post('login/password')
  @LOGIN_LIMIT
  @HttpCode(200)
  firstPassword(@Body(new ZodPipe(NewPasswordSchema)) body: z.infer<typeof NewPasswordSchema>, @Req() req: Request) {
    return this.auth.setFirstPassword(body, req.ip);
  }

  /** Who is signed in to the admin dashboard, and what they may do. */
  @Get('me')
  @StaffAuth()
  async me(@CurrentStaff() s: StaffPrincipal) {
    const { totpEnabledAt, ...row } = await this.auth.profile(s.id);
    return { ...row, twoFactorEnabled: totpEnabledAt !== null, twoFactorSince: totpEnabledAt, roles: s.roles, permissions: [...s.permissions].sort() };
  }

  @Patch('me')
  @StaffAuth()
  preferences(@CurrentStaff() s: StaffPrincipal, @Body(new ZodPipe(PreferencesSchema)) body: z.infer<typeof PreferencesSchema>, @Req() req: Request) {
    return this.auth.updatePreferences(s.id, body, req.ip);
  }

  @Post('password')
  @StaffAuth()
  @LOGIN_LIMIT
  @HttpCode(200)
  changePassword(@CurrentStaff() s: StaffPrincipal, @Body(new ZodPipe(ChangePasswordSchema)) body: z.infer<typeof ChangePasswordSchema>, @Req() req: Request) {
    return this.auth.changePassword(s.id, body, req.ip);
  }

  /** Ends every session of this account, including the current one. */
  @Post('sessions/revoke')
  @StaffAuth()
  @HttpCode(200)
  revoke(@CurrentStaff() s: StaffPrincipal, @Req() req: Request) {
    return this.auth.signOutEverywhere(s.id, req.ip);
  }
}
