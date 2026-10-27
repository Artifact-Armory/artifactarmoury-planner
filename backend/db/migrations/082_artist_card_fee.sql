-- 082_artist_card_fee.sql
--
-- Artists pay a card fee on each sale (1.5% of the price before VAT), taken from
-- their share at checkout; the platform covers Stripe's fixed 20p per order.
-- Founding artists (became an artist before 1 Nov 2026) pay none. The rule lives in
-- services/cardFee.ts; this column is only an override for one account.
--
-- order_items.artist_card_fee records the fee taken on each line, so the admin
-- dashboard can show it. artist_commission_amount is already net of it, so
-- earnings and payouts need no change.

ALTER TABLE users ADD COLUMN IF NOT EXISTS card_fee_percent DECIMAL(5,2);

COMMENT ON COLUMN users.card_fee_percent IS
  'Override for this artist''s card fee percent. NULL = the standard rule (0 for founding artists, otherwise ARTIST_CARD_FEE_PERCENT).';

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS artist_card_fee DECIMAL(10,2) NOT NULL DEFAULT 0;
