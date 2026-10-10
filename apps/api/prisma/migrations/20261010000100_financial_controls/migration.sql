-- Financial controls enforced by the database itself, so no code path
-- (including a buggy one) can rewrite history.

-- 1. Append-only tables: block UPDATE and DELETE.
CREATE OR REPLACE FUNCTION amico_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; post a reversal or adjustment instead', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION amico_forbid_mutation();
CREATE TRIGGER ledger_journal_append_only BEFORE UPDATE OR DELETE ON "LedgerJournal"
  FOR EACH ROW EXECUTE FUNCTION amico_forbid_mutation();
CREATE TRIGGER state_history_append_only BEFORE UPDATE OR DELETE ON "TransactionStateHistory"
  FOR EACH ROW EXECUTE FUNCTION amico_forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION amico_forbid_mutation();

-- 2. Each ledger line is either a debit or a credit, never negative, never both.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_one_side_chk"
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0));

-- 3. Every journal balances (checked at commit, so lines can be inserted one by one).
CREATE OR REPLACE FUNCTION amico_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  d BIGINT;
  c BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO d, c
    FROM "LedgerEntry" WHERE "journalId" = NEW."journalId";
  IF d <> c THEN
    RAISE EXCEPTION 'Ledger journal % is unbalanced (debits %, credits %)', NEW."journalId", d, c
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_journal_balanced AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION amico_check_journal_balanced();

-- 4. Money columns are never negative.
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_amounts_chk"
  CHECK (amount > 0 AND "customerPays" > 0 AND "platformFee" >= 0 AND "providerFee" >= 0 AND "expectedDelivered" > 0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amounts_chk"
  CHECK (amount > 0 AND "customerPays" > 0 AND "platformFee" >= 0 AND "providerFee" >= 0
         AND "expectedDelivered" > 0 AND "payoutInstructionAmount" > 0);
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_amount_chk" CHECK (amount > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_chk" CHECK (amount > 0);
