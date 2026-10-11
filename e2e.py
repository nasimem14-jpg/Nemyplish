"""Pruebas de extremo a extremo del frontend con Chromium: modo demo (Claude simulado) y modo backend (Supabase simulado).
Requisitos: playwright para Python y dist/index.html generado con
  SUPABASE_URL=http://sb.test SUPABASE_ANON_KEY=anon-key npm run build:web
"""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = (ROOT / 'dist/index.html').read_text()
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tests/out'
OUT.mkdir(parents=True, exist_ok=True)

MODULES = [{'t': 'Módulo %d' % n, 'd': 'Descripción %d' % n} for n in range(1, 6)]

DEMO_STUB = """
window.claude = { use: async (n) => {
  if (n !== 'sample') return null;
  const f = async (input, opts = {}) => {
    const text = 'Primer párrafo de la lección.\\n\\nEjercicio: haz algo durante 20 minutos.';
    if (opts.onText) opts.onText({ text, delta: text });
    return { text, truncated: false };
  };
  f.json = async (input) => {
    const s = input.map(t => t.content).join('\\n');
    window.__lastPrompt = s;
    if (s.includes('"xp"')) return { xp: 80, feedback: 'Bien hecho.', lesson: { title: 'Lección X', body: 'Cuerpo de la lección.' } };
    if (s.includes('"modules"')) return { title: 'Inglés profesional', promise: 'Podrás defender una idea en una reunión.', why: 'Parte de tu objetivo de aprender 10 palabras.', modules: %s };
    if (s.includes('"steps"')) return { steps: ['Paso A', 'Paso B', 'Paso C'] };
    if (s.includes('"goal"')) return { goal: 'Aprender 10 palabras' };
    return {};
  };
  return f;
} };
""" % json.dumps(MODULES)

SB_STUB = """
window.supabase = { createClient: () => {
  const q = (table) => ({
    select() { return this; }, eq() { return this; },
    limit() { return Promise.resolve({ data: table === 'entitlements' ? (window.__ent || []) : [] }); },
    maybeSingle() { return Promise.resolve({ data: window.__row ? { state: window.__row } : null }); },
    upsert(v) { window.__row = v.state; window.__saves = (window.__saves || 0) + 1; return Promise.resolve({ error: null }); }
  });
  return { auth: {
    getSession: async () => ({ data: { session: window.__session || null } }),
    onAuthStateChange(cb) { window.__authCb = cb; return { data: { subscription: {} } }; },
    signInWithOtp: async (o) => { window.__otp = o; return { error: null }; },
    signOut: async () => { window.__authCb && window.__authCb('SIGNED_OUT', null); }
  }, from: (t) => q(t) };
} };
"""

CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'FAIL ') + name)


async def demo(b):
    ctx = await b.new_context(viewport={'width': 400, 'height': 800})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.add_init_script(DEMO_STUB)
    await pg.goto('about:blank')
    await pg.route('http://app.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body=HTML))
    await pg.goto('http://app.test/')
    await pg.fill('#f-topic', 'Inglés'); await pg.click('[data-act=topic]')
    await pg.click('[data-act=suggest]')
    await pg.wait_for_function("document.getElementById('f-goal').value === 'Aprender 10 palabras'")
    await pg.click('[data-act=start]')
    await pg.wait_for_selector('[data-step]')
    check('demo: 3 pasos generados', await pg.locator('[data-step]').count() == 3)
    await pg.screenshot(path=str(OUT / 'demo-1-nivel.png'))
    await pg.click('[data-step="0"]')
    await pg.click('[data-act=toggle]'); await pg.fill('#f-note', 'Aprendí diez palabras nuevas y las usé en frases.')
    await pg.click('[data-act=submit]')
    await pg.wait_for_selector('.gain')
    await pg.wait_for_function("document.querySelector('.gain').textContent.trim() === '+80'", timeout=5000)
    check('demo: XP concedidos', '+80' in await pg.inner_text('.gain'))
    await pg.screenshot(path=str(OUT / 'demo-2-recompensa.png'))
    await pg.click('.link[data-act=finish]')
    await pg.fill('#f-aim', 'Defender una idea en reuniones'); await pg.click('[data-act=design]')
    await pg.wait_for_selector('.mods')
    check('demo: masterclass diseñada con 5 módulos', await pg.locator('.mod').count() == 5)
    check('demo: el prompt de diseño incluye el historial', 'Aprendí diez palabras' in await pg.evaluate('window.__lastPrompt'))
    await pg.click('[data-act=lesson][data-i="0"]')
    await pg.wait_for_selector('.reading p')
    check('demo: lección de muestra gratuita', await pg.locator('.reading p').count() >= 1)
    check('demo: módulo 2 bloqueado antes de pagar', await pg.locator('[data-act=lesson][data-i="1"]').count() == 0)
    await pg.click('[data-act=buy]')
    await pg.click('[data-act=lesson][data-i="1"]')
    await pg.wait_for_selector('.mod:nth-child(2) .reading p')
    check('demo: módulo 2 se desbloquea tras comprar', True)
    await pg.screenshot(path=str(OUT / 'demo-3-masterclass.png'), full_page=True)
    await pg.click('[data-tab=me]'); await pg.fill('#f-name', 'Nasim')
    await pg.screenshot(path=str(OUT / 'demo-4-personal.png'))
    await pg.click('[data-tab=settings]'); await pg.click('[data-k=theme][data-v=dark]')
    await pg.screenshot(path=str(OUT / 'demo-5-ajustes-oscuro.png'))
    await pg.click('[data-tab=learn]')
    await pg.screenshot(path=str(OUT / 'demo-6-final-oscuro.png'))
    over = await pg.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 0.5 && getComputedStyle(e).position !== 'fixed').slice(0, 6).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))""")
    check('demo: sin desbordamiento horizontal', not await pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
    if over: print('  desbordan:', over)
    check('demo: sin errores de página', not errs)
    if errs: print(errs)
    await ctx.close()


async def backend(b):
    # 1) sin sesión: pantalla de acceso y envío del enlace
    ctx = await b.new_context(viewport={'width': 400, 'height': 800})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.route('http://app.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body=HTML))
    await pg.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=SB_STUB))
    await pg.goto('http://app.test/')
    await pg.wait_for_selector('#f-email')
    check('backend: sin sesión muestra el acceso por correo', True)
    await pg.screenshot(path=str(OUT / 'backend-1-acceso.png'))
    await pg.fill('#f-email', 'nasim@example.com'); await pg.click('[data-act=login]')
    await pg.wait_for_selector('.notice')
    otp = await pg.evaluate('window.__otp')
    check('backend: pide el enlace al correo escrito', otp and otp['email'] == 'nasim@example.com')
    await ctx.close()

    # 2) con sesión: recorrido, guardado y pago
    ctx = await b.new_context(viewport={'width': 400, 'height': 800})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    seen = {'auth': [], 'lesson_stream': False}
    state = {'ent': False}

    async def fn(route):
        req = route.request
        if req.method == 'OPTIONS':
            return await route.fulfill(status=204, headers=CORS)
        body = json.loads(req.post_data or '{}')
        seen['auth'].append(req.headers.get('authorization'))
        task = body.get('task')
        if req.url.endswith('/create-checkout'):
            return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps({'url': 'http://pay.test/checkout'}))
        if task == 'lesson':
            seen['lesson_stream'] = body.get('stream') is True
            sse = 'data: {"delta":"Hola "}\n\ndata: {"delta":"desde el servidor."}\n\ndata: [DONE]\n\n'
            return await route.fulfill(status=200, headers=CORS, content_type='text/event-stream', body=sse)
        data = {
            'suggest': {'goal': 'Leer 5 minutos'}, 'steps': {'steps': ['A', 'B', 'C']},
            'evaluate': {'xp': 70, 'feedback': 'Correcto.', 'lesson': {'title': 'L', 'body': 'B'}},
            'design_master': {'title': 'Master', 'promise': 'P', 'why': 'W', 'modules': MODULES}
        }[task]
        await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps({'data': data}))

    await pg.route('http://sb.test/functions/v1/**', fn)
    await pg.route('http://pay.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<h1>pago</h1>'))
    await pg.route('http://app.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body=HTML))
    await pg.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=SB_STUB))
    await pg.add_init_script("window.__session = { access_token: 'tok', user: { id: 'u1', email: 'a@b.c' } };")
    await pg.goto('http://app.test/')
    await pg.wait_for_selector('#f-topic')
    await pg.fill('#f-topic', 'Guitarra'); await pg.click('[data-act=topic]')
    await pg.click('[data-act=suggest]')
    await pg.wait_for_function("document.getElementById('f-goal').value === 'Leer 5 minutos'")
    await pg.click('[data-act=start]'); await pg.wait_for_selector('[data-step]')
    await pg.click('[data-act=toggle]'); await pg.fill('#f-note', 'Practiqué el acorde de Do durante diez minutos.')
    await pg.click('[data-act=submit]'); await pg.wait_for_selector('.gain')
    await pg.click('.link[data-act=finish]')
    await pg.fill('#f-aim', 'Tocar tres canciones sencillas'); await pg.click('[data-act=design]')
    await pg.wait_for_selector('.mods')
    await pg.wait_for_timeout(900)
    saved = await pg.evaluate('window.__row')
    check('backend: el estado se guarda en la base de datos', saved and saved.get('master') and saved['topic'] == 'Guitarra')
    check('backend: las llamadas llevan el token de la sesión', seen['auth'] and all(a == 'Bearer tok' for a in seen['auth']))
    await pg.click('[data-act=lesson][data-i="0"]')
    await pg.wait_for_function("document.querySelector('.reading') && document.querySelector('.reading').innerText.includes('desde el servidor.')")
    check('backend: la lección llega por streaming', seen['lesson_stream'])
    await pg.click('[data-act=buy]')
    await pg.wait_for_url('http://pay.test/checkout')
    check('backend: el botón de compra abre el pago de Stripe', True)
    check('backend: sin errores de página', not errs)
    if errs: print(errs)
    await ctx.close()

    # 3) vuelta del pago: la compra se detecta y se desbloquea todo
    ctx = await b.new_context(viewport={'width': 400, 'height': 800})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    finished = {
        'topic': 'Guitarra', 'world': 1, 'level': 4, 'phase': 'reward', 'finished': True, 'totalXp': 350, 'goal': '', 'steps': [], 'gain': 0, 'feedback': '', 'lesson': None,
        'history': ['x'], 'log': [{'goal': 'x', 'note': 'n', 'feedback': 'f'}], 'unlocked': False, 'name': '',
        'settings': {'theme': 'auto', 'tone': 'cercano', 'length': 'normal'}, 'mprofile': {'level': 'Intermedio', 'time': '3–5 h por semana', 'aim': 'Tocar'},
        'master': {'v': 2, 'title': 'Master', 'promise': 'P', 'why': 'W', 'modules': [dict(m, body='') for m in MODULES]}
    }
    await pg.route('http://sb.test/functions/v1/**', lambda r: r.fulfill(status=200, headers=CORS, content_type='text/event-stream', body='data: {"delta":"Contenido del módulo."}\n\ndata: [DONE]\n\n'))
    await pg.route('http://app.test/**', lambda r: r.fulfill(status=200, content_type='text/html', body=HTML))
    await pg.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=SB_STUB))
    await pg.add_init_script("window.__session = { access_token: 'tok', user: { id: 'u1', email: 'a@b.c' } }; window.__ent = [{ id: 1 }]; window.__row = %s;" % json.dumps(finished))
    await pg.goto('http://app.test/?paid=1')
    await pg.wait_for_selector('.notice')
    check('backend: tras el pago se avisa y se desbloquea', 'Pago recibido' in await pg.inner_text('.notice') and await pg.locator('[data-act=buy]').is_disabled())
    await pg.click('[data-act=lesson][data-i="2"]')
    await pg.wait_for_selector('.mod:nth-child(3) .reading p')
    check('backend: con la compra, un módulo de pago se genera', True)
    await pg.screenshot(path=str(OUT / 'backend-2-pagado.png'), full_page=True)
    check('backend: sin errores de página (pago)', not errs)
    await ctx.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        await demo(b)
        await backend(b)
        await b.close()
    failed = [n for n, ok in results if not ok]
    print('\n%d comprobaciones, %d fallos' % (len(results), len(failed)))
    sys.exit(1 if failed else 0)

asyncio.run(main())
