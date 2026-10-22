import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database } from '../src/db.mjs';
import { europeShipping } from '../src/europe-shipping.mjs';
import { HttpError, now } from '../src/security.mjs';

const address = { name: 'Cliente de prueba', company_name: '', address: 'Calle de prueba', house_number: '10', address_2: '', postal_code: '28001', city: 'Madrid', country_code: 'ES', email: 'cliente@example.com', telephone: '+34 910123456' };
const box = { weight: 2.4, width: 25, height: 15, length: 85 };
const sender = { id: 123, name: 'EDG', address: 'Carrer de prova', house_number: '1', city: 'BÁRCELONA', postal_code: '08001', country_code: 'ES' };
const option = { id: 'test:home|', name: 'Entrega a domicilio', carrier: 'Transportista de prueba', price: 1295, currency: 'EUR', days: 4, shipping_option_code: 'test:home', contract_id: null };
function fixture(t, environment = 'test', overrides = {}) {
  const db = database(':memory:'); t.after(() => db.close());
  const user = { id: randomUUID(), name: 'Gestión', email: 'gestion@example.com', role: 'shipping' };
  const other = { id: randomUUID(), name: 'Otra cuenta', email: 'other@example.com', role: 'admin' };
  for (const actor of [user, other]) db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(actor.id, actor.name, actor.email, 'unused', actor.role, now());
  const config = { shippingProvider: 'sendcloud', url: 'https://example.com', sendcloud: { environment, publicKey: 'public-fixture', secretKey: 'private-fixture', webhookSecret: 'signature-fixture', senderAddressId: '123' } };
  const calls = { sender: 0, quote: 0, create: 0, retrieve: 0, lookup: 0, label: 0, verify: 0 };
  let receipt = { shipment_id: 'shipment-1', parcel_id: '12345', tracking_code: 'TRACK-123', tracking_url: 'https://tracking.example.com/TRACK-123', status: 'label_created', occurred_at: '2026-10-16T10:00:00.000Z' };
  const provider = {
    async sender() { calls.sender++; return sender; },
    async quote(input) { calls.quote++; assert.equal(input.sender.id, 123); return [option]; },
    async create(input) { calls.create++; return { ...receipt, reference: input.reference }; },
    async retrieve() { calls.retrieve++; return receipt; },
    async lookup() { calls.lookup++; return receipt; },
    async label() { calls.label++; return Buffer.from('%PDF-fixture'); },
    verifyWebhook() { calls.verify++; return true; }, ...overrides
  };
  return { db, user, other, config, calls, provider, service: europeShipping(db, config, provider), setReceipt(value) { receipt = value; } };
}
const quote = (f, change = {}) => f.service.quote(f.user, { destination: { ...address, ...change }, parcel: box });
const create = (f, q, changes = {}, key = randomUUID()) => f.service.create(f.user, { quote_id: q.id, service_id: q.options[0].id, order_reference: 'PEDIDO-1', confirm_live: true, ...changes }, key);

test('la configuración no revela claves y el remitente se valida mediante una consulta de solo lectura', async t => {
  const f = fixture(t), status = f.service.status();
  assert.equal(status.configured, true); assert.equal(status.checkout_enabled, false);
  assert.deepEqual(status.countries.map(c => c.code), ['ES']);
  assert.equal(status.webhook_url, 'https://example.com/api/webhooks/sendcloud');
  assert.ok(!JSON.stringify(status).includes('fixture'));
  assert.equal((await f.service.checkConnection()).sender.postal_code, '08001');
  assert.equal(f.calls.create, 0);
  const disabled = europeShipping(f.db, { ...f.config, shippingProvider: 'melhor_envio', sendcloud: {} }, f.provider);
  assert.equal(disabled.status().configured, false);
  await assert.rejects(disabled.checkConnection(), error => error.status === 503);
});

test('los países, códigos postales y medidas se validan antes de consultar tarifas', async t => {
  const f = fixture(t);
  for (const change of [{ country_code: 'FR' }, { country_code: 'DE', postal_code: '10115' }, { country_code: 'IT', postal_code: '20121', state_province_code: 'IT-MI' }, { country_code: 'PT', postal_code: '1234-567' }, { postal_code: '1011' }, { postal_code: 'abcde' }, { postal_code: '35001' }, { postal_code: '38001' }, { postal_code: '51001' }, { postal_code: '52001' }]) await assert.rejects(quote(f, change), error => error.status === 400);
  for (const parcel of [{ ...box, weight: 0 }, { ...box, width: 0 }, { ...box, length: 301 }, { ...box, height: '15' }, { ...box, weight: Infinity }, { weight: 1 }]) await assert.rejects(f.service.quote(f.user, { destination: address, parcel }), error => error.status === 400);
  for (const change of [{ email: 'bad-email' }, { telephone: 'not a number' }, { city: 'Madrid\nInjected' }, { house_number: '' }, { state_province_code: 'IT-RM' }]) await assert.rejects(quote(f, change), error => error.status === 400);
  assert.equal(f.calls.quote, 0); assert.equal(f.calls.sender, 0);
  assert.equal((await quote(f)).destination.postal_code, '28001');
  assert.equal((await quote(f, { postal_code: '07001', city: 'Palma' })).destination.country_code, 'ES');
  assert.equal((await quote(f, { state_province_code: 'es-m' })).destination.state_province_code, 'ES-M');
});

test('las cotizaciones anteriores fuera del alcance no pueden crear simulaciones ni etiquetas reales', async t => {
  for (const environment of ['test', 'live']) {
    const f = fixture(t, environment);
    for (const change of [{ country_code: 'DE', postal_code: '10115' }, { country_code: 'IT', postal_code: '20121', state_province_code: 'IT-MI' }, { country_code: 'PT', postal_code: '1234-567' }, ...['35001', '38001', '51001', '52001'].map(postal_code => ({ postal_code }))]) {
      const q = await quote(f), stored = f.db.prepare('SELECT payload FROM europe_quotes WHERE id=?').get(q.id), payload = JSON.parse(stored.payload);
      payload.destination = { ...payload.destination, ...change };
      f.db.prepare('UPDATE europe_quotes SET payload=? WHERE id=?').run(JSON.stringify(payload), q.id);
      await assert.rejects(create(f, q), error => error.status === 400 && /Península y Baleares/.test(error.message));
    }
    assert.equal(f.calls.create, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM europe_shipments').get().n, 0);
  }
});

test('los envíos internacionales anteriores siguen disponibles para consulta, seguimiento y descarga', async t => {
  for (const country_code of ['DE', 'IT', 'PT']) {
    const f = fixture(t, 'live'), q = await quote(f), key = randomUUID(), shipment = await create(f, q, {}, key);
    const legacyDestination = { ...shipment.destination, country_code };
    f.db.prepare('UPDATE europe_shipments SET destination=? WHERE id=?').run(JSON.stringify(legacyDestination), shipment.id);
    assert.equal(f.service.get(shipment.id).destination.country_code, country_code);
    assert.equal(f.service.list()[0].destination.country_code, country_code);
    f.setReceipt({ shipment_id: shipment.provider_shipment_id, parcel_id: shipment.provider_parcel_id, status: 'in_transit', event_at: '2026-10-17T10:00:00Z' });
    assert.equal((await f.service.sync(f.user, shipment.id)).status, 'in_transit');
    assert.equal((await f.service.download(shipment.id)).toString(), '%PDF-fixture');
    assert.equal((await create(f, q, {}, key)).id, shipment.id);
    assert.deepEqual([f.calls.create, f.calls.retrieve, f.calls.label], [1, 1, 1]);
  }
});

test('un origen fuera de Barcelona no puede cotizar ni marcarse listo', async t => {
  const f = fixture(t, 'test', { async sender() { return { ...sender, city: 'Madrid', postal_code: '28001' }; } });
  await assert.rejects(quote(f), /Barcelona/);
  await assert.rejects(f.service.checkConnection(), /Barcelona/);
  assert.equal(f.calls.quote, 0);
});

test('la cotización guarda la dirección, el remitente y las tarifas en euros durante diez minutos', async t => {
  const f = fixture(t), before = Date.now(), q = await quote(f);
  assert.equal(q.environment, 'test'); assert.equal(q.currency, 'EUR');
  assert.ok(Date.parse(q.expires_at) >= before + 599000 && Date.parse(q.expires_at) <= Date.now() + 600000);
  const stored = f.db.prepare('SELECT * FROM europe_quotes WHERE id=?').get(q.id), payload = JSON.parse(stored.payload);
  assert.deepEqual(payload.parcel, box); assert.equal(payload.sender.id, sender.id);
  assert.equal(JSON.parse(stored.options)[0].price, 1295);
  const log = f.db.prepare("SELECT details FROM audit WHERE action='europe_shipping.quote'").get().details;
  assert.ok(!log.includes(address.email)); assert.ok(!log.includes(address.address));
});

test('las simulaciones son locales: no crean remesas, etiquetas ni documentos reales', async t => {
  const f = fixture(t), q = await quote(f), shipment = await create(f, q, { price: 1 });
  assert.equal(shipment.status, 'simulated'); assert.equal(shipment.price, option.price);
  assert.equal(shipment.tracking_url, null); assert.equal(shipment.provider_shipment_id, null);
  assert.match(shipment.events[0].message, /Simulación local, sin etiqueta ni transporte real/);
  assert.equal(shipment.idempotency_key, undefined); assert.equal(shipment.request_hash, undefined);
  await assert.rejects(f.service.download(shipment.id), error => error.status === 409);
  assert.equal((await f.service.sync(f.user, shipment.id)).status, 'simulated');
  assert.deepEqual([f.calls.create, f.calls.label, f.calls.retrieve, f.calls.lookup], [0, 0, 0, 0]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ledger').get().n, 0);
});

test('la creación exige una tarifa vigente del mismo usuario y una confirmación en modo real', async t => {
  const f = fixture(t, 'live'), q = await quote(f);
  await assert.rejects(create(f, q, { confirm_live: false }), error => error.status === 409);
  await assert.rejects(f.service.create(f.other, { quote_id: q.id, service_id: option.id, confirm_live: true }, randomUUID()), error => error.status === 404);
  await assert.rejects(create(f, q, { service_id: 'invented-service' }), error => error.status === 400);
  f.db.prepare('UPDATE europe_quotes SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', q.id);
  await assert.rejects(create(f, q), /caducado/);
  assert.equal(f.calls.create, 0);
});

test('la cotización no se reutiliza al cambiar el entorno de prueba a real', async t => {
  const f = fixture(t), q = await quote(f), live = europeShipping(f.db, { ...f.config, sendcloud: { ...f.config.sendcloud, environment: 'live' } }, f.provider);
  await assert.rejects(live.create(f.user, { quote_id: q.id, service_id: option.id, confirm_live: true }, randomUUID()), /entorno/);
  assert.equal(f.calls.create, 0);
});

test('los rechazos definitivos conservan una explicación segura sin comprar otra etiqueta al reintentar', async t => {
  const f = fixture(t, 'live', { async create() { f.calls.create++; const error = new Error('Customer private@example.com rejected'); error.rejected = true; throw error; } });
  const q = await quote(f); await assert.rejects(create(f, q), error => error.status === 422);
  const result = f.service.list()[0]; assert.equal(result.status, 'rejected'); assert.ok(!result.last_error.includes('private@example.com'));
  assert.equal((await create(f, q)).id, result.id); assert.equal(f.calls.create, 1);
  await assert.rejects(f.service.download(result.id), error => error.status === 409);
});

test('el webhook de prueba comprueba la firma e ignora el evento sin crear transporte real', async t => {
  const f = fixture(t), shipment = await create(f, await quote(f)), raw = Buffer.from(JSON.stringify({ parcel: { id: '12345' } }));
  assert.deepEqual(await f.service.webhook({}, raw), { received: true, ignored: true });
  assert.equal(f.calls.verify, 1); assert.equal(f.calls.retrieve, 0); assert.equal(f.service.get(shipment.id).status, 'simulated');
  f.provider.verifyWebhook = () => { throw new HttpError(401, 'Firma no válida.'); };
  await assert.rejects(f.service.webhook({}, raw), error => error.status === 401);
});

test('la idempotencia sobrevive a otra instancia y una nueva clave no compra dos etiquetas para la misma cotización', async t => {
  const f = fixture(t, 'live'), q = await quote(f), key = randomUUID(), first = await create(f, q, {}, key);
  assert.equal(first.status, 'label_created');
  const otherInstance = europeShipping(f.db, f.config, f.provider);
  assert.equal((await otherInstance.create(f.user, { quote_id: q.id, service_id: option.id, order_reference: 'PEDIDO-1' }, key)).id, first.id);
  assert.equal((await create(f, q)).id, first.id);
  await assert.rejects(create(f, q, { order_reference: 'OTHER' }, key), error => error.status === 409);
  assert.equal(f.calls.create, 1); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM europe_shipments').get().n, 1);
});

test('dos creaciones concurrentes persisten la reserva antes de llamar al proveedor', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, 'live', { async create() { f.calls.create++; entered(); await gate; return { shipment_id: 'one', parcel_id: '1', status: 'label_created' }; } });
  const q = await quote(f), first = create(f, q); await started;
  const second = await create(f, q); assert.equal(second.status, 'submitting');
  release(); assert.equal((await first).id, second.id); assert.equal(f.calls.create, 1);
});

test('un fallo al auditar revierte la reserva y su evento antes de llamar a Sendcloud', async t => {
  const f = fixture(t, 'live'), q = await quote(f), key = randomUUID();
  f.db.exec("CREATE TRIGGER fail_shipping_audit BEFORE INSERT ON audit WHEN NEW.action='europe_shipping.create' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  await assert.rejects(create(f, q, {}, key), /audit unavailable/);
  assert.equal(f.calls.create, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM europe_shipments').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM europe_shipment_events').get().n, 0);
  f.db.exec('DROP TRIGGER fail_shipping_audit');
  assert.equal((await create(f, q, {}, key)).status, 'label_created'); assert.equal(f.calls.create, 1);
});

test('una respuesta incierta nunca vuelve a crear: se concilia por la referencia persistida', async t => {
  let lookupReference;
  const f = fixture(t, 'live', { async create() { f.calls.create++; throw new Error('timeout with private customer@example.com'); }, async lookup(reference) { f.calls.lookup++; lookupReference = reference; return { shipment_id: 'recovered', parcel_id: '77', status: 'label_created', reference }; } });
  const q = await quote(f), key = randomUUID();
  await assert.rejects(create(f, q, {}, key), /incierta/);
  const pending = f.service.list()[0]; assert.equal(pending.status, 'unknown');
  assert.ok(!pending.last_error.includes('customer@example.com'));
  assert.equal((await create(f, q, {}, key)).id, pending.id);
  assert.equal((await create(f, q)).status, 'unknown'); assert.equal(f.calls.create, 1);
  const recovered = await f.service.sync(f.user, pending.id);
  assert.equal(lookupReference, pending.reference); assert.equal(recovered.status, 'label_created'); assert.equal(recovered.provider_shipment_id, 'recovered');
  assert.equal(f.calls.create, 1);
});

test('una conciliación sin coincidencias conserva el envío incierto sin reintentar su creación', async t => {
  const f = fixture(t, 'live', { async create() { throw new Error('timeout'); }, async lookup() { f.calls.lookup++; return null; } });
  const q = await quote(f); await assert.rejects(create(f, q));
  const pending = f.service.list()[0], result = await f.service.sync(f.user, pending.id);
  assert.equal(result.status, 'unknown'); assert.match(result.last_error, /No se ha repetido/);
  assert.equal(f.calls.lookup, 1);
});

test('los eventos repetidos o anteriores no duplican ni hacen retroceder el seguimiento', async t => {
  const f = fixture(t, 'live'), first = await create(f, await quote(f));
  f.setReceipt({ shipment_id: first.provider_shipment_id, parcel_id: first.provider_parcel_id, status: 'in_transit', event_at: '2026-10-17T10:00:00Z' });
  await f.service.sync(f.user, first.id); await f.service.sync(f.user, first.id);
  assert.equal(f.service.get(first.id).events.filter(e => e.status === 'in_transit').length, 1);
  f.setReceipt({ shipment_id: first.provider_shipment_id, parcel_id: first.provider_parcel_id, status: 'label_created', event_at: '2026-10-16T10:00:00Z' });
  assert.equal((await f.service.sync(f.user, first.id)).status, 'in_transit');
  f.setReceipt({ shipment_id: first.provider_shipment_id, parcel_id: first.provider_parcel_id, status: 'delivered', event_at: '2026-10-18T10:00:00Z' });
  await f.service.sync(f.user, first.id);
  f.setReceipt({ shipment_id: first.provider_shipment_id, parcel_id: first.provider_parcel_id, status: 'cancelled', event_at: '2026-10-19T10:00:00Z' });
  assert.equal((await f.service.sync(f.user, first.id)).status, 'delivered');
});

test('los webhooks exigen firma, solo localizan envíos conocidos y consultan el seguimiento canónico', async t => {
  const f = fixture(t, 'live'), shipment = await create(f, await quote(f));
  f.setReceipt({ shipment_id: shipment.provider_shipment_id, parcel_id: shipment.provider_parcel_id, status: 'in_transit', tracking_url: 'https://tracking.example.com/canonical', event_at: '2026-10-17T10:00:00Z' });
  const raw = Buffer.from(JSON.stringify({ parcel: { id: shipment.provider_parcel_id, status: 'delivered', tracking_url: 'https://untrusted.example.com/' } }));
  assert.deepEqual(await f.service.webhook({}, raw), { received: true });
  await f.service.webhook({}, raw);
  assert.equal(f.calls.verify, 2); assert.equal(f.calls.retrieve, 2);
  assert.equal(f.service.get(shipment.id).status, 'in_transit');
  assert.equal(f.service.get(shipment.id).tracking_url, 'https://tracking.example.com/canonical');
  assert.equal(f.service.get(shipment.id).events.filter(e => e.status === 'in_transit').length, 1);
  assert.deepEqual(await f.service.webhook({}, Buffer.from('{"parcel":{"id":999999}}')), { received: true, ignored: true });
  f.provider.verifyWebhook = () => { throw new HttpError(401, 'Firma no válida.'); };
  await assert.rejects(f.service.webhook({}, raw), error => error.status === 401);
  assert.equal(f.calls.retrieve, 2);
});

test('la descarga usa las referencias del proveedor y no una URL suministrada por el cliente', async t => {
  let args;
  const f = fixture(t, 'live', { async label(...values) { args = values; return Buffer.from('%PDF-fixture'); } });
  const shipment = await create(f, await quote(f));
  assert.equal((await f.service.download(shipment.id)).toString(), '%PDF-fixture');
  assert.deepEqual(args, [shipment.provider_shipment_id, shipment.provider_parcel_id]);
});
