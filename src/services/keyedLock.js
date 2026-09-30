// Serialize a read/create/link sequence for each customer, without blocking others.
export function createKeyedLock() {
  const pending = new Map();
  return async (key, operation) => {
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    pending.set(key, current);
    try { return await current; }
    finally { if (pending.get(key) === current) pending.delete(key); }
  };
}
