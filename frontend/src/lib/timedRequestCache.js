export function createTimedRequestCache(ttlMs) {
  const entries = new Map();

  const peek = (key, { allowStale = false } = {}) => {
    const entry = entries.get(key);
    if (!entry?.response) return null;
    if (!allowStale && Date.now() - entry.createdAt > ttlMs) return null;
    return entry.response;
  };

  const load = (key, loader, { force = false } = {}) => {
    const current = entries.get(key);
    if (!force && current && Date.now() - current.createdAt <= ttlMs) {
      if (current.response) return Promise.resolve(current.response);
      if (current.promise) return current.promise;
    }

    if (current?.promise && !force) return current.promise;

    const promise = loader().then((response) => {
      if (entries.get(key)?.promise === promise) {
        entries.set(key, { response, createdAt: Date.now() });
      }
      return response;
    }).catch((error) => {
      const latest = entries.get(key);
      if (latest?.promise === promise) {
        if (latest.response) entries.set(key, { response: latest.response, createdAt: latest.createdAt });
        else entries.delete(key);
      }
      throw error;
    });
    entries.set(key, {
      ...(current?.response ? { response: current.response, createdAt: current.createdAt } : { createdAt: Date.now() }),
      promise,
    });
    return promise;
  };

  const prime = (key, response) => {
    entries.set(key, { response, createdAt: Date.now() });
    return response;
  };

  const invalidate = (key) => entries.delete(key);
  const clear = () => entries.clear();

  return { clear, invalidate, load, peek, prime };
}
