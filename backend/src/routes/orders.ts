// backend/src/routes/orders.ts
// Order creation, checkout, and management

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, optionalAuth } from '../middleware/auth';
import { paymentRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError, PaymentError } from '../middleware/error';
import { validateEmail } from '../utils/validation';
import {
  createPaymentIntent,
  getPaymentIntent,
  paymentMethodOf,
  type OrderPaymentMethod,
} from '../services/stripe';
import { accrueEarningsForOrder } from '../services/earnings';
import { sendOrderConfirmation } from '../services/email';
import { activeDiscountForModel, activeDiscountForBundle } from '../services/sales';
import { rateFor, vatOnLines, isKnownTaxCountry, DEFAULT_TAX_COUNTRY } from '../services/vat';
import { calculateOrderTax, recordTaxTransaction } from '../services/stripeTax';

const router = Router();

// ============================================================================
// CREATE ORDER (Initialize Checkout)
// ============================================================================

router.post('/',
  optionalAuth,
  paymentRateLimit,
  asyncHandler(async (req, res) => {
    const {
      items, // [{ modelId } | { bundleId }]
      customerEmail,
      // What the buyer picked at checkout ('stripe' = card, or 'paypal'). Advisory:
      // on live Stripe they can still switch method inside the Payment Element, so
      // this is only the opening guess and confirm/webhook overwrite it with the
      // method actually used.
      paymentMethod,
      // ISO country the buyer says they're in — the mock/fallback tax path when no
      // real billing address is supplied (see billingAddress below). Only the code is
      // accepted; the rate itself is always looked up server-side.
      taxCountry: requestedTaxCountry,
      // Real billing address collected at checkout (live Stripe only — see
      // Checkout.tsx's AddressElement). When present this — not taxCountry above —
      // is what tax is actually calculated from, via Stripe Tax: a buyer can no
      // longer change what they're charged by picking a different country in the
      // storefront-wide picker, because that picker no longer feeds the charge.
      billingAddress,
      // Buyer ticked the single checkout checkbox agreeing to the Terms of Service.
      // As of migration 042 that one checkbox covers two distinct things — the
      // per-model licence terms (personal vs. commercial use, no redistribution) AND
      // the immediate-download / 14-day-cancellation-waiver (UK CCRs 2013 reg. 37 /
      // EU CRD art. 16(m)) — the checkbox copy in Checkout.tsx spells out the waiver
      // explicitly rather than relying solely on the linked document, since the
      // regulation requires clear, informed consent to that specific point.
      termsAccepted,
    } = req.body;

    const requestedMethod: OrderPaymentMethod = paymentMethod === 'paypal' ? 'paypal' : 'stripe';

    // An unrecognised code falls back to the default rather than erroring: the picker
    // only ever offers codes from /api/tax/countries, so a bad one means a stale
    // client, and refusing the sale over it would be the wrong trade.
    const taxCountry = isKnownTaxCountry(requestedTaxCountry)
      ? String(requestedTaxCountry).toUpperCase()
      : DEFAULT_TAX_COUNTRY;

    // A real address only ever comes from Stripe's AddressElement, which already
    // constrains `country` to a real ISO alpha-2 — this is just a shape guard against
    // a malformed/tampered request, not a duplicate of that validation.
    const address: { country: string; postalCode?: string } | null =
      billingAddress && typeof billingAddress.country === 'string' && /^[A-Za-z]{2}$/.test(billingAddress.country)
        ? {
            country: billingAddress.country.toUpperCase(),
            postalCode: typeof billingAddress.postalCode === 'string' ? billingAddress.postalCode : undefined,
          }
        : null;

    if (!termsAccepted) {
      throw new ValidationError('Please agree to the Terms of Service before purchasing');
    }

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Order must contain at least one item');
    }
    if (items.length > 50) {
      throw new ValidationError('Maximum 50 items per order');
    }

    // Digital STL sales are tied to an account (that's how download entitlement
    // and buy-once work), so a purchase requires a signed-in user.
    const userId = (req as any).userId;
    if (!userId) { throw new ValidationError('Please sign in to complete your purchase'); }

    // Soft gate: a purchase requires a verified email (download entitlement is
    // tied to the account, so we want a confirmed address before selling).
    if (!(req as any).user?.email_verified) {
      throw new ValidationError('Please verify your email address before purchasing. Check your inbox for the verification link.');
    }

    const email = customerEmail || (req as any).user?.email;
    if (!email) { throw new ValidationError('Valid email address is required'); }
    validateEmail(email);

    const client = await (db as any).getClient?.() ?? await db.connect();

    try {
      await client.query('BEGIN');

      // Each entry becomes one order_items row per model. A bundle expands into
      // one row per constituent model (so per-model download entitlement + the
      // per-buyer watermark path "just work").
      const orderItems: Array<{
        modelId: string; artistId: string; modelName: string; modelSnapshot: any;
        unitPrice: number; commissionRate: number; commissionAmount: number;
        bundleId: string | null; bundleName: string | null;
      }> = [];
      let subtotal = 0;
      // The priced lines exactly as the buyer saw them in the cart — one entry per
      // cart line, so a bundle counts once at its own price even though it expands
      // into several order_items. VAT is charged on these (see vatOnLines).
      const taxableLines: number[] = [];

      const pushModelRow = (model: any, price: number, bundleId: string | null, bundleName: string | null) => {
        const commissionRate = parseFloat(model.commission_rate);
        const commissionAmount = Math.round(price * commissionRate) / 100;
        orderItems.push({
          modelId: model.id,
          artistId: model.artist_id,
          modelName: model.name,
          modelSnapshot: {
            id: model.id,
            name: model.name,
            description: model.description,
            // NB: deliberately no stl_file_path here. The raw R2 key must never be
            // persisted where it could later be echoed to a client (the bucket is
            // public-CDN-served). Downloads resolve the key fresh from the model id.
            dimensions: { width: model.width, height: model.height, depth: model.depth },
          },
          unitPrice: price,
          commissionRate,
          commissionAmount,
          bundleId,
          bundleName,
        });
      };

      for (const item of items) {
        if (item?.bundleId) {
          // --- Bundle: one price, split across its models -------------------
          const bundleResult = await client.query(
            `SELECT id, name, price, artist_id FROM bundles WHERE id = $1 AND status = 'published'`,
            [item.bundleId]
          );
          if (bundleResult.rows.length === 0) throw new NotFoundError(`Bundle ${item.bundleId}`);
          const bundle = bundleResult.rows[0];

          const modelsResult = await client.query(
            `SELECT m.*, u.commission_rate
             FROM bundle_items bi
             JOIN models m ON bi.model_id = m.id
             JOIN users u ON m.artist_id = u.id
             WHERE bi.bundle_id = $1
             ORDER BY bi.display_order ASC`,
            [item.bundleId]
          );
          const bundleModels = modelsResult.rows;
          if (bundleModels.length === 0) throw new ValidationError(`Bundle "${bundle.name}" has no models`);

          // Apply any active sale on the bundle (or the artist's portfolio).
          const bundleDiscount = await activeDiscountForBundle(client, bundle.id, bundle.artist_id);
          const bundlePrice = Math.round(parseFloat(bundle.price) * (100 - bundleDiscount.percent)); // pennies
          const totalBase = bundleModels.reduce((s: number, m: any) => s + parseFloat(m.base_price), 0);
          let allocated = 0;
          bundleModels.forEach((m: any, idx: number) => {
            let sharePence: number;
            if (idx === bundleModels.length - 1) {
              sharePence = bundlePrice - allocated; // last absorbs rounding remainder
            } else if (totalBase > 0) {
              sharePence = Math.round(bundlePrice * (parseFloat(m.base_price) / totalBase));
            } else {
              sharePence = Math.round(bundlePrice / bundleModels.length);
            }
            allocated += sharePence;
            pushModelRow(m, sharePence / 100, bundle.id, bundle.name);
          });
          subtotal += bundlePrice / 100;
          taxableLines.push(bundlePrice / 100);
        } else if (item?.modelId) {
          // --- Single model -------------------------------------------------
          const modelResult = await client.query(
            `SELECT m.*, u.commission_rate
             FROM models m JOIN users u ON m.artist_id = u.id
             WHERE m.id = $1 AND m.status = 'published'`,
            [item.modelId]
          );
          if (modelResult.rows.length === 0) throw new NotFoundError(`Model ${item.modelId}`);
          const model = modelResult.rows[0];
          // Apply any active sale on the model (or the artist's portfolio).
          const modelDiscount = await activeDiscountForModel(client, model.id, model.artist_id);
          const price = Math.round(parseFloat(model.base_price) * (100 - modelDiscount.percent)) / 100;
          pushModelRow(model, price, null, null);
          subtotal += price;
          taxableLines.push(price);
        } else {
          throw new ValidationError('Each item must be a modelId or bundleId');
        }
      }

      // No model may appear twice across the order (e.g. added standalone AND
      // via a bundle, or in two bundles).
      const seen = new Set<string>();
      for (const oi of orderItems) {
        if (seen.has(oi.modelId)) {
          throw new ValidationError(`"${oi.modelName}" appears more than once in your cart (it may be included in a bundle you also added)`);
        }
        seen.add(oi.modelId);
      }

      // Buy-once: fetch what the user already owns among these models.
      const ownedRows = await client.query(
        `SELECT DISTINCT oi.model_id
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.model_id = ANY($1::uuid[]) AND o.user_id = $2 AND o.payment_status = 'succeeded'`,
        [[...seen], userId]
      );
      const ownedIds = new Set<string>(ownedRows.rows.map((r: any) => r.model_id));

      // Reject re-buying a standalone model. For a bundle, only reject if the
      // buyer already owns *every* model in it (otherwise they're buying it for
      // the models they don't yet have).
      const bundlesInOrder = new Map<string, { name: string; total: number; owned: number }>();
      for (const oi of orderItems) {
        if (!oi.bundleId) {
          if (ownedIds.has(oi.modelId)) {
            throw new ValidationError(`You already own "${oi.modelName}" — you only pay once per model`);
          }
        } else {
          const b = bundlesInOrder.get(oi.bundleId) ?? { name: oi.bundleName || 'this bundle', total: 0, owned: 0 };
          b.total += 1;
          if (ownedIds.has(oi.modelId)) b.owned += 1;
          bundlesInOrder.set(oi.bundleId, b);
        }
      }
      for (const b of bundlesInOrder.values()) {
        if (b.total > 0 && b.owned === b.total) {
          throw new ValidationError(`You already own every model in "${b.name}"`);
        }
      }

      // Destination tax. `subtotal` is the NET total (artist prices are net, and
      // order_items.unit_price stays net), so commission and payouts are unaffected —
      // tax sits on top and belongs to the tax authority, not to us or the artist.
      //
      // When a real billing address was collected (live checkout), Stripe Tax
      // computes this authoritatively from it — that address, not the storefront's
      // self-declared country picker, is what determines the charge, which is the
      // whole point: the picker can no longer be gamed for a lower rate because it no
      // longer feeds the amount charged. Per line, then summed either way — matching
      // how the cart displays a gross price per line, so the buyer's basket adds up
      // to exactly this total. A bundle is one priced line even though it expands
      // into several order_items, so it's taxed on the bundle price the buyer was
      // shown, not on the split shares.
      let taxCountryFinal = taxCountry;
      let taxRate: number;
      let tax: number;
      let total: number;
      let stripeTaxCalculationId: string | null = null;
      const shippingCost = 0; // digital — no shipping
      if (address) {
        const taxResult = await calculateOrderTax(
          taxableLines.map((net, i) => ({ amountPence: Math.round(net * 100), reference: `line-${i}` })),
          address
        );
        taxCountryFinal = taxResult.country;
        taxRate = taxResult.ratePercent;
        tax = taxResult.taxPence / 100;
        total = taxResult.totalPence / 100; // Stripe's own subtotal+tax — not recomputed here
        stripeTaxCalculationId = taxResult.calculationId;
      } else {
        // No real address supplied — mock/test checkout, or a client that hasn't
        // been updated to collect one. Falls back to the pre-Stripe-Tax estimate.
        taxRate = rateFor(taxCountry);
        tax = vatOnLines(taxableLines, taxCountry);
        total = Math.round((subtotal + shippingCost + tax) * 100) / 100;
      }

      // Create order (no shipping address for digital STLs). Both terms_accepted_at
      // and download_consent_at are stamped from the one termsAccepted checkbox
      // checked above — its on-screen copy covers both the licence terms and the
      // immediate-download/cancellation-waiver explicitly.
      const orderResult = await client.query(
        `INSERT INTO orders (
          user_id, customer_email,
          subtotal, shipping_cost, tax, total,
          payment_method, payment_status, fulfillment_status,
          tax_country, tax_rate, stripe_tax_calculation_id,
          terms_accepted_at, download_consent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'pending', $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id, order_number`,
        [userId, email, subtotal, shippingCost, tax, total, requestedMethod, taxCountryFinal, taxRate, stripeTaxCalculationId]
      );
      const order = orderResult.rows[0];

      for (const item of orderItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, model_id, artist_id, bundle_id, bundle_name,
            model_name, model_snapshot,
            quantity, unit_price, total_price,
            artist_commission_rate, artist_commission_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8, $9, $10)`,
          [
            order.id,
            item.modelId,
            item.artistId,
            item.bundleId,
            item.bundleName,
            item.modelName,
            JSON.stringify(item.modelSnapshot),
            item.unitPrice,
            item.commissionRate,
            item.commissionAmount,
          ]
        );
      }

      // Mock/real Stripe payment intent. PayPal is accepted through Stripe (same
      // intent, same webhook, same settlement) — see services/stripe.ts.
      const paymentIntent = await createPaymentIntent({
        amount: total,
        currency: 'gbp',
        metadata: {
          order_id: String(order.id),
          order_number: order.order_number,
          customer_email: email,
        },
        description: `Order ${order.order_number}`,
        preferredMethod: requestedMethod,
      });

      await client.query(
        `UPDATE orders SET payment_intent_id = $1 WHERE id = $2`,
        [paymentIntent.payment_intent_id, order.id]
      );

      await client.query('COMMIT');

      logger.info('Order created', {
        orderId: order.id, orderNumber: order.order_number,
        subtotal, tax, total, taxCountry: taxCountryFinal, taxRate, stripeTaxCalculationId,
      });

      res.status(201).json({
        message: 'Order created successfully',
        order: {
          id: order.id,
          orderNumber: order.order_number,
          // The buyer sees gross everywhere, but return the breakdown so checkout can
          // show what the VAT line actually was.
          subtotal,
          tax,
          taxCountry: taxCountryFinal,
          taxRate,
          total,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.payment_intent_id,
        },
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

// ============================================================================
// CONFIRM ORDER (After Payment)
// ============================================================================

router.post('/:id/confirm',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      throw new ValidationError('Payment intent ID is required');
    }

    // Get order
    const orderResult = await db.query(
      `SELECT * FROM orders WHERE id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      throw new NotFoundError('Order');
    }

    const order = orderResult.rows[0];

    // Already confirmed — most likely the Stripe webhook won the race, or the buyer
    // reloaded the PayPal return URL. Report success without re-sending the receipt
    // or double-counting sales. (Redirect methods make this genuinely reachable; the
    // card-only flow never hit it.)
    if (order.payment_status === 'succeeded') {
      return res.json({
        message: 'Order already confirmed',
        order: { id: order.id, orderNumber: order.order_number, status: 'processing' },
      });
    }

    // Verify payment with Stripe
    const payment = await getPaymentIntent(paymentIntentId);

    // Redirect-based methods (PayPal among them) can land back on the site while the
    // payment is still settling. Record the attempt but do NOT mark it paid or unlock
    // any download — the payment_intent.succeeded webhook finishes the job.
    if (payment.status === 'processing') {
      await db.query(
        `UPDATE orders SET payment_status = 'processing', payment_method = $2 WHERE id = $1`,
        [id, paymentMethodOf(payment)]
      );
      return res.json({
        message: 'Payment is still being processed',
        order: { id: order.id, orderNumber: order.order_number, status: 'processing', pending: true },
      });
    }

    if (payment.status !== 'succeeded') {
      throw new PaymentError('Payment not completed');
    }

    // Digital STL orders are fulfilled instantly on payment — the buyer can
    // download straight away (no print farm, no shipping). The method is read off the
    // intent rather than trusted from the client: the buyer may have switched to
    // PayPal inside the Payment Element after this order row was written.
    //
    // `AND payment_status <> 'succeeded'` makes this the atomic claim on the order:
    // whoever updates a row is the one that sends the receipt and counts the sale.
    // The check above catches the ordinary case, but it reads and writes separately,
    // so a webhook landing mid-request could still slip past it.
    const claim = await db.query(
      `UPDATE orders
       SET payment_status = 'succeeded',
           paid_at = CURRENT_TIMESTAMP,
           fulfillment_status = 'delivered',
           payment_method = $2
       WHERE id = $1 AND payment_status <> 'succeeded'`,
      [id, paymentMethodOf(payment)]
    );
    const firstConfirm = (claim.rowCount ?? 0) > 0;

    // Record the sale with Stripe Tax — only the request that actually claimed the
    // order does this, same reasoning as the receipt email below: a reloaded PayPal
    // return page must not try to record it twice. `order_number` is the reference
    // (unique per order), and `recordTaxTransaction` itself no-ops for mock/no
    // calculation, so this is a harmless no-op for every mock-checkout order.
    if (firstConfirm && order.stripe_tax_calculation_id && !order.stripe_tax_transaction_id) {
      const transactionId = await recordTaxTransaction(order.stripe_tax_calculation_id, order.order_number);
      if (transactionId) {
        await db.query('UPDATE orders SET stripe_tax_transaction_id = $1 WHERE id = $2', [transactionId, id]);
      }
    }

    // Accrue the artists' earnings into the ledger (held for the payout hold window,
    // then cleared + paid out by the payout job). Idempotent — safe if the Stripe
    // webhook also fires for this order.
    await accrueEarningsForOrder(id).catch(err =>
      logger.error('Failed to accrue earnings on confirm', { error: err, orderId: id })
    );

    // Get order items (for the confirmation email + sale counts)
    const itemsResult = await db.query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [id]
    );

    // Send confirmation email (digital STL order — no shipping, files ready now).
    // Only the request that actually claimed the order does this, so a reloaded
    // PayPal return page can't send a second receipt or double-count the sale.
    if (firstConfirm) {
      sendOrderConfirmation({
        order: {
          id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          user_email: order.customer_email,
          pricing: { total: Number(order.total) },
        } as any,
        items: itemsResult.rows.map((r: any) => ({
          asset: { name: r.model_name, base_price: Number(r.unit_price) } as any,
          quantity: Number(r.quantity),
          modelId: r.model_id,
        }))
      }).catch(err => logger.error('Failed to send confirmation email', { error: err }));

      // Increment model sale counts
      for (const item of itemsResult.rows) {
        db.query(
          'UPDATE models SET sale_count = sale_count + $1 WHERE id = $2',
          [item.quantity, item.model_id]
        ).catch(err => logger.error('Failed to update sale count', { error: err }));
      }
    }

    logger.info('Order confirmed', { orderId: id, orderNumber: order.order_number });

    res.json({
      message: 'Order confirmed successfully',
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: 'processing'
      }
    });
  })
);

// ============================================================================
// ENTITLEMENTS (which models the signed-in user owns → drives UI gating)
// ============================================================================

router.get('/entitlements',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const models = await db.query(
      `SELECT DISTINCT oi.model_id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.user_id = $1 AND o.payment_status = 'succeeded' AND oi.model_id IS NOT NULL`,
      [userId]
    );
    const bundles = await db.query(
      `SELECT DISTINCT oi.bundle_id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.user_id = $1 AND o.payment_status = 'succeeded' AND oi.bundle_id IS NOT NULL`,
      [userId]
    );
    res.json({
      modelIds: models.rows.map((r: any) => r.model_id),
      bundleIds: bundles.rows.map((r: any) => r.bundle_id),
    });
  })
);

// ============================================================================
// MY LIBRARY (the buyer's purchased models, full detail + their own review)
// ============================================================================

router.get('/library',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const result = await db.query(
      `SELECT m.*,
              u.artist_name, u.artist_bio, u.artist_url,
              MIN(o.created_at) AS purchased_at,
              (SELECT COALESCE(AVG(rr.rating), 0) FROM reviews rr
                 WHERE rr.model_id = m.id AND rr.is_visible = true) AS average_rating,
              (SELECT COUNT(*) FROM reviews rr
                 WHERE rr.model_id = m.id AND rr.is_visible = true) AS review_count,
              rev.id AS my_review_id,
              rev.rating AS my_review_rating,
              rev.title AS my_review_title,
              rev.comment AS my_review_comment
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN models m ON oi.model_id = m.id
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews rev ON rev.model_id = m.id AND rev.user_id = $1
       WHERE o.user_id = $1
         AND o.payment_status = 'succeeded'
         AND oi.model_id IS NOT NULL
       GROUP BY m.id, u.artist_name, u.artist_bio, u.artist_url,
                rev.id, rev.rating, rev.title, rev.comment
       ORDER BY purchased_at DESC`,
      [userId]
    );

    const models = result.rows.map((row: any) => {
      const { my_review_id, my_review_rating, my_review_title, my_review_comment, purchased_at, ...model } = row;
      // SECURITY: never expose raw R2 keys — even to a buyer who owns the model. The
      // bucket is public-CDN-served, so a leaked stl_file_path (the `raw/` key) lets
      // the file be fetched un-watermarked, defeating the per-buyer leak trace. Buyers
      // download through /models/:id/download, which streams it watermarked.
      const hasGlb = !!model.glb_file_path;
      delete model.stl_file_path;
      delete model.glb_file_path;
      delete model.source_file_path;
      return {
        ...model,
        has_glb: hasGlb,
        purchasedAt: purchased_at,
        myReview: my_review_id
          ? {
              id: my_review_id,
              rating: Number(my_review_rating),
              title: my_review_title ?? null,
              comment: my_review_comment ?? null,
            }
          : null,
      };
    });

    res.json({ models });
  })
);

// ============================================================================
// GET ORDER STATUS
// ============================================================================

router.get('/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
        o.*,
        json_agg(
          json_build_object(
            'id', oi.id,
            'modelName', oi.model_name,
            'quantity', oi.quantity,
            'unitPrice', oi.unit_price,
            'totalPrice', oi.total_price,
            'color', oi.print_color,
            'material', oi.print_material,
            'quality', oi.print_quality
          )
        ) as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1
       GROUP BY o.id`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Order');
    }

    const order = result.rows[0];

    // Check permissions
    if (!(req as any).userId || ((req as any).userId !== order.user_id && (req as any).user?.role !== 'admin')) {
      // Allow access with order number + email for guest orders
      const { email } = req.query;
      if (!email || email !== order.customer_email) {
        throw new NotFoundError('Order');
      }
    }

    res.json({
      order
    });
  })
);

// ============================================================================
// GET MY ORDERS
// ============================================================================

router.get('/user/orders',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM orders WHERE user_id = $1`,
      [(req as any).userId]
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get orders with item count
    const result = await db.query(
      `SELECT 
        o.id, o.order_number, o.total,
        o.payment_status, o.fulfillment_status,
        o.tracking_number, o.tracking_url,
        o.created_at, o.paid_at, o.shipped_at,
        COUNT(oi.id) as item_count
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [(req as any).userId, Number(limit), offset]
    );

    res.json({
      orders: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / Number(limit))
      }
    });
  })
);

// ============================================================================
// TRACK ORDER (Public - with order number + email)
// ============================================================================

router.post('/track',
  asyncHandler(async (req, res) => {
    const { orderNumber, email } = req.body;

    if (!orderNumber || !email) {
      throw new ValidationError('Order number and email are required');
    }

    const result = await db.query(
      `SELECT 
        id, order_number, fulfillment_status,
        tracking_number, tracking_url,
        estimated_delivery, created_at, shipped_at
       FROM orders
       WHERE order_number = $1 AND customer_email = $2`,
      [orderNumber, email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Order not found with provided credentials');
    }

    res.json({
      order: result.rows[0]
    });
  })
);

export default router;
