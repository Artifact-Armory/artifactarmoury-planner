-- Migration 028: artist consent to third-party manufacturing.
--
-- Before a model can be priced/offered as a physical print, the artist must
-- agree it may be manufactured by a third-party print service. Recorded per
-- model. The artist is still paid the price they set; this only enables buyers
-- without a 3D printer to order a printed copy.

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS print_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_consent_at TIMESTAMP;
