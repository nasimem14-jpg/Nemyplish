// Verificación de la firma de los webhooks de Stripe (HMAC-SHA256 sobre "t.payload"), sin SDK.
const enc = new TextEncoder();

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyStripeSignature(payload, header, secret, opts = {}) {
  const tolerance = opts.tolerance ?? 300;
  const now = opts.now ?? Date.now();
  if (!header || !secret) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > tolerance) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + payload));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => safeEqual(s, hex));
}
