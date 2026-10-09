import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../supabase/functions/nemy/handler.js';
import { makeWebhookHandler } from '../supabase/functions/stripe-webhook/handler.js';
import { makeCheckoutHandler } from '../supabase/functions/create-checkout/handler.js';
import { verifyStripeSignature } from '../supabase/functions/_shared/stripe.js';
import { sanitize, build, extractJson } from '../supabase/functions/_shared/prompts.js';

const USER = { id: 'u1', email: 'a@b.c' };
const STATE = {
  topic: 'Inglés', name: 'Nasim', totalXp: 240,
  mprofile: { level: 'Intermedio', time: '3–5 h por semana', aim: 'Hablar en reuniones' },
  log: [{ goal: 'Aprender 10 palabras', note: 'Las repasé', feedback: 'Bien' }],
  master: { title: 'Inglés profesional', promise: 'p', why: 'w', modules: [1, 2, 3, 4, 5].map((n) => ({ t: 'Módulo ' + n, d: 'd' + n })) }
};

function anthropicJson(text) {
  return async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}
function deps(over = {}) {
  const calls = { anthropic: [], bump: 0 };
  return {
    calls,
    models: { fast: 'fast-model', smart: 'smart-model' },
    getUser: async (t) => (t === 'good' ? USER : null),
    loadState: async () => STATE,
    hasEntitlement: async () => false,
    bumpUsage: async () => { calls.bump++; return true; },
    anthropic: async (p) => { calls.anthropic.push(p); return anthropicJson('{"goal":"Leer 5 minutos"}')(); },
    ...over
  };
}
const req = (body, token = 'good', method = 'POST') =>
  new Request('http://x/nemy', { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });

test('sin sesión devuelve 401 y no llama a Claude', async () => {
  const d = deps();
  const res = await makeHandler(d)(req({ task: 'suggest' }, 'bad'));
  assert.equal(res.status, 401);
  assert.equal(d.calls.anthropic.length, 0);
});

test('tarea desconocida devuelve 400', async () => {
  const res = await makeHandler(deps())(req({ task: 'hack' }));
  assert.equal(res.status, 400);
});

test('suggest devuelve JSON y usa el modelo rápido', async () => {
  const d = deps();
  const res = await makeHandler(d)(req({ task: 'suggest', input: { topic: 'Inglés', history: [] } }));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, { goal: 'Leer 5 minutos' });
  assert.equal(d.calls.anthropic[0].model, 'fast-model');
  assert.equal(d.calls.anthropic[0].stream, false);
});

test('el límite diario devuelve 429 antes de llamar a Claude', async () => {
  const d = deps({ bumpUsage: async () => false });
  const res = await makeHandler(d)(req({ task: 'steps', input: { topic: 'x', goal: 'y' } }));
  assert.equal(res.status, 429);
  assert.equal(d.calls.anthropic.length, 0);
});

test('lección 1 es gratis; la 2 exige haber pagado', async () => {
  const textUp = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Lección' }] }), { status: 200 });
  const free = await makeHandler(deps({ anthropic: textUp }))(req({ task: 'lesson', input: { index: 0 } }));
  assert.equal(free.status, 200);
  const locked = await makeHandler(deps({ anthropic: textUp }))(req({ task: 'lesson', input: { index: 1 } }));
  assert.equal(locked.status, 402);
  const paid = await makeHandler(deps({ anthropic: textUp, hasEntitlement: async () => true }))(req({ task: 'lesson', input: { index: 1 } }));
  assert.equal(paid.status, 200);
  assert.equal((await paid.json()).text, 'Lección');
});

test('la lección usa la masterclass guardada en el servidor, no la enviada', async () => {
  const d = deps({ hasEntitlement: async () => true });
  const evil = { title: 'FALSA', modules: [{ t: 'Gratis total', d: '' }] };
  await makeHandler(d)(req({ task: 'lesson', input: { index: 2, master: evil, topic: 'otra cosa' } }));
  const prompt = d.calls.anthropic[0].messages[0].content;
  assert.match(prompt, /Módulo 3/);
  assert.doesNotMatch(prompt, /FALSA|Gratis total/);
});

test('lección sin masterclass guardada devuelve 409', async () => {
  const res = await makeHandler(deps({ loadState: async () => ({}) }))(req({ task: 'lesson', input: { index: 0 } }));
  assert.equal(res.status, 409);
});

test('streaming convierte el SSE de Anthropic en deltas simples', async () => {
  const sse = [
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Ho"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"la"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ];
  const stream = new ReadableStream({ start(c) { sse.forEach((s) => c.enqueue(new TextEncoder().encode(s))); c.close(); } });
  const d = deps({ anthropic: async (p) => { d.last = p; return new Response(stream, { status: 200 }); } });
  const res = await makeHandler(d)(req({ task: 'chat', stream: true, input: { topic: 't', goal: 'g', messages: [{ role: 'user', content: 'hola' }] } }));
  assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
  const out = await res.text();
  assert.match(out, /"delta":"Ho"/);
  assert.match(out, /"delta":"la"/);
  assert.match(out, /\[DONE\]/);
  assert.equal(d.last.stream, true);
});

test('un fallo de Anthropic devuelve 502 sin filtrar detalles', async () => {
  const d = deps({ anthropic: async () => new Response('secret', { status: 500 }) });
  const res = await makeHandler(d)(req({ task: 'steps', input: { topic: 'x', goal: 'y' } }));
  assert.equal(res.status, 502);
  assert.equal(JSON.stringify(await res.json()).includes('secret'), false);
});

test('sanitize recorta entradas y descarta mensajes mal formados', () => {
  const s = sanitize('chat', { topic: 'x'.repeat(500), messages: [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'y'.repeat(2000) }, { role: 'assistant', content: 'b' }] });
  assert.equal(s.topic.length, 80);
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].content.length, 600);
});

test('extractJson tolera texto y bloques de código alrededor', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Claro: {"a":2} listo'), { a: 2 });
  assert.equal(extractJson('sin json'), null);
});

test('build produce los prompts esperados', () => {
  const s = sanitize('suggest', { topic: 'Guitarra' });
  assert.equal(build('suggest', s).json, true);
  assert.equal(build('chat', sanitize('chat', { topic: 't', messages: [{ role: 'user', content: 'hi' }] })).stream, true);
});

async function sign(payload, secret, t) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload));
  return 't=' + t + ',v1=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('firma de Stripe: válida, alterada y caducada', async () => {
  const now = 1_800_000_000_000;
  const t = String(now / 1000);
  const header = await sign('{"a":1}', 'whsec_x', t);
  assert.equal(await verifyStripeSignature('{"a":1}', header, 'whsec_x', { now }), true);
  assert.equal(await verifyStripeSignature('{"a":2}', header, 'whsec_x', { now }), false);
  assert.equal(await verifyStripeSignature('{"a":1}', header, 'otro', { now }), false);
  assert.equal(await verifyStripeSignature('{"a":1}', header, 'whsec_x', { now: now + 3_600_000 }), false);
  assert.equal(await verifyStripeSignature('{"a":1}', null, 'whsec_x', { now }), false);
});

test('webhook concede la masterclass solo con firma válida y pago completado', async () => {
  const now = 1_800_000_000_000;
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', client_reference_id: 'u1' } } });
  const granted = [];
  const h = makeWebhookHandler({ secret: 'whsec_x', now: () => now, grant: async (u, s) => granted.push([u, s]) });
  const good = await h(new Request('http://x', { method: 'POST', body: event, headers: { 'stripe-signature': await sign(event, 'whsec_x', String(now / 1000)) } }));
  assert.equal(good.status, 200);
  assert.deepEqual(granted, [['u1', 'cs_1']]);
  const bad = await h(new Request('http://x', { method: 'POST', body: event, headers: { 'stripe-signature': 't=1,v1=00' } }));
  assert.equal(bad.status, 400);
  const unpaid = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'unpaid', client_reference_id: 'u1' } } });
  await h(new Request('http://x', { method: 'POST', body: unpaid, headers: { 'stripe-signature': await sign(unpaid, 'whsec_x', String(now / 1000)) } }));
  assert.equal(granted.length, 1);
});

test('checkout crea la sesión con el usuario y no cobra dos veces', async () => {
  let form;
  const h = makeCheckoutHandler({
    priceId: 'price_1', siteUrl: 'https://app.example', getUser: async (t) => (t === 'good' ? USER : null), hasEntitlement: async () => false,
    stripe: async (f) => { form = f; return new Response(JSON.stringify({ url: 'https://stripe.test/pay' }), { status: 200 }); }
  });
  const res = await h(req({}));
  assert.equal((await res.json()).url, 'https://stripe.test/pay');
  assert.equal(form.get('client_reference_id'), 'u1');
  assert.equal(form.get('line_items[0][price]'), 'price_1');
  assert.equal(form.get('success_url'), 'https://app.example?paid=1');
  const again = makeCheckoutHandler({ priceId: 'p', siteUrl: 's', getUser: async () => USER, hasEntitlement: async () => true, stripe: async () => { throw new Error('no'); } });
  assert.equal((await (await again(req({}))).json()).already, true);
  const anon = await h(req({}, 'bad'));
  assert.equal(anon.status, 401);
});
