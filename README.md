> **Cloudflare sin credenciales bancarias:** consulta [CLOUDFLARE.md](CLOUDFLARE.md) para publicar el catálogo y preparar productos y existencias reales con el proceso de compra bloqueado.

# EDG Commerce

Tienda online y panel de operaciones integrados: catálogo, carrito persistente, proceso de compra, pedidos, inventario, finanzas, expedición y usuarios con permisos por función. Interfaz en español de España, adaptable a móviles, con área de cliente y área de gestión.

La traducción de la interfaz no cambia las integraciones: el módulo fiscal actual emite **NF-e brasileñas mediante Focus NFe**. La facturación española y el pago europeo siguen pendientes de integración.

## Ejecutar en local

Requiere **Node.js 24**. El servidor utiliza HTTP, criptografía y SQLite nativos de Node. La biblioteca Sharp valida y optimiza las fotos. Instala las dependencias con `npm ci` antes de ejecutar.

```bash
cp .env.example .env
```

Rellena `ADMIN_EMAIL` y `ADMIN_PASSWORD` con una contraseña exclusiva de al menos 12 caracteres. Después:

```bash
npm ci
npm run seed
npm start
```

Abre http://localhost:3000. Inicia sesión con el administrador configurado para acceder a la gestión. Los clientes crean sus propias cuentas desde la tienda. `npm run seed` se puede repetir y no sustituye las contraseñas existentes.

En modo `demo`, el seed crea seis productos de ejemplo. Los pagos y los envíos son **simulados**, con un aviso permanente en la interfaz. El cliente puede simular la aprobación desde el detalle del pedido; no se realiza ninguna transacción real. Los productos de ejemplo utilizan símbolos ilustrativos hasta que subas las fotos desde el panel.

## Ejecutar en local con Docker

Con Docker Desktop abierto y el archivo `.env` cumplimentado con `ADMIN_EMAIL` y `ADMIN_PASSWORD` (al menos 12 caracteres):

```bash
docker compose up -d --build
```

Abre http://localhost:3000. Compose prepara automáticamente el administrador y el catálogo en modo demo. Los datos se guardan en el volumen persistente `commerce-data`.

```bash
docker compose logs -f app  # seguir los registros
docker compose stop        # detener
docker compose up -d       # volver a iniciar
```

## Funciones implementadas

| Área | Funciones |
|---|---|
| Tienda | Búsqueda, categorías, detalle del producto, precios, disponibilidad y carrito persistente por cliente |
| Proceso de compra | Dirección, presupuesto en el servidor, elección del envío, reserva de existencias y creación idempotente del pedido |
| Cliente | Registro, inicio de sesión, cambio de contraseña, historial de pedidos, pago, cancelación antes del pago y seguimiento |
| Catálogo | SKU único, categoría, descripción, precio, coste, dimensiones, peso, estado, galería de fotos y datos fiscales |
| Cupones | Porcentaje o importe fijo, compra mínima, descuento máximo, periodo, límite total y límite por cliente |
| NF-e brasileña | Emisión con Focus NFe, consulta de autorización, DANFE/XML con acceso autenticado, cancelación y clave integrada en la etiqueta |
| Recuperación | Enlace por correo electrónico, un solo uso, caducidad, revocación de sesiones y cola con reintentos mediante Resend |
| Inventario | Existencias físicas, reservadas y disponibles, avisos de reposición e historial de entradas y salidas con responsable |
| Pedidos | Pago, preparación, embalaje, envío, entrega, cancelación, reembolso y cronología |
| Finanzas | Ingresos confirmados, reembolsos totales y parciales, gastos, saldo y exportación CSV |
| Expedición | Presupuestos de Melhor Envio, creación de etiquetas comerciales con clave de NF-e, compra del envío, impresión y seguimiento |
| Gestión | Panel de control, perfiles por función, bloqueo de usuarios, revocación de sesiones y auditoría |

## Permisos

| Perfil | Accesos |
|---|---|
| Administrador | Todas las operaciones |
| Inventario | Panel operativo, catálogo, ajustes de inventario y consulta de pedidos |
| Finanzas | Panel financiero, pedidos, gastos, reembolsos, cupones y emisión fiscal |
| Expedición | Panel operativo, consulta de pedidos, preparación, embalaje, envío, entrega y etiquetas |
| Atención al cliente | Panel operativo y consulta de pedidos |
| Cliente | Su carrito y sus propios pedidos |

El servidor comprueba los permisos. El registro público siempre crea un cliente, independientemente de los campos adicionales enviados. El cliente no recibe los costes internos de los artículos ni los identificadores internos de pagos y etiquetas.

## Reglas de funcionamiento

- Los importes monetarios son enteros en céntimos. El servidor calcula los precios y los totales; los valores enviados por el navegador no determinan el cobro.
- Los presupuestos duran 10 minutos y están vinculados al cliente, al código postal y al contenido del carrito, incluidas las dimensiones y los precios.
- El proceso de compra reserva unidades en una transacción SQLite. La aprobación descuenta las existencias físicas y libera la reserva **una sola vez**.
- La reserva dura 30 minutos por defecto. La caducidad y la cancelación liberan las unidades. El mantenimiento se ejecuta cada minuto y también antes de las operaciones relevantes.
- Un pago tardío tras la caducidad intenta descontar las unidades que sigan disponibles. Si faltan unidades, el pedido pasa a **pago en revisión** y el equipo de finanzas debe reembolsarlo. Un pedido cancelado con un pago tardío siempre requiere revisión.
- Solo los pagos aprobados, sin reembolso parcial, pueden pasar a expedición. Las transiciones manuales siguen el orden establecido; el envío exige un código de seguimiento.
- Un reembolso confirmado repone automáticamente las existencias solo antes de la expedición. Tras el envío, el equipo debe comprobar la devolución y registrar la entrada en el inventario.
- Los webhooks duplicados no duplican ingresos, descuentos de existencias ni reembolsos. Las notificaciones de envío retrasadas no hacen que un pedido entregado vuelva al estado enviado.
- Un segundo cobro de un pedido ya pagado queda registrado en la auditoría (`payment.duplicate`) y debe revisarse en la pasarela; no vuelve a descontar existencias.

## Pagos reales: Mercado Pago

Define `COMMERCE_MODE=live`, `APP_URL` con tu origen público HTTPS y:

- `MERCADO_PAGO_ACCESS_TOKEN`;
- `MERCADO_PAGO_WEBHOOK_SECRET`;
- `MERCADO_PAGO_COLLECTOR_ID` (ID de la cuenta receptora).

El proceso de compra crea una preferencia de **Checkout Pro** y redirige a la página de Mercado Pago. Los medios disponibles dependen de la cuenta y del proveedor. El sistema no captura ni almacena datos de tarjetas.

Registra `https://TU-DOMINIO/api/webhooks/mercadopago` en las notificaciones de pago de la aplicación. El endpoint valida la firma y consulta el pago en la API oficial antes de comprobar el pedido, el receptor, la moneda y el importe. El retorno del navegador nunca confirma el pago.

Valida la aprobación, el estado pendiente, el rechazo, la caducidad y el reembolso con las cuentas de prueba antes de operar. No se han realizado cobros reales ni pruebas autenticadas con el proveedor durante la implementación.

## Envíos reales: Melhor Envio

Configura `MELHOR_ENVIO_TOKEN`, `SUPPORT_EMAIL`, `ORIGIN_POSTAL_CODE` y `MELHOR_ENVIO_SANDBOX`. Los presupuestos utilizan los pesos y las dimensiones del catálogo, así como el precio y el plazo personalizados que devuelve la API.

Para las etiquetas, configura `SHIPPING_FROM_JSON` con los datos completos del remitente, el documento correspondiente (CPF o CNPJ) y la inscripción estatal brasileña. Al emitir la NF-e desde el sistema, la clave autorizada en producción se reutiliza en la etiqueta. También se puede introducir una clave externa cuando el pedido no tiene una emisión integrada. La creación, la compra y la impresión son acciones independientes; la compra del envío utiliza el saldo de la cuenta de Melhor Envio y requiere confirmación en la interfaz. No se ha contratado ninguna entrega real.

Las actualizaciones automáticas utilizan `/api/webhooks/melhorenvio`. Configura `MELHOR_ENVIO_WEBHOOK_SECRET` con el secreto de la aplicación integrada y registra el endpoint en esa misma aplicación. La firma `X-ME-Signature` se comprueba sobre el cuerpo original. Los tokens generados directamente desde el panel permiten obtener presupuestos y realizar consultas, pero el webhook depende de una aplicación integrada; en esos casos, utiliza el botón **Consultar transportista**.

La consulta actualiza el código de seguimiento y avanza a enviado o entregado cuando el proveedor confirma la admisión o la entrega. También registra los intentos fallidos y las interrupciones en la cronología. Se puede introducir manualmente un enlace de seguimiento externo para envíos fuera de la integración.

## Pruebas

```bash
npm run check
npm test
```

Las pruebas de API y reglas de negocio utilizan una base de datos en memoria y no llaman a proveedores reales. También se ha ejecutado y superado la prueba de navegador del flujo de compra, expedición, entrega y reposición, con inspección visual en ordenador y móvil. La integración continua también ejecuta el flujo de demostración en un navegador de escritorio y comprueba la navegación en pantalla móvil. Para repetir las pruebas de navegador en local, instala las dependencias de desarrollo y Chromium:

```bash
npm install
npx playwright install chromium
npm run test:ui
```

## Alojamiento y datos

Hay un `Dockerfile` con un usuario sin privilegios, el volumen `/data` y una comprobación de estado. El contenedor está configurado para producción; rellena las credenciales y configura HTTPS en el proxy inverso. Ejecuta el seed una vez en el mismo volumen para preparar el administrador y después elimina `ADMIN_PASSWORD` del entorno de ejecución.

Utiliza **una sola instancia del servidor** con disco persistente y copias de seguridad de SQLite. La aplicación no es adecuada para funciones de Vercel con un sistema de archivos efímero ni para múltiples réplicas que compartan la base de datos. Para ese escenario, migra la persistencia a PostgreSQL y añade colas para las tareas externas. Para obtener una copia de seguridad coherente, utiliza la API de copia de seguridad de SQLite o detén el proceso y copia la base de datos junto con los archivos WAL/SHM; no copies únicamente el archivo `.db` mientras el servidor esté escribiendo.

## Límites de esta primera versión

Esta versión cubre la compra, las operaciones, las fotos, los cupones, la recuperación de contraseña y la integración de emisión de NF-e brasileñas. Antes de abrir la tienda, necesita las credenciales de los proveedores, un catálogo real, la identidad de la tienda y el alojamiento. Las API externas se han verificado mediante su documentación y con pruebas de respuestas controladas; **todavía es necesaria la homologación autenticada**.

Todavía no incluye variantes de talla o color, cálculo tributario automático, conciliación automática de comisiones, devoluciones con logística inversa, verificación de correo electrónico, avisos de venta por correo electrónico o WhatsApp, múltiples almacenes ni integración de compras con proveedores. La emisión fiscal utiliza los datos tributarios configurados y revisados; no determina automáticamente el régimen, CFOP, CSOSN, DIFAL, IBS/CBS ni los tipos impositivos.

En la integración de etiquetas, la creación automática se limita a presupuestos de **un solo bulto**; los servicios que exigen una oficina, XML fiscal o varios bultos requieren ampliar el adaptador u operar desde el panel de Melhor Envio. No repitas una creación o compra ante una respuesta incierta sin comprobar el panel del proveedor. Para recuperar automáticamente estos casos y los webhooks perdidos, la siguiente evolución debe incluir una cola duradera y conciliación periódica.

Los listados administrativos tienen límites de 200 pedidos, usuarios o movimientos y 500 apuntes; el saldo del panel considera todo el historial. Implementa la paginación antes de alcanzar un gran volumen. El gráfico utiliza magnitudes absolutas y no constituye un informe contable.

## Documentación de referencia

- [Mercado Pago: Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview)
- [Mercado Pago: notificaciones](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications)
- [Melhor Envio: presupuestos](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos)
- [Melhor Envio: creación de etiquetas](https://docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho)
- [Melhor Envio: webhooks](https://docs.melhorenvio.com.br/docs/webhooks)

## Fotos de los productos

En el panel **Productos**, abre el editor y sube archivos JPEG, PNG o WebP de hasta 5 MB por archivo y ocho fotos por producto. La primera foto es la portada. Guarda el producto después de subir las fotos; se pueden eliminar imágenes de la galería desde el editor.

El servidor decodifica la imagen, limita el número de píxeles, corrige la orientación, reduce el tamaño hasta 1280 px y genera un JPEG sin metadatos. No se aceptan archivos SVG ni archivos no válidos. La foto optimizada se guarda en SQLite, en el mismo almacenamiento persistente de la aplicación; por tanto, las copias de seguridad también incluyen las imágenes. Los archivos subidos sin asociación pueden permanecer almacenados y requieren una futura limpieza administrativa.

## Cupones

Los administradores y el equipo de finanzas pueden crear y activar o desactivar cupones. Los porcentajes utilizan centésimas de porcentaje internamente; los importes fijos, mínimos y máximos utilizan céntimos. El descuento solo se aplica a los productos y mantiene al menos un céntimo para evitar que se envíen pedidos gratuitos a la pasarela.

El proceso de compra recalcula las reglas en una transacción junto con la reserva de existencias. Los pedidos pendientes reservan un uso del cupón; la cancelación y la caducidad lo liberan. El pago confirma el uso y el reembolso no permite reutilizar la promoción. Una vez que haya pedidos vinculados, las condiciones no se pueden editar: desactiva el cupón y crea otro código. Los pagos tardíos mantienen el descuento contratado y pueden consumir un uso que ya se había liberado; el límite evita nuevos procesos de compra sin modificar retroactivamente un cobro.

El descuento se reparte en céntimos exactos entre los artículos del proceso de compra de Mercado Pago y de la NF-e, conservando el total del pedido. Las condiciones futuras de un cupón no modifican los pedidos ya creados.

## Recuperación de contraseña por correo electrónico

Configura `RESEND_API_KEY`, `EMAIL_FROM` (remitente verificado en Resend) y `EMAIL_ENCRYPTION_KEY` (32 bytes en hexadecimal, estable). No expongas estas claves en el navegador. El endpoint público no revela si una cuenta existe.

El enlace dura 30 minutos, solo se puede utilizar una vez y contiene un token aleatorio cuyo hash se guarda en la base de datos. Una nueva solicitud invalida el enlace anterior; el cambio de contraseña revoca las sesiones y los demás enlaces de la cuenta. El cambio manual de contraseña y los cambios de acceso realizados por el administrador también invalidan los enlaces pendientes.

El mensaje entra en una cola persistente, con el contenido cifrado mediante AES-256-GCM y hasta cinco intentos. El servidor procesa la cola cada minuto. La clave de envío es idempotente y el contenido cifrado se borra tras confirmar el envío. Guarda la clave de cifrado de forma segura; perderla o cambiarla impide el envío de mensajes pendientes. La aceptación por Resend no garantiza la entrega en el buzón del destinatario; consulta el panel del proveedor para comprobar rechazos, supresiones y devoluciones.

En modo demo no se envía el mensaje: el administrador ve el texto y el enlace en **Correos electrónicos**, para probar el flujo. Esta vista del contenido no existe en modo live. La clave de cifrado de la simulación se guarda en la base de datos para poder reiniciar el entorno. Al alternar entre demo y live, se invalidan los enlaces y los mensajes pendientes.

## Emisión de NF-e brasileñas

Integración de **NF-e de mercancías de Brasil mediante Focus NFe**. Este módulo no emite facturas españolas ni implementa VERI*FACTU. Configura la empresa y los recursos necesarios en el proveedor, tu `FOCUS_NFE_TOKEN`, `NFE_EMITTER_JSON`, `NFE_DEFAULTS_JSON` y `NFE_ENVIRONMENT=homologation` para empezar.

El emisor sigue el formato de Focus NFe: CNPJ, nombre, inscripción estatal, régimen tributario y dirección. Los parámetros generales deben incluir la naturaleza de la operación, la modalidad de envío, el consumidor final y el indicador de inscripción estatal del destinatario, además de los demás campos exigidos para tu operación.

Registra NCM, CFOP, unidad, origen y situaciones tributarias de ICMS, PIS y COFINS en el producto. Se pueden introducir campos tributarios adicionales en el editor avanzado. **Las clasificaciones, las bases imponibles, los importes de los tributos y los tipos impositivos deben ser configurados y revisados por el responsable contable para cada operación.** El sistema conserva una instantánea fiscal de los productos en el pedido; los cambios posteriores del catálogo no modifican la venta anterior. Los pedidos antiguos sin datos fiscales se pueden completar durante la revisión de la emisión.

En el detalle de un pedido pagado, antes del envío, pulsa **Emitir NF-e**, comprueba los artículos fiscales y confirma. Introduce también el código fiscal del medio de pago efectivamente recibido y sus datos complementarios (incluidos los de la entidad adquirente y la autorización cuando corresponda). La integración no presupone que todo pago de Mercado Pago sea PIX o tarjeta. El servidor obtiene del pedido los precios, las cantidades, el destinatario, el descuento, el envío y el importe del pago. No se pueden modificar estos valores enviando datos fiscales arbitrarios. Esta implementación cubre la venta de mercancías con totales ya contratados; las operaciones que añaden importes como IPI/ST al total del pedido requieren ampliar el cálculo comercial antes de la emisión.

Cada pedido tiene una referencia fiscal persistente. La emisión puede quedar en proceso: utiliza **Consultar estado** hasta la autorización. Un fallo de comunicación queda marcado como incierto e impide un nuevo envío hasta que se realice la consulta. Si la consulta confirma que no hay una NF-e en el proveedor, se puede volver a enviar con la misma referencia; los rechazos se pueden corregir y reenviar. La aplicación no cambia la referencia para eludir una respuesta incierta.

El DANFE y el XML están disponibles en el pedido mediante rutas autenticadas. Los clientes solo pueden acceder a los documentos de sus propios pedidos. Para contratar una etiqueta real, la emisión vinculada debe estar autorizada en producción; los documentos simulados, de homologación, cancelados o pendientes no sirven para esa etiqueta. Los envíos manuales con una NF-e vinculada también requieren autorización en el entorno correcto.

La cancelación de una NF-e exige una justificación y la confirmación del proveedor, y la aplicación la bloquea después de la expedición. El proveedor o la SEFAZ deciden los plazos y las condiciones de autorización y cancelación. La cancelación fiscal y el reembolso financiero son operaciones independientes. Las cartas de corrección, la inutilización, los documentos fiscales de devolución y la NF-e complementaria todavía no forman parte de este módulo.

El modo demo simula la autorización y la cancelación sin enviar datos a la SEFAZ ni generar DANFE/XML reales. En modo live, la homologación se identifica en la interfaz y utiliza el endpoint específico; la producción exige `NFE_ENVIRONMENT=production`, un token adecuado y datos revisados. No se ha emitido ningún documento fiscal real durante la implementación. Sigue siendo necesaria la homologación autenticada de tu empresa.

Las migraciones al esquema v2 son automáticas y conservan los registros y pedidos existentes; haz una copia de seguridad antes de actualizar una instalación. El operador consulta el procesamiento fiscal; esta versión no incluye webhook de Focus NFe ni consulta fiscal automática.

- [Focus NFe: emisión](https://doc.focusnfe.com.br/reference/emitir_nfe)
- [Focus NFe: consulta](https://doc.focusnfe.com.br/reference/consultar_nfe)
- [Focus NFe: cancelación](https://doc.focusnfe.com.br/reference/cancelar_nfe)
- [Resend: envío](https://resend.com/docs/api-reference/emails/send-email)
