-- SEC-165 (owner decision 2026-11-25): a closed account's national-ID photos are locked at closure and removed for good
-- 6 months later by the privacy.purge_closed_identity_files job. purged_at records that the bytes are gone.
ALTER TABLE "files" ADD COLUMN "purged_at" timestamp with time zone;
