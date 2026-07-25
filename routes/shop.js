const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET / - Homepage
router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories').all();
  const featuredProducts = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.featured = 1 
    ORDER BY p.id DESC LIMIT 8
  `).all();
  
  const recentProducts = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    ORDER BY p.id DESC LIMIT 6
  `).all();

  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  settingsRows.forEach(s => settings[s.key] = s.value);

  res.render('shop/index', {
    categories,
    featuredProducts,
    recentProducts,
    settings,
    user: req.session.user || null
  });
});

// GET /catalog - Catalog page with filters & search
router.get('/catalog', (req, res) => {
  const { category, search, rarity, sort } = req.query;

  let query = `
    SELECT p.*, c.name as category_name, c.slug as category_slug 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE 1=1
  `;
  const params = [];

  if (category) {
    query += ` AND c.slug = ?`;
    params.push(category);
  }

  if (rarity) {
    query += ` AND p.rarity = ?`;
    params.push(rarity);
  }

  if (search) {
    query += ` AND (p.name LIKE ? OR p.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  if (sort === 'price-low') {
    query += ` ORDER BY p.price ASC`;
  } else if (sort === 'price-high') {
    query += ` ORDER BY p.price DESC`;
  } else if (sort === 'name') {
    query += ` ORDER BY p.name ASC`;
  } else {
    query += ` ORDER BY p.id DESC`;
  }

  const products = db.prepare(query).all(...params);
  const categories = db.prepare('SELECT * FROM categories').all();

  res.render('shop/catalog', {
    products,
    categories,
    selectedCategory: category || '',
    selectedRarity: rarity || '',
    searchQuery: search || '',
    selectedSort: sort || '',
    user: req.session.user || null
  });
});

// GET /product/:slug - Detailed view
router.get('/product/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.slug = ?
  `).get(req.params.slug);

  if (!product) {
    return res.status(404).render('404', { message: 'Product not found' });
  }

  // Count active unused keys in database pool for real-time stock
  const activeKeysCount = db.prepare('SELECT COUNT(*) as count FROM product_keys WHERE product_id = ? AND is_used = 0').get(product.id).count;
  product.stock = activeKeysCount;

  const relatedProducts = db.prepare(`
    SELECT p.*, c.name as category_name 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.category_id = ? AND p.id != ? 
    LIMIT 4
  `).all(product.category_id, product.id);

  res.render('shop/product', {
    product,
    relatedProducts,
    user: req.session.user || null
  });
});

// GET /cart - Shopping Cart Page
router.get('/cart', (req, res) => {
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  settingsRows.forEach(s => settings[s.key] = s.value);

  res.render('shop/cart', {
    settings,
    user: req.session.user || null
  });
});

// POST /api/coupon/validate - Check coupon discount
router.post('/api/coupon/validate', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.json({ success: false, message: 'Please enter a coupon code.' });
  }

  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(code.trim().toUpperCase());

  if (!coupon) {
    return res.json({ success: false, message: 'Invalid or expired coupon code.' });
  }

  if (coupon.times_used >= coupon.max_uses) {
    return res.json({ success: false, message: 'This coupon has reached its maximum usage limit.' });
  }

  res.json({
    success: true,
    code: coupon.code,
    discount_percent: coupon.discount_percent,
    discount_fixed: coupon.discount_fixed,
    message: coupon.discount_percent > 0 ? `${coupon.discount_percent}% off applied!` : `$${coupon.discount_fixed.toFixed(2)} off applied!`
  });
});

module.exports = router;
