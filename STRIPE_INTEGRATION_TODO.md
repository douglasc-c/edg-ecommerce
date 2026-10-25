# Stripe Checkout: configuración y pruebas de EDG

Este archivo reúne los pasos pendientes de la integración con Checkout Studio. La transferencia a Banco Sabadell sigue siendo el método principal y Stripe ofrece el pago con tarjeta.

## Estado de la integración

Se aplica el **escenario A**: ya existe una llamada REST a `POST /v1/checkout/sessions` en [src/stripe.mjs](src/stripe.mjs). Se actualizaron sus parámetros para reflejar Checkout Studio. No se añadieron servidores, rutas, SDK ni dependencias.

El webhook, la conciliación de pedidos, el reembolso, la reserva de existencias y la redirección del cliente ya existen. La configuración del panel por sí sola no conecta el checkout a los pedidos: hay que desplegar el cambio y completar las credenciales siguientes.

## Valores que sustituir

**No hay valores de ejemplo pendientes dentro de la llamada existente.** Se conservan los valores reales que la tienda calcula para cada pedido:

**Archivo:** [src/stripe.mjs](src/stripe.mjs).

| Campo | Valor actual | Acción |
| --- | --- | --- |
| `mode` | `payment` | Compra única; no cambiar a suscripción. |
| `success_url` | Origen de `APP_URL` + `/?payment=success#orders` | Mantener. En producción, `APP_URL` es `https://www.edgskateboards.com`. |
| `cancel_url` | Origen de `APP_URL` + `/?payment=cancelled#orders` | Mantener. |
| `line_items` | Una línea `Pedido #…` en EUR con el total validado por el servidor | Mantener el catálogo externo; no hace falta introducir un `price_…` del panel. El total incluye el envío y los descuentos calculados en la tienda. |

La página Stripe muestra el total agrupado del pedido; el detalle de productos permanece en la tienda. Volver a la URL de éxito no acredita el pago.

Los valores que deben aportarse son secretos y configuración del entorno, no sustituciones en el código.

## Parámetros configurados

**Archivo:** [src/stripe.mjs](src/stripe.mjs).

| Parámetro de Checkout Studio | Valor |
| --- | --- |
| `ui_mode` | `hosted_page` |
| `billing_address_collection` | `auto` |
| `phone_number_collection.enabled` | `false` |
| `automatic_tax.enabled` | `false` |
| `allow_promotion_codes` | `false` |
| `submit_type` | `auto` |
| `integration_identifier` | `hosted_web_0001` |
| `origin_context` | `web` |
| `allowed_payment_method_types[0]` | `card` |

`payment_method_collection` se omite porque Stripe solo permite configurarlo con `mode=subscription`; EDG utiliza `mode=payment`.

Se conservan los parámetros operativos existentes aunque el prompt genérico del panel no los enumere: `client_reference_id`, los metadatos `order_id` de sesión y PaymentIntent, `expires_at`, `customer_email` y la limitación a tarjeta. Quitarlos impediría la conciliación con el pedido o cambiaría los métodos y el plazo de pago acordados. También se conserva la clave de idempotencia de cada pedido.

La tienda usa REST con `fetch`, sin SDK Stripe instalado. Por eso no se añade ni se elige una versión de SDK. `hosted_page` es el valor de la API actual y del Checkout Studio enviado; no se establece una cabecera `Stripe-Version` ni se cambia la versión de la cuenta. Hay que validar la creación real de una sesión en el Sandbox: una cuenta con versión API anterior debe revisar la compatibilidad de estos campos antes de actualizar su versión.

La creación de Checkout usa `allowed_payment_method_types` para limitar los métodos elegibles a tarjeta en la API `2026-09-30.endive` o compatible. Esa versión eliminó el parámetro de entrada `payment_method_types`: enviarlo devuelve HTTP 400. Se conserva el valor del pedido, los metadatos y la idempotencia; no se reintenta automáticamente cambiando parámetros ni se modifica la versión de la cuenta.

La identidad visual y las políticas se gestionan en Stripe. La desactivación de Adaptive Pricing se confirma en los ajustes del mismo Sandbox. Antes de pagos reales, queda por definir el cálculo del IVA y completar las políticas de la tienda.

## Configuración en Cloudflare

Después de integrar el cambio en la rama publicada, abre **Workers & Pages → edg-ecommerce → Settings → Variables and Secrets**. Conserva las variables que ya funcionan y aplica los cambios mediante **Deploy**.

[wrangler.jsonc](wrangler.jsonc) declara ahora las opciones de producción: `PAYMENT_ENVIRONMENT=live`, `SENDCLOUD_ENVIRONMENT=live` y `EUROPE_CHECKOUT_ENABLED=true`, además del banco, beneficiario y plazo de reserva. Sigue [PRODUCTION.md](PRODUCTION.md) para coordinar el cambio con los secretos LIVE antes de publicar. `keep_vars=true` conserva las entradas añadidas exclusivamente al panel; los valores declarados en `vars` deben coincidir con los del panel para que el siguiente despliegue no restaure otro entorno.

La tabla siguiente conserva la referencia para un Sandbox separado. No publiques `PAYMENT_ENVIRONMENT=test` en la tienda real ni sustituyas sus claves LIVE por las del Sandbox.

| Variable | Valor para pruebas |
| --- | --- |
| `APP_URL` | `https://www.edgskateboards.com` |
| `COMMERCE_MODE` | `catalog` |
| `STORE_CURRENCY` | `EUR` |
| `SHIPPING_PROVIDER` | `sendcloud` |
| `EUROPE_CHECKOUT_ENABLED` | `true` |
| `PAYMENT_ENVIRONMENT` | `test` |
| `SENDCLOUD_ENVIRONMENT` | `test` |
| `BANK_TRANSFER_BANK` | `Banco Sabadell` |
| `BANK_TRANSFER_BENEFICIARY` | `EDG SKATEBOARDS S.L.` |
| `BANK_TRANSFER_RESERVATION_HOURS` | `72`, ya declarado en `wrangler.jsonc`. |
| `BANK_TRANSFER_IBAN` | **Secret**: IBAN español completo de 24 caracteres, confirmado con el banco. No se incluye en este archivo. |
| `STRIPE_SECRET_KEY` | **Secret**: clave `sk_test_…` del Sandbox seleccionado, o clave restringida `rk_test_…` con los permisos necesarios. |
| `STRIPE_WEBHOOK_SECRET` | **Secret**: firma `whsec_…` del endpoint descrito abajo, perteneciente al mismo Sandbox. |

No hace falta `STRIPE_PUBLISHABLE_KEY` para esta integración mediante redirección. Stripe solo se ofrece cuando están configurados ambos secretos. Sin ellos, la transferencia sigue disponible si el checkout EUR está habilitado y tiene sus datos completos.

Mantén las credenciales de Sendcloud que ya permitieron consultar tarifas. El entorno de Sendcloud es independiente del de pagos. Conserva también `ADMIN_EMAIL` y `ADMIN_PASSWORD`, necesarios para inicializar el almacén de pruebas.

Si una clave secreta apareció en una captura o mensaje, sustitúyela desde Stripe y guarda la nueva únicamente como secreto. Nunca pegues su valor en GitHub ni en este documento.

## Webhook del Sandbox

1. En el mismo **Sandbox de EDG**, abre **Workbench → Webhooks → Create an event destination**.
2. Elige eventos de **tu cuenta**, con formato **Snapshot**. El controlador existente espera ese formato.
3. Selecciona estos eventos:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`
4. Elige **Webhook endpoint** y registra:

   `https://www.edgskateboards.com/api/webhooks/stripe`

5. Copia el secreto de firma de ese destino a `STRIPE_WEBHOOK_SECRET` en Cloudflare y despliega la configuración.
6. Comprueba que las notificaciones de una compra de prueba se entregan con respuesta `200` y que la tienda confirma el pedido correspondiente.

Una prueba genérica del panel puede usar una sesión que no pertenece a ningún pedido EDG y no valida la compra completa. Realiza también una compra desde el carrito de la tienda.

## Prueba completa

El checkout EUR con `PAYMENT_ENVIRONMENT=test` utiliza el almacén aislado `primary-eur-test`. Tiene sus propios usuarios, productos, existencias y pedidos. Que no aparezcan los productos habituales en este modo no significa que se hayan borrado. Consulta [EUROPE_CHECKOUT.md](EUROPE_CHECKOUT.md) para los detalles de aislamiento y transferencia bancaria.

1. Inicia sesión como administrador en pruebas y crea un producto de prueba con existencias, peso y medidas.
2. Registra un cliente de prueba, añade el producto al carrito, introduce una dirección admitida y calcula el envío mediante Sendcloud.
3. Selecciona **Tarjeta · Stripe**. Comprueba el total en euros y la apertura de `checkout.stripe.com`.
4. Usa estos datos únicamente en el Sandbox, con fecha futura y CVC de tres dígitos:

   | Caso | Tarjeta de prueba |
   | --- | --- |
   | Pago aprobado | `4242 4242 4242 4242` |
   | Autenticación 3D Secure | `4000 0025 0000 3155` |
   | Fondos insuficientes | `4000 0000 0000 9995` |

5. Comprueba la confirmación en **Pedidos**, el movimiento de existencias y el ingreso. El webhook verifica la firma y consulta la sesión Stripe para contrastar referencia, entorno, importe y moneda.
6. Reenvía el mismo evento: no debe duplicar el ingreso ni descontar de nuevo las existencias.
7. Prueba cancelar el pago, dejar vencer la reserva y solicitar un reembolso completo de un pedido de prueba. El pago Stripe tiene una reserva de 35 minutos. Pagar no contrata automáticamente una etiqueta Sendcloud.

## Estructura y comprobaciones

Si la tienda devuelve 502 al iniciar el pago, revisa **Cloudflare → edg-ecommerce → Logs → Live** y busca `Stripe request rejected:`. El registro contiene solo estado HTTP, tipo/código admitidos, nombre de un parámetro enviado y `request_id`, cuando Stripe proporciona esos datos. El mensaje y cuerpo remotos, los encabezados de autorización y los datos del cliente no se registran. La referencia `req_…` también se incluye en la respuesta pública para localizar la solicitud en **Stripe → Workbench → Logs**.

Si no se obtiene una respuesta HTTP, el registro `Stripe request failed:` distingue `timeout` de `network_error`, sin registrar el mensaje de la excepción. El timeout sigue siendo de 15 segundos y las escrituras con resultado incierto no se repiten automáticamente.

Tras desplegar una corrección, entra en **Mis pedidos** y retoma el pedido pendiente con **Pagar con tarjeta · Stripe** si la reserva sigue vigente. Si ya venció, crea un pedido nuevo. La confirmación real del pago sigue dependiendo del webhook.

La reanudación repite primero la solicitud con su clave y parámetros originales, incluso cuando quedan menos de 30 minutos. Así recupera una sesión cuya respuesta pudo perderse. Solo si Stripe rechaza expresamente `expires_at` con una validación HTTP 400, y el pedido sigue pendiente y vigente, se renueva el plazo a 35 minutos y se guarda una nueva clave antes de solicitar la sesión. Un timeout conserva la clave y la fecha de esa tentativa; no provoca otro intento automático. Los pedidos vencidos liberan las existencias y requieren un pedido nuevo. Un conflicto al pagar actualiza el estado mostrado en la pantalla.

La migración 10 añade únicamente la clave interna de reanudación a los pedidos existentes, con valor inicial nulo. Se aplica automáticamente al iniciar la tienda y conserva productos, pedidos y reservas.

- Código actualizado: [src/stripe.mjs](src/stripe.mjs).
- Archivo nuevo: este documento; no se añadieron otras rutas o servicios.
- Configuración y webhook existentes: [src/server.mjs](src/server.mjs).
- Seguimiento y conciliación existentes: [src/commerce.mjs](src/commerce.mjs).
- Configuración de referencia: [.env.example](.env.example).
- Pruebas existentes: [test/stripe-provider.test.mjs](test/stripe-provider.test.mjs), [test/europe-checkout-http.test.mjs](test/europe-checkout-http.test.mjs) y [test/europe-checkout.test.mjs](test/europe-checkout.test.mjs).

La comprobación automatizada local no reemplaza la compra real simulada en tu Sandbox, porque utiliza proveedores de prueba sin tus credenciales.

Comprobaciones locales completadas: `npm run check`, `npm test` (242 pruebas, incluidas la reanudación tras cinco minutos, la respuesta perdida, la persistencia de la nueva clave y la migración conservativa), los cuatro casos de `test/browser/europe-checkout.spec.mjs`, `npm run check:cloudflare`, `npm run test:cloudflare` y `npm run test:cloudflare:payments`. Se contrastó la solicitud generada con los campos del prompt de Checkout Studio enviado, manteniendo el total y la referencia del pedido.

## Antes de activar pagos reales

Completa las simulaciones anteriores, la activación de la cuenta Stripe, las políticas y el tratamiento de IVA. Sigue el orden de [PRODUCTION.md](PRODUCTION.md) para cambiar las claves, el webhook y las variables en una sola publicación. `PAYMENT_ENVIRONMENT=live` vuelve al almacén principal: no copia los pedidos de prueba. `SENDCLOUD_ENVIRONMENT=live` permite contratar etiquetas únicamente tras la confirmación del administrador; el pago no contrata transporte automáticamente. Consulta [SENDCLOUD.md](SENDCLOUD.md).

## Referencias

- [API de Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [Idempotencia y validación de solicitudes](https://docs.stripe.com/api/idempotent_requests)
- [Cambio de métodos de pago en Endive](https://docs.stripe.com/changelog/endive/2026-09-30/remove-payment-method-types-checkout-sessions)
- [Checkout Studio](https://docs.stripe.com/payments/checkout-studio/how-it-works)
- [Catálogo externo y precios inline](https://docs.stripe.com/products-prices/how-products-and-prices-work)
- [Webhooks](https://docs.stripe.com/webhooks)
- [Tarjetas de prueba](https://docs.stripe.com/testing)
- [Protección de claves](https://docs.stripe.com/keys-best-practices)
- [Soporte Stripe](https://support.stripe.com)
- [Stripe MCP](https://docs.stripe.com/mcp)
