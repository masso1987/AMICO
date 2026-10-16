import { Body, Controller, Get, Global, HttpCode, HttpStatus, Inject, Injectable, Module, Patch, Post } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { Msisdn } from '@amico/contracts';
import { ENV, loadEnv, type Env } from '../config/env';
import { DomainError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthGuard, CurrentCustomer, CustomerAuth, type CustomerPrincipal } from './auth.guard';
import { LOGIN_LIMIT, StaffAuthController, StaffAuthService } from './staff-auth';

const Password = z.string().min(10, 'Use at least 10 characters').max(200);
const Locale = z.enum(['en', 'fr']);
const RegisterSchema = z.object({ phone: Msisdn, fullName: z.string().trim().min(2).max(120), password: Password, locale: Locale.default('en') });
const ProfileSchema = z
  .object({ fullName: z.string().trim().min(2).max(120).optional(), locale: Locale.optional(), smsOptIn: z.boolean().optional(), whatsappOptIn: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
const CustomerLoginSchema = z.object({ phone: Msisdn, password: z.string().min(1).max(200) });

const INVALID = () => new DomainError('INVALID_CREDENTIALS', 'Invalid credentials', HttpStatus.UNAUTHORIZED);
// Dummy hash so unknown accounts take as long as known ones.
let dummyHash: Promise<string> | null = null;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async registerCustomer(input: z.infer<typeof RegisterSchema>) {
    const exists = await this.prisma.customer.findUnique({ where: { phone: input.phone } });
    if (exists) throw new DomainError('PHONE_TAKEN', 'An account already exists for this number', HttpStatus.CONFLICT);
    const c = await this.prisma.customer.create({
      data: { phone: input.phone, fullName: input.fullName, locale: input.locale, passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) },
    });
    await this.audit.record({ actorType: 'CUSTOMER', actorId: c.id, action: 'customer.register', entityType: 'Customer', entityId: c.id });
    // TODO(P1): SMS OTP verification of the phone number before first transaction.
    return { id: c.id, accessToken: await this.jwt.signAsync({ sub: c.id, typ: 'customer' }, { expiresIn: this.env.JWT_CUSTOMER_TTL as never }) };
  }

  async loginCustomer(input: z.infer<typeof CustomerLoginSchema>) {
    const c = await this.prisma.customer.findUnique({ where: { phone: input.phone } });
    if (!(await this.verify(c?.passwordHash, input.password)) || !c?.active) throw INVALID();
    return { accessToken: await this.jwt.signAsync({ sub: c.id, typ: 'customer' }, { expiresIn: this.env.JWT_CUSTOMER_TTL as never }) };
  }

  async me(customerId: string) {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return { id: c.id, phone: c.phone, fullName: c.fullName, phoneVerified: c.phoneVerifiedAt !== null, locale: c.locale, smsOptIn: c.smsOptIn, whatsappOptIn: c.whatsappOptIn, createdAt: c.createdAt };
  }

  async updateProfile(customerId: string, input: z.infer<typeof ProfileSchema>) {
    const before = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    await this.prisma.customer.update({ where: { id: customerId }, data: input });
    await this.audit.record({ actorType: 'CUSTOMER', actorId: customerId, action: 'customer.profile', entityType: 'Customer', entityId: customerId, before: { fullName: before.fullName, locale: before.locale, smsOptIn: before.smsOptIn, whatsappOptIn: before.whatsappOptIn }, after: input });
    return this.me(customerId);
  }

  private async verify(hash: string | undefined, password: string): Promise<boolean> {
    if (!hash) {
      dummyHash ??= argon2.hash('not-a-real-password', { type: argon2.argon2id });
      await argon2.verify(await dummyHash, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }
}


@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('customer/register')
  @LOGIN_LIMIT
  register(@Body(new ZodPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>) {
    return this.auth.registerCustomer(body);
  }

  @Post('customer/login')
  @LOGIN_LIMIT
  @HttpCode(200)
  loginCustomer(@Body(new ZodPipe(CustomerLoginSchema)) body: z.infer<typeof CustomerLoginSchema>) {
    return this.auth.loginCustomer(body);
  }

  @Get('customer/me')
  @CustomerAuth()
  me(@CurrentCustomer() c: CustomerPrincipal) {
    return this.auth.me(c.id);
  }

  @Patch('customer/me')
  @CustomerAuth()
  updateMe(@CurrentCustomer() c: CustomerPrincipal, @Body(new ZodPipe(ProfileSchema)) body: z.infer<typeof ProfileSchema>) {
    return this.auth.updateProfile(c.id, body);
  }
}

@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => ({ secret: loadEnv().JWT_SECRET }) })],
  controllers: [AuthController, StaffAuthController],
  providers: [AuthService, StaffAuthService, AuthGuard],
  exports: [JwtModule, AuthGuard, StaffAuthService],
})
export class AuthModule {}
