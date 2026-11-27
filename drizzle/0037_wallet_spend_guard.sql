-- Narrows the PKG-WALLET-02 exception (owner decision 2026-11-27: keep spends review-free, but ONLY for a
-- customer's own balance). A journal entry of type WALLET_SPEND carries no staff approval, so at commit it must:
--   * debit CUSTOMER_WALLETS by a positive amount and never credit it (a spend can only take money OUT of wallets);
--   * be matched by exactly one customer_wallet_entries SPEND row for the same entry and the same amount.
-- Anything else (a wallet top-up, a payout, a refund disguised as WALLET_SPEND) is rejected by the database.
CREATE OR REPLACE FUNCTION edmn_wallet_spend_guard() RETURNS trigger AS $$
DECLARE d bigint; c bigint; n int; s bigint;
BEGIN
  IF NEW.entry_type <> 'WALLET_SPEND' THEN RETURN NULL; END IF;
  SELECT coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0) INTO d, c
    FROM journal_lines l JOIN ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = NEW.id AND a.code = 'CUSTOMER_WALLETS';
  SELECT count(*), coalesce(sum(-amount), 0) INTO n, s
    FROM customer_wallet_entries WHERE journal_entry_id = NEW.id AND kind = 'SPEND';
  IF d <= 0 OR c <> 0 OR n <> 1 OR s <> d THEN
    RAISE EXCEPTION 'WALLET_SPEND entry % must debit CUSTOMER_WALLETS (debit %, credit %) and match one SPEND row (rows %, amount %)', NEW.id, d, c, n, s
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_entries_wallet_spend_guard ON journal_entries;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_wallet_spend_guard AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edmn_wallet_spend_guard();
