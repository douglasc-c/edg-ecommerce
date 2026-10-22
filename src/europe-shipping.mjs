import { randomUUID } from 'node:crypto';
import { HttpError, requireThat, text, email, hash, now, safeLink } from './security.mjs';
import { transaction } from './db.mjs';

const countries = [{ code: 'ES', name: 'España (Península y Baleares)' }];
const messages = {
  submitting: 'Solicitud de envío en curso.', unknown: 'Resultado pendiente de conciliación con Sendcloud.',
  simulated: 'Simulación local, sin etiqueta ni transporte real.', label_created: 'Etiqueta creada; pendiente de entrega al transportista.',
  rejected: 'Solicitud rechazada por Sendcloud. Revisa los datos en su panel.',
  in_transit: 'En tránsito.', out_for_delivery: 'En reparto.', ready_for_pickup: 'Listo para recoger.',
  delivered: 'Entregado.', exception: 'Incidencia de transporte.', cancelled: 'Envío cancelado.'
};
const progress = { submitting: -2, unknown: -1, label_created: 0, in_transit: 1, out_for_delivery: 2, ready_for_pickup: 2, delivered: 3, cancelled: 3 };
const terminal = new Set(['delivered', 'cancelled']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const cleanCity = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
function field(value, label, min = 1, max = 150) {
  const result = text(value, label, min, max);
  requireThat(!/[\u0000-\u001f\u007f]/.test(result), 400, `${label}: caracteres no válidos.`);
  return result;
}
function optional(value, label, max = 150) { return value === undefined || value === null || value === '' ? '' : field(value, label, 1, max); }
function destination(input) {
  requireThat(object(input), 400, 'Introduce la dirección del destinatario.');
  const country = field(input.country_code, 'País', 2, 2).toUpperCase();
  requireThat(country === 'ES', 400, 'Solo se admiten destinos en España (Península y Baleares).');
  const postal = field(input.postal_code, 'Código postal', 5, 5);
  requireThat(/^\d{5}$/.test(postal), 400, 'El código postal debe contener cinco dígitos.');
  requireThat(!/^(35|38|51|52)/.test(postal), 400, 'En España solo se admiten la Península y Baleares. Canarias, Ceuta y Melilla requieren una ruta aduanera específica.');
  const telephone = field(input.telephone, 'Teléfono', 7, 30);
  requireThat(/^\+?[\d ()-]+$/.test(telephone) && /^\d{7,15}$/.test(telephone.replace(/\D/g, '')), 400, 'Introduce un teléfono válido, con prefijo internacional.');
  const province = optional(input.state_province_code, 'Código de provincia', 30).toUpperCase();
  if (province) requireThat(/^ES-[A-Z0-9]{1,6}$/.test(province), 400, 'Introduce el código ISO de la provincia española (por ejemplo, ES-M).');
  return {
    name: field(input.name, 'Nombre', 2, 100), company_name: optional(input.company_name, 'Empresa', 100),
    address: field(input.address, 'Calle', 2, 150), house_number: field(input.house_number, 'Número', 1, 25),
    address_2: optional(input.address_2, 'Complemento', 150), postal_code: postal,
    city: field(input.city, 'Ciudad', 2, 100), country_code: country,
    email: email(input.email), telephone: telephone.replace(/[ ()-]/g, ''), ...(province ? { state_province_code: province } : {})
  };
}
function parcel(input) {
  requireThat(object(input), 400, 'Introduce el peso y las medidas del paquete.');
  const result = {};
  for (const key of ['weight', 'width', 'height', 'length']) {
    const value = input[key], weight = key === 'weight';
    requireThat(typeof value === 'number' && Number.isFinite(value) && value >= (weight ? 0.001 : 1) && value <= (weight ? 100 : 300), 400,
      weight ? 'El peso debe estar entre 0,001 y 100 kg.' : 'Cada medida debe estar entre 1 y 300 cm.');
    result[key] = value;
  }
  return result;
}
function senderAddress(sender) {
  requireThat(object(sender) && String(sender.country_code || sender.country || '').toUpperCase() === 'ES' && cleanCity(sender.city) === 'barcelona' && /^08\d{3}$/.test(String(sender.postal_code || '')), 409,
    'Configura en Sendcloud un remitente de Barcelona, España, con código postal 08xxx.');
  return sender;
}
function providerOption(option) {
  requireThat(object(option) && typeof option.id === 'string' && option.id.length > 0 && option.id.length <= 600 && Number.isSafeInteger(option.price) && option.price >= 0 && option.price <= 1000000 && option.currency === 'EUR', 502, 'Sendcloud ha devuelto una tarifa no válida en euros.');
  return {
    id: option.id, name: field(option.name, 'Servicio', 1, 250), carrier: field(option.carrier, 'Transportista', 1, 100), price: option.price, currency: 'EUR',
    days: Number.isSafeInteger(option.days) && option.days > 0 && option.days <= 365 ? option.days : null,
    ...(option.shipping_option_code !== undefined ? { shipping_option_code: option.shipping_option_code } : {}),
    ...(option.contract_id !== undefined ? { contract_id: option.contract_id } : {})
  };
}
function identifier(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : null; }
function timestamp(value) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }

export function europeShipping(db, config, provider) {
  const settings = config.sendcloud || {}, environment = settings.environment === 'live' ? 'live' : 'test';
  const row = id => db.prepare('SELECT * FROM europe_shipments WHERE id=?').get(id);
  const audit = (user, action, id, details = {}) => db.prepare('INSERT INTO audit(actor_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?)').run(user?.id || null, action, id, JSON.stringify(details), now());
  function view(value) {
    if (!value) return null;
    const { request_hash, idempotency_key, ...result } = value;
    result.destination = JSON.parse(value.destination); result.parcel = JSON.parse(value.parcel); result.service = JSON.parse(value.service);
    result.events = db.prepare('SELECT id,status,message,created_at FROM europe_shipment_events WHERE shipment_id=? ORDER BY id').all(value.id);
    return result;
  }
  function status() {
    const missing = [];
    if (config.shippingProvider !== 'sendcloud') missing.push('SHIPPING_PROVIDER=sendcloud');
    if (!['test', 'live'].includes(settings.environment)) missing.push('SENDCLOUD_ENVIRONMENT');
    for (const [key, name] of [['publicKey', 'SENDCLOUD_PUBLIC_KEY'], ['secretKey', 'SENDCLOUD_SECRET_KEY'], ['senderAddressId', 'SENDCLOUD_SENDER_ADDRESS_ID']]) if (!settings[key]) missing.push(name);
    if (environment === 'live' && !settings.webhookSecret) missing.push('SENDCLOUD_WEBHOOK_SECRET');
    return { provider: 'sendcloud', environment, configured: missing.length === 0, missing, origin: { city: 'Barcelona', country_code: 'ES' }, countries, webhook_url: `${String(config.url || '').replace(/\/$/, '')}/api/webhooks/sendcloud`, checkout_enabled: false };
  }
  function ready() { requireThat(status().configured, 503, 'Completa la configuración de Sendcloud en el servidor.'); }
  function event(id, key, state, created = now()) {
    db.prepare('INSERT OR IGNORE INTO europe_shipment_events(shipment_id,event_key,status,message,created_at) VALUES(?,?,?,?,?)').run(id, key, state, messages[state], created);
  }
  function apply(id, data, eventKey = null) {
    const stored = row(id); requireThat(stored, 404, 'Envío no encontrado.');
    requireThat(object(data), 502, 'Respuesta de seguimiento no válida.');
    const shipmentId = identifier(data.shipment_id), parcelId = identifier(data.parcel_id);
    requireThat(shipmentId && parcelId, 502, 'Sendcloud no ha confirmado las referencias del envío y del paquete.');
    if (data.reference) requireThat(data.reference === stored.reference, 502, 'La referencia del envío no coincide.');
    if (stored.provider_shipment_id && shipmentId) requireThat(stored.provider_shipment_id === shipmentId, 502, 'La referencia del envío no coincide.');
    if (stored.provider_parcel_id && parcelId) requireThat(stored.provider_parcel_id === parcelId, 502, 'La referencia del paquete no coincide.');
    const state = Object.hasOwn(messages, data.status) && !['simulated', 'submitting'].includes(data.status) ? data.status : 'unknown';
    const occurred = timestamp(data.event_at || data.occurred_at), stale = !['submitting', 'unknown', 'rejected'].includes(stored.status) && occurred && stored.last_event_at && occurred < stored.last_event_at;
    const backwards = progress[state] !== undefined && progress[stored.status] !== undefined && progress[state] < progress[stored.status];
    const blocked = stale || terminal.has(stored.status) && stored.status !== state || backwards;
    if (blocked) return view(stored);
    const code = data.tracking_code ? field(String(data.tracking_code), 'Seguimiento', 1, 150) : stored.tracking_code;
    const url = data.tracking_url ? safeLink(data.tracking_url) : stored.tracking_url;
    const changed = stored.status !== state;
    return transaction(db, () => {
      db.prepare('UPDATE europe_shipments SET status=?,provider_shipment_id=?,provider_parcel_id=?,tracking_code=?,tracking_url=?,last_event_at=?,last_error=NULL,updated_at=? WHERE id=?')
        .run(state, shipmentId || stored.provider_shipment_id, parcelId || stored.provider_parcel_id, code || null, url || null, occurred || stored.last_event_at, now(), id);
      if (changed) event(id, eventKey || `sendcloud:${hash(JSON.stringify([id, state, occurred]))}`, state, occurred || now());
      return view(row(id));
    });
  }
  async function reconcile(stored) {
    let data;
    if (stored.provider_shipment_id) data = await provider.retrieve(stored.provider_shipment_id, stored.provider_parcel_id);
    else data = await provider.lookup(stored.reference);
    if (!data) {
      db.prepare('UPDATE europe_shipments SET last_error=?,updated_at=? WHERE id=?').run('El envío todavía no aparece en Sendcloud. No se ha repetido la solicitud de creación.', now(), stored.id);
      return view(row(stored.id));
    }
    return apply(stored.id, data);
  }
  return {
    status,
    async checkConnection() { ready(); const sender = senderAddress(await provider.sender()); return { ...status(), ready: true, sender }; },
    async quote(user, input) {
      ready(); requireThat(user?.id, 401, 'Inicia sesión.'); requireThat(object(input), 400, 'Solicitud de tarifa no válida.');
      const target = destination(input.destination), box = parcel(input.parcel), sender = senderAddress(await provider.sender());
      const result = await provider.quote({ sender, destination: target, parcel: box });
      requireThat(Array.isArray(result) && result.length <= 200, 502, 'Respuesta de tarifas no válida.');
      const options = result.map(providerOption); requireThat(new Set(options.map(option => option.id)).size === options.length, 502, 'Sendcloud ha devuelto servicios duplicados.');
      const id = randomUUID(), expires = new Date(Date.now() + 600000).toISOString();
      db.prepare('INSERT INTO europe_quotes(id,actor_id,payload,options,expires_at) VALUES(?,?,?,?,?)').run(id, user.id, JSON.stringify({ environment, sender, destination: target, parcel: box }), JSON.stringify(options), expires);
      audit(user, 'europe_shipping.quote', id, { environment, country: target.country_code, services: options.length });
      return { id, environment, currency: 'EUR', destination: target, parcel: box, options, expires_at: expires };
    },
    async create(user, input, idempotencyKey) {
      ready(); requireThat(user?.id, 401, 'Inicia sesión.'); requireThat(object(input), 400, 'Solicitud de envío no válida.');
      const quoteId = field(input.quote_id, 'Cotización', 1, 100), serviceId = field(input.service_id, 'Servicio', 1, 600);
      const orderReference = optional(input.order_reference, 'Referencia del pedido', 100);
      const key = hash(JSON.stringify([environment, user.id, field(idempotencyKey, 'Clave de idempotencia', 8, 200)]));
      const requestHash = hash(JSON.stringify({ environment, quote_id: quoteId, service_id: serviceId, order_reference: orderReference }));
      const existing = db.prepare('SELECT * FROM europe_shipments WHERE idempotency_key=?').get(key) || db.prepare('SELECT * FROM europe_shipments WHERE quote_id=?').get(quoteId);
      if (existing) {
        requireThat(existing.actor_id === user.id && existing.environment === environment && existing.request_hash === requestHash, 409, 'La clave o cotización ya se ha utilizado para otro envío.');
        return view(existing);
      }
      if (environment === 'live') requireThat(input.confirm_live === true, 409, 'Confirma expresamente la creación de una etiqueta real, con posible coste.');
      const quote = db.prepare('SELECT * FROM europe_quotes WHERE id=? AND actor_id=?').get(quoteId, user.id);
      requireThat(quote, 404, 'Cotización no encontrada.');
      requireThat(quote.expires_at > now(), 409, 'La cotización ha caducado. Solicita una nueva tarifa.');
      const payload = JSON.parse(quote.payload); requireThat(payload.environment === environment, 409, 'El entorno de la cotización no coincide.');
      requireThat(String(payload.sender.id) === String(settings.senderAddressId), 409, 'El remitente ha cambiado. Solicita una nueva cotización.');
      // Las cotizaciones anteriores también deben respetar el alcance vigente antes de crear un envío nuevo.
      payload.destination = destination(payload.destination);
      const option = JSON.parse(quote.options).find(item => item.id === serviceId); requireThat(option, 400, 'Selecciona un servicio de la cotización.');
      const id = randomUUID(), reference = `edg-eu-${id}`, created = now(), state = environment === 'test' ? 'simulated' : 'submitting';
      // Se persiste antes de toda llamada de creación: ni reintentos ni claves nuevas pueden comprar una segunda etiqueta para la misma cotización.
      transaction(db, () => {
        db.prepare('INSERT INTO europe_shipments(id,quote_id,reference,order_reference,environment,status,destination,parcel,service,price,currency,request_hash,idempotency_key,actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, quoteId, reference, orderReference || null, environment, state, JSON.stringify(payload.destination), JSON.stringify(payload.parcel), JSON.stringify(option), option.price, 'EUR', requestHash, key, user.id, created, created);
        event(id, `${id}:created`, state, created); audit(user, 'europe_shipping.create', id, { environment, service_id: option.id });
      });
      if (environment === 'test') return view(row(id));
      try { return apply(id, await provider.create({ reference, sender: payload.sender, destination: payload.destination, parcel: payload.parcel, option })); }
      catch (error) {
        if (error.rejected === true) {
          transaction(db, () => {
            db.prepare('UPDATE europe_shipments SET status=?,last_error=?,updated_at=? WHERE id=?').run('rejected', messages.rejected, now(), id);
            event(id, `${id}:rejected`, 'rejected');
          });
          throw new HttpError(422, messages.rejected);
        }
        transaction(db, () => {
          db.prepare('UPDATE europe_shipments SET status=?,provider_shipment_id=COALESCE(?,provider_shipment_id),provider_parcel_id=COALESCE(?,provider_parcel_id),last_error=?,updated_at=? WHERE id=?')
            .run('unknown', identifier(error.shipment_id), identifier(error.parcel_id), 'Respuesta incierta de Sendcloud. Consulta este envío para conciliarlo; no crees otra etiqueta para el mismo paquete.', now(), id);
          event(id, `${id}:unknown`, 'unknown');
        });
        throw new HttpError(502, 'Respuesta incierta de Sendcloud. El envío quedó registrado; actualiza su seguimiento para conciliarlo sin repetir la compra.');
      }
    },
    list() { return db.prepare('SELECT * FROM europe_shipments ORDER BY created_at DESC LIMIT 200').all().map(view); },
    get(id) { const stored = row(id); requireThat(stored, 404, 'Envío no encontrado.'); return view(stored); },
    async sync(user, id) {
      const stored = row(id); requireThat(stored, 404, 'Envío no encontrado.');
      if (stored.environment === 'test') return view(stored);
      ready(); requireThat(stored.environment === environment, 409, 'Consulta el envío con su configuración original.');
      audit(user, 'europe_shipping.sync', id, { environment });
      try { return await reconcile(stored); }
      catch { throw new HttpError(502, 'No se pudo consultar Sendcloud. El envío conserva su estado y no se ha creado otra etiqueta.'); }
    },
    async download(id) {
      const stored = row(id); requireThat(stored, 404, 'Envío no encontrado.');
      requireThat(stored.environment === 'live', 409, 'Las simulaciones locales no generan una etiqueta PDF ni un transporte real.');
      ready(); requireThat(environment === 'live', 409, 'Descarga la etiqueta con su configuración original.');
      requireThat(stored.provider_shipment_id && stored.provider_parcel_id && !['unknown', 'submitting', 'cancelled', 'rejected'].includes(stored.status), 409, 'La etiqueta todavía no está disponible. Consulta primero el envío.');
      return provider.label(stored.provider_shipment_id, stored.provider_parcel_id);
    },
    async webhook(headers, raw) {
      await provider.verifyWebhook(headers, raw);
      let body; try { body = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { throw new HttpError(400, 'Webhook no válido.'); }
      requireThat(object(body), 400, 'Webhook no válido.');
      if (environment !== 'live') return { received: true, ignored: true };
      const parcelId = identifier(body.parcel?.id ?? body.data?.parcel?.id), shipmentId = identifier(body.shipment?.id ?? body.data?.shipment?.id);
      if (!parcelId && !shipmentId) return { received: true, ignored: true };
      const stored = db.prepare("SELECT * FROM europe_shipments WHERE environment='live' AND ((provider_parcel_id IS NOT NULL AND provider_parcel_id=?) OR (provider_shipment_id IS NOT NULL AND provider_shipment_id=?)) LIMIT 1").get(parcelId, shipmentId);
      if (!stored) return { received: true, ignored: true };
      // El evento firmado solo identifica el registro; estados y enlaces se vuelven a consultar al proveedor.
      const result = await reconcile(stored);
      if (result.status !== stored.status) audit(null, 'europe_shipping.webhook', stored.id, { status: result.status });
      return { received: true };
    }
  };
}
