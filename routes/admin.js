const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Middleware to ensure user is logged in as Admin
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/auth/login?error=Admin+access+required');
  }
  next();
}

// Protect all admin routes
router.use(requireAdmin);

// GET /admin - Analytics Dashboard
router.get('/', (req, res) => {
  const totalRevenue = db.prepare(`SELECT SUM(total_amount) as total FROM orders WHERE status = 'completed'`).get().total || 0;
  const totalOrders = db.prepare(`SELECT COUNT(*) as count FROM orders`).get().count || 0;
  const totalProducts = db.prepare(`SELECT COUNT(*) as count FROM products`).get().count || 0;
  const activeKeys = db.prepare(`SELECT COUNT(*) as count FROM product_keys WHERE is_used = 0`).get().count || 0;

  const recentOrders = db.prepare(`
    SELECT o.*, u.username 
    FROM orders o 
    LEFT JOIN users u ON o.user_id = u.id 
    ORDER BY o.created_at DESC LIMIT 6
  `).all();

  const lowStockProducts = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM product_keys WHERE product_id = p.id AND is_used = 0) as key_count 
    FROM products p 
    ORDER BY key_count ASC LIMIT 5
  `).all();

  // Category distribution for Chart.js
  const categoryStats = db.prepare(`
    SELECT c.name, COUNT(p.id) as product_count 
    FROM categories c 
    LEFT JOIN products p ON p.category_id = c.id 
    GROUP BY c.id
  `).all();

  res.render('admin/dashboard', {
    user: req.session.user,
    totalRevenue,
    totalOrders,
    totalProducts,
    activeKeys,
    recentOrders,
    lowStockProducts,
    categoryStats
  });
});

// GET /admin/products - List all products
router.get('/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name as category_name,
    (SELECT COUNT(*) FROM product_keys WHERE product_id = p.id AND is_used = 0) as active_keys
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    ORDER BY p.id DESC
  `).all();

  res.render('admin/products', {
    user: req.session.user,
    products,
    success: req.query.success || null
  });
});

// GET /admin/products/new - New Product Form
router.get('/products/new', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories').all();
  res.render('admin/product-form', {
    user: req.session.user,
    categories,
    product: null,
    error: null
  });
});

// POST /admin/products/new - Create Product
router.post('/products/new', (req, res) => {
  const { name, category_id, price, rarity, description, image_url, featured, initial_keys } = req.body;

  if (!name || !price || !category_id) {
    const categories = db.prepare('SELECT * FROM categories').all();
    return res.render('admin/product-form', {
      user: req.session.user,
      categories,
      product: req.body,
      error: 'Name, Category, and Price are required.'
    });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + '-' + Math.floor(Math.random() * 1000);

  const result = db.prepare(`
    INSERT INTO products (category_id, name, slug, description, price, stock, rarity, image_url, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    category_id,
    name.trim(),
    slug,
    description ? description.trim() : '',
    parseFloat(price),
    0,
    rarity || 'Rare',
    image_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
    featured ? 1 : 0
  );

  const productId = result.lastInsertRowid;

  // Insert initial keys if provided (multiline input)
  if (initial_keys && initial_keys.trim()) {
    const keyLines = initial_keys.split('\n').map(k => k.trim()).filter(Boolean);
    const insertKey = db.prepare('INSERT INTO product_keys (product_id, key_code) VALUES (?, ?)');
    for (let k of keyLines) {
      insertKey.run(productId, k);
    }
    const count = db.prepare('SELECT COUNT(*) as count FROM product_keys WHERE product_id = ? AND is_used = 0').get(productId).count;
    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(count, productId);
  }

  res.redirect('/admin/products?success=Product+created+successfully');
});

// GET /admin/products/edit/:id - Edit Product Form
router.get('/products/edit/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    return res.redirect('/admin/products');
  }
  const categories = db.prepare('SELECT * FROM categories').all();
  res.render('admin/product-form', {
    user: req.session.user,
    categories,
    product,
    error: null
  });
});

// POST /admin/products/edit/:id - Update Product
router.post('/products/edit/:id', (req, res) => {
  const { name, category_id, price, rarity, description, image_url, featured } = req.body;
  const productId = req.params.id;

  db.prepare(`
    UPDATE products 
    SET category_id = ?, name = ?, description = ?, price = ?, rarity = ?, image_url = ?, featured = ?
    WHERE id = ?
  `).run(
    category_id,
    name.trim(),
    description ? description.trim() : '',
    parseFloat(price),
    rarity || 'Rare',
    image_url || '',
    featured ? 1 : 0,
    productId
  );

  res.redirect('/admin/products?success=Product+updated+successfully');
});

// POST /admin/products/delete/:id - Delete Product
router.post('/products/delete/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.redirect('/admin/products?success=Product+deleted');
});

// GET /admin/categories - Category Management
router.get('/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count 
    FROM categories c
  `).all();

  res.render('admin/categories', {
    user: req.session.user,
    categories,
    success: req.query.success || null,
    error: null
  });
});

// POST /admin/categories - Add Category
router.post('/categories', (req, res) => {
  const { name, icon, description } = req.body;
  if (!name) {
    return res.redirect('/admin/categories');
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

  try {
    db.prepare('INSERT INTO categories (name, slug, icon, description) VALUES (?, ?, ?, ?)').run(
      name.trim(),
      slug,
      icon || 'bi-controller',
      description ? description.trim() : ''
    );
    res.redirect('/admin/categories?success=Category+added');
  } catch (err) {
    res.redirect('/admin/categories?error=Category+slug+already+exists');
  }
});

// POST /admin/categories/delete/:id - Delete Category
router.post('/categories/delete/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories?success=Category+deleted');
});

// GET /admin/keys - Digital Key Pool Manager
router.get('/keys', (req, res) => {
  const products = db.prepare('SELECT id, name FROM products ORDER BY name ASC').all();
  const selectedProductId = req.query.product_id || (products.length > 0 ? products[0].id : null);

  let keys = [];
  if (selectedProductId) {
    keys = db.prepare(`
      SELECT k.*, p.name as product_name 
      FROM product_keys k 
      JOIN products p ON k.product_id = p.id 
      WHERE k.product_id = ? 
      ORDER BY k.is_used ASC, k.id DESC
    `).all(selectedProductId);
  }

  res.render('admin/keys', {
    user: req.session.user,
    products,
    selectedProductId,
    keys,
    success: req.query.success || null
  });
});

// POST /admin/keys/add - Batch upload digital keys
router.post('/keys/add', (req, res) => {
  const { product_id, key_codes } = req.body;
  if (!product_id || !key_codes) {
    return res.redirect('/admin/keys');
  }

  const lines = key_codes.split('\n').map(k => k.trim()).filter(Boolean);
  const insertKey = db.prepare('INSERT INTO product_keys (product_id, key_code) VALUES (?, ?)');
  
  for (let k of lines) {
    insertKey.run(product_id, k);
  }

  // Update product stock count
  const count = db.prepare('SELECT COUNT(*) as count FROM product_keys WHERE product_id = ? AND is_used = 0').get(product_id).count;
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(count, product_id);

  res.redirect(`/admin/keys?product_id=${product_id}&success=${lines.length}+keys+added+successfully`);
});

// POST /admin/keys/delete/:id - Delete a key
router.post('/admin/keys/delete/:id', (req, res) => {
  const keyObj = db.prepare('SELECT product_id FROM product_keys WHERE id = ?').get(req.params.id);
  if (keyObj) {
    db.prepare('DELETE FROM product_keys WHERE id = ?').run(req.params.id);
    const count = db.prepare('SELECT COUNT(*) as count FROM product_keys WHERE product_id = ? AND is_used = 0').get(keyObj.product_id).count;
    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(count, keyObj.product_id);
    return res.redirect(`/admin/keys?product_id=${keyObj.product_id}&success=Key+deleted`);
  }
  res.redirect('/admin/keys');
});

// GET /admin/orders - Manage Customer Orders
router.get('/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, u.username 
    FROM orders o 
    LEFT JOIN users u ON o.user_id = u.id 
    ORDER BY o.created_at DESC
  `).all();

  for (let order of orders) {
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  }

  res.render('admin/orders', {
    user: req.session.user,
    orders,
    success: req.query.success || null
  });
});

// POST /admin/orders/status/:id - Change Order Status
router.post('/orders/status/:id', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.redirect('/admin/orders?success=Order+status+updated');
});

// GET /admin/coupons - Manage Coupon & Promo Codes
router.get('/coupons', (req, res) => {
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
  res.render('admin/coupons', {
    user: req.session.user,
    coupons,
    success: req.query.success || null,
    error: null
  });
});

// POST /admin/coupons - Create Coupon Code
router.post('/coupons', (req, res) => {
  const { code, discount_percent, discount_fixed, max_uses } = req.body;
  if (!code) {
    return res.redirect('/admin/coupons');
  }

  try {
    db.prepare(`
      INSERT INTO coupons (code, discount_percent, discount_fixed, max_uses)
      VALUES (?, ?, ?, ?)
    `).run(
      code.trim().toUpperCase(),
      parseFloat(discount_percent || 0),
      parseFloat(discount_fixed || 0),
      parseInt(max_uses || 100)
    );
    res.redirect('/admin/coupons?success=Coupon+created');
  } catch (err) {
    res.redirect('/admin/coupons?error=Coupon+code+already+exists');
  }
});

// POST /admin/coupons/toggle/:id - Toggle coupon active state
router.post('/coupons/toggle/:id', (req, res) => {
  const coupon = db.prepare('SELECT active FROM coupons WHERE id = ?').get(req.params.id);
  if (coupon) {
    const newActive = coupon.active ? 0 : 1;
    db.prepare('UPDATE coupons SET active = ? WHERE id = ?').run(newActive, req.params.id);
  }
  res.redirect('/admin/coupons');
});

// POST /admin/coupons/delete/:id - Delete coupon
router.post('/coupons/delete/:id', (req, res) => {
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.redirect('/admin/coupons?success=Coupon+deleted');
});

// GET /admin/settings - Store Configuration Page
router.get('/settings', (req, res) => {
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  settingsRows.forEach(s => settings[s.key] = s.value);

  res.render('admin/settings', {
    user: req.session.user,
    settings,
    success: req.query.success || null
  });
});

// POST /admin/settings - Save Store Configuration
router.post('/settings', (req, res) => {
  const keys = ['site_name', 'currency_symbol', 'stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret', 'sandbox_mode', 'banner_message', 'contact_email'];
  
  const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  for (let key of keys) {
    const val = req.body[key] !== undefined ? req.body[key].trim() : '';
    updateStmt.run(key, val);
  }

  res.redirect('/admin/settings?success=Settings+updated+successfully');
});

module.exports = router;
