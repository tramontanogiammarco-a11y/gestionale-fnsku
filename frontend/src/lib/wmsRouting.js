const EPSILON = 0.0001;

function point(value = {}) {
  return { x: Number(value.x || 0), z: Number(value.z || 0) };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function coordinateKey(value) {
  return `p:${value.x.toFixed(4)}:${value.z.toFixed(4)}`;
}

function projectionOnSegment(value, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((value.x - start.x) * dx + (value.z - start.z) * dz) / lengthSquared)) : 0;
  return { point: { x: start.x + dx * t, z: start.z + dz * t }, t };
}

function segmentIntersection(left, right) {
  const rx = left.b.x - left.a.x;
  const rz = left.b.z - left.a.z;
  const sx = right.b.x - right.a.x;
  const sz = right.b.z - right.a.z;
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < EPSILON) return null;
  const qx = right.a.x - left.a.x;
  const qz = right.a.z - left.a.z;
  const t = (qx * sz - qz * sx) / denominator;
  const u = (qx * rz - qz * rx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { point: { x: left.a.x + rx * t, z: left.a.z + rz * t }, leftT: t, rightT: u };
}

function addEdge(graph, left, right, weight) {
  if (!graph.has(left)) graph.set(left, []);
  if (!graph.has(right)) graph.set(right, []);
  graph.get(left).push({ id: right, weight });
  graph.get(right).push({ id: left, weight });
}

function dijkstra(graph, start, target) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const pending = new Set(graph.keys());
  while (pending.size) {
    let current = null;
    let best = Infinity;
    pending.forEach((id) => {
      const candidate = distances.get(id) ?? Infinity;
      if (candidate < best) {
        current = id;
        best = candidate;
      }
    });
    if (current == null || best === Infinity) break;
    if (current === target) break;
    pending.delete(current);
    (graph.get(current) || []).forEach((edge) => {
      if (!pending.has(edge.id)) return;
      const candidate = best + edge.weight;
      if (candidate < (distances.get(edge.id) ?? Infinity)) {
        distances.set(edge.id, candidate);
        previous.set(edge.id, current);
      }
    });
  }
  if (!distances.has(target)) return null;
  const ids = [];
  let current = target;
  while (current) {
    ids.unshift(current);
    if (current === start) break;
    current = previous.get(current);
  }
  return { distance: distances.get(target), ids };
}

export function normalizeAisles(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((aisle, index) => ({
    id: String(aisle.id || `aisle-${index + 1}`),
    name: String(aisle.name || `Corridoio ${index + 1}`),
    points: (Array.isArray(aisle.points) ? aisle.points : []).map(point).filter((value) => Number.isFinite(value.x) && Number.isFinite(value.z)),
  })).filter((aisle) => aisle.points.length >= 2);
}

export function locationAccessPoint(location = {}) {
  const radians = Number(location.map_rotation || 0) * Math.PI / 180;
  const widthAxis = { x: Math.cos(radians), z: -Math.sin(radians) };
  const depthAxis = { x: Math.sin(radians), z: Math.cos(radians) };
  const side = location.access_side || "front";
  const direction = side === "back" ? { x: -depthAxis.x, z: -depthAxis.z }
    : side === "left" ? { x: -widthAxis.x, z: -widthAxis.z }
      : side === "right" ? widthAxis : depthAxis;
  const size = side === "left" || side === "right" ? Number(location.map_width || 1) : Number(location.map_depth || 1);
  const offset = size / 2 + 0.65;
  return {
    x: Number(location.map_x || 0) + direction.x * offset,
    z: Number(location.map_z || 0) + direction.z * offset,
  };
}

// A nearest-neighbour route is fast, but it can zig-zag through the warehouse
// (for example A30 -> A60 -> A34). Keep that as the starting point, then use
// a small 2-opt pass to remove those unnecessary returns on the real walkable map.
function optimizedVisitOrder(locations = [], distanceFor) {
  const byId = new Map(locations.map((location) => [String(location.id), location]));
  const cache = new Map();
  const distanceBetween = (fromId, toId) => {
    const key = `${fromId}:${toId}`;
    if (!cache.has(key)) cache.set(key, Number(distanceFor(fromId, toId)) || Infinity);
    return cache.get(key);
  };
  const compareLocation = (leftId, rightId) => String(byId.get(leftId)?.codice || leftId)
    .localeCompare(String(byId.get(rightId)?.codice || rightId), "it", { numeric: true });
  const remaining = locations.map((location) => String(location.id));
  const order = [];
  let previousId = "__entrance__";

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((candidateId, index) => {
      const candidateDistance = distanceBetween(previousId, candidateId);
      if (candidateDistance < bestDistance - EPSILON || (Math.abs(candidateDistance - bestDistance) < EPSILON && compareLocation(candidateId, remaining[bestIndex]) < 0)) {
        bestIndex = index;
        bestDistance = candidateDistance;
      }
    });
    previousId = remaining.splice(bestIndex, 1)[0];
    order.push(previousId);
  }

  // Warehouse paths are bidirectional. Reversing a slice is therefore a safe
  // way to remove backtracking without ignoring configured corridors/blocks.
  if (order.length <= 32) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let start = 0; start < order.length - 1 && !improved; start += 1) {
        for (let end = start + 1; end < order.length; end += 1) {
          const beforeId = start === 0 ? "__entrance__" : order[start - 1];
          const firstId = order[start];
          const lastId = order[end];
          const afterId = end === order.length - 1 ? null : order[end + 1];
          const currentDistance = distanceBetween(beforeId, firstId) + (afterId ? distanceBetween(lastId, afterId) : 0);
          const swappedDistance = distanceBetween(beforeId, lastId) + (afterId ? distanceBetween(firstId, afterId) : 0);
          if (swappedDistance + EPSILON >= currentDistance) continue;
          order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
          improved = true;
          break;
        }
      }
    }
  }

  return order.map((id) => byId.get(id)).filter(Boolean);
}

function linearSlotCode(location = {}) {
  const match = String(location.codice || "").toUpperCase().match(/^([A-Z]+[0-9]*\+A)([0-9]+)$/);
  if (!match) return null;
  return { rack: match[1], position: Number(match[2]) };
}

function linearRackSweepOrder(locations = [], map = {}) {
  if (locations.length < 2) return null;
  const decorated = locations.map((location) => ({ location, slot: linearSlotCode(location) }));
  if (decorated.some((item) => !item.slot)) return null;
  const rack = decorated[0].slot.rack;
  if (decorated.some((item) => item.slot.rack !== rack)) return null;

  const entrance = { x: Number(map.entrance_x || 0), z: Number(map.entrance_z || 0) };
  const endpoints = [...decorated].sort((left, right) => left.slot.position - right.slot.position);
  const first = endpoints[0];
  const last = endpoints[endpoints.length - 1];
  const ascending = distance(entrance, locationAccessPoint(first.location)) <= distance(entrance, locationAccessPoint(last.location));
  return [...decorated]
    .sort((left, right) => ascending ? left.slot.position - right.slot.position : right.slot.position - left.slot.position)
    .map((item) => item.location);
}

function gridRoute(locations, map) {
  const cellSize = Number(map.grid_size || 0.5);
  const width = Number(map.width || 34);
  const depth = Number(map.depth || 24);
  const cols = Math.max(1, Math.floor(width / cellSize));
  const rows = Math.max(1, Math.floor(depth / cellSize));
  const minX = -width / 2;
  const minZ = -depth / 2;
  const key = (col, row) => `${col}:${row}`;
  const cellPoint = (col, row) => ({ x: minX + (col + 0.5) * cellSize, z: minZ + (row + 0.5) * cellSize });
  const pointCell = (value) => ({
    col: Math.max(0, Math.min(cols - 1, Math.floor((value.x - minX) / cellSize))),
    row: Math.max(0, Math.min(rows - 1, Math.floor((value.z - minZ) / cellSize))),
  });
  const blocked = new Set();
  for (const obstacle of map.obstacles || []) {
    if (!["pallet", "slot", "terra", "quarantena", "outbound", "packing"].includes(obstacle.tipo)) continue;
    const center = { x: Number(obstacle.map_x || 0), z: Number(obstacle.map_z || 0) };
    const radians = -Number(obstacle.map_rotation || 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const halfWidth = Number(obstacle.map_width || 1) / 2 + 0.08;
    const halfDepth = Number(obstacle.map_depth || 1) / 2 + 0.08;
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        const current = cellPoint(col, row);
        const dx = current.x - center.x;
        const dz = current.z - center.z;
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        if (Math.abs(localX) <= halfWidth && Math.abs(localZ) <= halfDepth) blocked.add(key(col, row));
      }
    }
  }

  const nearestFree = (value) => {
    const origin = pointCell(value);
    if (!blocked.has(key(origin.col, origin.row))) return origin;
    for (let radius = 1; radius < Math.max(cols, rows); radius += 1) {
      const candidates = [];
      for (let dx = -radius; dx <= radius; dx += 1) {
        candidates.push({ col: origin.col + dx, row: origin.row - radius }, { col: origin.col + dx, row: origin.row + radius });
      }
      for (let dz = -radius + 1; dz < radius; dz += 1) {
        candidates.push({ col: origin.col - radius, row: origin.row + dz }, { col: origin.col + radius, row: origin.row + dz });
      }
      const valid = candidates.filter((cell) => cell.col >= 0 && cell.col < cols && cell.row >= 0 && cell.row < rows && !blocked.has(key(cell.col, cell.row)));
      if (valid.length) return valid.sort((a, b) => distance(cellPoint(a.col, a.row), value) - distance(cellPoint(b.col, b.row), value))[0];
    }
    return null;
  };

  const findPath = (start, target) => {
    if (!start || !target) return null;
    const startKey = key(start.col, start.row);
    const targetKey = key(target.col, target.row);
    const open = new Set([startKey]);
    const cells = new Map([[startKey, start], [targetKey, target]]);
    const cameFrom = new Map();
    const scores = new Map([[startKey, 0]]);
    const estimates = new Map([[startKey, Math.abs(start.col - target.col) + Math.abs(start.row - target.row)]]);
    while (open.size) {
      let currentKey = null;
      let best = Infinity;
      open.forEach((candidate) => {
        const score = estimates.get(candidate) ?? Infinity;
        if (score < best) { best = score; currentKey = candidate; }
      });
      if (currentKey === targetKey) {
        const path = [];
        let cursor = currentKey;
        while (cursor) {
          const cell = cells.get(cursor);
          path.unshift(cellPoint(cell.col, cell.row));
          cursor = cameFrom.get(cursor);
        }
        return { path, distance: Math.max(0, path.length - 1) * cellSize };
      }
      open.delete(currentKey);
      const current = cells.get(currentKey);
      for (const next of [
        { col: current.col + 1, row: current.row }, { col: current.col - 1, row: current.row },
        { col: current.col, row: current.row + 1 }, { col: current.col, row: current.row - 1 },
      ]) {
        if (next.col < 0 || next.col >= cols || next.row < 0 || next.row >= rows) continue;
        const nextKey = key(next.col, next.row);
        if (blocked.has(nextKey)) continue;
        cells.set(nextKey, next);
        const tentative = Number(scores.get(currentKey) || 0) + 1;
        if (tentative >= (scores.get(nextKey) ?? Infinity)) continue;
        cameFrom.set(nextKey, currentKey);
        scores.set(nextKey, tentative);
        estimates.set(nextKey, tentative + Math.abs(next.col - target.col) + Math.abs(next.row - target.row));
        open.add(nextKey);
      }
    }
    return null;
  };

  const entrance = nearestFree({ x: Number(map.entrance_x || 0), z: Number(map.entrance_z || 0) });
  const endpoints = new Map([["__entrance__", entrance]]);
  locations.forEach((location) => endpoints.set(String(location.id), nearestFree(locationAccessPoint(location))));
  const paths = new Map();
  const routeBetween = (fromId, toId) => {
    const key = `${fromId}:${toId}`;
    if (!paths.has(key)) paths.set(key, findPath(endpoints.get(fromId), endpoints.get(toId)));
    return paths.get(key);
  };
  const reachable = locations.filter((location) => routeBetween("__entrance__", String(location.id)));
  const unreachable = locations.filter((location) => !routeBetween("__entrance__", String(location.id)));
  const planned = linearRackSweepOrder(reachable, map) || optimizedVisitOrder(reachable, (fromId, toId) => routeBetween(fromId, toId)?.distance);
  const ordered = [];
  const pathPoints = entrance ? [cellPoint(entrance.col, entrance.row)] : [];
  let total = 0;
  let currentId = "__entrance__";
  for (const next of planned) {
    const bestPath = routeBetween(currentId, String(next.id));
    if (!bestPath) return { locations: ordered, distance: total, pathPoints, mode: "grid", unreachable: [...unreachable, next] };
    const points = [...bestPath.path];
    if (pathPoints.length) points.shift();
    pathPoints.push(...points);
    ordered.push({ ...next, route_distance: bestPath.distance });
    total += bestPath.distance;
    currentId = String(next.id);
  }
  return { locations: ordered, distance: total, pathPoints, mode: "grid", unreachable };
}

function buildGraph(aisles, attachments) {
  const segments = [];
  normalizeAisles(aisles).forEach((aisle) => {
    aisle.points.slice(0, -1).forEach((start, index) => {
      const end = aisle.points[index + 1];
      if (distance(start, end) > EPSILON) segments.push({ id: `${aisle.id}:${index}`, a: start, b: end, splits: [{ t: 0, point: start }, { t: 1, point: end }] });
    });
  });
  if (!segments.length) return null;

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const crossing = segmentIntersection(segments[i], segments[j]);
      if (!crossing) continue;
      segments[i].splits.push({ t: crossing.leftT, point: crossing.point });
      segments[j].splits.push({ t: crossing.rightT, point: crossing.point });
    }
  }

  const attachmentLinks = [];
  attachments.forEach((attachment) => {
    let best = null;
    segments.forEach((segment) => {
      const projected = projectionOnSegment(attachment.point, segment.a, segment.b);
      const nextDistance = distance(attachment.point, projected.point);
      if (!best || nextDistance < best.distance) best = { segment, ...projected, distance: nextDistance };
    });
    best.segment.splits.push({ t: best.t, point: best.point });
    attachmentLinks.push({ id: attachment.id, point: attachment.point, projected: best.point, distance: best.distance });
  });

  const graph = new Map();
  const points = new Map();
  segments.forEach((segment) => {
    const unique = [...new Map(segment.splits.map((split) => [coordinateKey(split.point), split])).values()].sort((left, right) => left.t - right.t);
    unique.forEach((split) => points.set(coordinateKey(split.point), split.point));
    unique.slice(0, -1).forEach((split, index) => {
      const next = unique[index + 1];
      addEdge(graph, coordinateKey(split.point), coordinateKey(next.point), distance(split.point, next.point));
    });
  });
  attachmentLinks.forEach((attachment) => {
    points.set(attachment.id, attachment.point);
    addEdge(graph, attachment.id, coordinateKey(attachment.projected), attachment.distance);
  });
  return { graph, points };
}

export function calculateWarehouseRoute(locations = [], map = {}) {
  if (Array.isArray(map.obstacles) && map.obstacles.length) return gridRoute(locations, map);
  const allLocations = [...locations];
  const pending = [...allLocations];
  const entrance = { x: Number(map.entrance_x || 0), z: Number(map.entrance_z || 0) };
  const fallback = () => {
    const planned = linearRackSweepOrder(allLocations, map) || optimizedVisitOrder(allLocations, (fromId, toId) => {
      const from = fromId === "__entrance__" ? entrance : locationAccessPoint(allLocations.find((location) => String(location.id) === fromId));
      const to = locationAccessPoint(allLocations.find((location) => String(location.id) === toId));
      return distance(from, to);
    });
    const ordered = [];
    const pathPoints = [entrance];
    let current = entrance;
    let total = 0;
    planned.forEach((next) => {
      current = locationAccessPoint(next);
      const nextDistance = distance(pathPoints[pathPoints.length - 1], current);
      ordered.push({ ...next, route_distance: nextDistance });
      pathPoints.push(current);
      total += nextDistance;
    });
    return { locations: ordered, distance: total, pathPoints, mode: "direct" };
  };

  const aisles = normalizeAisles(map.aisles);
  if (!aisles.length || !pending.length) return fallback();
  const attachments = [{ id: "attach:entrance", point: entrance }, ...pending.map((location) => ({ id: `attach:${location.id}`, point: locationAccessPoint(location) }))];
  const network = buildGraph(aisles, attachments);
  if (!network) return fallback();

  const routeCache = new Map();
  const routeBetween = (fromId, toId) => {
    const key = `${fromId}:${toId}`;
    if (!routeCache.has(key)) routeCache.set(key, dijkstra(network.graph, fromId, toId));
    return routeCache.get(key);
  };
  const planned = linearRackSweepOrder(pending, map) || optimizedVisitOrder(pending, (fromId, toId) => routeBetween(
    fromId === "__entrance__" ? "attach:entrance" : `attach:${fromId}`,
    `attach:${toId}`,
  )?.distance);
  const ordered = [];
  const pathPoints = [];
  let currentId = "attach:entrance";
  let total = 0;
  for (const next of planned) {
    const bestPath = routeBetween(currentId, `attach:${next.id}`);
    if (!bestPath) return fallback();
    const routePoints = bestPath.ids.map((id) => network.points.get(id)).filter(Boolean);
    if (pathPoints.length && routePoints.length) routePoints.shift();
    pathPoints.push(...routePoints);
    ordered.push({ ...next, route_distance: bestPath.distance });
    total += bestPath.distance;
    currentId = `attach:${next.id}`;
  }
  return { locations: ordered, distance: total, pathPoints, mode: "aisles" };
}
