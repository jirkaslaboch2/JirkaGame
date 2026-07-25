# Production Deployment Tutorial Guide 🚀

This step-by-step tutorial guides you through deploying your **LootVault Online Game Item Shop** to production when you are ready to launch live with real payments.

---

## Table of Contents
1. [Pre-Deployment Checklist](#1-pre-deployment-checklist)
2. [Option A: Cloud Platform Deployment (Render.com)](#2-option-a-cloud-platform-deployment-rendercom)
3. [Option B: VPS Deployment (Ubuntu + Nginx + PM2 + SSL)](#3-option-b-vps-deployment-ubuntu--nginx--pm2--ssl)
4. [Stripe Production Webhook Integration](#4-stripe-production-webhook-integration)
5. [Post-Launch Security Best Practices](#5-post-launch-security-best-practices)

---

## 1. Pre-Deployment Checklist

Before deploying, ensure you have gathered the following:

- [ ] **Custom Domain Name** (e.g., `lootvault.gg` or `yourgamestore.com`)
- [ ] **Live Stripe Account** ([Stripe Sign Up](https://dashboard.stripe.com/register))
- [ ] **Stripe Live API Keys** (`pk_live_...` & `sk_live_...`)
- [ ] **Strong Admin Password** (Change default `admin123`!)
- [ ] **Session Secret Key** (A long, random cryptographic string)

---

## 2. Option A: Cloud Platform Deployment (Render.com)

Render provides a simple, managed cloud platform with free/low-cost hosting for Node.js applications and persistent disk volumes.

### Step 1: Push Project to GitHub
1. Initialize git and push your codebase to a private/public GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of LootVault game shop"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/JirkaGame.git
   git push -u origin main
   ```

### Step 2: Create a Web Service on Render
1. Sign in to [Render.com](https://render.com).
2. Click **New +** &rarr; **Web Service**.
3. Connect your GitHub repository `JirkaGame`.
4. Configure service settings:
   - **Name**: `lootvault-shop`
   - **Environment**: `Node`
   - **Region**: Select closest to your primary player base (e.g. Frankfurt, Oregon, Singapore).
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`

### Step 3: Add Environment Variables on Render
Navigate to the **Environment** tab on Render and add the following keys:
| Key | Example Value |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `SESSION_SECRET` | `generate_random_secret_string_here` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_your_live_key_here` |
| `STRIPE_SECRET_KEY` | `sk_live_your_live_key_here` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_your_live_webhook_secret` |

### Step 4: Attach a Persistent Disk (For SQLite Database)
To prevent your database (`store.db`) from resetting when your server restarts:
1. In Render, go to **Disks** &rarr; **Add Disk**.
2. Name: `db-storage`
3. Mount Path: `/opt/render/project/src/db`
4. Size: `1 GB` (or larger depending on transaction volume).

Click **Deploy Web Service**! Render will automatically build and launch your store.

---

## 3. Option B: VPS Deployment (Ubuntu + Nginx + PM2 + SSL)

Deploying on a Virtual Private Server (DigitalOcean Droplet, AWS EC2, Vultr, or Linode) gives you full control, dedicated performance, and low costs ($5–$10/month).

### Step 1: Server Provisioning & SSH Access
1. Create an **Ubuntu 22.04 LTS** droplet/instance.
2. Connect to your server via SSH:
   ```bash
   ssh root@YOUR_SERVER_IP
   ```

### Step 2: Install Node.js & PM2 Process Manager
```bash
# Update Ubuntu package lists
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx build-essential

# Install PM2 globally
sudo npm install -g pm2
```

### Step 3: Clone Codebase & Install Dependencies
```bash
cd /var/www
sudo git clone https://github.com/YOUR_USERNAME/JirkaGame.git
cd JirkaGame

# Install production dependencies
npm install --production

# Create production .env file
nano .env
```
Paste your environment variables:
```env
PORT=3000
NODE_ENV=production
SESSION_SECRET=super_secure_random_key_998877
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Step 4: Start Application with PM2
```bash
# Start Express application in background
pm2 start server.js --name "lootvault-shop"

# Configure PM2 to start automatically on system boot
pm2 startup
pm2 save
```

### Step 5: Configure Nginx as Reverse Proxy
Create an Nginx configuration file for your store domain:
```bash
sudo nano /etc/nginx/sites-available/lootvault
```

Paste the following configuration (replace `yourdomain.com` with your actual domain):
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site configuration & test Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/lootvault /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 6: Secure with Free SSL Certificate (Certbot / Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```
Follow the prompts to enable automatic HTTPS redirection. Your site is now secured with **TLS 1.3 Encryption**!

---

## 4. Stripe Production Webhook Integration

To automatically grant digital keys to customers immediately upon payment confirmation:

1. Log into your [Stripe Dashboard](https://dashboard.stripe.com).
2. Switch mode from **Test** to **Live** (top right toggle).
3. Go to **Developers** &rarr; **Webhooks** &rarr; **Add Endpoint**.
4. Set Endpoint URL to:
   `https://yourdomain.com/checkout/webhook`
5. Select events to send:
   - `checkout.session.completed`
6. Click **Add Endpoint**.
7. Reveal the **Signing secret** (starts with `whsec_...`).
8. Paste this secret into your production `.env` (`STRIPE_WEBHOOK_SECRET=whsec_...`) or in the **Admin Panel &rarr; Settings**!

---

## 5. Post-Launch Security Best Practices

1. **Change Default Admin Password**:
   - Log into `/auth/login` as `admin@example.com`.
   - Update your password or create a dedicated admin user.

2. **Automated SQLite Database Backups**:
   Set up a daily cron job on your VPS to backup `db/store.db`:
   ```bash
   crontab -e
   ```
   Add line to backup daily at 2:00 AM:
   ```cron
   0 2 * * * cp /var/www/JirkaGame/db/store.db /var/backups/store_$(date +\%F).db
   ```

3. **Monitor System Logs**:
   ```bash
   # View live application logs
   pm2 logs lootvault-shop
   ```

You are ready to accept real payments and serve gamers worldwide! 🎮✨
