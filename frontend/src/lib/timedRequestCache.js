export function createTimedRequestCache(ttlMs) {
  const entries = new Map();

  const peek = (key) => {
    const entry = entries.get(key);
    if (!entry?.response || Date.now() - entry.createdAt > ttlMs) return null;
    return entry.response;
  };

  const load = (key, loader, { force = false } = {}) => {
    const current = entries.get(key);
    if (!force && current && Date.now() - current.createdAt <= ttlMs) {
      if (current.response) return Promise.resolve(current.response);
      if (current.promise) return current.promise;
    }

    const promise = loader().then((response) => {
      if (entries.get(key)?.promise === promise) {
        entries.set(key, { response, createdAt: Date.now() });
      }
      return response;
    }).catch((error) => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
      throw error;
    });
    entries.set(key, { promise, createdAt: Date.now() });
    return promise;
  };

  return { load, peek };
}
