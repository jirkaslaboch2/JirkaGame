const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('user/login', { error: null, success: req.query.registered ? 'Registration successful! Please login.' : null });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { email, password, remember } = req.body;
  
  if (!email || !password) {
    return res.render('user/login', { error: 'Please enter both email and password.', success: null });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('user/login', { error: 'Invalid email or password.', success: null });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  };

  if (remember) {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  } else {
    req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 1 day
  }

  if (user.role === 'admin') {
    return res.redirect('/admin');
  }

  res.redirect(req.query.redirect || '/user/inventory');
});

// GET /auth/register
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('user/register', { error: null });
});

// POST /auth/register
router.post('/register', (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password) {
    return res.render('user/register', { error: 'All fields are required.' });
  }

  if (password !== confirmPassword) {
    return res.render('user/register', { error: 'Passwords do not match.' });
  }

  if (password.length < 6) {
    return res.render('user/register', { error: 'Password must be at least 6 characters long.' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existingUser) {
    return res.render('user/register', { error: 'Email address is already registered.' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  
  const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run(
    username.trim(),
    email.trim().toLowerCase(),
    hashedPassword,
    'user'
  );

  req.session.user = {
    id: result.lastInsertRowid,
    username: username.trim(),
    email: email.trim().toLowerCase(),
    role: 'user'
  };

  res.redirect('/user/inventory');
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// GET /user/inventory - Protected User Inventory Vault
router.get('/user/inventory', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/auth/login?redirect=/user/inventory');
  }

  const userId = req.session.user.id;
  const userEmail = req.session.user.email ? req.session.user.email.toLowerCase() : '';
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? OR LOWER(customer_email) = ? ORDER BY created_at DESC').all(userId, userEmail);

  // Fetch items and digital keys for each order
  for (let order of orders) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    for (let item of items) {
      if (item.key_codes) {
        item.keysList = item.key_codes.split(',').map(k => k.trim()).filter(Boolean);
      } else {
        item.keysList = [];
      }
    }
    order.items = items;
  }

  res.render('user/inventory', {
    user: req.session.user,
    orders
  });
});

module.exports = router;
