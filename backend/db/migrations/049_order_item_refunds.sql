-- 049_order_item_refunds.sql
--
-- Per-line-item refunds. Until now the only refund path was the blunt
-- "refund_buyers" moderation action (routes/admin.ts), which refunds EVERY
-- buyer of a model at once and only fires off a report. Admins need to open
-- an individual order and refund a single model within it.
--
-- orders.payment_status already has a 'refunded' value (schema.sql) — that's
-- now reserved for "every item in this order has been refunded"; a single
-- refunded line is tracked here instead, so the other still-valid items in
-- the same order keep their entitlement (download access, "already owned"
-- checks, etc. — see the refunded_at IS NULL filters added across
-- models.ts/orders.ts/reports.ts/artists.ts in this same change).

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS refunded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Gross £ actually refunded (net + that line's own VAT share, computed at
  -- refund time from the order's snapshotted tax_rate — see routes/admin.ts).
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2);

CREATE INDEX IF NOT EXISTS idx_order_items_refunded ON order_items(refunded_at) WHERE refunded_at IS NOT NULL;

COMMENT ON COLUMN order_items.refunded_at IS 'Set when an admin refunds this specific line via POST /admin/orders/:orderId/items/:itemId/refund.';
COMMENT ON COLUMN order_items.refund_amount IS 'Gross amount actually refunded to the buyer for this line (net total_price + its VAT share).';
