// La selección usa únicamente configuración del Worker, nunca datos del visitante.
export function commerceStoreName(env){
  return env.EUROPE_CHECKOUT_ENABLED==='true'&&env.STORE_CURRENCY==='EUR'&&(env.PAYMENT_ENVIRONMENT||'test')==='test'
    ?'primary-eur-test':'primary';
}
