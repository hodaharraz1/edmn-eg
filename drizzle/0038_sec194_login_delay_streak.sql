-- SEC-194 (PKG-FOLLOWUP-01): per-account timestamp of the last failed login, for the progressive login delay.
-- (The payments_two_person_chk WALLET clause this file also re-created is already in 0036, added NOT VALID because
--  historical pre-0026 payments are deliberately unvalidated; re-adding it here without NOT VALID fails on staging.)
ALTER TABLE "users" ADD COLUMN "last_failed_login_at" timestamp with time zone;