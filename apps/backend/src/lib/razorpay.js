import crypto from 'crypto';

const API_BASE = 'https://api.razorpay.com/v1';

function authHeader() {
  const token = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

// Creates a Razorpay order for the Wallet "Add Money" flow. The mobile app
// opens Razorpay Checkout with this order_id; Checkout itself presents
// UPI/card/netbanking/payment-link as payment method tabs, so nothing here
// is method-specific.
export async function createRazorpayOrder({ amount, receipt }) {
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.description || `Razorpay order creation failed: ${res.status}`);
  return payload;
}

// Verifies the HMAC-SHA256 signature Razorpay sends on both the client-side
// checkout success callback and the server-side webhook — same algorithm,
// different secret (payment link/checkout signs with key_secret, the
// webhook signs with its own dedicated webhook secret).
export function verifySignature(body, signature, secret) {
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(body).digest('hex'));
  const actual = Buffer.from(signature || '');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
