import type { RouteDef } from '../http';
import { adminRoutes } from './admin';
import { buyerRoutes } from './buyer';
import { sellerRoutes } from './seller';
import { sellerSetupRoutes } from './seller-setup';
import { dealRoutes } from './deals';
import { messageRoutes } from './messages';
import { walletRoutes } from './wallet';
import { postPurchaseRoutes } from './postpurchase';
import { notificationRoutes } from './notifications';
import { customerRoutes } from './customer';
import { publicRoutes } from './public';

/** Every mobile API route, by contract. The OpenAPI documents and the route-file coverage test are generated from these. */
export const MOBILE_API_ROUTES: RouteDef[] = [...publicRoutes, ...customerRoutes, ...buyerRoutes, ...sellerRoutes, ...sellerSetupRoutes, ...dealRoutes, ...messageRoutes, ...walletRoutes, ...postPurchaseRoutes, ...notificationRoutes] as unknown as RouteDef[];
export const ADMIN_API_ROUTES: RouteDef[] = adminRoutes as unknown as RouteDef[];
export const ALL_API_ROUTES: RouteDef[] = [...MOBILE_API_ROUTES, ...ADMIN_API_ROUTES];
