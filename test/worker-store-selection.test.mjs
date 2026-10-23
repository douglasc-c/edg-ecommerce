import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceStoreName } from '../cloudflare/store-selection.mjs';

test('el checkout EUR de pruebas usa almacenamiento independiente de la tienda real',()=>{
  assert.equal(commerceStoreName({EUROPE_CHECKOUT_ENABLED:'true',STORE_CURRENCY:'EUR',PAYMENT_ENVIRONMENT:'test'}),'primary-eur-test');
  assert.equal(commerceStoreName({EUROPE_CHECKOUT_ENABLED:'true',STORE_CURRENCY:'EUR'}),'primary-eur-test');
  for(const env of [
    {},{STORE_CURRENCY:'EUR'},
    {EUROPE_CHECKOUT_ENABLED:'false',STORE_CURRENCY:'EUR',PAYMENT_ENVIRONMENT:'test'},
    {EUROPE_CHECKOUT_ENABLED:'true',STORE_CURRENCY:'BRL',PAYMENT_ENVIRONMENT:'test'},
    {EUROPE_CHECKOUT_ENABLED:'true',STORE_CURRENCY:'EUR',PAYMENT_ENVIRONMENT:'live'},
  ])assert.equal(commerceStoreName(env),'primary');
});
