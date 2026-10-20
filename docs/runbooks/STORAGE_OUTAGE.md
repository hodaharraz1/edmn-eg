# Storage Outage / Recovery

Classes (`src/server/storage/scanning.ts`): PUBLIC (product/store/CMS/review images — re-encoded by sharp), PRIVATE (evidence, attachments, waybills), HIGHLY_SENSITIVE (IDENTITY_DOCUMENT, SELLER_DOCUMENT, PAYMENT_PROOF, WITHDRAWAL_PROOF, REFUND_PROOF).
Private bytes are only ever served by `/api/files/[id]` after a per-purpose authorization check (uniform 404, `private, no-store`, sandbox CSP); staff views of sensitive purposes are audited (`file.sensitive_viewed`); National ID scans additionally need `identity.documents.view` + 2FA within the hour. No public URL exists for private files.

## Symptoms
`/api/ready` storage `error`; uploads fail; images 404.

## Steps
1. Check `/admin/ops` (storage check, fingerprint storage component). Staging uses `STORAGE_DRIVER=database` → a storage outage is a database outage (DATABASE_RESTORE / provider status).
2. Local disk driver: confirm the root and its `.edmn-environment` marker match the runtime (a mismatched root is refused as a fingerprint VIOLATION — never "fix" by deleting the marker; find why a foreign root was mounted).
3. After recovery verify integrity (read-only, prints counts only):
   `npx tsx scripts/storage-verify.ts --db <url> [--root <dir>]` → every object present, sha256 matches; exit 1 if any PRIVATE / HIGHLY_SENSITIVE object is missing or altered.
4. Malware scanner down: files stay QUARANTINED/SCAN_FAILED and are not served (production). Restore the scanner; the `files.scan` job resumes. Never mark files CLEAN by hand.

## Never
Never make a private bucket/path public, never copy staging files to production, never expose National ID or bank documents to "speed up" recovery.
