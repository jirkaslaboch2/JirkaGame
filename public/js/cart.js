// Cart state stored in localStorage
let cart = JSON.parse(localStorage.getItem('lootvault_cart')) || [];
let appliedCoupon = JSON.parse(localStorage.getItem('lootvault_coupon')) || null;

function saveCart() {
  localStorage.setItem('lootvault_cart', JSON.stringify(cart));
  updateCartBadge();
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadgeCount');
  if (badge) {
    const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.innerText = totalCount;
    badge.style.display = totalCount > 0 ? 'inline-block' : 'none';
  }
}

function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: parseFloat(product.price),
      image: product.image_url,
      rarity: product.rarity,
      quantity: 1
    });
  }
  saveCart();
  showToast(`Added "${product.name}" to cart!`);
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
  renderCartPage();
}

function updateQuantity(productId, newQty) {
  const item = cart.find(i => i.id === productId);
  if (item) {
    item.quantity = parseInt(newQty);
    if (item.quantity <= 0) {
      removeFromCart(productId);
    } else {
      saveCart();
      renderCartPage();
    }
  }
}

function clearCart() {
  cart = [];
  appliedCoupon = null;
  localStorage.removeItem('lootvault_cart');
  localStorage.removeItem('lootvault_coupon');
  updateCartBadge();
}

function showToast(msg) {
  let toastEl = document.getElementById('gamingToast');
  if (!toastEl) {
    const container = document.body;
    toastEl = document.createElement('div');
    toastEl.id = 'gamingToast';
    toastEl.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#00f2fe;color:#090c15;padding:12px 20px;border-radius:10px;font-weight:bold;z-index:9999;box-shadow:0 4px 15px rgba(0,242,254,0.4);transition:opacity 0.3s ease;';
    container.appendChild(toastEl);
  }
  toastEl.innerText = msg;
  toastEl.style.opacity = '1';
  setTimeout(() => {
    toastEl.style.opacity = '0';
  }, 2500);
}

// Render Cart Page contents dynamically
function renderCartPage() {
  const cartContainer = document.getElementById('cartItemsList');
  if (!cartContainer) return;

  if (cart.length === 0) {
    cartContainer.innerHTML = `
      <div class="text-center py-5">
        <i class="bi bi-cart-x text-muted" style="font-size: 3.5rem;"></i>
        <h4 class="mt-3 text-muted">Your Shopping Cart is Empty</h4>
        <p class="text-secondary">Browse our catalog and claim epic gaming loot!</p>
        <a href="/catalog" class="btn btn-gaming mt-2">Explore Storefront</a>
      </div>
    `;
    updateSummary(0);
    return;
  }

  let html = '';
  let subtotal = 0;

  cart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;

    html += `
      <div class="card card-gaming mb-3">
        <div class="card-body d-flex flex-column flex-sm-row align-items-center justify-content-between gap-3">
          <div class="d-flex align-items-center gap-3">
            <img src="${item.image}" alt="${item.name}" style="width:70px; height:70px; object-fit:cover; border-radius:8px;">
            <div>
              <h6 class="mb-1 font-weight-bold">${item.name}</h6>
              <div class="badge rarity-${(item.rarity || 'rare').toLowerCase()} mb-1">${item.rarity || 'Item'}</div>
              <div class="text-muted small">$${item.price.toFixed(2)} each</div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-3">
            <div class="input-group input-group-sm" style="width: 110px;">
              <button class="btn btn-outline-gaming" onclick="updateQuantity(${item.id}, ${item.quantity - 1})">-</button>
              <input type="number" class="form-control form-control-dark text-center" value="${item.quantity}" readonly>
              <button class="btn btn-outline-gaming" onclick="updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
            </div>
            <div class="text-end fw-bold text-cyan" style="min-width: 80px;">
              $${itemTotal.toFixed(2)}
            </div>
            <button class="btn btn-sm btn-outline-danger" onclick="removeFromCart(${item.id})">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  });

  cartContainer.innerHTML = html;
  updateSummary(subtotal);
}

function updateSummary(subtotal) {
  const subtotalEl = document.getElementById('cartSubtotal');
  const discountEl = document.getElementById('cartDiscount');
  const totalEl = document.getElementById('cartTotal');
  const couponMsg = document.getElementById('couponMsg');

  let discountAmount = 0;
  if (appliedCoupon && subtotal > 0) {
    if (appliedCoupon.discount_percent > 0) {
      discountAmount = (subtotal * appliedCoupon.discount_percent) / 100;
    } else if (appliedCoupon.discount_fixed > 0) {
      discountAmount = Math.min(appliedCoupon.discount_fixed, subtotal);
    }
  }

  const finalTotal = Math.max(0, subtotal - discountAmount);

  if (subtotalEl) subtotalEl.innerText = `$${subtotal.toFixed(2)}`;
  if (discountEl) discountEl.innerText = `-$${discountAmount.toFixed(2)}`;
  if (totalEl) totalEl.innerText = `$${finalTotal.toFixed(2)}`;
}

// Coupon Form Submit Handler
async function applyCouponCode() {
  const input = document.getElementById('couponInput');
  const msgEl = document.getElementById('couponMsg');
  if (!input || !input.value.trim()) return;

  const code = input.value.trim();

  try {
    const res = await fetch('/api/coupon/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (data.success) {
      appliedCoupon = data;
      localStorage.setItem('lootvault_coupon', JSON.stringify(appliedCoupon));
      msgEl.className = 'small mt-2 text-success';
      msgEl.innerText = data.message;
      renderCartPage();
    } else {
      msgEl.className = 'small mt-2 text-danger';
      msgEl.innerText = data.message;
    }
  } catch (err) {
    console.error(err);
  }
}

// Process Checkout (Stripe or Sandbox Simulator)
async function processCheckout(useSandbox = false) {
  if (cart.length === 0) {
    showToast('Your cart is empty!');
    return;
  }

  const emailInput = document.getElementById('customerEmailInput');
  const customerEmail = emailInput ? emailInput.value.trim() : '';

  const couponCode = appliedCoupon ? appliedCoupon.code : null;

  const payload = {
    items: cart,
    couponCode,
    customerEmail
  };

  const payBtn = document.getElementById(useSandbox ? 'sandboxPayBtn' : 'stripePayBtn');
  if (payBtn) payBtn.disabled = true;

  try {
    if (useSandbox) {
      // Sandbox payment
      const res = await fetch('/checkout/sandbox-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        clearCart();
        window.location.href = data.redirectUrl;
      } else {
        alert('Sandbox Payment Failed: ' + data.error);
        if (payBtn) payBtn.disabled = false;
      }
    } else {
      // Stripe Checkout Session
      const res = await fetch('/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.stripeConfigured && data.url) {
        // Clear local cart before Stripe redirect
        clearCart();
        window.location.href = data.url;
      } else {
        // Stripe keys are sample placeholder keys - open Sandbox confirmation modal
        const modalEl = document.getElementById('sandboxNoticeModal');
        if (modalEl) {
          const modal = new bootstrap.Modal(modalEl);
          modal.show();
        } else {
          alert('Stripe Key is in sample mode. Using Sandbox Payment Simulator instead.');
          processCheckout(true);
        }
        if (payBtn) payBtn.disabled = false;
      }
    }
  } catch (err) {
    console.error('Checkout error:', err);
    alert('An error occurred during checkout.');
    if (payBtn) payBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  renderCartPage();
});
