-- 044_stripe_tax.sql
--
-- Stripe Tax replaces the self-declared-country VAT calculation at checkout (see
-- services/vat.ts and migration 040) with a rate Stripe derives from the buyer's
-- real billing address, and records each sale with Stripe for OSS/VAT filing.
--
-- `stripe_tax_calculation_id` is set when the order is created (the quote used to
-- price the PaymentIntent). `stripe_tax_transaction_id` is set once, after payment
-- succeeds, by whichever request/webhook wins the atomic payment_status claim — it's
-- what actually makes the sale count towards a Stripe Tax filing, so its absence on a
-- paid order is a signal worth investigating, not just decorative.
--
-- `tax_country` / `tax_rate` (040) are unaffected: they keep being populated, now
-- from the Stripe Tax result when a real calculation ran, so every existing reader of
-- those two columns (admin, email, order summary) needs no change.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_tax_calculation_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_tax_transaction_id VARCHAR(255);

COMMENT ON COLUMN orders.stripe_tax_calculation_id IS
  'Stripe Tax calculation id the order''s tax/total were quoted from. NULL for mock-mode orders and orders placed before Stripe Tax.';
COMMENT ON COLUMN orders.stripe_tax_transaction_id IS
  'Stripe Tax transaction id recorded on payment success (what counts the sale for filing). NULL until payment succeeds, and always NULL under mock payments.';
