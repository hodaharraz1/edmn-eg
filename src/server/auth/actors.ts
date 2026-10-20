import { eq } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { rolePermissions, userRoles } from '@/server/db/schema';
import type { Permission } from '@/server/rbac/permissions';
import { sellerContextForUser } from '@/server/modules/sellers/service';

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
  sessionId?: string;
  stepUpAt?: Date | null;
}

export function customerActor(userId: string, ctx: RequestContext = {}): Actor {
  return { type: 'CUSTOMER', userId, permissions: new Set(), ...ctx };
}

/** Seller actor = customer identity + resolved seller membership & seller-scoped permissions. */
export async function sellerActor(userId: string, ctx: RequestContext = {}): Promise<Actor | null> {
  const sc = await sellerContextForUser(userId);
  if (!sc) return null;
  return { type: 'SELLER', userId, permissions: new Set(), sellerId: sc.seller.id, sellerPermissions: sc.permissions, ...ctx };
}

export async function staffPermissions(userId: string): Promise<Set<Permission>> {
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleCode, userRoles.roleCode))
    .where(eq(userRoles.userId, userId));
  return new Set(rows.map((r) => r.permission as Permission));
}

export async function adminActor(userId: string, ctx: RequestContext = {}): Promise<Actor> {
  return { type: 'ADMIN', userId, permissions: await staffPermissions(userId), ...ctx };
}
