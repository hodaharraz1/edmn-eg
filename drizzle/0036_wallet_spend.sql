-- PKG-WALLET-02: الدفع من رصيد المحفظة (owner brief: "No staff review needed for spending (no outside money
-- arrives); still audited"). The deposit itself was credited two-person (WALLET_TOPUP_CREDIT); spending the
-- customer's OWN balance moves no outside money, so the brief exempts it from staff review — audited instead.
-- The ONLY approval-exempt journal entry type is WALLET_SPEND. Every staff movement stays two-person, unchanged.
CREATE OR REPLACE FUNCTION edmn_journal_requires_approval() RETURNS trigger AS $$
DECLARE a record;
BEGIN
  IF NEW.approval_id IS NULL THEN
    -- PKG-WALLET-02 exception: customer-initiated spend of their own wallet balance (audited; sub-ledger row
    -- customer_wallet_entries SPEND carries the same journal_entry_id). Refunds of wallet-paid orders are
    -- normal staff-approved REFUND entries that credit CUSTOMER_WALLETS — they are NOT exempt.
    IF NEW.entry_type = 'WALLET_SPEND' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'journal entry % (%) has no Admin financial approval', NEW.idempotency_key, NEW.entry_type USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM financial_approvals WHERE id = NEW.approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial approval % not found', NEW.approval_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.approved_by IS NULL OR a.approved_at IS NULL THEN
    RAISE EXCEPTION 'financial approval % has no approving Admin', a.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.entry_type = ANY (a.entry_types)) THEN
    RAISE EXCEPTION 'approval % (%) does not cover entry type %', a.id, a.action, NEW.entry_type USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.status = 'APPROVED' THEN
    UPDATE financial_approvals SET status = 'CONSUMED', consumed_at = now() WHERE id = a.id;
  ELSIF NOT (a.status = 'CONSUMED' AND a.consumed_at = now()) THEN
    RAISE EXCEPTION 'financial approval % is % and cannot be (re)used', a.id, a.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- A wallet payment is confirmed by its payer (the customer spending their own balance), with no staff review:
-- relax the two-person CHECK for method WALLET only. Staff-confirmed payments keep the original rule.
ALTER TABLE "payments" DROP CONSTRAINT "payments_two_person_chk";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_two_person_chk" CHECK ("payments"."confirmed_by" is null or ("payments"."review_started_by" is not null and "payments"."confirmed_by" <> "payments"."review_started_by") or ("payments"."method" = 'WALLET' and "payments"."confirmed_by" = "payments"."payer_user_id"));--> statement-breakpoint
-- The WALLET method code exists so orders/deals can carry it; availability is gated by the
-- wallet.topUpEnabled setting (never by the staff-managed transfer-method list).
INSERT INTO "payment_methods" ("code", "name_ar", "name_en", "is_enabled", "sort_order") VALUES ('WALLET', 'محفظة أضمن', 'EDMN Wallet', false, 90) ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
