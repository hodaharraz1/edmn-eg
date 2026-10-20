/**
 * Credentials that are public knowledge (committed in this repository for local demo/test databases).
 * A production deployment refuses them outright, whatever account they belong to (C8, fail closed).
 */
export const PUBLIC_FIXTURE_PASSWORDS: readonly string[] = ['Demo@12345', 'Admin@Edmn#2026', 'Test@12345'];
export const PUBLIC_FIXTURE_TOTP_SECRETS: readonly string[] = ['JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'];

export const isProductionDeployment = (env: Record<string, string | undefined> = process.env) => env.EDMN_ENVIRONMENT === 'production';
