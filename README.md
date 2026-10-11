# Nemyplish

App de aprendizaje por niveles con una mentora de IA (Nemy). La persona elige un tema, completa objetivos, Nemy los evalúa y da XP, y al final se ofrece una masterclass de pago diseñada con su historial.

## Qué hay en la carpeta

| Ruta | Para qué sirve |
|---|---|
| `web/src.html` | La app (una sola página, blanco y negro). Funciona en dos modos: **demo** dentro de Claude y **real** con tu backend. |
| `scripts/build-web.mjs` | Genera `dist/index.html` (para tu hosting) y `dist/artifact.html` (para la demo en Claude). |
| `supabase/migrations/` | Base de datos: estado de cada persona, compras y límite diario de IA, con seguridad por filas. |
| `supabase/functions/nemy` | Único punto de entrada a Claude. La clave de la API vive solo aquí. |
| `supabase/functions/create-checkout` | Crea el pago en Stripe. |
| `supabase/functions/stripe-webhook` | Recibe la confirmación de Stripe y desbloquea la masterclass. |
| `tests/` | Pruebas del backend (`npm test`) y del frontend en un navegador (`tests/e2e.py`). |

## Cómo funciona

1. La persona entra con un enlace al correo (sin contraseñas, Supabase Auth).
2. Su progreso se guarda en `app_state`; solo ella puede leerlo o cambiarlo.
3. Cada acción de Nemy llama a `nemy`, que comprueba la sesión, aplica el límite diario y llama a Claude. El navegador nunca ve la clave.
4. La lección 1 de la masterclass es gratis. Para las demás, `nemy` consulta la tabla `entitlements` **en el servidor**, así que no se puede saltar el pago desde el navegador.
5. El botón de compra abre Stripe Checkout. Cuando Stripe confirma el pago, `stripe-webhook` (firma verificada) añade la compra y la app desbloquea el resto.

## Puesta en marcha

Necesitas cuentas de Supabase, Stripe y la API de Claude, y la [CLI de Supabase](https://supabase.com/docs/guides/cli).

1. **Proyecto de Supabase.** Créalo y, en esta carpeta:
   ```
   supabase login
   supabase link --project-ref <ref-del-proyecto>
   supabase db push
   ```
2. **Acceso por correo.** En Authentication → URL Configuration, pon como *Site URL* y *Redirect URL* la dirección donde alojarás la web. El correo que envía Supabase por defecto tiene un límite muy bajo: para producción configura tu propio SMTP.
3. **Stripe.** Crea un producto "Masterclass" con precio único (el mismo que muestra la app) y copia el identificador del precio (`price_...`).
4. **Secretos de las funciones:**
   ```
   supabase secrets set ANTHROPIC_API_KEY=... STRIPE_SECRET_KEY=sk_... STRIPE_PRICE_ID=price_... \
     SITE_URL=https://tu-dominio ALLOWED_ORIGIN=https://tu-dominio
   ```
   Opcionales: `AI_DAILY_LIMIT` (80 consultas por persona y día), `MODEL_FAST` y `MODEL_SMART` (modelos de Claude).
5. **Desplegar las funciones** (`config.toml` ya desactiva la verificación de JWT de la pasarela; cada función comprueba a la persona o la firma por su cuenta):
   ```
   supabase functions deploy nemy create-checkout stripe-webhook
   ```
6. **Webhook de Stripe.** En Stripe crea un endpoint con la URL `https://<ref>.supabase.co/functions/v1/stripe-webhook` y los eventos `checkout.session.completed` y `checkout.session.async_payment_succeeded`. Copia su secreto de firma (`whsec_...`) y guárdalo:
   ```
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```
7. **Generar la web** con la dirección y la clave pública (anon) de tu proyecto, y subir `dist/index.html` a cualquier hosting estático:
   ```
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<clave-anon> npm run build:web
   ```
   La clave anon es pública por diseño; la protegen las reglas de seguridad por filas.
8. **Probar el pago** con la tarjeta de pruebas de Stripe (`4242 4242 4242 4242`) antes de pasar a modo real.

El precio que ve la persona está en `MASTER_PRICE` (`web/src.html`). El importe que se cobra es el del precio de Stripe: mantén ambos iguales.

## Seguridad y costes

- La clave de Claude y la de Stripe solo existen como secretos de las funciones.
- Las compras solo las escribe el webhook (rol de servicio). Las personas solo pueden leer las suyas.
- Las lecciones se generan a partir de la masterclass guardada en la base de datos, no de lo que envíe el navegador.
- Cada acción de Nemy es una llamada a la API de Claude que pagas tú. `AI_DAILY_LIMIT` pone un tope por persona; las lecciones largas son lo que más cuesta.

## Pruebas

```
npm test                                   # backend: 15 pruebas con servicios simulados
SUPABASE_URL=http://sb.test SUPABASE_ANON_KEY=anon-key npm run build:web
python3 tests/e2e.py                       # frontend en Chromium, modo demo y modo backend simulado
```

Las pruebas usan servicios simulados. No se han ejecutado contra un proyecto real de Supabase, Stripe ni la API de Claude, así que el primer despliegue necesita una prueba completa de extremo a extremo.

## Antes de vender

- Las lecciones las escribe una IA y pueden tener errores. Revisa o escribe tú el contenido clave de la masterclass.
- Hacen falta términos de venta, política de privacidad y la gestión de IVA y del derecho de desistimiento en contenido digital. Consúltalo con un asesor.
