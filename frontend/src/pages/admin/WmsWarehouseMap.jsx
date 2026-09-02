import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { useOutletContext } from "react-router-dom";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AlertTriangle, Box, Boxes, Eye, Grid3X3, Loader2, MapPinned, Move3D,
  MousePointer2, PackageOpen, Plus, RotateCcw, Route, Save, ScanLine, Sparkles, Trash2, Undo2, Warehouse, Waypoints,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { calculateWarehouseRoute, normalizeAisles } from "@/lib/wmsRouting";

const GRID_SIZE = 0.1;
const DEFAULT_MAP = { width: 18, depth: 60, grid_size: GRID_SIZE, entrance_x: 0, entrance_z: 29.2, aisles: [] };
const MAP_DRAFT_KEY = "aimago-wms-warehouse-map-draft-v1";
const OPERATIONAL_TYPES = new Set(["pallet", "slot"]);
const MAP_HIDDEN_CODES = new Set(["INBOUND-01", "OUTBOUND-01", "PACK-01"]);
function locationLabel(location) {
  if (location.tipo === "outbound" || location.codice === "OUTBOUND-01") return "OUTBOUND";
  if (location.tipo === "packing" || location.codice === "PACK-01") return "PACKING STATION";
  if (location.codice === "INBOUND-01") return "INBOUND";
  return location.codice;
}

function locationNumber(code) {
  const match = String(code || "").match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : 0;
}

function smartLocation(location, fallbackIndex = 0) {
  const index = fallbackIndex;
  if (location.tipo === "pallet") {
    const column = index % 6;
    const row = Math.floor(index / 6);
    return { ...location, map_x: -7.5 + column * 3, map_z: -28.8 + row * 1.5, map_rotation: 0 };
  }
  if (location.tipo === "slot") {
    const column = index % 10;
    const row = Math.floor(index / 10);
    return { ...location, map_x: -7.2 + column * 1.6, map_z: -28.5 + row * 0.7, map_rotation: 0, access_side: "front" };
  }
  if (location.codice === "INBOUND-01") return { ...location, map_x: -5.5, map_z: 27.8, map_rotation: 0 };
  if (location.codice === "OUTBOUND-01") return { ...location, map_x: 5.5, map_z: 27.8, map_rotation: 0 };
  if (location.codice === "PACK-01") return { ...location, map_x: 0, map_z: 23.5, map_rotation: 0 };
  return location;
}

function smartLocations(rows = []) {
  const fallbackIndexes = { pallet: 0, slot: 0, other: 0 };
  return rows.map((location) => {
    const key = location.tipo === "pallet" || location.tipo === "slot" ? location.tipo : "other";
    const fallback = fallbackIndexes[key]++;
    return smartLocation(location, fallback);
  });
}

function normalizeLocations(rows = []) {
  const smartRows = smartLocations(rows);
  return rows.map((row, index) => {
    const fallback = smartRows[index];
    return {
      ...fallback,
      map_x: Number(row.map_x ?? fallback.map_x ?? 0),
      map_z: Number(row.map_z ?? fallback.map_z ?? 0),
      map_rotation: Number(row.map_rotation || 0),
      map_width: row.tipo === "slot" ? 1.6 : row.tipo === "pallet" ? 2.7 : Number(row.map_width || (row.tipo === "packing" ? 4.5 : 3)),
      map_depth: row.tipo === "slot" ? 0.5 : row.tipo === "pallet" ? 1.2 : Number(row.map_depth || (row.tipo === "packing" ? 2.4 : 1.6)),
      access_side: row.access_side || "front",
    };
  });
}

function parsePhysicalLocation(location) {
  const match = String(location?.codice || "").match(/^([SP])(\d+)\+([A-Z])(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    block: match[2],
    level: match[3],
    position: Number(match[4]),
  };
}

function blockId(tipo, block) {
  return `block:${tipo}:${block}`;
}

function buildPhysicalBlocks(rows = []) {
  const groups = new Map();
  const standalone = [];
  rows.forEach((location) => {
    const parsed = parsePhysicalLocation(location);
    if (!parsed || !OPERATIONAL_TYPES.has(location.tipo)) {
      standalone.push(location);
      return;
    }
    const key = blockId(location.tipo, parsed.block);
    if (!groups.has(key)) groups.set(key, { tipo: location.tipo, block: parsed.block, rows: [] });
    groups.get(key).rows.push({ ...location, physical: parsed });
  });

  const blocks = [...groups.entries()].map(([id, group]) => {
    const levelOrder = group.tipo === "pallet" ? ["Z", "Y", "X"] : ["A", "B", "C", "D", "E"];
    const members = group.rows.sort((left, right) => (
      levelOrder.indexOf(left.physical.level) - levelOrder.indexOf(right.physical.level)
      || left.physical.position - right.physical.position
    ));
    const first = members[0];
    const content = members.flatMap((member) => (member.contenuto || []).map((item) => ({
      ...item,
      location_id: member.id,
      location_code: member.codice,
    })));
    return {
      ...first,
      id,
      codice: `BLOCCO ${group.block}`,
      block_number: group.block,
      members,
      logical_count: members.length,
      occupata: members.some((member) => member.occupata),
      quantita: members.reduce((sum, member) => sum + Number(member.quantita || 0), 0),
      contenuto: content,
      stato: members.some((member) => member.stato === "bloccata") ? "bloccata" : "attiva",
      map_width: group.tipo === "pallet" ? 2.7 : 1.6,
      map_depth: group.tipo === "pallet" ? 1.2 : 0.5,
    };
  });
  return [...standalone, ...blocks];
}

function expandPhysicalBlocks(rows = []) {
  return rows.flatMap((location) => {
    const mapValues = {
      map_x: location.map_x,
      map_z: location.map_z,
      map_rotation: location.map_rotation,
      map_width: location.map_width,
      map_depth: location.map_depth,
      access_side: location.access_side,
    };
    if (!location.members?.length) return [{ id: location.id, ...mapValues }];
    return location.members.map((member) => ({ id: member.id, ...mapValues }));
  });
}

function normalizeMap(value = {}) {
  const legacySize = Number(value.width) !== DEFAULT_MAP.width || Number(value.depth) !== DEFAULT_MAP.depth;
  return {
    ...DEFAULT_MAP,
    ...value,
    width: DEFAULT_MAP.width,
    depth: DEFAULT_MAP.depth,
    grid_size: GRID_SIZE,
    entrance_x: legacySize ? DEFAULT_MAP.entrance_x : Number(value.entrance_x ?? DEFAULT_MAP.entrance_x),
    entrance_z: legacySize ? DEFAULT_MAP.entrance_z : Number(value.entrance_z ?? DEFAULT_MAP.entrance_z),
    // Corridors are inferred from free floor space; old manual lines are ignored.
    aisles: [],
    hidden_location_ids: [...new Set(Array.isArray(value.hidden_location_ids) ? value.hidden_location_ids : [])],
  };
}

function mapSnapshot(locations, map) {
  return JSON.stringify({
    locations: locations.map(({ id, map_x, map_z, map_rotation, map_width, map_depth, access_side }) => [id, map_x, map_z, map_rotation, map_width, map_depth, access_side]),
    map: [map.width, map.depth, map.grid_size, map.entrance_x, map.entrance_z, map.aisles, map.hidden_location_ids],
  });
}

function restoreMapDraft(serverLocations, serverMap) {
  try {
    const draft = JSON.parse(window.localStorage.getItem(MAP_DRAFT_KEY) || "null");
    if (!draft?.locations?.length || !draft?.saved_at) return null;
    const serverIds = new Set(serverLocations.map((location) => location.id));
    const draftRows = draft.locations.filter((location) => serverIds.has(location.id));
    if (!draftRows.length || draftRows.length < Math.ceil(serverLocations.length * 0.8)) return null;
    const draftById = new Map(draftRows.map((location) => [location.id, location]));
    return {
      locations: serverLocations.map((location) => {
        const saved = draftById.get(location.id);
        return saved ? { ...location, ...saved } : location;
      }),
      map: { ...serverMap, ...(draft.map || {}), hidden_location_ids: serverMap.hidden_location_ids || [] },
    };
  } catch (_) {
    return null;
  }
}

function locationAxes(location) {
  const radians = THREE.MathUtils.degToRad(Number(location.map_rotation || 0));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: cos, z: -sin },
    { x: sin, z: cos },
  ];
}

function projectedRadius(location, axis) {
  const [widthAxis, depthAxis] = locationAxes(location);
  return Math.abs(widthAxis.x * axis.x + widthAxis.z * axis.z) * location.map_width / 2
    + Math.abs(depthAxis.x * axis.x + depthAxis.z * axis.z) * location.map_depth / 2;
}

function locationsOverlap(left, right, padding = 0) {
  const delta = { x: right.map_x - left.map_x, z: right.map_z - left.map_z };
  const axes = [...locationAxes(left), ...locationAxes(right)];
  return axes.every((axis) => {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    return distance < projectedRadius(left, axis) + projectedRadius(right, axis) + padding - 0.000001;
  });
}

function placeNewBlocksOnStagingSide(rows, newCodes, map = DEFAULT_MAP) {
  const codes = new Set(newCodes);
  const isNewBlock = (row) => codes.has(row.codice)
    || row.members?.some((member) => codes.has(member.codice));
  const targets = rows.filter(isNewBlock).sort((left, right) => (
    Number(left.block_number || locationNumber(left.codice))
    - Number(right.block_number || locationNumber(right.codice))
  ));
  if (!targets.length) return rows;

  const fixed = rows.filter((row) => !isNewBlock(row));
  const placed = [];
  const width = Number(map.width || DEFAULT_MAP.width);
  const depth = Number(map.depth || DEFAULT_MAP.depth);
  const margin = 0.2;

  targets.forEach((target) => {
    const blockWidth = Number(target.map_width || (target.tipo === "pallet" ? 2.7 : 1.6));
    const blockDepth = Number(target.map_depth || (target.tipo === "pallet" ? 1.2 : 0.5));
    const columnStep = blockWidth + margin;
    const rowStep = blockDepth + margin;
    let candidate = null;

    for (let column = 0; column < 6 && !candidate; column += 1) {
      const x = Math.round((width / 2 - blockWidth / 2 - margin - column * columnStep) / GRID_SIZE) * GRID_SIZE;
      for (let z = -depth / 2 + blockDepth / 2 + margin; z <= depth / 2 - blockDepth / 2 - margin; z += rowStep) {
        const attempt = {
          ...target,
          map_x: Number(x.toFixed(2)),
          map_z: Number((Math.round(z / GRID_SIZE) * GRID_SIZE).toFixed(2)),
          map_rotation: 0,
        };
        if (![...fixed, ...placed].some((row) => locationsOverlap(attempt, row, 0.05))) {
          candidate = attempt;
          break;
        }
      }
    }

    placed.push(candidate || target);
  });

  const placedById = new Map(placed.map((row) => [row.id, row]));
  return rows.map((row) => placedById.get(row.id) || row);
}

function locationOutsideMap(location, map = DEFAULT_MAP) {
  const extents = rotatedHalfExtents(location);
  return Math.abs(Number(location.map_x || 0)) + extents.x > Number(map.width || DEFAULT_MAP.width) / 2
    || Math.abs(Number(location.map_z || 0)) + extents.z > Number(map.depth || DEFAULT_MAP.depth) / 2;
}

function locationsTouch(left, right, tolerance = 0.011) {
  if (locationsOverlap(left, right)) return false;
  const delta = { x: right.map_x - left.map_x, z: right.map_z - left.map_z };
  const separations = [...locationAxes(left), ...locationAxes(right)].map((axis) => {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    return distance - projectedRadius(left, axis) - projectedRadius(right, axis);
  });
  const largestGap = Math.max(...separations);
  return largestGap >= -tolerance && largestGap <= tolerance;
}

function createRectangularGrid(width, depth, step = GRID_SIZE) {
  const positions = [];
  const colors = [];
  const minor = new THREE.Color("#e8edf1");
  const major = new THREE.Color("#b7c3cc");
  const addLine = (x1, z1, x2, z2, color) => {
    positions.push(x1, 0.012, z1, x2, 0.012, z2);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  };
  const xCells = Math.round(width / step);
  const zCells = Math.round(depth / step);
  for (let index = 0; index <= xCells; index += 1) {
    const x = -width / 2 + index * step;
    addLine(x, -depth / 2, x, depth / 2, index % 10 === 0 ? major : minor);
  }
  for (let index = 0; index <= zCells; index += 1) {
    const z = -depth / 2 + index * step;
    addLine(-width / 2, z, width / 2, z, index % 10 === 0 ? major : minor);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
}

function rotatedHalfExtents(location) {
  const [widthAxis, depthAxis] = locationAxes(location);
  return {
    x: Math.abs(widthAxis.x) * location.map_width / 2 + Math.abs(depthAxis.x) * location.map_depth / 2,
    z: Math.abs(widthAxis.z) * location.map_width / 2 + Math.abs(depthAxis.z) * location.map_depth / 2,
  };
}

function collisionIds(locations) {
  const rows = locations.filter((row) => Number.isFinite(row.map_x) && Number.isFinite(row.map_z));
  const collisions = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      if (locationsOverlap(left, right)) {
        collisions.add(left.id);
        collisions.add(right.id);
      }
    }
  }
  return collisions;
}

function touchingRelations(locations) {
  const rows = locations.filter((row) => Number.isFinite(row.map_x) && Number.isFinite(row.map_z));
  const relations = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (!locationsTouch(rows[i], rows[j])) continue;
      if (!relations.has(rows[i].id)) relations.set(rows[i].id, []);
      if (!relations.has(rows[j].id)) relations.set(rows[j].id, []);
      relations.get(rows[i].id).push(rows[j]);
      relations.get(rows[j].id).push(rows[i]);
    }
  }
  return relations;
}

function magnetizeLocations(locations, movingIds, threshold = 0.2) {
  const moving = new Set(movingIds);
  const movingRows = locations.filter((row) => moving.has(row.id) && OPERATIONAL_TYPES.has(row.tipo));
  const fixedRows = locations.filter((row) => !moving.has(row.id) && OPERATIONAL_TYPES.has(row.tipo));
  let best = null;

  movingRows.forEach((current) => {
    const currentExtents = rotatedHalfExtents(current);
    fixedRows.forEach((fixed) => {
      const fixedExtents = rotatedHalfExtents(fixed);
      const overlapX = Math.min(current.map_x + currentExtents.x, fixed.map_x + fixedExtents.x)
        - Math.max(current.map_x - currentExtents.x, fixed.map_x - fixedExtents.x);
      const overlapZ = Math.min(current.map_z + currentExtents.z, fixed.map_z + fixedExtents.z)
        - Math.max(current.map_z - currentExtents.z, fixed.map_z - fixedExtents.z);

      if (overlapZ > 0.01) {
        const direction = fixed.map_x >= current.map_x ? 1 : -1;
        const targetX = fixed.map_x - direction * (currentExtents.x + fixedExtents.x);
        const dx = targetX - current.map_x;
        const dz = fixed.map_z - current.map_z;
        const distance = Math.hypot(dx, dz);
        if (Math.abs(dx) <= threshold && Math.abs(dz) <= threshold && (!best || distance < best.distance)) {
          best = { dx, dz, distance };
        }
      }
      if (overlapX > 0.01) {
        const direction = fixed.map_z >= current.map_z ? 1 : -1;
        const targetZ = fixed.map_z - direction * (currentExtents.z + fixedExtents.z);
        const dx = fixed.map_x - current.map_x;
        const dz = targetZ - current.map_z;
        const distance = Math.hypot(dx, dz);
        if (Math.abs(dx) <= threshold && Math.abs(dz) <= threshold && (!best || distance < best.distance)) {
          best = { dx, dz, distance };
        }
      }
    });
  });

  if (!best) return { locations, snapped: false };
  const snappedLocations = locations.map((row) => moving.has(row.id)
    ? { ...row, map_x: row.map_x + best.dx, map_z: row.map_z + best.dz }
    : row);
  const snappedCollisions = collisionIds(snappedLocations);
  if ([...moving].some((id) => snappedCollisions.has(id))) return { locations, snapped: false };
  return { locations: snappedLocations, snapped: true };
}

function createTextSprite(text, { background = "#ffffff", color = "#0f172a", scale = 1 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 88;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.beginPath();
  context.roundRect(4, 4, 312, 80, 16);
  context.fill();
  context.strokeStyle = "rgba(15, 23, 42, .18)";
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = color;
  context.font = "700 32px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 160, 45);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.4 * scale, 0.66 * scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

const WarehouseScene = forwardRef(function WarehouseScene({
  locations, onMoveCommit, onDragStateChange, onAislePoint, selectedId, setSelectedId, mode, snap, magnet, map, routeData, collisions, touching, draftAislePoints,
}, ref) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);
  const locationsRef = useRef(locations);
  const propsRef = useRef({ onMoveCommit, onDragStateChange, onAislePoint, selectedId, setSelectedId, mode, snap, magnet, map });

  locationsRef.current = locations;
  propsRef.current = { onMoveCommit, onDragStateChange, onAislePoint, selectedId, setSelectedId, mode, snap, magnet, map };

  useImperativeHandle(ref, () => ({
    topView() {
      const state = stateRef.current;
      if (!state) return;
      state.camera.position.set(0, 76, 0.01);
      state.controls.target.set(0, 0, 0);
      state.controls.update();
    },
    perspectiveView() {
      const state = stateRef.current;
      if (!state) return;
      state.camera.position.set(34, 38, 48);
      state.controls.target.set(0, 0, 0);
      state.controls.update();
    },
    fitView() {
      const state = stateRef.current;
      if (!state) return;
      const distance = Math.max(map.width, map.depth);
      state.camera.position.set(distance * 0.62, distance * 0.72, distance * 0.84);
      state.controls.target.set(0, 0, 0);
      state.controls.update();
    },
    focusLocation(locationId) {
      const state = stateRef.current;
      const location = locationsRef.current.find((row) => row.id === locationId);
      if (!state || !location) return;
      state.camera.position.set(location.map_x, 18, location.map_z + 0.01);
      state.controls.target.set(location.map_x, 0, location.map_z);
      state.controls.update();
    },
  }), [map.depth, map.width]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || stateRef.current) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc");
    scene.fog = new THREE.Fog("#f8fafc", 80, 145);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
    camera.position.set(34, 38, 48);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-label", "Mappa 3D del magazzino");
    renderer.domElement.dataset.testid = "warehouse-map-canvas";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.minDistance = 10;
    controls.maxDistance = 115;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight("#ffffff", "#64748b", 2.4));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.3);
    keyLight.position.set(12, 24, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width, map.depth),
      new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.92, metalness: 0.02 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = createRectangularGrid(map.width, map.depth, map.grid_size || GRID_SIZE);
    scene.add(grid);

    const floorEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(map.width, 0.12, map.depth)),
      new THREE.LineBasicMaterial({ color: "#475569" })
    );
    floorEdges.position.y = -0.04;
    scene.add(floorEdges);

    const palletZone = createTextSprite("ZONA PALLET", { background: "#fff7ed", color: "#9a3412", scale: 1.25 });
    palletZone.position.set(-7.6, 0.35, -10.8);
    scene.add(palletZone);
    const slotZone = createTextSprite("ZONA SLOT", { background: "#ecfeff", color: "#115e59", scale: 1.25 });
    slotZone.position.set(7, 0.35, -10.8);
    scene.add(slotZone);

    const entrance = new THREE.Group();
    const entrancePad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.72, 0.08, 32),
      new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.55 })
    );
    entrancePad.position.y = 0.05;
    entrance.add(entrancePad);
    const entranceLabel = createTextSprite("INGRESSO", { background: "#0f172a", color: "#ffffff" });
    entranceLabel.position.y = 1.05;
    entrance.add(entranceLabel);
    entrance.position.set(map.entrance_x, 0, map.entrance_z);
    scene.add(entrance);

    const meshes = new Map();
    const clickMeshes = [];
    locationsRef.current.forEach((location) => {
      const height = location.tipo === "pallet" ? 3.2 : location.tipo === "slot" ? 1.4 : 0.18;
      const geometry = new THREE.BoxGeometry(location.map_width, height, location.map_depth);
      const material = new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.7, metalness: location.tipo === "slot" ? 0.2 : 0.05 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(location.map_x, height / 2, location.map_z);
      mesh.rotation.y = THREE.MathUtils.degToRad(location.map_rotation || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.locationId = location.id;
      scene.add(mesh);

      const hitMesh = new THREE.Mesh(
        new THREE.BoxGeometry(location.map_width * 1.12, Math.max(height, 0.58), location.map_depth * 1.18),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitMesh.userData.locationId = location.id;
      mesh.add(hitMesh);
      clickMeshes.push(hitMesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: "#334155", transparent: true, opacity: 0.45 })
      );
      mesh.add(edge);
      const physicalBlock = Boolean(location.members?.length);
      const label = createTextSprite(locationLabel(location), {
        background: physicalBlock ? "#0f172a" : "#ffffff",
        color: physicalBlock ? "#ffffff" : "#0f172a",
        scale: physicalBlock ? (location.tipo === "pallet" ? 1.32 : 1.18) : location.tipo === "slot" ? 0.76 : 0.86,
      });
      label.position.set(0, height / 2 + (physicalBlock ? 0.78 : 0.48), 0);
      mesh.add(label);
      const accessMarker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24),
        new THREE.MeshStandardMaterial({ color: "#0891b2", emissive: "#164e63", emissiveIntensity: 0.2 })
      );
      accessMarker.position.y = -height / 2 + 0.08;
      mesh.add(accessMarker);
      meshes.set(location.id, { mesh, hitMesh, label, material, edge, height, accessMarker });
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();
    const drag = {
      active: false,
      start: null,
      origins: null,
      ids: [],
      pointerId: null,
      previewLocations: null,
      invalidIds: new Set(),
      styleSnapshots: null,
    };

    const pointerPosition = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const restoreDragVisuals = () => {
      if (!drag.origins) return;
      drag.ids.forEach((id) => {
        const item = meshes.get(id);
        const origin = drag.origins.get(id);
        const style = drag.styleSnapshots?.get(id);
        if (!item || !origin) return;
        item.mesh.position.x = origin.x;
        item.mesh.position.z = origin.z;
        if (style) {
          item.material.color.copy(style.color);
          item.material.emissive.copy(style.emissive);
          item.material.emissiveIntensity = style.emissiveIntensity;
        }
      });
    };

    const resetDrag = () => {
      drag.active = false;
      drag.start = null;
      drag.origins = null;
      drag.ids = [];
      drag.pointerId = null;
      drag.previewLocations = null;
      drag.invalidIds = new Set();
      drag.styleSnapshots = null;
      controls.enabled = propsRef.current.mode === "explore";
      renderer.domElement.style.cursor = propsRef.current.mode.startsWith("move") ? "grab" : "default";
      propsRef.current.onDragStateChange?.({ active: false, invalid: false, touching: false, count: 0 });
    };

    const releasePointer = (pointerId) => {
      if (pointerId != null && renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
      }
    };

    const finishDrag = (event, { cancel = false } = {}) => {
      if (!drag.active) return;
      const pointerId = event?.pointerId ?? drag.pointerId;
      const invalid = drag.invalidIds.size > 0;
      const nextLocations = drag.previewLocations;
      if (cancel || invalid || !nextLocations) {
        restoreDragVisuals();
        if (invalid && !cancel) toast.error("Posizione non valida: l'ubicazione si sovrappone a un'altra");
      } else {
        drag.ids.forEach((id) => {
          const item = meshes.get(id);
          const style = drag.styleSnapshots?.get(id);
          if (!item || !style) return;
          item.material.color.copy(style.color);
          item.material.emissive.copy(style.emissive);
          item.material.emissiveIntensity = style.emissiveIntensity;
        });
        propsRef.current.onMoveCommit(nextLocations);
      }
      releasePointer(pointerId);
      resetDrag();
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      pointerPosition(event);
      if (propsRef.current.mode === "draw-aisle") {
        if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
        event.preventDefault();
        event.stopPropagation();
        const step = propsRef.current.snap ? GRID_SIZE : 0.01;
        const halfWidth = propsRef.current.map.width / 2;
        const halfDepth = propsRef.current.map.depth / 2;
        propsRef.current.onAislePoint?.({
          x: Math.max(-halfWidth, Math.min(halfWidth, Math.round(planeHit.x / step) * step)),
          z: Math.max(-halfDepth, Math.min(halfDepth, Math.round(planeHit.z / step) * step)),
        });
        return;
      }
      const hit = raycaster.intersectObjects(clickMeshes, false)[0];
      if (propsRef.current.mode === "place-location") {
        if (hit) {
          propsRef.current.setSelectedId(hit.object.userData.locationId);
          return;
        }
        const selected = locationsRef.current.find((row) => row.id === propsRef.current.selectedId);
        if (!selected || !OPERATIONAL_TYPES.has(selected.tipo) || !raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
        const step = propsRef.current.snap ? GRID_SIZE : 0.01;
        const extents = rotatedHalfExtents(selected);
        const halfWidth = propsRef.current.map.width / 2;
        const halfDepth = propsRef.current.map.depth / 2;
        const mapX = Math.max(-halfWidth + extents.x, Math.min(halfWidth - extents.x, Math.round(planeHit.x / step) * step));
        const mapZ = Math.max(-halfDepth + extents.z, Math.min(halfDepth - extents.z, Math.round(planeHit.z / step) * step));
        const rawPreview = locationsRef.current.map((row) => row.id === selected.id ? { ...row, map_x: mapX, map_z: mapZ } : row);
        const preview = propsRef.current.magnet ? magnetizeLocations(rawPreview, [selected.id]).locations : rawPreview;
        if (collisionIds(preview).has(selected.id)) {
          toast.error("Casella occupata: lascia spazio oppure affianca gli scaffali senza sovrapporli");
          return;
        }
        propsRef.current.onMoveCommit(preview);
        const attachedTo = touchingRelations(preview).get(selected.id) || [];
        if (attachedTo.length) toast.success(`A contatto con ${attachedTo.map((row) => row.codice).join(", ")}: nessun passaggio tra le ubicazioni`);
        else toast.success("Posizione separata: lo spazio libero può essere usato dalla rotta");
        return;
      }
      if (!hit) return;
      const locationId = hit.object.userData.locationId;
      propsRef.current.setSelectedId(locationId);
      if (!propsRef.current.mode.startsWith("move")) return;
      const selected = locationsRef.current.find((row) => row.id === locationId);
      if (!selected || !OPERATIONAL_TYPES.has(selected.tipo)) return;
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
      event.preventDefault();
      event.stopPropagation();
      drag.active = true;
      drag.start = planeHit.clone();
      drag.ids = propsRef.current.mode === "move-zone"
        ? locationsRef.current.filter((row) => row.tipo === selected.tipo).map((row) => row.id)
        : [locationId];
      drag.origins = new Map(locationsRef.current.filter((row) => drag.ids.includes(row.id)).map((row) => [row.id, { x: row.map_x, z: row.map_z }]));
      drag.pointerId = event.pointerId;
      drag.previewLocations = locationsRef.current;
      drag.invalidIds = new Set();
      drag.styleSnapshots = new Map(drag.ids.map((id) => {
        const item = meshes.get(id);
        return [id, {
          color: item.material.color.clone(),
          emissive: item.material.emissive.clone(),
          emissiveIntensity: item.material.emissiveIntensity,
        }];
      }));
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      propsRef.current.onDragStateChange?.({ active: true, invalid: false, touching: false, count: drag.ids.length });
    };

    const onPointerMove = (event) => {
      if (!drag.active) {
        if (propsRef.current.mode === "draw-aisle" || propsRef.current.mode === "place-location") {
          renderer.domElement.style.cursor = "crosshair";
          return;
        }
        pointerPosition(event);
        const hovering = raycaster.intersectObjects(clickMeshes, false).length > 0;
        renderer.domElement.style.cursor = propsRef.current.mode.startsWith("move") && hovering ? "grab" : "default";
        return;
      }
      pointerPosition(event);
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
      const step = propsRef.current.snap ? GRID_SIZE : 0.01;
      const rawDx = planeHit.x - drag.start.x;
      const rawDz = planeHit.z - drag.start.z;
      const halfWidth = propsRef.current.map.width / 2;
      const halfDepth = propsRef.current.map.depth / 2;
      const movingRows = locationsRef.current.filter((row) => drag.origins.has(row.id));
      let minDx = -Infinity;
      let maxDx = Infinity;
      let minDz = -Infinity;
      let maxDz = Infinity;
      movingRows.forEach((location) => {
        const origin = drag.origins.get(location.id);
        const extents = rotatedHalfExtents(location);
        minDx = Math.max(minDx, -halfWidth + extents.x - origin.x);
        maxDx = Math.min(maxDx, halfWidth - extents.x - origin.x);
        minDz = Math.max(minDz, -halfDepth + extents.z - origin.z);
        maxDz = Math.min(maxDz, halfDepth - extents.z - origin.z);
      });
      const anchor = drag.origins.get(drag.ids[0]);
      const snappedDx = Math.round((anchor.x + rawDx) / step) * step - anchor.x;
      const snappedDz = Math.round((anchor.z + rawDz) / step) * step - anchor.z;
      const dx = Math.max(minDx, Math.min(maxDx, snappedDx));
      const dz = Math.max(minDz, Math.min(maxDz, snappedDz));
      const rawPreviewLocations = locationsRef.current.map((location) => {
        const origin = drag.origins.get(location.id);
        return origin ? { ...location, map_x: origin.x + dx, map_z: origin.z + dz } : location;
      });
      const previewLocations = propsRef.current.magnet
        ? magnetizeLocations(rawPreviewLocations, drag.ids).locations
        : rawPreviewLocations;
      const previewCollisions = collisionIds(previewLocations);
      const invalidIds = new Set(drag.ids.filter((id) => previewCollisions.has(id)));
      const previewTouching = touchingRelations(previewLocations);
      const attachedIds = new Set(drag.ids.filter((id) => previewTouching.has(id)));
      const previewById = new Map(previewLocations.map((location) => [location.id, location]));
      drag.ids.forEach((id) => {
        const item = meshes.get(id);
        const location = previewById.get(id);
        if (!item || !location) return;
        item.mesh.position.x = location.map_x;
        item.mesh.position.z = location.map_z;
        item.material.color.set(invalidIds.size ? "#e11d48" : attachedIds.size ? "#f59e0b" : "#0891b2");
        item.material.emissive.set(invalidIds.size ? "#4c0519" : attachedIds.size ? "#78350f" : "#164e63");
        item.material.emissiveIntensity = 0.28;
      });
      drag.previewLocations = previewLocations;
      drag.invalidIds = invalidIds;
      propsRef.current.onDragStateChange?.({ active: true, invalid: invalidIds.size > 0, touching: attachedIds.size > 0, count: drag.ids.length });
    };

    const onPointerUp = (event) => finishDrag(event);
    const onPointerCancel = (event) => finishDrag(event, { cancel: true });
    const onKeyDown = (event) => {
      if (event.key === "Escape" && drag.active) finishDrag(null, { cancel: true });
    };

    renderer.domElement.style.touchAction = "none";
    renderer.domElement.addEventListener("pointerdown", onPointerDown, true);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    stateRef.current = { scene, camera, renderer, controls, meshes, entrance, routeLine: null, corridorGroup: null };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, true);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose?.();
      });
      container.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [map.depth, map.entrance_x, map.entrance_z, map.grid_size, map.width]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.entrance.position.set(map.entrance_x, 0, map.entrance_z);
    locations.forEach((location) => {
      const item = state.meshes.get(location.id);
      if (!item) return;
      item.mesh.position.set(location.map_x, item.height / 2, location.map_z);
      item.mesh.rotation.y = THREE.MathUtils.degToRad(location.map_rotation || 0);
      const side = location.access_side || "front";
      const accessOffset = side === "left" || side === "right" ? location.map_width / 2 + 0.65 : location.map_depth / 2 + 0.65;
      item.accessMarker.position.x = side === "left" ? -accessOffset : side === "right" ? accessOffset : 0;
      item.accessMarker.position.z = side === "back" ? -accessOffset : side === "front" ? accessOffset : 0;
      const selected = location.id === selectedId;
      const colliding = collisions.has(location.id);
      const attached = touching.has(location.id);
      const showAttached = attached && (mode !== "explore" || selected);
      const color = colliding ? "#dc2626"
        : showAttached ? "#f59e0b"
          : selected ? "#0284c7"
          : location.stato === "bloccata" ? "#e11d48"
            : location.tipo === "pallet" ? (location.occupata ? "#d97706" : "#f0b86e")
              : location.tipo === "slot" ? (location.occupata ? "#0f766e" : "#76c7bc")
                : location.tipo === "outbound" ? "#22c55e"
                  : location.tipo === "packing" ? "#38bdf8"
                    : location.tipo === "quarantena" ? "#a855f7" : "#64748b";
      item.material.color.set(color);
      item.material.emissive.set(colliding ? "#450a0a" : showAttached ? "#78350f" : selected ? "#0c4a6e" : "#000000");
      item.material.emissiveIntensity = selected || colliding || showAttached ? 0.22 : 0;
      item.edge.material.color.set(colliding ? "#991b1b" : showAttached ? "#92400e" : "#334155");
      item.accessMarker.visible = selected;
      const ordinal = locationNumber(location.codice);
      item.label.visible = Boolean(location.members?.length) || selected || location.occupata || ordinal % 10 === 0 || !OPERATIONAL_TYPES.has(location.tipo);
    });

    if (state.routeLine) {
      state.scene.remove(state.routeLine);
      state.routeLine.geometry.dispose();
      state.routeLine.material.dispose();
      state.routeLine = null;
    }
    if (routeData.pathPoints.length >= 2) {
      const points = routeData.pathPoints.map((routePoint) => new THREE.Vector3(routePoint.x, 0.22, routePoint.z));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: "#2563eb", linewidth: 2 });
      state.routeLine = new THREE.Line(geometry, material);
      state.routeLine.renderOrder = 10;
      state.scene.add(state.routeLine);
    }

    if (state.corridorGroup) {
      state.scene.remove(state.corridorGroup);
      state.corridorGroup.traverse((object) => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    }
    const corridorGroup = new THREE.Group();
    const renderAisle = (aisle, draft = false) => {
      aisle.points.slice(0, -1).forEach((start, index) => {
        const end = aisle.points[index + 1];
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        const segment = new THREE.Mesh(
          new THREE.BoxGeometry(length, 0.035, draft ? 0.42 : 0.58),
          new THREE.MeshBasicMaterial({ color: draft ? "#f59e0b" : "#22d3ee", transparent: true, opacity: draft ? 0.82 : 0.38, depthWrite: false })
        );
        segment.position.set((start.x + end.x) / 2, 0.07, (start.z + end.z) / 2);
        segment.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
        corridorGroup.add(segment);
      });
      aisle.points.forEach((aislePoint) => {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(draft ? 0.13 : 0.09, draft ? 0.13 : 0.09, 0.05, 18),
          new THREE.MeshBasicMaterial({ color: draft ? "#f59e0b" : "#0891b2" })
        );
        marker.position.set(aislePoint.x, 0.1, aislePoint.z);
        corridorGroup.add(marker);
      });
    };
    normalizeAisles(map.aisles).forEach((aisle) => renderAisle(aisle));
    if (draftAislePoints.length) renderAisle({ points: draftAislePoints }, true);
    state.corridorGroup = corridorGroup;
    state.scene.add(corridorGroup);
  }, [collisions, draftAislePoints, locations, map.aisles, map.entrance_x, map.entrance_z, mode, routeData.pathPoints, selectedId, touching]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.controls.enabled = mode === "explore";
    state.renderer.domElement.style.cursor = mode.startsWith("move") ? "grab" : mode === "draw-aisle" || mode === "place-location" ? "crosshair" : "default";
  }, [mode]);

  return <div ref={containerRef} className="absolute inset-0" />;
});

export default function WmsWarehouseMap() {
  const { clientId, selectedClient } = useOutletContext() || {};
  const sceneRef = useRef(null);
  const [locations, setLocations] = useState([]);
  const [map, setMap] = useState(DEFAULT_MAP);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("explore");
  const [snap, setSnap] = useState(true);
  const [magnet, setMagnet] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [draftAislePoints, setDraftAislePoints] = useState([]);
  const [selectedAisleId, setSelectedAisleId] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [dragState, setDragState] = useState({ active: false, invalid: false, touching: false, count: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unmappedStock, setUnmappedStock] = useState([]);
  const [hiddenLocations, setHiddenLocations] = useState([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [creatingLocations, setCreatingLocations] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blockSearch, setBlockSearch] = useState("");
  const [locationDraft, setLocationDraft] = useState({ tipo: "slot", blocco: "101", bloccoFine: "101", livelli: 1, ubicazioni: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = clientId ? `?cliente_id=${encodeURIComponent(clientId)}` : "";
      const response = await api.get(`/wms/mappa${suffix}`);
      const rawMap = response.data.map || {};
      const legacySize = Number(rawMap.width) !== DEFAULT_MAP.width || Number(rawMap.depth) !== DEFAULT_MAP.depth;
      const legacyDimensions = (response.data.locations || []).some((row) => row.tipo === "slot"
        && (Number(row.map_width) !== 1.6 || Number(row.map_depth) !== 0.5));
      const hiddenLocationIds = new Set(Array.isArray(rawMap.hidden_location_ids) ? rawMap.hidden_location_ids : []);
      const hiddenRows = (response.data.locations || []).filter((row) => (
        hiddenLocationIds.has(row.id) && OPERATIONAL_TYPES.has(row.tipo)
      ));
      const hiddenOccupiedRows = hiddenRows.filter((row) => Number(row.quantita || 0) > 0);
      const visibleRows = (response.data.locations || []).filter((row) => (
        !hiddenLocationIds.has(row.id) && !MAP_HIDDEN_CODES.has(row.codice)
      ));
      const sourceLocations = legacySize ? smartLocations(visibleRows) : visibleRows;
      const nextMap = normalizeMap(rawMap);
      const loadedLocations = normalizeLocations(buildPhysicalBlocks(sourceLocations));
      const outOfBoundsCodes = loadedLocations
        .filter((location) => OPERATIONAL_TYPES.has(location.tipo) && locationOutsideMap(location, nextMap))
        .flatMap((location) => location.members?.length
          ? location.members.map((member) => member.codice)
          : [location.codice]);
      const nextLocations = placeNewBlocksOnStagingSide(loadedLocations, outOfBoundsCodes, nextMap);
      const recoveredDraft = restoreMapDraft(nextLocations, nextMap);
      const visibleLocations = recoveredDraft?.locations || nextLocations;
      const visibleMap = recoveredDraft?.map || nextMap;
      setLocations(visibleLocations);
      setHiddenLocations(normalizeLocations(buildPhysicalBlocks(hiddenRows)));
      setUnmappedStock(normalizeLocations(buildPhysicalBlocks(hiddenOccupiedRows)));
      setMap(visibleMap);
      setInitialSnapshot(legacySize || legacyDimensions
        ? "__legacy_map__"
        : mapSnapshot(loadedLocations, nextMap));
      setMoveHistory([]);
      setSelectedId(null);
      if (recoveredDraft) toast.success("Bozza della disposizione recuperata");
      return visibleLocations;
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Mappa non disponibile");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => locations.find((location) => location.id === selectedId) || null, [locations, selectedId]);
  const collisions = useMemo(() => collisionIds(locations), [locations]);
  const touching = useMemo(() => touchingRelations(locations), [locations]);
  const selectedCollisions = useMemo(() => selected
    ? locations.filter((location) => location.id !== selected.id && locationsOverlap(selected, location))
    : [], [locations, selected]);
  const selectedTouching = selected ? touching.get(selected.id) || [] : [];
  const routeData = useMemo(() => showRoute
    ? calculateWarehouseRoute(
      locations.filter((location) => location.occupata && OPERATIONAL_TYPES.has(location.tipo)),
      { ...map, grid_size: GRID_SIZE, obstacles: locations },
    )
    : { locations: [], distance: 0, pathPoints: [], mode: "direct" }, [locations, map, showRoute]);
  const dirty = useMemo(() => Boolean(initialSnapshot) && mapSnapshot(locations, map) !== initialSnapshot, [initialSnapshot, locations, map]);

  useEffect(() => {
    if (loading || !dirty) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(MAP_DRAFT_KEY, JSON.stringify({
          saved_at: new Date().toISOString(),
          locations: locations.map(({ id, map_x, map_z, map_rotation, map_width, map_depth, access_side }) => ({
            id, map_x, map_z, map_rotation, map_width, map_depth, access_side,
          })),
          map: {
            width: map.width,
            depth: map.depth,
            entrance_x: map.entrance_x,
            entrance_z: map.entrance_z,
            aisles: map.aisles,
          },
        }));
      } catch (_) {
        // La mappa continua a funzionare anche se il browser non concede lo storage locale.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, locations, map]);
  const stats = useMemo(() => ({
    pallets: locations.filter((row) => row.tipo === "pallet").length,
    slots: locations.filter((row) => row.tipo === "slot").length,
    palletPositions: locations.filter((row) => row.tipo === "pallet").reduce((sum, row) => sum + Number(row.logical_count || 1), 0),
    slotPositions: locations.filter((row) => row.tipo === "slot").reduce((sum, row) => sum + Number(row.logical_count || 1), 0),
    occupied: locations.filter((row) => row.occupata && OPERATIONAL_TYPES.has(row.tipo)).length,
  }), [locations]);

  const updateSelected = (changes) => {
    if (!selectedId) return;
    setLocations((previous) => {
      setMoveHistory((history) => [...history.slice(-9), previous]);
      return previous.map((location) => location.id === selectedId ? { ...location, ...changes } : location);
    });
  };

  const commitMove = useCallback((nextLocations) => {
    setLocations((previous) => {
      setMoveHistory((history) => [...history.slice(-9), previous]);
      return nextLocations;
    });
  }, []);

  const undoMove = () => {
    setMoveHistory((history) => {
      if (!history.length) return history;
      setLocations(history[history.length - 1]);
      setSelectedId(null);
      return history.slice(0, -1);
    });
  };

  const activateMoveMode = (nextMode) => {
    setMode(nextMode);
    setDraftAislePoints([]);
    setDragState({ active: false, invalid: false, touching: false, count: 0 });
    window.requestAnimationFrame(() => sceneRef.current?.topView());
  };

  const activatePlacementMode = () => {
    setMode("place-location");
    setDraftAislePoints([]);
    setDragState({ active: false, invalid: false, touching: false, count: 0 });
    window.requestAnimationFrame(() => sceneRef.current?.topView());
  };

  const activateAisleMode = () => {
    setMode("draw-aisle");
    setSelectedId(null);
    setSelectedAisleId(null);
    setDraftAislePoints([]);
    window.requestAnimationFrame(() => sceneRef.current?.topView());
  };

  const appendAislePoint = useCallback((nextPoint) => {
    setDraftAislePoints((previous) => {
      const last = previous[previous.length - 1];
      return last && last.x === nextPoint.x && last.z === nextPoint.z ? previous : [...previous, nextPoint];
    });
  }, []);

  const finishAisle = () => {
    if (draftAislePoints.length < 2) {
      toast.error("Indica almeno due punti per creare il corridoio");
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() || `aisle-${Date.now()}`;
    const nextAisle = { id, name: `Corridoio ${map.aisles.length + 1}`, points: draftAislePoints };
    setMap((previous) => ({ ...previous, aisles: [...previous.aisles, nextAisle] }));
    setSelectedAisleId(id);
    setDraftAislePoints([]);
    setMode("explore");
    toast.success("Corridoio aggiunto. Salva la mappa per confermare.");
  };

  const removeAisle = (aisleId) => {
    setMap((previous) => ({ ...previous, aisles: previous.aisles.filter((aisle) => aisle.id !== aisleId) }));
    setSelectedAisleId((previous) => previous === aisleId ? null : previous);
  };

  const updateAislePoint = (aisleId, pointIndex, changes) => {
    setMap((previous) => ({
      ...previous,
      aisles: previous.aisles.map((aisle) => aisle.id !== aisleId ? aisle : {
        ...aisle,
        points: aisle.points.map((aislePoint, index) => index === pointIndex ? { ...aislePoint, ...changes } : aislePoint),
      }),
    }));
  };

  const applySmartLayout = () => {
    setLocations((previous) => {
      setMoveHistory((history) => [...history.slice(-9), previous]);
      return smartLocations(previous);
    });
    setSelectedId(null);
    toast.success("Disposizione intelligente applicata. Salva per confermare.");
  };

  const findBlock = () => {
    const query = String(blockSearch || "").trim().toUpperCase().replace(/^BLOCCO\s*/, "");
    if (!query) return;
    const target = locations.find((location) => (
      String(location.block_number || "").toUpperCase() === query
      || String(location.codice || "").toUpperCase() === `BLOCCO ${query}`
      || String(location.codice || "").toUpperCase() === query
      || location.members?.some((member) => String(member.codice || "").toUpperCase() === query)
    ));
    if (!target) {
      const hiddenTarget = hiddenLocations.find((location) => (
        String(location.block_number || "").toUpperCase() === query
        || String(location.codice || "").toUpperCase() === `BLOCCO ${query}`
        || String(location.codice || "").toUpperCase() === query
        || location.members?.some((member) => String(member.codice || "").toUpperCase() === query)
      ));
      if (hiddenTarget) {
        const members = hiddenTarget.members?.length ? hiddenTarget.members : [hiddenTarget];
        const memberIds = new Set(members.map((member) => member.id));
        const memberCodes = members.map((member) => member.codice);
        const restoredLocations = placeNewBlocksOnStagingSide([...locations, hiddenTarget], memberCodes, map);
        setMap((current) => ({
          ...current,
          hidden_location_ids: (current.hidden_location_ids || []).filter((id) => !memberIds.has(id)),
        }));
        setLocations(restoredLocations);
        setHiddenLocations((current) => current.filter((location) => location.id !== hiddenTarget.id));
        setUnmappedStock((current) => current.filter((location) => location.id !== hiddenTarget.id));
        setSelectedId(hiddenTarget.id);
        setMode("explore");
        window.requestAnimationFrame(() => sceneRef.current?.focusLocation(hiddenTarget.id));
        toast.success(`${hiddenTarget.codice} ripristinato sul lato destro. Salva la mappa.`);
        return;
      }
      toast.error(`Blocco ${query} non presente nella mappa`);
      return;
    }
    setSelectedId(target.id);
    setMode("explore");
    window.requestAnimationFrame(() => sceneRef.current?.focusLocation(target.id));
    toast.success(`${target.codice} trovato e selezionato`);
  };

  const openLocationBuilder = (tipo) => {
    setLocationDraft({ tipo, blocco: "101", bloccoFine: "101", livelli: 1, ubicazioni: 1 });
    setBuilderOpen(true);
  };

  const createLocations = async () => {
    setCreatingLocations(true);
    try {
      const response = await api.post("/wms/ubicazioni/genera", {
        tipo: locationDraft.tipo,
        blocco: locationDraft.blocco,
        blocco_fine: locationDraft.bloccoFine,
        livelli: Number(locationDraft.livelli),
        ubicazioni_per_livello: Number(locationDraft.ubicazioni),
      });
      const firstCode = response.data.locations?.[0]?.codice;
      const requestedCodes = (response.data.locations || []).map((location) => location.codice);
      setBuilderOpen(false);
      const nextLocations = await load();
      const stagedLocations = placeNewBlocksOnStagingSide(nextLocations || [], requestedCodes, map);
      if (requestedCodes.length) {
        setLocations(stagedLocations);
        setMoveHistory((history) => [...history.slice(-9), nextLocations]);
      }
      const firstLocation = stagedLocations.find((row) => row.codice === firstCode || row.members?.some((member) => member.codice === firstCode));
      if (firstLocation) {
        setSelectedId(firstLocation.id);
        activatePlacementMode();
      }
      toast.success(`${response.data.create} nuove ubicazioni create${response.data.esistenti ? `, ${response.data.esistenti} gia presenti` : ""}. I nuovi blocchi sono raccolti sul lato destro della griglia.`);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Ubicazioni non create");
    } finally {
      setCreatingLocations(false);
    }
  };

  const removeSelectedFromMap = () => {
    if (!selected || !OPERATIONAL_TYPES.has(selected.tipo)) return;
    const members = selected.members?.length ? selected.members : [selected];
    const memberIds = members.map((member) => member.id);
    setMap((current) => ({
      ...current,
      hidden_location_ids: [...new Set([...(current.hidden_location_ids || []), ...memberIds])],
    }));
    if (Number(selected.quantita || 0) > 0) {
      setUnmappedStock((current) => [...current.filter((location) => location.id !== selected.id), selected]);
    }
    setLocations((current) => current.filter((location) => location.id !== selected.id));
    setDeleteOpen(false);
    setSelectedId(null);
    toast.success("Rimossa dalla mappa. Premi Salva mappa per confermare.");
  };

  const save = async () => {
    if (collisions.size) {
      toast.error("Risolvi le sovrapposizioni prima di salvare");
      return;
    }
    setSaving(true);
    try {
      const response = await api.put("/wms/mappa", {
        locations: expandPhysicalBlocks(locations),
        map: {
          width: map.width,
          depth: map.depth,
          entrance_x: map.entrance_x,
          entrance_z: map.entrance_z,
          aisles: map.aisles,
          hidden_location_ids: map.hidden_location_ids || [],
        },
      });
      const nextMap = normalizeMap(response.data.map || {});
      const hiddenLocationIds = new Set(nextMap.hidden_location_ids || []);
      const nextLocations = normalizeLocations(buildPhysicalBlocks(
        (response.data.locations || []).filter((row) => (
          !hiddenLocationIds.has(row.id) && !MAP_HIDDEN_CODES.has(row.codice)
        )),
      ));
      setLocations(nextLocations);
      setMap(nextMap);
      setInitialSnapshot(mapSnapshot(nextLocations, nextMap));
      setMoveHistory([]);
      try {
        window.localStorage.removeItem(MAP_DRAFT_KEY);
      } catch (_) {
        // Il salvataggio remoto e gia concluso; lo storage locale e solo una protezione aggiuntiva.
      }
      toast.success("Mappa magazzino salvata");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Mappa non salvata");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>;

  return (
    <div className="space-y-4" data-testid="admin-wms-warehouse-map">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-teal-700"><MapPinned className="h-4 w-4" /> Layout operativo</div>
          <h1 className="font-heading text-3xl font-black">Mappa magazzino</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline"><PackageOpen className="mr-1 h-3.5 w-3.5 text-amber-600" /> {stats.pallets} blocchi pallet · {stats.palletPositions} posizioni</Badge>
            <Badge variant="outline"><Warehouse className="mr-1 h-3.5 w-3.5 text-teal-700" /> {stats.slots} blocchi slot · {stats.slotPositions} posizioni</Badge>
            <Badge variant="outline"><Boxes className="mr-1 h-3.5 w-3.5 text-sky-700" /> {stats.occupied} occupate</Badge>
            <Badge variant="outline"><Grid3X3 className="mr-1 h-3.5 w-3.5 text-slate-600" /> 18 × 60 m · griglia 10 cm</Badge>
            {clientId && <Badge className="bg-cyan-100 text-cyan-900 hover:bg-cyan-100">Stock: {selectedClient?.ragione_sociale || "Cliente selezionato"}</Badge>}
            {dirty && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Modifiche non salvate</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex h-10 overflow-hidden rounded-md border border-slate-200 bg-white">
            <Input
              value={blockSearch}
              onChange={(event) => setBlockSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") findBlock(); }}
              placeholder="Trova blocco"
              aria-label="Trova blocco"
              className="h-10 w-36 rounded-none border-0 focus-visible:ring-0"
            />
            <Button type="button" variant="ghost" size="icon" onClick={findBlock} aria-label="Cerca blocco" className="h-10 w-10 rounded-none border-l border-slate-200">
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" onClick={() => openLocationBuilder("slot")}><Plus className="mr-2 h-4 w-4" /> Nuovo slot</Button>
          <Button variant="outline" onClick={() => openLocationBuilder("pallet")}><Plus className="mr-2 h-4 w-4" /> Nuovo portapallet</Button>
          <Button variant="outline" onClick={applySmartLayout}><Sparkles className="mr-2 h-4 w-4" /> Disposizione intelligente</Button>
          <Button onClick={save} disabled={!dirty || saving || collisions.size > 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salva mappa
          </Button>
        </div>
      </div>

      {unmappedStock.length > 0 && (
        <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-bold">
              Merce presente in {unmappedStock.length} {unmappedStock.length === 1 ? "blocco escluso" : "blocchi esclusi"} dalla mappa
            </div>
            <div className="mt-1">
              {unmappedStock.reduce((sum, location) => sum + Number(location.quantita || 0), 0)} pezzi non partecipano alle rotte intelligenti: {unmappedStock.slice(0, 8).map((location) => location.codice).join(", ")}{unmappedStock.length > 8 ? "…" : ""}.
              Rigenera gli stessi blocchi per riportarli nella mappa senza perdere il contenuto.
            </div>
          </div>
        </div>
      )}

      {collisions.size > 0 && (
        <div className="flex items-center gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          <AlertTriangle className="h-4 w-4" /> {collisions.size} ubicazioni sovrapposte: {locations.filter((row) => collisions.has(row.id)).map((row) => row.codice).join(", ")}
        </div>
      )}

      {routeData.unreachable?.length > 0 && (
        <div className="flex items-center gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4" /> Passaggio bloccato verso: {routeData.unreachable.map((location) => location.codice).join(", ")}. Lascia almeno una casella libera.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 bg-white px-3 py-3">
        <div className="flex gap-1 rounded-md bg-slate-100 p-1" aria-label="Modalita mappa">
          <ModeButton active={mode === "explore"} onClick={() => setMode("explore")} icon={Eye}>Esplora</ModeButton>
          <ModeButton active={mode === "place-location"} onClick={activatePlacementMode} icon={MousePointer2}>Posiziona a clic</ModeButton>
          <ModeButton active={mode === "move-location"} onClick={() => activateMoveMode("move-location")} icon={Move3D}>Sposta ubicazione</ModeButton>
          <ModeButton active={mode === "move-zone"} onClick={() => activateMoveMode("move-zone")} icon={Boxes}>Sposta zona</ModeButton>
          <button
            type="button"
            onClick={undoMove}
            disabled={!moveHistory.length}
            title="Annulla ultimo spostamento"
            aria-label="Annulla ultimo spostamento"
            className="flex h-9 w-9 items-center justify-center rounded text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
          <label className="flex items-center gap-2"><Switch checked={snap} onCheckedChange={setSnap} /><Grid3X3 className="h-4 w-4" /> Caselle 10 cm</label>
          <label className="flex items-center gap-2"><Switch checked={magnet} onCheckedChange={setMagnet} /><Move3D className="h-4 w-4" /> Calamita 20 cm</label>
          <label className="flex items-center gap-2"><Switch checked={showRoute} onCheckedChange={setShowRoute} /><Route className="h-4 w-4" /> Percorso più corto</label>
          <div className="text-slate-500">{routeData.locations.length} tappe · {routeData.distance.toFixed(1)} m · spazio libero automatico</div>
        </div>
      </div>

      <div className="relative -mx-4 h-[calc(100dvh-250px)] min-h-[460px] overflow-hidden bg-slate-50 sm:-mx-6 lg:-mx-8" data-testid="warehouse-map-viewport">
        <WarehouseScene
          ref={sceneRef}
          locations={locations}
          onMoveCommit={commitMove}
          onDragStateChange={setDragState}
          onAislePoint={appendAislePoint}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          mode={mode}
          snap={snap}
          magnet={magnet}
          map={map}
          routeData={routeData}
          collisions={collisions}
          touching={touching}
          draftAislePoints={draftAislePoints}
        />

        {mode.startsWith("move") && (
          <div className={`pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 border px-4 py-2 text-sm font-bold shadow-sm backdrop-blur ${
            dragState.invalid
              ? "border-rose-300 bg-rose-50/95 text-rose-800"
              : dragState.touching
                ? "border-amber-300 bg-amber-50/95 text-amber-900"
              : dragState.active
                ? "border-cyan-300 bg-cyan-50/95 text-cyan-900"
                : "border-slate-200 bg-white/95 text-slate-700"
          }`}>
            {dragState.invalid
              ? "SOVRAPPOSTA: posizione non valida e non salvabile"
              : dragState.touching
                ? "ATTACCATA: posizione valida, ma qui non c'è passaggio"
              : dragState.active
                ? `SEPARATA: spazio percorribile · ${dragState.count} ${dragState.count === 1 ? "ubicazione" : "ubicazioni"}`
                : mode === "move-zone"
                  ? "Trascina un pallet o uno slot per spostare tutta la zona"
                  : "Trascina l'ubicazione nella nuova posizione"}
          </div>
        )}

        {mode === "place-location" && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 border border-cyan-300 bg-cyan-50/95 px-4 py-2 text-sm font-bold text-cyan-950 shadow-sm backdrop-blur">
            {selected && OPERATIONAL_TYPES.has(selected.tipo)
              ? `${selected.codice}: clicca una casella libera per posizionarlo`
              : "Clicca uno scaffale o pallet, poi clicca la posizione di destinazione"}
          </div>
        )}

        <div className="absolute left-4 top-4 flex gap-1 border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
          <Button size="sm" variant="ghost" onClick={() => sceneRef.current?.topView()}><Grid3X3 className="mr-2 h-4 w-4" /> Alto</Button>
          <Button size="sm" variant="ghost" onClick={() => sceneRef.current?.perspectiveView()}><Box className="mr-2 h-4 w-4" /> 3D</Button>
          <Button size="icon" variant="ghost" title="Inquadra mappa" aria-label="Inquadra mappa" onClick={() => sceneRef.current?.fitView()}><ScanLine className="h-4 w-4" /></Button>
        </div>

        <div className="absolute bottom-4 left-4 flex flex-wrap gap-3 border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur">
          <Legend color="#f0b86e" label="Pallet" /><Legend color="#76c7bc" label="Slot" /><Legend color="#38bdf8" label="Packing station" /><Legend color="#22d3ee" label="Percorso" /><Legend color="#f59e0b" label="Attaccata" /><Legend color="#dc2626" label="Sovrapposta" />
        </div>

        <aside className={`absolute right-4 overflow-y-auto border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur max-md:hidden ${selected ? "bottom-4 top-4 w-[320px]" : "top-4 w-[280px]"}`}>
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div><div className="text-xs font-bold uppercase text-slate-500">{selected.members?.length ? "Blocco fisico" : "Ubicazione"}</div><h2 className="mt-1 text-xl font-black">{selected.codice}</h2></div>
                <Badge className={selected.tipo === "pallet" ? "bg-amber-100 text-amber-900" : selected.tipo === "slot" ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-800"}>{selected.tipo}</Badge>
              </div>
              {selectedCollisions.length > 0 ? (
                <div className="mt-4 border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-900">
                  Sovrapposta a {selectedCollisions.map((row) => row.codice).join(", ")}. Spostala prima di salvare.
                </div>
              ) : selectedTouching.length > 0 ? (
                <div className="mt-4 border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                  Attaccata a {selectedTouching.map((row) => row.codice).join(", ")}. Tra queste ubicazioni non c'è passaggio.
                </div>
              ) : OPERATIONAL_TYPES.has(selected.tipo) ? (
                <div className="mt-4 border border-cyan-200 bg-cyan-50 p-3 text-sm font-bold text-cyan-900">
                  Separata dalle altre ubicazioni. Lo spazio libero è disponibile per la rotta.
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 py-4">
                <MapInput label="X (m)" value={selected.map_x} onChange={(value) => updateSelected({ map_x: value })} step={0.01} />
                <MapInput label="Z (m)" value={selected.map_z} onChange={(value) => updateSelected({ map_z: value })} step={0.01} />
                <MapInput label="Rotazione" value={selected.map_rotation} onChange={(value) => updateSelected({ map_rotation: value })} step={15} />
                <div><div className="mb-1 text-xs font-bold text-slate-500">Stato</div><div className="flex h-10 items-center font-semibold capitalize">{selected.stato}</div></div>
              </div>
              {OPERATIONAL_TYPES.has(selected.tipo) && (
                <div className="mb-4 grid grid-cols-2 border border-slate-200 bg-slate-50 text-center">
                  <div className="border-r border-slate-200 px-3 py-2"><div className="text-[11px] font-bold uppercase text-slate-500">Larghezza</div><div className="mt-1 font-mono font-bold">{Math.round(selected.map_width * 100)} cm</div></div>
                  <div className="px-3 py-2"><div className="text-[11px] font-bold uppercase text-slate-500">Profondita</div><div className="mt-1 font-mono font-bold">{Math.round(selected.map_depth * 100)} cm</div></div>
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={() => updateSelected({ map_rotation: (selected.map_rotation + 90) % 360 })}><RotateCcw className="mr-2 h-4 w-4" /> Ruota 90°</Button>
              {OPERATIONAL_TYPES.has(selected.tipo) && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="mb-2 text-xs font-bold uppercase text-slate-500">Lato di prelievo</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["front", "Fronte"], ["back", "Retro"], ["left", "Sinistra"], ["right", "Destra"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateSelected({ access_side: value })}
                        className={`h-9 border text-sm font-semibold transition ${selected.access_side === value ? "border-cyan-600 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">Il punto azzurro indica da quale lato l’operatore può raggiungere la merce.</div>
                </div>
              )}
              {selected.members?.length ? (
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase text-slate-500">Posizioni nel blocco</span><Badge variant="outline">{selected.members.length}</Badge></div>
                  <div className="mt-3 space-y-2">
                    {selected.members.map((member) => (
                      <div key={member.id} className={`border p-3 ${member.occupata ? "border-teal-200 bg-teal-50/60" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-sm font-black">{String(member.codice).replace(/^[SP]/, "")}</div>
                          <Badge className={member.occupata ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}>{member.quantita || 0} pz</Badge>
                        </div>
                        {(member.contenuto || []).length ? (
                          <div className="mt-2 space-y-2 border-t border-teal-200 pt-2">
                            {member.contenuto.map((item) => (
                              <div key={`${member.id}-${item.cliente_id}-${item.fnsku || item.ean}`}>
                                <div className="text-sm font-bold leading-tight">{item.titolo}</div>
                                <div className="mt-1 font-mono text-[11px] text-slate-500">{item.fnsku || item.ean} · ×{item.quantita}</div>
                                <div className="text-[11px] text-slate-500">{item.cliente}</div>
                              </div>
                            ))}
                          </div>
                        ) : <div className="mt-2 text-xs text-slate-500">Posizione libera</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase text-slate-500">Contenuto</span><span className="text-lg font-black">{selected.quantita || 0}</span></div>
                <div className="mt-3 space-y-2">
                  {(selected.contenuto || []).length === 0 ? <div className="text-sm text-slate-500">Ubicazione libera</div> : selected.contenuto.map((item) => (
                    <div key={`${item.cliente_id}-${item.fnsku || item.ean}`} className="border-l-2 border-teal-500 pl-3">
                      <div className="text-sm font-bold">{item.titolo}</div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500">{item.fnsku || item.ean} · ×{item.quantita}</div>
                      <div className="text-[11px] text-slate-500">{item.cliente}</div>
                    </div>
                  ))}
                </div>
              </div>
              )}
              {OPERATIONAL_TYPES.has(selected.tipo) && (
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <Button
                    variant="outline"
                    className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {selected.members?.length ? "Rimuovi blocco dalla mappa" : `Rimuovi ${selected.tipo} dalla mappa`}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="border-b border-slate-200 pb-3">
                <div className="text-xs font-bold uppercase text-slate-500">Viabilità automatica</div>
                <h2 className="mt-1 text-lg font-black">Percorso più corto</h2>
              </div>
              <div className="mt-4 border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
                <Route className="mb-3 h-7 w-7 text-cyan-700" />
                <div className="font-bold">Tutto lo spazio libero è percorribile.</div>
                <div className="mt-2 text-cyan-900">Slot e portapallet sono ostacoli. Se due blocchi sono attaccati, la rotta non passa in mezzo.</div>
              </div>
              <div className="mt-3 border border-slate-200 p-3 text-xs font-semibold text-slate-600">
                Partenza dall’ingresso · griglia 10 cm · tappe ordinate sulla distanza realmente percorribile.
              </div>
            </div>
          )}
        </aside>
      </div>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{locationDraft.tipo === "slot" ? "Aggiungi slot" : "Aggiungi portapallet"}</DialogTitle>
            <DialogDescription>
              {locationDraft.tipo === "slot"
                ? "Dimensione fissa 160 x 50 cm. I livelli partono da A e il codice scanner da S."
                : "Dimensione fissa 270 x 120 cm. I livelli partono da Z e il codice scanner da P."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <BuilderField label="Numero iniziale" value={locationDraft.blocco} onChange={(value) => setLocationDraft((current) => ({ ...current, blocco: value }))} />
            <BuilderField label="Numero finale" value={locationDraft.bloccoFine} onChange={(value) => setLocationDraft((current) => ({ ...current, bloccoFine: value }))} />
            <BuilderField label="Livelli" value={locationDraft.livelli} min={1} max={locationDraft.tipo === "slot" ? 5 : 3} onChange={(value) => setLocationDraft((current) => ({ ...current, livelli: value }))} />
            <BuilderField label="Posizioni per livello" value={locationDraft.ubicazioni} min={1} max={20} onChange={(value) => setLocationDraft((current) => ({ ...current, ubicazioni: value }))} />
          </div>
          <div className="border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
            Primo codice: <strong className="font-mono">{locationDraft.tipo === "slot" ? "S" : "P"}{locationDraft.blocco}+{locationDraft.tipo === "slot" ? "A" : "Z"}1</strong>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilderOpen(false)}>Annulla</Button>
            <Button onClick={createLocations} disabled={creatingLocations}>
              {creatingLocations ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Crea e posiziona
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rimuovi {selected?.codice || "posizione"} dalla mappa?</DialogTitle>
            <DialogDescription>
              {selected?.members?.length
                ? `Il blocco e le sue ${selected.members.length} posizioni non compariranno piu nella mappa 3D.`
                : "La posizione non comparira piu nella mappa 3D."}
            </DialogDescription>
          </DialogHeader>
          <div className="border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
            L'ubicazione, i prodotti e tutti i movimenti restano invariati. Viene esclusa soltanto dalla visualizzazione e dalle rotte intelligenti.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Annulla</Button>
            <Button
              className="bg-rose-700 text-white hover:bg-rose-800"
              onClick={removeSelectedFromMap}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Rimuovi dalla mappa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BuilderField({ label, value, onChange, min = 1, max = 99999 }) {
  return <div><Label className="mb-2 block">{label}</Label><Input type="number" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function ModeButton({ active, onClick, icon: Icon, children }) {
  return <button onClick={onClick} className={`flex h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}><Icon className="h-4 w-4" /> {children}</button>;
}

function Legend({ color, label }) {
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{label}</span>;
}

function MapInput({ label, value, onChange, step = 0.01 }) {
  const focusedRef = useRef(false);
  const [draft, setDraft] = useState(Number(value).toFixed(2));

  useEffect(() => {
    if (!focusedRef.current) setDraft(Number(value).toFixed(2));
  }, [value]);

  const updateDraft = (nextValue) => {
    setDraft(nextValue);
    const normalized = String(nextValue).replace(",", ".");
    if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") return;
    const number = Number(normalized);
    if (Number.isFinite(number)) onChange(number);
  };

  const commitDraft = () => {
    focusedRef.current = false;
    const number = Number(String(draft).replace(",", "."));
    const committed = Number.isFinite(number) ? number : Number(value);
    if (Number.isFinite(number)) onChange(number);
    setDraft(committed.toFixed(2));
  };

  return (
    <label>
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        value={draft}
        onFocus={(event) => { focusedRef.current = true; event.currentTarget.select(); }}
        onChange={(event) => updateDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
      />
    </label>
  );
}
