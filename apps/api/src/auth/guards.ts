import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';

/**
 * RBAC (BUILD_PLAN 2.3) and the verified-user gate (2.1).
 *
 * Two separate guards, deliberately. `JwtAuthGuard` answers "who is this?";
 * `VerifiedGuard` answers "may they touch money yet?". Conflating them is how
 * an unverified account ends up with a transfer endpoint.
 */

export type CustomerRole = 'SENDER' | 'RECIPIENT';
export type StaffRole = 'SUPPORT' | 'COMPLIANCE_OFFICER' | 'TREASURY_OPERATOR' | 'ADMIN';

export interface AuthenticatedUser {
  readonly id: string;
  readonly roles: readonly CustomerRole[];
  readonly kycTier: number;
  readonly emailVerified: boolean;
  readonly status: string;
}

export interface AuthenticatedStaff {
  readonly id: string;
  readonly roles: readonly StaffRole[];
  readonly displayName: string;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
    staff?: AuthenticatedStaff;
  }
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: CustomerRole[]) => SetMetadata(ROLES_KEY, roles);

export const STAFF_ROLES_KEY = 'staffRoles';
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (request.user === undefined) {
    throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
  }
  return request.user;
});

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (request.staff === undefined) {
    throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Staff sign in required' });
  }
  return request.staff;
});

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secret = config.JWT_ACCESS_SECRET;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        roles: CustomerRole[];
        tier: number;
        verified: boolean;
        status: string;
      }>(token, { secret: this.secret });

      request.user = {
        id: payload.sub,
        roles: payload.roles ?? [],
        kycTier: payload.tier ?? 0,
        emailVerified: payload.verified === true,
        status: payload.status,
      };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Session is not valid' });
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<CustomerRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (user === undefined) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    }
    if (!required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'This account does not have access to that resource',
      });
    }
    return true;
  }
}

/**
 * The financial gate.
 *
 * BUILD_PLAN 2.1 DoD: an unverified user receives 403 on every financial
 * endpoint. Applying this by decorator on each money-touching controller keeps
 * the requirement visible where the endpoint is defined.
 */
@Injectable()
export class VerifiedUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (user === undefined) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    }
    if (!user.emailVerified || user.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Confirm your email address before sending money',
      });
    }
    return true;
  }
}

@Injectable()
export class StaffAuthGuard implements CanActivate {
  /** The admin signing key, deliberately different from the customer one. */
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.secret = config.ADMIN_JWT_ACCESS_SECRET;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (token === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Staff sign in required',
      });
    }
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        roles: StaffRole[];
        name: string;
      }>(token, { secret: this.secret });
      request.staff = { id: payload.sub, roles: payload.roles ?? [], displayName: payload.name };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Session is not valid' });
    }
  }
}

@Injectable()
export class StaffRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const staff = request.staff;
    if (staff === undefined) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Staff sign in required',
      });
    }
    // ADMIN is not a superuser over compliance decisions: a compliance
    // decision requires COMPLIANCE_OFFICER, precisely so that segregation of
    // duties survives someone being made an administrator.
    if (!required.some((role) => staff.roles.includes(role))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: `This action requires one of: ${required.join(', ')}`,
      });
    }
    return true;
  }
}
