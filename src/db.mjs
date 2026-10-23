import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initialize } from './schema.mjs';
export function databasePath(env=process.env) {
  const base=env.DB_PATH||'./data/commerce.db';
  const test=env.EUROPE_CHECKOUT_ENABLED==='true'&&env.STORE_CURRENCY==='EUR'&&(env.PAYMENT_ENVIRONMENT||'test')==='test';
  return test&&base!==':memory:'?`${base}.eur-test`:base;
}
export function database(path = databasePath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return initialize(db);
}
export function transaction(db, fn) {
  if(db.transactionSync) return db.transactionSync(fn);
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
