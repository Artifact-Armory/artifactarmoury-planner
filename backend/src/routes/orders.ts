// backend/src/routes/orders.ts
// Order creation, checkout, and management

import { Router } from 'express';
import { db } from '../db';
import { logger } from '../utils/logger';
import { authenticate, optionalAuth } from '../middleware/auth';
import { paymentRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError, PaymentError } from '../middleware/error';
import { validateEmail, sanitizeInput } from '../utils/validation';
import { createPaymentIntent, confirmPayment } from '../services/stripe';
import { submitPrintJob } from '../services/printFarm';
import { sendEmail } from '../services/email';

const router = Router();

// ============================================================================
// CREATE ORDER (Initialize Checkout)
// ============================================================================

router.post('/',
  optionalAuth,
  paymentRateLimit,
  asyncHandler(async (req, res) => {
    const {
      items, // [{ modelId, quantity, color, material, quality, specialInstructions }]
      shipping,
      customerEmail
    } = req.body;

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Order must contain at least one item');
    }

    if (items.length > 50) {
      throw new ValidationError('Maximum 50 items per order');
    }

    // Validate shipping
    if (!shipping || !shipping.name || !shipping.line1 || !shipping.city || 
        !shipping.postalCode || !shipping.country) {
      throw new ValidationError('Complete shipping address is required');
    }

    // Validate email
    const email = customerEmail || req.user?.email;
    if (!email || !validateEmail(email)) {
      throw new ValidationError('Valid email address is required');
    }

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Fetch model details and calculate totals
      const orderItems = [];
      let subtotal = 0;

      for (const item of items) {
        if (!item.modelId || !item.quantity || item.quantity < 1) {
          throw new ValidationError('Invalid item data');
        }

        // Get model details
        const modelResult = await client.query(
          `SELECT m.*, u.commission_rate, u.stripe_account_id
           FROM models m
           JOIN users u ON m.artist_id = u.id
           WHERE m.id = $1 AND m.status = 'published'`,
          [item.modelId]
        );

        if (modelResult.rows.length === 0) {
          throw new NotFoundError(`Model ${item.modelId}`);
        }

        const model = modelResult.rows[0];

        // Calculate item price
        const unitPrice = parseFloat(model.base_price);
        const quantity = parseInt(item.quantity);
        const totalPrice = unitPrice * quantity;
        subtotal += totalPrice;

        // Calculate artist commission
        const commissionRate = parseFloat(model.commission_rate);
        const commissionAmount = (totalPrice * commissionRate) / 100;

        orderItems.push({
          modelId: model.id,
          artistId: model.artist_id,
          modelName: model.name,
          modelSnapshot: {
            id: model.id,
            name: model.name,
            description: model.description,
            stl_file_path: model.stl_file_path,
            dimensions: {
              width: model.width,
              height: model.height,
              depth: model.depth
            }
          },
          quantity,
          unitPrice,
          totalPrice,
          commissionRate,
          commissionAmount,
          color: item.color || 'Gray',
          material: item.material || 'PLA',
          quality: item.quality || 'standard',
          specialInstructions: item.specialInstructions || null
        });
      }

      // Calculate shipping (simple estimate for now)
      const shippingCost = calculateShipping(orderItems, shipping);

      // Calculate tax (if applicable)
      const tax = 0; // Implement tax calculation based on location

      const total = subtotal + shippingCost + tax;

      // Create order
      const orderResult = await client.query(
        `INSERT INTO orders (
          user_id, customer_email,
          shipping_name, shipping_address_line1, shipping_address_line2,
          shipping_city, shipping_state, shipping_postal_code, shipping_country,
          subtotal, shipping_cost, tax, total,
          payment_method, payment_status, fulfillment_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'stripe', 'pending', 'pending')
        RETURNING id, order_number`,
        [
          req.userId || null,
          email,
          sanitizeInput(shipping.name),
          sanitizeInput(shipping.line1),
          shipping.line2 ? sanitizeInput(shipping.line2) : null,
          sanitizeInput(shipping.city),
          shipping.state ? sanitizeInput(shipping.state) : null,
          sanitizeInput(shipping.postalCode),
          shipping.country,
          subtotal,
          shippingCost,
          tax,
          total
        ]
      );

      const order = orderResult.rows[0];

      // Create order items
      for (const item of orderItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, model_id, artist_id,
            model_name, model_snapshot,
            quantity, unit_price, total_price,
            artist_commission_rate, artist_commission_amount,
            print_color, print_material, print_quality, special_instructions
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            order.id,
            item.modelId,
            item.artistId,
            item.modelName,
            JSON.stringify(item.modelSnapshot),
            item.quantity,
            item.unitPrice,
            item.totalPrice,
            item.commissionRate,
            item.commissionAmount,
            item.color,
            item.material,
            item.quality,
            item.specialInstructions
          ]
        );
      }

      // Create Stripe payment intent
      const paymentIntent = await createPaymentIntent({
        amount: Math.round(total * 100), // Convert to cents
        currency: 'usd',
        orderId: order.id,
        orderNumber: order.order_number,
        customerEmail: email,
        metadata: {
          orderId: order.id,
          orderNumber: order.order_number
        }
      });

      // Store payment intent ID
      await client.query(
        `UPDATE orders SET payment_intent_id = $1 WHERE id = $2`,
        [paymentIntent.id, order.id]
      );

      await client.query('COMMIT');

      logger.info('Order created', { 
        orderId: order.id, 
        orderNumber: order.order_number,
        total 
      });

      res.status(201).json({
        message: 'Order created successfully',
        order: {
          id: order.id,
          orderNumber: order.order_number,
          total,
          clientSecret: paymentIntent.client_secret
        }
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

    // Verify payment with Stripe
    const payment = await confirmPayment(paymentIntentId);

    if (payment.status !== 'succeeded') {
      throw new PaymentError('Payment not completed');
    }

    // Update order status
    await db.query(
      `UPDATE orders 
       SET payment_status = 'succeeded', 
           paid_at = CURRENT_TIMESTAMP,
           fulfillment_status = 'processing'
       WHERE id = $1`,
      [id]
    );

    // Get order items for print submission
    const itemsResult = await db.query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [id]
    );

    // Submit to print farm (async)
    submitPrintJob({
      orderId: order.id,
      orderNumber: order.order_number,
      items: itemsResult.rows.map(item => ({
        itemId: item.id,
        modelName: item.model_name,
        stlFilePath: JSON.parse(item.model_snapshot).stl_file_path,
        quantity: item.quantity,
        color: item.print_color,
        material: item.print_material,
        quality: item.print_quality,
        specialInstructions: item.special_instructions
      })),
      shipping: {
        name: order.shipping_name,
        line1: order.shipping_address_line1,
        line2: order.shipping_address_line2,
        city: order.shipping_city,
        state: order.shipping_state,
        postalCode: order.shipping_postal_code,
        country: order.shipping_country
      },
      priority: 'standard'
    }).then(printJob => {
      // Update order with print job ID
      db.query(
        `UPDATE orders SET print_farm_job_id = $1 WHERE id = $2`,
        [printJob.jobId, id]
      );
      
      logger.info('Print job submitted', { orderId: id, jobId: printJob.jobId });
    }).catch(err => {
      logger.error('Failed to submit print job', { error: err, orderId: id });
    });

    // Send confirmation email
    sendEmail({
      to: order.customer_email,
      subject: `Order Confirmation - ${order.order_number}`,
      template: 'order-confirmation',
      data: {
        orderNumber: order.order_number,
        total: order.total,
        items: itemsResult.rows
      }
    }).catch(err => logger.error('Failed to send confirmation email', { error: err }));

    // Increment model sale counts
    for (const item of itemsResult.rows) {
      db.query(
        'UPDATE models SET sale_count = sale_count + $1 WHERE id = $2',
        [item.quantity, item.model_id]
      ).catch(err => logger.error('Failed to update sale count', { error: err }));
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
    if (!req.userId || (req.userId !== order.user_id && req.user?.role !== 'admin')) {
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
      [req.userId]
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
      [req.userId, Number(limit), offset]
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateShipping(items: any[], destination: any): number {
  // Simple flat rate for now
  // In production, integrate with shipping API
  const baseRate = 5.99;
  const perItemRate = 1.50;
  
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = baseRate + (itemCount * perItemRate);

  // International shipping
  if (destination.country !== 'US') {
    return total * 2;
  }

  return Math.round(total * 100) / 100;
}

export default router;