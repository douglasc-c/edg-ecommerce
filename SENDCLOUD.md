# Envíos europeos con Sendcloud

El módulo **Gestión → Envíos europeos** (`/#europe-shipping`) permite preparar envíos manuales desde el remitente de Barcelona, consultar tarifas, contratar una etiqueta y consultar su seguimiento. Tienen acceso los perfiles de administrador y expedición.

El alcance inicial es un bulto por envío, desde Barcelona a España peninsular y Baleares (`ES`). Los destinos internacionales quedan fuera del alcance inicial; los envíos internacionales ya registrados conservan su historial, seguimiento y descarga de etiqueta cuando esté disponible. No se admiten Canarias, Ceuta ni Melilla (códigos postales españoles que empiezan por `35`, `38`, `51` o `52`). Cada envío requiere el peso en kg y las tres medidas exteriores del bulto embalado en cm. No se deducen de un único producto.

Este módulo no modifica el inventario, las reservas, los pagos ni los apuntes financieros. No habilita el carrito ni el pago en EUR: mantén `COMMERCE_MODE=catalog`. El checkout EUR se activa por separado siguiendo [EUROPE_CHECKOUT.md](EUROPE_CHECKOUT.md). La facturación española también es independiente y sigue pendiente.

## 1. Preparar la cuenta y el remitente

1. Crea o utiliza la cuenta de empresa en [Sendcloud](https://app.sendcloud.com/).
2. Completa los datos de empresa, facturación y los requisitos que Sendcloud solicite para activar los servicios y sus tarifas.
3. En las direcciones de remitente, registra la dirección completa de salida y devolución de Barcelona, España. Revisa empresa, contacto, calle, número, código postal, ciudad, país y datos de contacto.
4. Activa los transportistas y servicios que vas a utilizar o conecta el contrato propio que corresponda a tu cuenta. La disponibilidad depende del contrato y de la ruta; no se presupone que todos los transportistas tengan tarifas activadas.
5. Revisa el plan y las condiciones de cobro. Crear una etiqueta real puede generar un cargo, aunque no entregues el paquete al transportista. Este módulo no contrata recogidas ni gestiona devoluciones o cancelaciones de etiquetas.

## 2. Crear las claves de integración

En el panel de Sendcloud, abre la configuración de integraciones y crea una integración de tipo API. Guarda su **Public Key** y su **Secret Key**. La integración del proyecto utiliza autenticación HTTP Basic: la clave pública es el usuario y la clave privada es la contraseña. **No actives la opción que obliga a utilizar OAuth2** para esta integración.

Las claves se utilizan solo en el servidor. No las pegues en el navegador, archivos versionados ni capturas públicas. Los webhooks deben configurarse en esta misma integración: los eventos de otra integración no se envían automáticamente a esta.

## 3. Configurar primero el modo de prueba

La configuración de la tienda europea es:

```dotenv
COMMERCE_MODE=catalog
STORE_CURRENCY=EUR
SHIPPING_PROVIDER=sendcloud
SENDCLOUD_ENVIRONMENT=test
SENDCLOUD_PUBLIC_KEY=
SENDCLOUD_SECRET_KEY=
SENDCLOUD_WEBHOOK_SECRET=
SENDCLOUD_SENDER_ADDRESS_ID=
```

| Variable | Valor |
| --- | --- |
| `SHIPPING_PROVIDER` | `sendcloud` para seleccionar el módulo europeo. |
| `SENDCLOUD_ENVIRONMENT` | `test` para simular la creación localmente; `live` para poder contratar envíos reales tras confirmar en la interfaz. |
| `SENDCLOUD_PUBLIC_KEY` | Public Key de la integración API de tu cuenta. |
| `SENDCLOUD_SECRET_KEY` | Secret Key de esa misma integración. |
| `SENDCLOUD_WEBHOOK_SECRET` | Clave de firma específica del webhook, si la configuras en Sendcloud. Si se deja vacía, se utiliza la clave privada de API. |
| `SENDCLOUD_SENDER_ADDRESS_ID` | ID numérico de la dirección de remitente de Barcelona configurada en esa cuenta. |

En local, rellena estas variables en `.env`, con las credenciales de tu cuenta, y reinicia el servidor. No cambies a `COMMERCE_MODE=live` para utilizar Sendcloud: ese modo pertenece al proceso de compra existente y no habilita el pago europeo.

En Cloudflare, `wrangler.jsonc` ya selecciona `sendcloud` y `test`. Desde la carpeta del repositorio, añade las credenciales mediante las solicitudes interactivas:

```bash
npx wrangler secret put SENDCLOUD_PUBLIC_KEY
npx wrangler secret put SENDCLOUD_SECRET_KEY
npx wrangler secret put SENDCLOUD_SENDER_ADDRESS_ID
```

Si configuras una clave de firma específica para el webhook, guárdala también mediante `npx wrangler secret put SENDCLOUD_WEBHOOK_SECRET`.

Para obtener el ID del remitente, abre **Configuración → Direcciones** en Sendcloud y edita la dirección de Barcelona. El número al final de la URL es su `sender_address_id`; utiliza el de tu propia dirección. Este procedimiento está documentado en las [preguntas frecuentes de la API](https://support.sendcloud.com/hc/es/articles/7789894544276-Preguntas-frecuentes-sobre-las-API-de-Sendcloud). Guarda ese número en `SENDCLOUD_SENDER_ADDRESS_ID` antes de comprobar la conexión en la tienda: el botón requiere las claves y el ID ya configurados.

También puedes añadir los secretos en el Worker, en **Settings → Variables and Secrets**. Las variables normales `SHIPPING_PROVIDER` y `SENDCLOUD_ENVIRONMENT` se mantienen en `wrangler.jsonc` para conservarlas tras los despliegues. No sobrescribas los secretos de otra tienda ni compartas el Worker o el inventario con la tienda brasileña.

## 4. Probar la conexión y consultar tarifas

1. Entra con un administrador o un usuario de expedición y abre **Gestión → Envíos europeos**.
2. Pulsa **Comprobar conexión**. Revisa en Sendcloud la cuenta y el remitente configurados, y confirma que el origen sea Barcelona, `ES`.
3. El país de destino está fijado a **España (Península y Baleares)**. Introduce la dirección, el código postal español de cinco dígitos y la ciudad con precisión. El campo **Provincia** es opcional; si lo introduces, utiliza el código ISO completo, por ejemplo `ES-B` para Barcelona. Se conserva en los datos locales, pero no se envía como `state_province_code` a Sendcloud: la API no admite ese campo para España, ni al consultar tarifas ni al crear el envío.
4. Pesa y mide el bulto exterior ya embalado. Introduce peso, largo, ancho y alto; no se admite omitir medidas ni añadir un segundo bulto.
5. Pulsa **Consultar tarifas** y selecciona uno de los servicios devueltos. Revisa la moneda EUR y el importe que muestra el proveedor.
6. Antes de simular o contratar, comprueba las consultas para un destino válido de la Península y otro de Baleares si vas a utilizar esa ruta. Estas consultas son de lectura: no pulses el botón de creación para verificar únicamente las tarifas. Comprueba también que se rechazan Canarias, Ceuta, Melilla y cualquier país distinto de `ES`. Las cotizaciones internacionales anteriores no permiten crear un envío nuevo.

La consulta de remitentes y tarifas utiliza **la API real y las credenciales de tu cuenta**, incluso con `SENDCLOUD_ENVIRONMENT=test`. Consultar tarifas no crea un envío ni contrata una etiqueta. Una lista vacía puede indicar que faltan servicios activados o que no hay servicios compatibles con la ruta, el peso o las dimensiones. Si el contrato no tiene tarifas disponibles, no se inventa un precio.

Si Sendcloud rechaza una consulta, la respuesta de la API de la tienda incluye `provider.operation` (`sender` o `quote`), el estado HTTP original y sus errores JSON:API con el código, el campo y el detalle disponible. El aviso de la interfaz también muestra el estado y el motivo. Se ocultan las credenciales y los valores de las direcciones enviados en la consulta; no se devuelven cuerpos HTML ni respuestas de error excesivas. Los logs `Sendcloud API error:` conservan únicamente la operación, el estado, los códigos y los campos. Comparte ese diagnóstico para investigar la causa; no cambies a `live` para intentar corregir una consulta fallida. Un rechazo no demuestra por sí solo que falten transportistas: la [API de opciones y tarifas](https://sendcloud.dev/api/v3/shipping-options/return-a-list-of-available-shipping-options) también puede rechazar datos o contratos.

Las tarifas dependen de las condiciones de la cuenta y del paquete. No garantizan un plazo concreto ni sustituyen las condiciones del transportista; comprueba recargos y condiciones de facturación en Sendcloud.

## 5. Simular la creación sin contratar transporte

Con `SENDCLOUD_ENVIRONMENT=test`, pulsa **Simular envío**, revisa el resumen y después **Guardar simulación**. Esto registra una **simulación local** en el historial. No llama a la creación de envíos de Sendcloud, no anuncia el paquete a un transportista, no genera un PDF real y no permite descargar una etiqueta válida para enviar mercancía.

Este modo no es un sandbox de Sendcloud y tampoco utiliza su opción `Unstamped letter` (`sendcloud:letter`). La carta sin franqueo se excluye de los servicios ofrecidos y no se puede contratar desde este módulo como transporte real. La prueba automática del código utiliza respuestas controladas, sin contratar transporte en el proveedor. Usa datos de ejemplo para comprobar el formulario y el historial; la simulación no valida la expedición física ni el seguimiento del transportista.

Para comprobar el seguimiento real será necesario un envío contratado y procesado por el transportista. No entregues mercancía con un registro de prueba.

## 6. Configurar el webhook de seguimiento

La URL es el valor exacto de `APP_URL` seguido de:

```text
/api/webhooks/sendcloud
```

Por ejemplo:

```text
https://edg-ecommerce.tu-subdominio.workers.dev/api/webhooks/sendcloud
```

En **Settings → Integrations → Configure** de la misma integración API de Sendcloud:

1. Activa **Webhook feedback enabled**.
2. Introduce la URL HTTPS pública del Worker en **Webhook URL**.
3. Si estableces una **Webhook Signature Key**, guarda el mismo valor en `SENDCLOUD_WEBHOOK_SECRET`. Si Sendcloud firma con la clave privada de API y no has establecido otra clave, deja vacía esta variable.
4. Guarda la configuración y utiliza **Test API webhook** para comprobar la accesibilidad.

El servidor verifica `Sendcloud-Signature` mediante HMAC sobre el cuerpo original. El webhook solo puede actualizar envíos reales registrados localmente en este módulo; no crea pedidos ni cambia inventario o finanzas. Un evento de prueba de integración no equivale a un movimiento real de un paquete. Para revisar un envío concreto, utiliza también la consulta de seguimiento del historial.

## 7. Contratar el primer envío real

Con la cuenta, el remitente, los servicios, las tarifas y el webhook comprobados:

1. Cambia `SENDCLOUD_ENVIRONMENT` a `live` en `wrangler.jsonc` y publica con `npm run deploy`. En local, cambia la variable en `.env` y reinicia el servidor. Conserva `COMMERCE_MODE=catalog` y `STORE_CURRENCY=EUR`.
2. Abre **Envíos europeos** y comprueba que el panel identifica el entorno real.
3. Introduce los datos correctos de un destinatario autorizado y el peso y las dimensiones del bulto. Consulta de nuevo las tarifas y revisa el servicio y el importe.
4. Pulsa **Revisar contratación**, comprueba el resumen, marca la confirmación del coste y pulsa **Contratar envío y generar etiqueta**. Esta acción puede generar un cargo en Sendcloud.
5. Revisa el resultado y utiliza **Descargar etiqueta PDF** cuando esté disponible. Comprueba remitente, destinatario, transportista y código de seguimiento antes de imprimirla y utilizarla.
6. Utiliza **Consultar estado** en el historial y **Seguir envío** cuando haya un enlace disponible. Comprueba los cambios posteriores del webhook tras la admisión del paquete por el transportista.

El historial distingue **Solicitud rechazada** de **Pendiente de conciliación** o **Creación en curso**. Ante un rechazo confirmado, revisa y corrige los datos antes de utilizar **Preparar otro envío** y solicitar una tarifa nueva. Ante un resultado incierto, utiliza **Consultar / conciliar** y comprueba el panel de Sendcloud; no prepares otro envío para repetir la contratación del mismo paquete. Puedes preparar otros envíos independientes. Crear otro registro o utilizar una referencia nueva para el mismo paquete puede duplicar la contratación. Si necesitas cancelar una etiqueta, gestiona la cancelación en Sendcloud y comprueba su resultado y plazo; este módulo no realiza cancelaciones ni garantiza reembolsos del transportista.

Puedes volver a `SENDCLOUD_ENVIRONMENT=test` para impedir nuevas contrataciones desde este módulo. Esto no cancela ni reembolsa etiquetas que ya se hayan creado en el proveedor.

## Alcance técnico y validación

Los presupuestos, la creación, la consulta de envíos y la dirección del remitente utilizan los recursos correspondientes de la API v3 de Sendcloud. Las claves y la descarga de etiquetas se gestionan en el servidor. El módulo mantiene su propio historial de envíos manuales y lo separa de los pedidos del proceso de compra.

Las pruebas automatizadas no crean envíos reales ni verifican las credenciales o los contratos de tu cuenta. La prueba autenticada de conexión y tarifas y la primera contratación real controlada deben realizarse con la cuenta preparada. No incluye recogidas, varios bultos, puntos de recogida, devoluciones, cancelación automática, facturación española ni cobros al cliente.

## Referencias oficiales

- [Autenticación y claves de API](https://sendcloud.dev/docs/getting-started/authentication)
- [Direcciones de remitente](https://sendcloud.dev/docs/addresses/sender-addresses)
- [Servicios y tarifas](https://sendcloud.dev/docs/shipments/shipping-options-and-quotes)
- [Crear un envío con API v3](https://sendcloud.dev/docs/shipments/create-a-shipment)
- [Imprimir etiquetas](https://sendcloud.dev/docs/shipments/print-your-labels)
- [Consultar un envío](https://sendcloud.dev/docs/shipments/retrieve-a-shipment)
- [Configurar webhooks](https://support.sendcloud.com/hc/en-gb/articles/12455997971220-What-are-webhooks-and-how-to-set-them-up-in-Sendcloud)
- [Planes y condiciones de cobro](https://www.sendcloud.com/pricing/)
