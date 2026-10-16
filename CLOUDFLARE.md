# Publicar la tienda y preparar el inventario sin credenciales bancarias

El proyecto incluye un Worker listo para el **modo catálogo**, con gestión real de productos, fotos, precios, existencias, movimientos y usuarios. El escaparate está disponible e indica «Tienda en preparación». El carrito, los presupuestos del proceso de compra, el pago simulado y los webhooks de Mercado Pago y Melhor Envio están bloqueados en la API. El módulo administrativo **Envíos europeos** y su webhook de Sendcloud tienen un flujo independiente, descrito en [SENDCLOUD.md](SENDCLOUD.md). El catálogo no cobra ni reserva nada.

El archivo `wrangler.jsonc` utiliza `COMMERCE_MODE=catalog`, `STORE_CURRENCY=EUR`, `SHIPPING_PROVIDER=sendcloud` y `SENDCLOUD_ENVIRONMENT=test`. En esta etapa no es necesario introducir credenciales del banco español, de Mercado Pago ni de Melhor Envio. La integración europea de pagos y facturación sigue pendiente; cambiar únicamente a `live` no habilita pagos en euros. La traducción al español tampoco cambia el módulo fiscal brasileño de Focus NFe.

## 1. Actualizar el proyecto

Después de integrar la PR, desde la carpeta del repositorio:

```bash
git switch master
git pull
npm ci
npx wrangler login
```

Utiliza Node 24. Si has creado un Worker con un asistente de plantillas, conecta este repositorio: el código y la configuración de este proyecto sustituyen a la plantilla.

## 2. Publicar el Worker

```bash
npm run deploy
```

El comando crea el Worker `edg-ecommerce` y su base de datos SQLite persistente en un Durable Object. No es necesario crear D1, rellenar `database_id`, crear un bucket R2 ni ejecutar el seed. Las migraciones del esquema se aplican automáticamente. No se inserta ningún producto de ejemplo.

Anota la URL HTTPS devuelta, por ejemplo `https://edg-ecommerce.tu-subdominio.workers.dev`.

## 3. Configurar la URL y el administrador

```bash
npx wrangler secret put APP_URL
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
```

Introduce cada valor cuando lo solicite el terminal:

| Configuración | Valor |
| --- | --- |
| `APP_URL` | La URL HTTPS exacta del Worker o del dominio propio, sin ruta. |
| `ADMIN_EMAIL` | Tu correo electrónico para acceder a la administración. |
| `ADMIN_PASSWORD` | Una contraseña exclusiva de entre 12 y 128 caracteres. |

La URL y el correo electrónico se guardan como secretos para que el siguiente despliegue no los sobrescriba. No pegues contraseñas en archivos ni commits. Antes de configurar los tres valores, el escaparate estático puede cargar, pero la API devuelve un error de disponibilidad.

Abre la tienda. El primer acceso a la API crea el administrador. Inicia sesión con el correo electrónico y la contraseña y abre **Gestión** (o `/#admin`). Tras confirmar el inicio de sesión, puedes eliminar `ADMIN_PASSWORD` con `npx wrangler secret delete ADMIN_PASSWORD`: la cuenta ya está guardada de forma persistente. Cambiar ese secreto después no modifica la contraseña de una cuenta existente; utiliza «Mi cuenta» para cambiarla.

## 4. Preparar los productos y el inventario

1. En **Productos**, registra el SKU, el nombre, la categoría, la descripción, el precio y el coste en euros, y las fotos. El peso y las dimensiones se conservan en el catálogo. En el módulo de envíos europeos se introduce además el peso y las tres medidas del bulto embalado, que pueden ser distintos de los datos de un producto individual.
2. Utiliza **Inactivo** para mantener un producto fuera del escaparate mientras lo preparas.
3. En **Inventario**, registra las existencias iniciales y las reposiciones con un motivo. Los movimientos quedan en el historial.
4. Abre **Ver tienda** para revisar el escaparate. Los precios se muestran en euros y las compras no están disponibles.
5. En **Usuarios**, crea accesos para el equipo con el perfil adecuado. La recuperación por correo electrónico solo está disponible después de configurar Resend, el remitente y la clave de cifrado.

El editor acepta JPEG, PNG y WebP de hasta 5 MB; normaliza las imágenes a JPEG de hasta 1280 × 1280 antes de enviarlas. El Worker valida y vuelve a codificar el JPEG, eliminando los metadatos. Cada producto puede tener hasta ocho fotos.

## 5. Preparar Sendcloud sin abrir las compras

Sigue [SENDCLOUD.md](SENDCLOUD.md) para crear la integración API, registrar el remitente de Barcelona y obtener su ID. Añade las claves como secretos del mismo Worker:

```bash
npx wrangler secret put SENDCLOUD_PUBLIC_KEY
npx wrangler secret put SENDCLOUD_SECRET_KEY
npx wrangler secret put SENDCLOUD_SENDER_ADDRESS_ID
```

Introduce los valores cuando lo solicite el terminal. Guarda la clave de firma específica, si la utilizas, con `npx wrangler secret put SENDCLOUD_WEBHOOK_SECRET`. `SENDCLOUD_WEBHOOK_SECRET` es opcional si el webhook usa la clave privada de API como firma; si configuras una clave de firma específica en Sendcloud, debes guardar exactamente esa clave. No incluyas credenciales en commits ni en el navegador.

Mantén `SENDCLOUD_ENVIRONMENT=test` para comenzar. Abre **Gestión → Envíos europeos** con un administrador o un usuario de expedición, comprueba la conexión y consulta tarifas. Estas consultas utilizan la API real; la creación en modo `test` es una simulación local, sin envío ni etiqueta real. El webhook público es `APP_URL` seguido de `/api/webhooks/sendcloud`.

La contratación real se habilita por separado en `SENDCLOUD_ENVIRONMENT=live`, siguiendo la comprobación de cuenta, dirección, servicio y coste de [SENDCLOUD.md](SENDCLOUD.md). Conserva `COMMERCE_MODE=catalog` y `STORE_CURRENCY=EUR`: la logística manual no necesita credenciales bancarias y no habilita el pago europeo.

## Desde el panel de Cloudflare conectado a GitHub

En **Workers & Pages → Create → Import a repository**, selecciona `douglasc-c/edg-ecommerce` después de integrar la PR.

| Campo | Configuración |
| --- | --- |
| Rama de producción | `master` |
| Directorio raíz | `/` (raíz del repositorio) |
| Comando de compilación | `npm ci` |
| Comando de despliegue | `npm run deploy` |
| Versión de Node | `24` |

La configuración de los bindings está en `wrangler.jsonc`. Después del primer despliegue, añade `APP_URL`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` en **Settings → Variables and Secrets**, como secretos, y aplica los cambios.

## Persistencia, tiendas y actualizaciones

Los productos, las fotos, las cuentas, las sesiones, los movimientos, los pedidos y el historial de envíos europeos se guardan en el SQLite del Durable Object. El escaparate se entrega como assets del Worker. Los despliegues conservan los datos. Mantén el nombre del Worker, la clase `CommerceStore`, el binding `STORE` y el nombre interno `primary`: cambiarlos puede apuntar a otra base de datos. No elimines el Worker ni el namespace para actualizar la aplicación.

Esta implementación utiliza una tienda por Worker. Para Brasil y Europa, publica Workers separados con configuraciones propias y datos e inventarios aislados. La moneda es una configuración por tienda: cambiar `EUR` por `BRL` modifica la visualización, pero no convierte los importes. Configura la moneda antes de registrar el catálogo. La arquitectura actual concentra la base de datos en un objeto; para un volumen elevado, reevalúa el particionado y las imágenes en R2.

El cron se ejecuta cada cinco minutos y procesa el mantenimiento y los correos electrónicos configurados. Las reservas también caducan al consultar productos o pedidos. En modo catálogo no hay nuevas reservas. Los datos locales de prueba no se envían a producción.

## Validar antes del despliegue

```bash
npm run check
npm test
npm run test:cloudflare
npm run test:ui
```

La prueba de Workers compila el paquete, lo ejecuta en el runtime de Cloudflare y comprueba la autenticación, la autorización, las fotos, los productos, el inventario, el bloqueo de compras y la persistencia después de reiniciar. No requiere una cuenta de Cloudflare.

Referencias: [SQLite en Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/).
