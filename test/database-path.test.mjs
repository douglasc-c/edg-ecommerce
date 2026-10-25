import test from 'node:test';
import assert from 'node:assert/strict';
import { databasePath } from '../src/db.mjs';

test('Node y Docker mantienen separados los archivos EUR de pruebas aunque exista DB_PATH',()=>{
  const enabled={EUROPE_CHECKOUT_ENABLED:'true',STORE_CURRENCY:'EUR',PAYMENT_ENVIRONMENT:'test'};
  assert.equal(databasePath(enabled),'./data/commerce.db.eur-test');
  assert.equal(databasePath({...enabled,DB_PATH:'/data/commerce.db'}),'/data/commerce.db.eur-test');
  assert.equal(databasePath({...enabled,PAYMENT_ENVIRONMENT:'live',DB_PATH:'/data/commerce.db'}),'/data/commerce.db');
  assert.equal(databasePath({...enabled,EUROPE_CHECKOUT_ENABLED:'false',DB_PATH:'/data/commerce.db'}),'/data/commerce.db');
  assert.equal(databasePath({...enabled,DB_PATH:':memory:'}),':memory:');
  assert.equal(databasePath({STORE_CURRENCY:'BRL',DB_PATH:'/data/commerce.db'}),'/data/commerce.db');
});
