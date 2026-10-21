'use strict';

export function resolveDatabase(source, options = {}) {
  if (!source) throw new TypeError('RawMongo persistence requires a database, client, manager, or collection resolver.');
  if (typeof options.databaseResolver === 'function') return options.databaseResolver(source, options);
  if (typeof source.collection === 'function') return source;
  const name = options.database || options.dbName || options.connection || undefined;
  if (typeof source.db === 'function') return source.db(name);
  if (typeof source.database === 'function') return source.database(name);
  if (source.client && typeof source.client.db === 'function') return source.client.db(name);
  if (source.connection && typeof source.connection.collection === 'function') return source.connection;
  throw new TypeError('Unable to resolve a RawMongo database from the supplied source.');
}
export function collection(source, name, options = {}) {
  if (typeof options.collectionResolver === 'function') return options.collectionResolver(source, name, options);
  const db = resolveDatabase(source, options);
  const value = db.collection?.(name) || db.getCollection?.(name);
  if (!value) throw new TypeError(`RawMongo collection '${name}' is unavailable.`);
  return value;
}
export async function transaction(source, operation, options = {}) {
  if (options.session) return operation(options.session);
  if (typeof options.transaction === 'function') return options.transaction((session) => operation(session), options.transactionOptions || {});
  const candidates = [source, source?.client, source?.db?.client, source?.connection?.client].filter(Boolean);
  for (const target of candidates) {
    if (typeof target.withTransaction === 'function') return target.withTransaction((session) => operation(session), options.transactionOptions || {});
  }
  if (options.requireTransactions === true) throw Object.assign(new Error('RawMongo transactions are required for this event persistence operation.'), { code: 'EVENT_STORE_TRANSACTION_REQUIRED' });
  return operation(null);
}
export function value(result) {
  if (result == null) return null;
  if (Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  if (Object.prototype.hasOwnProperty.call(result, 'document')) return result.document;
  return result;
}
export function matched(result) { return Number(result?.matchedCount ?? result?.modifiedCount ?? result?.n ?? result?.nModified ?? 0) > 0; }
export function duplicate(error) { return error?.code === 11000 || /duplicate key|E11000/i.test(error?.message || ''); }
export async function array(cursor) { if (!cursor) return []; if (Array.isArray(cursor)) return cursor; if (typeof cursor.toArray === 'function') return await cursor.toArray(); const output = []; if (cursor[Symbol.asyncIterator]) for await (const item of cursor) output.push(item); return output; }
export function clone(value, seen = new WeakMap()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value);
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code || null };
  if (Array.isArray(value)) { const output = []; seen.set(value, output); for (const child of value) output.push(clone(child, seen)); return output; }
  const output = {}; seen.set(value, output); for (const [key, child] of Object.entries(value)) output[key] = clone(child, seen); return output;
}
export function publicDocument(document) { if (!document) return null; const output = clone(document); if (output._id != null && output.id == null) output.id = String(output._id); return output; }
export function safeError(error) { return { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error), at: new Date() }; }
