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
