-- 071_payout_transfer_group.sql
-- Each payout's Stripe transfer is now tagged with a transfer_group (services/payouts.ts).
-- If Stripe's answer to a transfer is lost (timeout, dropped connection, 5xx), the payout
-- stays 'pending' with its earnings held, and the next payout run looks the transfer up by
-- this group before trying again — so a transfer that did go through is recorded, not
-- paid a second time. Previously such a failure released the earnings and the next run
-- paid them again. Payouts created before this migration have no group and are never
-- retried automatically.

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS transfer_group VARCHAR(64);
