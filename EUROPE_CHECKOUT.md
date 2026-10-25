# Checkout EUR: transferencia Sabadell y tarjeta Stripe

La transferencia es la opción principal. No requiere contratar un TPV Virtual: el cliente realiza una transferencia bancaria y administración o finanzas comprueba el abono antes de confirmar el pedido. Stripe Checkout es opcional para tarjetas. La cuenta del banco y el TPV de Sabadell son servicios diferentes; esta implementación no utiliza PAYCOMET ni Redsys.

## Configuración

El catálogo publicado sigue cerrado para compras hasta activar expresamente `EUROPE_CHECKOUT_ENABLED=true`. Mantén `COMMERCE_MODE=catalog`, `STORE_CURRENCY=EUR` y `SHIPPING_PROVIDER=sendcloud`.

| Variable | Valor |
| --- | --- |
| `EUROPE_CHECKOUT_ENABLED` | `true` para habilitar el checkout europeo; por defecto `false`. |
| `PAYMENT_ENVIRONMENT` | `test` durante las pruebas; `live` para pagos reales. Por defecto `test`. |
| `BANK_TRANSFER_BANK` | `Banco Sabadell`. |
| `BANK_TRANSFER_BENEFICIARY` | `EDG SKATEBOARDS S.L.`. |
| `BANK_TRANSFER_IBAN` | IBAN español completo del beneficiario, verificado con el banco. |
| `BANK_TRANSFER_RESERVATION_HOURS` | `72` por defecto; configurable entre 1 y 168 horas. |
| `STRIPE_SECRET_KEY` | Opcional: clave de API de pruebas `sk_test_…` o restringida `rk_test_…` con permisos para Checkout, consulta y reembolso. |
| `STRIPE_WEBHOOK_SECRET` | Opcional: secreto `whsec_…` del endpoint de ese mismo entorno Stripe. |

El IBAN español debe contener 24 caracteres y superar la validación de control. El número parcial compartido en la conversación no se incluye en el repositorio. El checkout no se activa con una cuenta incompleta. La validación de formato no comprueba la titularidad: utiliza la cuenta confirmada por el banco.

En Cloudflare, añade las credenciales en **Workers & Pages → edg-ecommerce → Settings → Variables and Secrets** y aplica con **Deploy**. Guarda `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y `BANK_TRANSFER_IBAN` como **Secret**. No se necesita una clave publicable para esta redirección a la página de pago alojada por Stripe.

`wrangler.jsonc` declara `PAYMENT_ENVIRONMENT=test`, el nombre del banco, el beneficiario y las 72 horas de reserva. La activación `EUROPE_CHECKOUT_ENABLED` se configura como **Text** solo desde el panel, después de completar las credenciales y el IBAN: no se añade un valor vacío ni se activa automáticamente al desplegar. `keep_vars=true` conserva las variables configuradas únicamente en el panel. Para cambiar de forma permanente una variable que sí figura en `vars`, actualiza también `wrangler.jsonc`: un despliegue posterior aplica el valor del archivo.

Las credenciales de Sendcloud siguen siendo necesarias para consultar tarifas. `SENDCLOUD_ENVIRONMENT` es independiente de `PAYMENT_ENVIRONMENT`: mantén `SENDCLOUD_ENVIRONMENT=test` durante las pruebas de pagos.

## Pruebas aisladas

Al habilitar EUR en `PAYMENT_ENVIRONMENT=test`, el Worker utiliza un Durable Object separado, `primary-eur-test`, para cuentas, productos, existencias y finanzas simuladas. El catálogo normal y los pagos reales usan `primary`. El almacén de pruebas comienza vacío y necesita su administrador y productos de prueba. Conserva `ADMIN_EMAIL` y `ADMIN_PASSWORD` para inicializar ese almacén. Cambiar a `live` vuelve al almacén principal; no convierte ni copia los pedidos de prueba.

En Node y Docker, el arranque normal añade `.eur-test` a la ruta de base de datos configurada cuando se activa el checkout EUR de pruebas. Por ejemplo, `data/commerce.db` se convierte en `data/commerce.db.eur-test`, y `/data/commerce.db` en `/data/commerce.db.eur-test`. Los archivos de producción se conservan. Las llamadas de programación que pasan expresamente una ruta a `database(ruta)` son responsables de elegir un archivo de pruebas separado.

## Transferencia

1. Crea un cliente y un producto de prueba con existencias, peso y medidas completos.
2. Añade el producto al carrito e introduce una dirección de la Península o Baleares. Consulta el frete para esa dirección.
3. Selecciona **Transferencia bancaria**. El servidor calcula el total en euros y genera un pedido con beneficiario, IBAN, referencia única, importe y vencimiento.
4. En pruebas, no realices ninguna transferencia real. El pedido indica que es una simulación. Abrir el pedido o copiar la referencia no confirma el pago.
5. En **Pedidos**, administración o finanzas abre el pedido y utiliza **Confirmar transferencia**. Introduce el importe exacto en euros y una referencia bancaria de prueba; confirma expresamente la comprobación del abono. En producción, hazlo solo después de comprobar el crédito efectivo en el banco, no a partir de un comprobante enviado por el cliente.
6. Comprueba el estado pagado, el movimiento de existencias y el ingreso. Repetir el mismo recibo no duplica los efectos, y no puede utilizarse para acreditar otro pedido.

La reserva dura 72 horas por defecto. Cancelar o vencer libera la reserva. Un pago tardío sin existencias disponibles pasa a revisión, sin habilitar el envío. Los datos bancarios del pedido quedan guardados: cambiar la configuración no altera instrucciones ya emitidas. Las devoluciones bancarias deben gestionarse y conciliarse desde el banco; no hay una API bancaria que compruebe o devuelva transferencias automáticamente.

## Tarjeta opcional

1. Crea o utiliza un sandbox Stripe y configura sus dos credenciales anteriores. Sin ellas, la tienda ofrece únicamente transferencia.
2. Registra un endpoint Stripe para `APP_URL` seguido de `/api/webhooks/stripe`, en el mismo sandbox. Suscríbelo a `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `charge.refunded`.
3. Selecciona **Tarjeta · Stripe** al crear el pedido. El servidor genera Checkout con el importe exacto y una reserva de 35 minutos.
4. Usa tarjetas de prueba: `4242 4242 4242 4242` para aprobación; `4000 0025 0000 3155` para 3D Secure; `4000 0000 0000 9995` para recusa. Validez futura y CVC de tres dígitos. Nunca uses una tarjeta real en las simulaciones.
5. Comprueba el evento en Stripe y la confirmación en la tienda. Volver a la página de éxito no confirma dinero: el servidor valida la firma y consulta la sesión Stripe antes de registrar el pago.
6. Prueba cancelación, vencimiento, notificaciones repetidas y reembolso. El reembolso completo de Stripe repone existencias automáticamente solo antes del envío; las devoluciones posteriores requieren revisar la mercancía recibida.

Los identificadores, importes, moneda y entorno deben coincidir con el pedido guardado. Los reintentos usan claves de idempotencia. Un reembolso que llegue antes de la confirmación se concilia con la sesión guardada antes de acreditar el pedido.

## Envío y límites

El checkout consulta Sendcloud usando el peso y las medidas del catálogo. Para un solo bulto, estima una pila rectangular conservadora; no incluye un cálculo de embalaje a medida. El almacén debe medir el paquete real antes de contratar el transporte y verificar el coste. Los carritos que superan los límites del bulto se rechazan.

No se compra una etiqueta automáticamente al pagar. Prepara el transporte manualmente desde **Envíos europeos** con la referencia del pedido y las medidas del paquete embalado. La facturación fiscal española sigue pendiente; las rutas brasileñas de Focus NFe y Melhor Envio están deshabilitadas para EUR.

## Publicación real

Tras validar las simulaciones, verifica el IBAN y el beneficiario con el banco. Para tarjetas, completa la activación de la cuenta Stripe y configura sus claves de producción y un endpoint de producción independiente. Cambia `PAYMENT_ENVIRONMENT=live` y publica; verifica el catálogo, las existencias y los usuarios del almacén principal. La contratación real de transporte se activa por separado siguiendo [SENDCLOUD.md](SENDCLOUD.md).

Referencias: [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [webhooks](https://docs.stripe.com/webhooks), [tarjetas de prueba](https://docs.stripe.com/testing).
