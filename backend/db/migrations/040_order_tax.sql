-- 040_order_tax.sql
--
-- Destination VAT on orders. `orders.tax` already existed but was always written as
-- 0; these columns record *why* a given amount was charged, which is what an OSS
-- return needs per sale: which country's rate was applied, and what that rate was.
--
-- The rate is snapshotted rather than looked up at reporting time on purpose — rates
-- change, and a historical order must keep reporting the rate that was actually
-- charged to that buyer.
--
-- `order_items.unit_price` stays NET throughout, so artist commission and payouts are
-- untouched by any of this. Tax lives only at the order level.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_country VARCHAR(2),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.tax_country IS
  'ISO 3166-1 alpha-2 country whose VAT rate was applied. NULL for orders placed before destination VAT was introduced.';
COMMENT ON COLUMN orders.tax_rate IS
  'VAT percentage applied to this order (e.g. 20.00), snapshotted at purchase time.';

-- Reporting reads these by country over a date range (an OSS return is exactly that
-- shape), and only paid orders count.
CREATE INDEX IF NOT EXISTS idx_orders_tax_country
  ON orders (tax_country, paid_at)
  WHERE payment_status = 'succeeded';
