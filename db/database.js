const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'store.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

function initDatabase() {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      icon TEXT DEFAULT 'bi-controller',
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 0,
      rarity TEXT DEFAULT 'Rare',
      image_url TEXT,
      featured INTEGER DEFAULT 0,
      delivery_type TEXT DEFAULT 'Instant Digital Key',
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      key_code TEXT NOT NULL,
      is_used INTEGER DEFAULT 0,
      order_id INTEGER,
      used_at DATETIME,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      customer_email TEXT NOT NULL,
      total_amount REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      stripe_session_id TEXT,
      payment_method TEXT DEFAULT 'Stripe',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      key_codes TEXT,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_percent REAL DEFAULT 0,
      discount_fixed REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      times_used INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Default Store Settings
  const defaultSettings = [
    ['site_name', 'LootVault Gaming Store'],
    ['currency_symbol', '$'],
    ['stripe_publishable_key', 'pk_test_sample_key_12345'],
    ['stripe_secret_key', 'sk_test_sample_key_12345'],
    ['stripe_webhook_secret', 'whsec_sample_key_12345'],
    ['sandbox_mode', 'true'],
    ['banner_message', '🔥 Summer Sale! Use coupon code GAMER10 for 10% off all digital items!'],
    ['contact_email', 'support@lootvault.gg']
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, val] of defaultSettings) {
    insertSetting.run(key, val);
  }

  // Seed Admin User
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  if (adminCount.count === 0) {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminUsername = process.env.ADMIN_USERNAME || 'AdminGamer';
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);

    db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run(
      adminUsername,
      adminEmail,
      hashedPassword,
      'admin'
    );
  }

  // Seed Categories if empty
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (catCount.count === 0) {
    const categories = [
      { name: 'Counter-Strike 2', slug: 'cs2', icon: 'bi-crosshair', description: 'Weapon Skins, Knife Codes, Prime Passes' },
      { name: 'World of Warcraft', slug: 'wow', icon: 'bi-shield-shaded', description: 'Gold Bundles, Game Time, Rare Mounts' },
      { name: 'Roblox', slug: 'roblox', icon: 'bi-box-seam', description: 'Robux Digital Gift Cards, Limited Items' },
      { name: 'League of Legends', slug: 'lol', icon: 'bi-trophy', description: 'Riot Points Gift Cards & Accounts' },
      { name: 'GTA V / FiveM', slug: 'gta5', icon: 'bi-car-front', description: 'GTA Online Cash Cards, Modded Vehicles' },
      { name: 'Valorant', slug: 'valorant', icon: 'bi-lightning-charge', description: 'Valorant Points (VP) Gift Codes' }
    ];

    const insertCat = db.prepare('INSERT INTO categories (name, slug, icon, description) VALUES (?, ?, ?, ?)');
    categories.forEach(c => insertCat.run(c.name, c.slug, c.icon, c.description));
  }

  // Seed Products if empty
  const prodCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (prodCount.count === 0) {
    const cs2Id = db.prepare('SELECT id FROM categories WHERE slug = ?').get('cs2').id;
    const wowId = db.prepare('SELECT id FROM categories WHERE slug = ?').get('wow').id;
    const robloxId = db.prepare('SELECT id FROM categories WHERE slug = ?').get('roblox').id;
    const lolId = db.prepare('SELECT id FROM categories WHERE slug = ?').get('lol').id;
    const gtaId = db.prepare('SELECT id FROM categories WHERE slug = ?').get('gta5').id;
    const valId = db.prepare('SELECT id FROM categories WHERE slug = ?').get('valorant').id;

    const products = [
      {
        category_id: cs2Id,
        name: 'AWP | Dragon Lore (Factory New)',
        slug: 'awp-dragon-lore-fn',
        description: 'The holy grail of CS2 weapon skins. Insanely rare souvenir sniper skin with float score 0.01.',
        price: 1499.00,
        stock: 5,
        rarity: 'Legendary',
        image_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: cs2Id,
        name: 'Karambit | Fade (StatTrak)',
        slug: 'karambit-fade-stattrak',
        description: 'StatTrak curved blade knife featuring 99% Fade gradient. Instant key redeem code for Steam trade delivery.',
        price: 899.00,
        stock: 8,
        rarity: 'Legendary',
        image_url: 'https://images.unsplash.com/photo-1589241062272-c0a000072dfa?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: wowId,
        name: '1,000,000 WoW Gold (US/EU)',
        slug: '1m-wow-gold',
        description: 'Instant delivery 1 Million Gold code valid for any US or EU Realm. Delivered via secure redeem voucher.',
        price: 49.99,
        stock: 25,
        rarity: 'Rare',
        image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: wowId,
        name: 'Reins of the Swift Spectral Tiger',
        slug: 'swift-spectral-tiger-mount',
        description: 'TCG Exclusive epic ground mount voucher code. Unused card code delivered instantly to inventory.',
        price: 799.00,
        stock: 3,
        rarity: 'Legendary',
        image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: wowId,
        name: '60-Day Game Time Code',
        slug: 'wow-60-day-game-time',
        description: 'Official 60-day subscription card key for World of Warcraft Retail & Classic.',
        price: 29.99,
        stock: 50,
        rarity: 'Common',
        image_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80',
        featured: 0,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: robloxId,
        name: '10,000 Robux Digital Gift Card',
        slug: '10k-robux-gift-card',
        description: 'Instant digital code redeemable for 10,000 Robux in your Roblox account.',
        price: 89.99,
        stock: 30,
        rarity: 'Epic',
        image_url: 'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: robloxId,
        name: '4,500 Robux Digital Gift Card',
        slug: '4.5k-robux-gift-card',
        description: 'Instant digital code redeemable for 4,500 Robux. Works worldwide.',
        price: 44.99,
        stock: 45,
        rarity: 'Rare',
        image_url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=600&q=80',
        featured: 0,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: lolId,
        name: '$50 Riot Points (RP) Gift Card',
        slug: '50-riot-points-card',
        description: 'Redeem code for League of Legends & Teamfight Tactics. Grants ~7,200 RP.',
        price: 47.50,
        stock: 20,
        rarity: 'Rare',
        image_url: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: gtaId,
        name: '$10,000,000 GTA Online Cash Card',
        slug: '10m-gta-cash-card',
        description: 'Meglodon shark card redeem code for GTA V Online (PC/PS5/Xbox Series X).',
        price: 39.99,
        stock: 40,
        rarity: 'Epic',
        image_url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=600&q=80',
        featured: 1,
        delivery_type: 'Instant Digital Key'
      },
      {
        category_id: valId,
        name: '5,350 Valorant Points (VP) Gift Code',
        slug: '5350-valorant-points-code',
        description: 'Unlock premium knife skins and weapon bundles in Valorant instantly.',
        price: 49.99,
        stock: 18,
        rarity: 'Rare',
        image_url: 'https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=600&q=80',
        featured: 0,
        delivery_type: 'Instant Digital Key'
      }
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (category_id, name, slug, description, price, stock, rarity, image_url, featured, delivery_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    products.forEach(p => {
      const res = insertProd.run(p.category_id, p.name, p.slug, p.description, p.price, p.stock, p.rarity, p.image_url, p.featured, p.delivery_type);
      const prodId = res.lastInsertRowid;

      // Seed digital keys for each product
      const insertKey = db.prepare('INSERT INTO product_keys (product_id, key_code) VALUES (?, ?)');
      for (let i = 1; i <= p.stock; i++) {
        const keyPrefix = p.slug.substring(0, 4).toUpperCase();
        const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
                           Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
                           Math.random().toString(36).substring(2, 6).toUpperCase();
        insertKey.run(prodId, `${keyPrefix}-${randomCode}`);
      }
    });
  }

  // Seed Coupons if empty
  const couponCount = db.prepare('SELECT COUNT(*) as count FROM coupons').get();
  if (couponCount.count === 0) {
    const insertCoupon = db.prepare('INSERT INTO coupons (code, discount_percent, discount_fixed, max_uses) VALUES (?, ?, ?, ?)');
    insertCoupon.run('GAMER10', 10, 0, 1000);
    insertCoupon.run('SUMMER20', 0, 20.0, 500);
    insertCoupon.run('VIP50', 50, 0, 50);
  }

  console.log('✅ SQLite Database initialized and seeded successfully.');
}

initDatabase();

module.exports = db;
