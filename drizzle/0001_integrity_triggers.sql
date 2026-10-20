-- Append-only protection for audit, status history and the financial journal.
-- Corrections are made with reversing/adjusting entries, never by UPDATE/DELETE.
CREATE OR REPLACE FUNCTION edmn_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER status_history_append_only BEFORE UPDATE OR DELETE ON status_history
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
-- TRUNCATE is a separate statement-level event.
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();
--> statement-breakpoint
-- Every journal entry must balance (sum debits = sum credits, at least two lines).
-- Checked at COMMIT so lines can be inserted one by one inside the posting transaction.
CREATE OR REPLACE FUNCTION edmn_check_entry_balanced() RETURNS trigger AS $$
DECLARE d bigint; c bigint; n int;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n
    FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c OR n < 2 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (debit %, credit %, lines %)', NEW.entry_id, d, c, n;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edmn_check_entry_balanced();
