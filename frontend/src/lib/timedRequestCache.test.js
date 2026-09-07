import { createTimedRequestCache } from "./timedRequestCache";

test("deduplicates concurrent requests for the same key", async () => {
  const cache = createTimedRequestCache(1_000);
  let resolveRequest;
  const loader = jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));

  const first = cache.load("stock", loader);
  const second = cache.load("stock", loader);

  expect(loader).toHaveBeenCalledTimes(1);
  resolveRequest({ data: { value: 1 } });
  await expect(Promise.all([first, second])).resolves.toEqual([
    { data: { value: 1 } },
    { data: { value: 1 } },
  ]);
});

test("a slower stale request cannot replace a forced refresh", async () => {
  const cache = createTimedRequestCache(1_000);
  const resolvers = [];
  const loader = jest.fn(() => new Promise((resolve) => { resolvers.push(resolve); }));

  const stale = cache.load("stock", loader);
  const fresh = cache.load("stock", loader, { force: true });

  resolvers[1]({ data: { value: "fresh" } });
  await fresh;
  resolvers[0]({ data: { value: "stale" } });
  await stale;

  expect(cache.peek("stock")).toEqual({ data: { value: "fresh" } });
});

test("keeps stale data visible while it refreshes", async () => {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValue(1_000);
  const cache = createTimedRequestCache(100);
  cache.prime("orders", { data: { value: "cached" } });

  now.mockReturnValue(1_500);
  expect(cache.peek("orders")).toBeNull();
  expect(cache.peek("orders", { allowStale: true })).toEqual({ data: { value: "cached" } });

  let resolveRefresh;
  const refresh = cache.load("orders", () => new Promise((resolve) => { resolveRefresh = resolve; }));
  expect(cache.peek("orders", { allowStale: true })).toEqual({ data: { value: "cached" } });
  resolveRefresh({ data: { value: "fresh" } });
  await refresh;
  expect(cache.peek("orders")).toEqual({ data: { value: "fresh" } });
  now.mockRestore();
});

test("a failed refresh preserves the last usable response", async () => {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValue(1_000);
  const cache = createTimedRequestCache(100);
  cache.prime("stock", { data: { value: "cached" } });

  now.mockReturnValue(1_500);
  await expect(cache.load("stock", () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  expect(cache.peek("stock", { allowStale: true })).toEqual({ data: { value: "cached" } });
  now.mockRestore();
});

test("invalidates one key without clearing the others", () => {
  const cache = createTimedRequestCache(1_000);
  cache.prime("orders", { data: 1 });
  cache.prime("stock", { data: 2 });

  cache.invalidate("orders");

  expect(cache.peek("orders")).toBeNull();
  expect(cache.peek("stock")).toEqual({ data: 2 });
});
