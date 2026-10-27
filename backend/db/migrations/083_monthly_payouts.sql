-- 083_monthly_payouts.sql
--
-- Artist payouts move from a weekly timer to once a month, on the 1st (UK time).
-- One row per month that has had its scheduled run; the primary key means only one
-- server can claim a month, and a redeploy mid-month doesn't pay out again.
-- (The old timer also ran a full payout on every boot, i.e. every deploy.)

CREATE TABLE IF NOT EXISTS payout_runs (
    run_month DATE PRIMARY KEY,           -- first day of the month, UK time
    ran_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The month this ships in counts as done, so the first monthly run is the 1st of
-- next month rather than straight away on deploy.
INSERT INTO payout_runs (run_month)
VALUES (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date)
ON CONFLICT (run_month) DO NOTHING;
