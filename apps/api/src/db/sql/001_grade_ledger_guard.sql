-- The grade ledger is append-only: any UPDATE or DELETE is rejected at the database level.
CREATE OR REPLACE FUNCTION athena_ledger_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'grade_ledger is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS grade_ledger_append_only ON grade_ledger;
CREATE TRIGGER grade_ledger_append_only
  BEFORE UPDATE OR DELETE ON grade_ledger
  FOR EACH ROW EXECUTE FUNCTION athena_ledger_guard();
