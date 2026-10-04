import type { Permission, SellerPermission } from '@/server/rbac/permissions';
import { DomainError, forbidden, unauthenticated } from './errors';

/**
 * The authenticated principal performing an action. Built by the auth layer from the session
 * and passed explicitly into every domain service (services never read cookies themselves).
 */
export type ActorType = 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'SYSTEM' | 'ANONYMOUS';

export interface Actor {
  type: ActorType;
  userId: string | null;
  /** staff permissions (ADMIN actors) */
  permissions: ReadonlySet<Permission>;
  /** seller context (SELLER actors) */
  sellerId?: string;
  sellerPermissions?: ReadonlySet<SellerPermission>;
  sessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
  /** time of last step-up re-authentication for highly sensitive operations */
  stepUpAt?: Date | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', userId: null, permissions: new Set() };

export function requireUser(actor: Actor): string {
  if (!actor.userId) throw unauthenticated();
  return actor.userId;
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (actor.type === 'SYSTEM') return;
  if (actor.type !== 'ADMIN' || !actor.permissions.has(permission)) throw forbidden();
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return actor.type === 'SYSTEM' || (actor.type === 'ADMIN' && actor.permissions.has(permission));
}

/** Seller-scoped guard: returns the seller id the actor is allowed to act for. */
export function requireSeller(actor: Actor, permission?: SellerPermission): string {
  if (actor.type !== 'SELLER' || !actor.sellerId) throw forbidden('هذا الإجراء متاح للبائعين فقط');
  if (permission && !actor.sellerPermissions?.has(permission)) throw forbidden();
  return actor.sellerId;
}

const STEP_UP_WINDOW_MS = 10 * 60 * 1000;
export function requireStepUp(actor: Actor): void {
  if (actor.type === 'SYSTEM') return;
  if (!actor.stepUpAt || Date.now() - actor.stepUpAt.getTime() > STEP_UP_WINDOW_MS) {
    throw new DomainError('STEP_UP_REQUIRED', 'يرجى تأكيد هويتك مرة أخرى لإتمام هذا الإجراء الحساس');
  }
}
