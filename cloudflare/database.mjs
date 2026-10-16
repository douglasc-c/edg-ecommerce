import { initialize } from '../src/schema.mjs';
export function database(){throw new Error('Usa la base de datos persistente del Durable Object.');}
export function transaction(db,fn){return db.transactionSync(fn);}
export function durableDatabase(storage){
  const db={
    exec(sql){storage.sql.exec(sql).toArray();},
    prepare(sql){return {
      get(...args){return storage.sql.exec(sql,...args).toArray()[0];},
      all(...args){return storage.sql.exec(sql,...args).toArray();},
      run(...args){const cursor=storage.sql.exec(sql,...args);cursor.toArray();return {changes:cursor.rowsWritten};}
    };},
    transactionSync(fn){return storage.transactionSync(fn);},
    close(){}
  };
  storage.transactionSync(()=>initialize(db));
  return db;
}
