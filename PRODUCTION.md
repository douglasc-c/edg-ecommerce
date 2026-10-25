# Producción: Stripe y Sendcloud

El checkout de EDG ya se ha validado en el Sandbox. Esta configuración prepara los pagos reales en EUR y el transporte real, manteniendo la transferencia a Banco Sabadell como primera opción.

## 1. Preparar Stripe en el entorno real

Sal del Sandbox y entra en la cuenta de producción de EDG. Completa su activación y comprueba que puede aceptar pagos. Obtén la clave de API de producción `sk_live_…`, o una clave restringida `rk_live_…` con los permisos necesarios para Checkout, consulta de sesiones y reembolsos.

La versión API de la cuenta real debe ser compatible con los parámetros de Checkout validados en pruebas (`2026-09-30.endive` o una versión compatible). El proveedor utiliza la versión predeterminada de la cuenta; la configuración del Sandbox no demuestra qué versión utiliza la cuenta real.

En **Workbench → Webhooks**, crea un destino de **producción**, para **tu cuenta**, formato **Snapshot**, con estos eventos:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`

URL del destino:

```text
https://www.edgskateboards.com/api/webhooks/stripe
```

Guarda su secreto de firma `whsec_…` en Cloudflare. El secreto del destino de pruebas no sustituye al del destino de producción.

## 2. Publicar secretos y variables juntos

Antes de integrar la PR que cambia el Wrangler a producción, abre **Cloudflare → Workers & Pages → edg-ecommerce → Settings → Variables and Secrets**. Prepara estos cambios en la misma edición y aplica **Deploy** una sola vez, cuando estén todos completos:

| Nombre | Tipo | Valor de producción |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Secret | Clave `sk_live_…` o `rk_live_…` de la cuenta real. |
| `STRIPE_WEBHOOK_SECRET` | Secret | Firma `whsec_…` del nuevo destino LIVE. |
| `PAYMENT_ENVIRONMENT` | Text | `live` |
| `SENDCLOUD_ENVIRONMENT` | Text | `live` |
| `EUROPE_CHECKOUT_ENABLED` | Text | `true` |

Conserva `COMMERCE_MODE=catalog`, `STORE_CURRENCY=EUR`, `SHIPPING_PROVIDER=sendcloud`, el IBAN completo, el beneficiario, las credenciales Sendcloud, el remitente y las credenciales administrativas. En esta aplicación, `COMMERCE_MODE=live` corresponde al flujo brasileño y no debe utilizarse para el checkout EUR.

La clave Stripe y `PAYMENT_ENVIRONMENT` se validan juntos. Publicar `live` con una clave `sk_test_…`, o publicar una clave LIVE mientras el entorno sigue en `test`, impide inicializar la API y devuelve 503. Por eso hay que aplicar el conjunto en una sola publicación.

Confirma que el webhook de Sendcloud apunta a `https://www.edgskateboards.com/api/webhooks/sendcloud` y utiliza el secreto de firma configurado en esa integración. Si no se ha establecido un secreto distinto, la aplicación utiliza `SENDCLOUD_SECRET_KEY`, según [SENDCLOUD.md](SENDCLOUD.md).

## 3. Integrar y verificar

Después de aplicar la configuración de producción en Cloudflare, integra esta PR para que los siguientes despliegues mantengan esos valores. El código de pagos ya integrado admite el entorno real; esta PR fija su configuración y documenta el cambio.

Abre `https://www.edgskateboards.com/api/health`: debe devolver `{"status":"ok"}`. En `https://www.edgskateboards.com/api/config`, comprueba:

```json
{
  "currency": "EUR",
  "checkout_enabled": true,
  "payment_environment": "live",
  "shipping_environment": "live",
  "payment_methods": ["bank_transfer", "stripe"]
}
```

La configuración pública confirma qué entorno ha cargado la aplicación. La primera compra de un cliente real permitirá comprobar además la autorización del pago, la entrega del webhook con HTTP 200 y el pedido pagado en la tienda. No utilices tarjetas de prueba ni crees cobros artificiales para validar producción.

El cambio a `live` selecciona el almacén principal `primary`. Vuelven sus productos, usuarios, existencias y pedidos; no se copian los del almacén aislado `primary-eur-test`. Inicia sesión con la cuenta del catálogo principal y revisa precios, existencias, colores, tallas, peso y medidas. Desaparece el aviso de pruebas.

En **Envíos europeos**, comprueba la conexión y una tarifa. La creación de una etiqueta requiere la confirmación explícita del administrador y puede generar costes reales; no se crea ninguna etiqueta al pagar un pedido. Mide el paquete embalado antes de contratar.

El total cobrado sigue siendo el total del carrito. Stripe Tax continúa desactivado y esta publicación no incorpora cálculo de IVA ni facturación española; conserva el tratamiento actual de los precios.

## Reabrir pruebas

Para probar de nuevo, utiliza un entorno separado con sus propios secretos TEST y `PAYMENT_ENVIRONMENT=test`. No cambies la tienda publicada a pruebas mientras recibe pedidos reales.

## Referencias

- [Activar una integración Stripe](https://docs.stripe.com/get-started/checklist/go-live)
- [Claves de API](https://docs.stripe.com/keys)
- [Webhooks](https://docs.stripe.com/webhooks)
- [Integración Sendcloud de EDG](SENDCLOUD.md)
