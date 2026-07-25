require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust reverse proxy (Nginx, Render, Cloudflare)
if (IS_PROD) {
  app.set('trust proxy', 1);
}

// Security HTTP Headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://*.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["'self'", "https://js.stripe.com"]
    }
  }
}));

// Gzip Compression
app.use(compression());

// Rate Limiter for Authentication & Payment API Endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many login attempts from this IP, please try again after 15 minutes.'
});

app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/checkout/create-session', apiLimiter);
app.use('/checkout/sandbox-pay', apiLimiter);

// EJS View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static Assets
app.use(express.static(path.join(__dirname, 'public')));

// Persistent SQLite Session Store with better-sqlite3
app.use(session({
  store: new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 15 * 60 * 1000
    }
  }),
  secret: process.env.SESSION_SECRET || 'lootvault_gaming_secret_key_9988',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: IS_PROD,
    sameSite: 'lax'
  }
}));

// Body Parsing Middleware for standard forms/JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Checkout & Payment Routes
const checkoutRoutes = require('./routes/checkout');
app.use('/checkout', checkoutRoutes);

// Pass store settings & user state globally to all EJS templates
app.use((req, res, next) => {
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  settingsRows.forEach(s => settings[s.key] = s.value);
  
  res.locals.settings = settings;
  res.locals.user = req.session.user || null;
  next();
});

// Route Mounts
app.use('/', require('./routes/shop'));
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));

// 404 Handler
app.use((req, res) => {
  res.status(404).render('shop/index', {
    categories: db.prepare('SELECT * FROM categories').all(),
    featuredProducts: [],
    recentProducts: [],
    settings: res.locals.settings,
    user: res.locals.user
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`
  🎮 =================================================== 🎮
  🔥 LootVault Gaming Store is running live!
  🌐 Storefront URL : http://localhost:${PORT}
  🔐 Admin Dashboard: http://localhost:${PORT}/admin
  👑 Admin Login    : admin@example.com / admin123
  🛡️ Production Mode: ${IS_PROD ? 'ENABLED (HTTPS/Proxy)' : 'Development (Local)'}
  🎮 =================================================== 🎮
  `);
});
