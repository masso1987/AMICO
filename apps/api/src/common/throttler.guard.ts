import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Rate-limit key: the signed-in user's token when there is one, otherwise the
 * client IP. All browser traffic reaches the API through the web apps on
 * localhost, so keying on the socket address alone would make every customer
 * and staff member share one limit. The web apps forward the visitor's IP in
 * X-Forwarded-For, and `trust proxy` makes req.ip use it.
 */
@Injectable()
export class AmicoThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const auth: string | undefined = req.headers?.authorization;
    if (auth?.startsWith('Bearer ')) return `tok:${createHash('sha256').update(auth).digest('hex').slice(0, 32)}`;
    return `ip:${req.ip}`;
  }
}
