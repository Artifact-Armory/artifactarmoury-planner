-- 070_promo_redemption_count_paid_only.sql
-- promo_codes.redemption_count used to be bumped when an order was CREATED, so
-- abandoned checkouts counted as uses. It now means "used on a paid order" and is
-- bumped once the order is paid (services/promoCodes.ts countPaidRedemptions). The
-- redemption limits themselves are now counted live from promo_code_redemptions, so
-- this column is only what the artist sees on /artist/promotions. Recompute it from
-- paid (and since-refunded) orders so existing codes show the right number.

UPDATE promo_codes pc
SET redemption_count = COALESCE((
  SELECT COUNT(*)
  FROM promo_code_redemptions r
  JOIN orders o ON o.id = r.order_id
  WHERE r.promo_code_id = pc.id
    AND o.payment_status IN ('succeeded', 'refunded')
), 0);
