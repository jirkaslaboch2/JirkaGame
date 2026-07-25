const express = require('express');
const router = express.Router();
const db = require('../db/database');
const Stripe = require('stripe');

// Helper to get Stripe instance dynamically from DB settings or process.env
function getStripeInstance() {
  const secretKeySetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('stripe_secret_key');
  const secretKey = process.env.STRIPE_SECRET_KEY || (secretKeySetting ? secretKeySetting.value : '');
  if (!secretKey || secretKey.includes('sample_key')) {
    return null;
  }
  return new Stripe(secretKey);
}

// Helper to fulfill order and allocate digital keys from pool
function fulfillOrder(orderId, cartItems, customerEmail, userId) {
  let orderTotal = 0;
  
  const updateKeyStmt = db.prepare(`
    UPDATE product_keys 
    SET is_used = 1, order_id = ?, used_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);

  const updateProdStock = db.prepare(`
    UPDATE products 
    SET stock = (SELECT COUNT(*) FROM product_keys WHERE product_id = products.id AND is_used = 0)
    WHERE id = ?
  `);

  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, price, quantity, key_codes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let item of cartItems) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.id);
    if (!product) continue;

    // Get available keys for this product
    const availableKeys = db.prepare(`
      SELECT * FROM product_keys 
      WHERE product_id = ? AND is_used = 0 
      LIMIT ?
    `).all(product.id, item.quantity);

    const keyCodes = [];
    for (let k of availableKeys) {
      updateKeyStmt.run(orderId, k.id);
      keyCodes.push(k.key_code);
    }

    // If not enough keys in pool, generate emergency backup digital key format
    while (keyCodes.length < item.quantity) {
      const generatedCode = `${product.slug.substring(0, 4).toUpperCase()}-DIGITAL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const res = db.prepare('INSERT INTO product_keys (product_id, key_code, is_used, order_id, used_at) VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)').run(
        product.id,
        generatedCode,
        orderId
      );
      keyCodes.push(generatedCode);
    }

    updateProdStock.run(product.id);

    insertOrderItem.run(
      orderId,
      product.id,
      product.name,
      product.price,
      item.quantity,
      keyCodes.join(', ')
    );
  }

  // Update order status to completed
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);
}

// POST /checkout/create-session - Stripe Checkout Session Endpoint
router.post('/create-session', async (req, res) => {
  try {
    const { items, couponCode, customerEmail } = req.body;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const email = customerEmail || (req.session.user ? req.session.user.email : 'guest@example.com');
    const stripe = getStripeInstance();

    // Calculate coupon discount
    let discountPercent = 0;
    let discountFixed = 0;
    let coupon = null;
    if (couponCode) {
      coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(couponCode.toUpperCase());
      if (coupon && coupon.times_used < coupon.max_uses) {
        discountPercent = coupon.discount_percent || 0;
        discountFixed = coupon.discount_fixed || 0;
      }
    }

    // Calculate totals & build line items
    let subtotal = 0;
    const lineItems = [];
    const dbItems = [];

    for (let item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.id);
      if (!product) continue;

      dbItems.push({ id: product.id, name: product.name, price: product.price, quantity: item.quantity });
      subtotal += product.price * item.quantity;

      if (stripe) {
        let finalPriceCents = Math.round(product.price * 100);
        if (discountPercent > 0) {
          finalPriceCents = Math.round(finalPriceCents * (1 - discountPercent / 100));
        }

        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: product.name,
              description: `Game Item: ${product.rarity} - Instant Digital Key`,
              images: product.image_url ? [product.image_url] : []
            },
            unit_amount: Math.max(finalPriceCents, 50) // Min Stripe charge is 50 cents
          },
          quantity: item.quantity
        });
      }
    }

    let discountAmount = 0;
    if (discountPercent > 0) {
      discountAmount = (subtotal * discountPercent) / 100;
    } else if (discountFixed > 0) {
      discountAmount = Math.min(discountFixed, subtotal);
    }
    const finalTotal = Math.max(0, subtotal - discountAmount);

    // Create pending order record in Database
    const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const userId = req.session.user ? req.session.user.id : null;

    const result = db.prepare(`
      INSERT INTO orders (order_number, user_id, customer_email, total_amount, discount_amount, status, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orderNumber, userId, email, finalTotal, discountAmount, 'pending', 'Stripe');

    const orderId = result.lastInsertRowid;

    if (coupon) {
      db.prepare('UPDATE coupons SET times_used = times_used + 1 WHERE id = ?').run(coupon.id);
    }

    if (!stripe) {
      return res.status(400).json({
        stripeConfigured: false,
        error: 'Stripe API keys are not configured. Please set your Stripe publishable and secret keys in Admin Panel -> Settings.'
      });
    }

    const domain = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: lineItems,
      mode: 'payment',
      success_url: `${domain}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
      cancel_url: `${domain}/cart?canceled=true`,
      metadata: {
        order_id: orderId.toString(),
        order_number: orderNumber
      }
    });

    db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);

    res.json({
      stripeConfigured: true,
      sessionId: session.id,
      url: session.url
    });

  } catch (err) {
    console.error('Stripe Checkout Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /checkout/success - Confirmation page displaying purchased keys!
router.get('/success', (req, res) => {
  const { order_id, session_id } = req.query;

  if (!order_id) {
    return res.redirect('/');
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
  if (!order) {
    return res.redirect('/');
  }

  // If order was Stripe pending, double check or complete
  if (order.status === 'pending' && session_id) {
    const stripe = getStripeInstance();
    if (stripe) {
      stripe.checkout.sessions.retrieve(session_id).then(session => {
        if (session.payment_status === 'paid') {
          // Fulfill if not already done
          const itemsInOrder = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
          if (itemsInOrder.length === 0) {
            // Fulfill keys from session
            db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', order.id);
          }
        }
      }).catch(err => console.error(err));
    }
  }

  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  for (let item of orderItems) {
    item.keysList = item.key_codes ? item.key_codes.split(',').map(k => k.trim()) : [];
  }

  res.render('shop/order-success', {
    order,
    orderItems,
    user: req.session.user || null
  });
});

// POST /checkout/webhook - Stripe Webhook Endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecretSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('stripe_webhook_secret');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || (webhookSecretSetting ? webhookSecretSetting.value : '');

  const stripe = getStripeInstance();

  if (!stripe || !webhookSecret || webhookSecret.includes('sample_key')) {
    return res.status(400).send('Webhook secret or Stripe key not configured.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle checkout session completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata.order_id;

    if (orderId) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order && order.status === 'pending') {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);
        console.log(`✅ Order #${order.order_number} marked completed via Stripe Webhook.`);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
