-- Migration 027: print quote / print-on-demand price on models.
--
-- The artist dashboard's Print button asks the outsourced print provider for a
-- cost, then stores the computed customer-facing print price alongside it so the
-- quote persists (and can later drive an "order a print" option on the listing).
-- print_price = print_provider_cost + base_price (artist fee) + £1 site fee.

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS print_provider_cost DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS print_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS print_provider VARCHAR(50),
  ADD COLUMN IF NOT EXISTS print_quoted_at TIMESTAMP;
