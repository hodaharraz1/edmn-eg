@AGENTS.md

## Test execution policy
Read `docs/TESTING_POLICY.md` before running E2E against staging: full regression runs locally; staging gets targeted specs after a deploy; a FULL staging run only for a release candidate / milestone / explicit owner request (Vercel Hobby resource budget).

## Egyptian market identity (non-negotiable)
EDMN is an Egyptian marketplace and must never look Saudi/Gulf/GCC. Every design, copy, imagery, seed-data or redesign change follows `docs/BRAND_EGYPT_MARKET_IDENTITY.md`. In short:
- EGP only, via `formatEGP` (`ج.م`).
- Egyptian places, from database governorates.
- Professional Arabic natural for Egyptians.
- No human imagery by default, and never Gulf dress, skylines or clichés.
- New raster assets must be listed in that document (enforced by `tests/unit/egypt-market-identity.test.ts`).
