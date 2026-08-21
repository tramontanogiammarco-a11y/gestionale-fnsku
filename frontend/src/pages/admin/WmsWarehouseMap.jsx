import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AlertTriangle, Box, Boxes, Eye, Grid3X3, Loader2, MapPinned, Move3D,
  PackageOpen, RotateCcw, Route, Save, ScanLine, Sparkles, Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const DEFAULT_MAP = { width: 34, depth: 24, entrance_x: 0, entrance_z: 10.5 };
const OPERATIONAL_TYPES = new Set(["pallet", "slot"]);

function locationNumber(code) {
  return Number(String(code || "").match(/^[PS]\d+\+A(\d+)$/)?.[1] || 0);
}

function smartLocation(location, fallbackIndex = 0) {
  const numbered = locationNumber(location.codice);
  const index = numbered > 0 ? numbered - 1 : fallbackIndex;
  if (location.tipo === "pallet") {
    return { ...location, map_x: -13 + Math.floor(index / 20) * 2.7, map_z: -9 + (index % 20) * 0.95, map_rotation: 0 };
  }
  if (location.tipo === "slot") {
    return { ...location, map_x: 2.5 + Math.floor(index / 20) * 2.2, map_z: -9 + (index % 20) * 0.95, map_rotation: 0 };
  }
  if (location.codice === "INBOUND-01") return { ...location, map_x: -4, map_z: 10.8, map_rotation: 0 };
  if (location.codice === "QUARANTENA-01") return { ...location, map_x: 4, map_z: 10.8, map_rotation: 0 };
  return location;
}

function smartLocations(rows = []) {
  const fallbackIndexes = { pallet: 100, slot: 100, other: 0 };
  return rows.map((location) => {
    const key = location.tipo === "pallet" || location.tipo === "slot" ? location.tipo : "other";
    const fallback = fallbackIndexes[key];
    if (!locationNumber(location.codice)) fallbackIndexes[key] += 1;
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
      map_width: Number(row.map_width || (row.tipo === "pallet" ? 1.6 : row.tipo === "slot" ? 0.92 : 3)),
      map_depth: Number(row.map_depth || (row.tipo === "pallet" ? 0.72 : row.tipo === "slot" ? 0.62 : 1.6)),
    };
  });
}

function mapSnapshot(locations, map) {
  return JSON.stringify({
    locations: locations.map(({ id, map_x, map_z, map_rotation }) => [id, map_x, map_z, map_rotation]),
    map: [map.width, map.depth, map.entrance_x, map.entrance_z],
  });
}

function collisionIds(locations) {
  const rows = locations.filter((row) => Number.isFinite(row.map_x) && Number.isFinite(row.map_z));
  const collisions = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      const xLimit = (left.map_width + right.map_width) / 2 + 0.08;
      const zLimit = (left.map_depth + right.map_depth) / 2 + 0.08;
      if (Math.abs(left.map_x - right.map_x) < xLimit && Math.abs(left.map_z - right.map_z) < zLimit) {
        collisions.add(left.id);
        collisions.add(right.id);
      }
    }
  }
  return collisions;
}

function calculateRoute(locations, map) {
  const pending = locations.filter((location) => location.occupata && OPERATIONAL_TYPES.has(location.tipo));
  const ordered = [];
  let current = { map_x: Number(map.entrance_x), map_z: Number(map.entrance_z) };
  let distance = 0;
  while (pending.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    pending.forEach((location, index) => {
      const nextDistance = Math.hypot(location.map_x - current.map_x, location.map_z - current.map_z);
      if (nextDistance < bestDistance) {
        bestDistance = nextDistance;
        bestIndex = index;
      }
    });
    const [next] = pending.splice(bestIndex, 1);
    ordered.push(next);
    distance += bestDistance;
    current = next;
  }
  return { locations: ordered, distance };
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
  locations, setLocations, selectedId, setSelectedId, mode, snap, map, routeData, collisions,
}, ref) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);
  const locationsRef = useRef(locations);
  const propsRef = useRef({ setLocations, setSelectedId, mode, snap, map });

  locationsRef.current = locations;
  propsRef.current = { setLocations, setSelectedId, mode, snap, map };

  useImperativeHandle(ref, () => ({
    topView() {
      const state = stateRef.current;
      if (!state) return;
      state.camera.position.set(0, 37, 0.01);
      state.controls.target.set(0, 0, 0);
      state.controls.update();
    },
    perspectiveView() {
      const state = stateRef.current;
      if (!state) return;
      state.camera.position.set(25, 25, 27);
      state.controls.target.set(0, 0, 0);
      state.controls.update();
    },
    fitView() {
      const state = stateRef.current;
      if (!state) return;
      const distance = Math.max(map.width, map.depth) * 0.95;
      state.camera.position.set(distance * 0.72, distance * 0.72, distance * 0.78);
      state.controls.target.set(0, 0, 0);
      state.controls.update();
    },
  }), [map.depth, map.width]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || stateRef.current) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eef3f3");
    scene.fog = new THREE.Fog("#eef3f3", 35, 72);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(25, 25, 27);
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
    controls.maxDistance = 58;
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

    const grid = new THREE.GridHelper(Math.max(map.width, map.depth), Math.round(Math.max(map.width, map.depth) * 2), "#94a3b8", "#d8e0e5");
    grid.position.y = 0.012;
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
      const height = location.tipo === "slot" ? 1.35 : location.tipo === "pallet" ? 0.34 : 0.18;
      const geometry = new THREE.BoxGeometry(location.map_width, height, location.map_depth);
      const material = new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.7, metalness: location.tipo === "slot" ? 0.2 : 0.05 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(location.map_x, height / 2, location.map_z);
      mesh.rotation.y = THREE.MathUtils.degToRad(location.map_rotation || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.locationId = location.id;
      scene.add(mesh);
      clickMeshes.push(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: "#334155", transparent: true, opacity: 0.45 })
      );
      mesh.add(edge);
      const label = createTextSprite(location.codice, { scale: location.tipo === "slot" ? 0.76 : 0.86 });
      label.position.set(0, height / 2 + 0.48, 0);
      mesh.add(label);
      meshes.set(location.id, { mesh, label, material, height });
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();
    const drag = { active: false, start: null, origins: null, ids: [] };

    const pointerPosition = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      pointerPosition(event);
      const hit = raycaster.intersectObjects(clickMeshes, false)[0];
      if (!hit) return;
      const locationId = hit.object.userData.locationId;
      propsRef.current.setSelectedId(locationId);
      if (!propsRef.current.mode.startsWith("move")) return;
      const selected = locationsRef.current.find((row) => row.id === locationId);
      if (!selected || !OPERATIONAL_TYPES.has(selected.tipo)) return;
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
      drag.active = true;
      drag.start = planeHit.clone();
      drag.ids = propsRef.current.mode === "move-zone"
        ? locationsRef.current.filter((row) => row.tipo === selected.tipo).map((row) => row.id)
        : [locationId];
      drag.origins = new Map(locationsRef.current.filter((row) => drag.ids.includes(row.id)).map((row) => [row.id, { x: row.map_x, z: row.map_z }]));
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerMove = (event) => {
      if (!drag.active) {
        pointerPosition(event);
        const hovering = raycaster.intersectObjects(clickMeshes, false).length > 0;
        renderer.domElement.style.cursor = propsRef.current.mode.startsWith("move") && hovering ? "grab" : "default";
        return;
      }
      pointerPosition(event);
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
      const step = propsRef.current.snap ? 0.25 : 0.01;
      const rawDx = planeHit.x - drag.start.x;
      const rawDz = planeHit.z - drag.start.z;
      const dx = Math.round(rawDx / step) * step;
      const dz = Math.round(rawDz / step) * step;
      const halfWidth = propsRef.current.map.width / 2;
      const halfDepth = propsRef.current.map.depth / 2;
      propsRef.current.setLocations((previous) => previous.map((location) => {
        const origin = drag.origins.get(location.id);
        if (!origin) return location;
        return {
          ...location,
          map_x: Math.max(-halfWidth + 0.5, Math.min(halfWidth - 0.5, origin.x + dx)),
          map_z: Math.max(-halfDepth + 0.5, Math.min(halfDepth - 0.5, origin.z + dz)),
        };
      }));
    };

    const finishDrag = (event) => {
      if (!drag.active) return;
      drag.active = false;
      drag.origins = null;
      drag.ids = [];
      controls.enabled = true;
      renderer.domElement.style.cursor = "default";
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", finishDrag);
    renderer.domElement.addEventListener("pointercancel", finishDrag);

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

    stateRef.current = { scene, camera, renderer, controls, meshes, entrance, routeLine: null };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", finishDrag);
      renderer.domElement.removeEventListener("pointercancel", finishDrag);
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
  }, [map.depth, map.entrance_x, map.entrance_z, map.width]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.entrance.position.set(map.entrance_x, 0, map.entrance_z);
    locations.forEach((location) => {
      const item = state.meshes.get(location.id);
      if (!item) return;
      item.mesh.position.set(location.map_x, item.height / 2, location.map_z);
      item.mesh.rotation.y = THREE.MathUtils.degToRad(location.map_rotation || 0);
      const selected = location.id === selectedId;
      const colliding = collisions.has(location.id);
      const color = colliding ? "#dc2626"
        : selected ? "#0284c7"
          : location.stato === "bloccata" ? "#e11d48"
            : location.tipo === "pallet" ? (location.occupata ? "#d97706" : "#f0b86e")
              : location.tipo === "slot" ? (location.occupata ? "#0f766e" : "#76c7bc")
                : location.tipo === "quarantena" ? "#a855f7" : "#64748b";
      item.material.color.set(color);
      item.material.emissive.set(selected ? "#0c4a6e" : colliding ? "#450a0a" : "#000000");
      item.material.emissiveIntensity = selected || colliding ? 0.22 : 0;
      const ordinal = locationNumber(location.codice);
      item.label.visible = selected || location.occupata || ordinal % 10 === 0 || !OPERATIONAL_TYPES.has(location.tipo);
    });

    if (state.routeLine) {
      state.scene.remove(state.routeLine);
      state.routeLine.geometry.dispose();
      state.routeLine.material.dispose();
      state.routeLine = null;
    }
    if (routeData.locations.length) {
      const points = [new THREE.Vector3(map.entrance_x, 0.22, map.entrance_z)];
      routeData.locations.forEach((location) => points.push(new THREE.Vector3(location.map_x, 0.22, location.map_z)));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: "#2563eb", linewidth: 2 });
      state.routeLine = new THREE.Line(geometry, material);
      state.routeLine.renderOrder = 10;
      state.scene.add(state.routeLine);
    }
  }, [collisions, locations, map.entrance_x, map.entrance_z, routeData.locations, selectedId]);

  return <div ref={containerRef} className="absolute inset-0" />;
});

export default function WmsWarehouseMap() {
  const sceneRef = useRef(null);
  const [locations, setLocations] = useState([]);
  const [map, setMap] = useState(DEFAULT_MAP);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("explore");
  const [snap, setSnap] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/wms/mappa");
      const nextLocations = normalizeLocations(response.data.locations || []);
      const nextMap = { ...DEFAULT_MAP, ...(response.data.map || {}) };
      setLocations(nextLocations);
      setMap(nextMap);
      setInitialSnapshot(mapSnapshot(nextLocations, nextMap));
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Mappa non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => locations.find((location) => location.id === selectedId) || null, [locations, selectedId]);
  const collisions = useMemo(() => collisionIds(locations), [locations]);
  const routeData = useMemo(() => showRoute ? calculateRoute(locations, map) : { locations: [], distance: 0 }, [locations, map, showRoute]);
  const dirty = useMemo(() => Boolean(initialSnapshot) && mapSnapshot(locations, map) !== initialSnapshot, [initialSnapshot, locations, map]);
  const stats = useMemo(() => ({
    pallets: locations.filter((row) => row.tipo === "pallet").length,
    slots: locations.filter((row) => row.tipo === "slot").length,
    occupied: locations.filter((row) => row.occupata && OPERATIONAL_TYPES.has(row.tipo)).length,
  }), [locations]);

  const updateSelected = (changes) => {
    if (!selectedId) return;
    setLocations((previous) => previous.map((location) => location.id === selectedId ? { ...location, ...changes } : location));
  };

  const applySmartLayout = () => {
    setLocations((previous) => smartLocations(previous));
    setSelectedId(null);
    toast.success("Disposizione intelligente applicata. Salva per confermare.");
  };

  const save = async () => {
    if (collisions.size) {
      toast.error("Risolvi le sovrapposizioni prima di salvare");
      return;
    }
    setSaving(true);
    try {
      const response = await api.put("/wms/mappa", {
        locations: locations.map(({ id, map_x, map_z, map_rotation }) => ({ id, map_x, map_z, map_rotation })),
        map: { width: map.width, depth: map.depth, entrance_x: map.entrance_x, entrance_z: map.entrance_z },
      });
      const nextLocations = normalizeLocations(response.data.locations || []);
      const nextMap = { ...DEFAULT_MAP, ...(response.data.map || {}) };
      setLocations(nextLocations);
      setMap(nextMap);
      setInitialSnapshot(mapSnapshot(nextLocations, nextMap));
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
            <Badge variant="outline"><PackageOpen className="mr-1 h-3.5 w-3.5 text-amber-600" /> {stats.pallets} pallet</Badge>
            <Badge variant="outline"><Warehouse className="mr-1 h-3.5 w-3.5 text-teal-700" /> {stats.slots} slot</Badge>
            <Badge variant="outline"><Boxes className="mr-1 h-3.5 w-3.5 text-sky-700" /> {stats.occupied} occupate</Badge>
            {dirty && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Modifiche non salvate</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={applySmartLayout}><Sparkles className="mr-2 h-4 w-4" /> Disposizione intelligente</Button>
          <Button onClick={save} disabled={!dirty || saving || collisions.size > 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salva mappa
          </Button>
        </div>
      </div>

      {collisions.size > 0 && (
        <div className="flex items-center gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          <AlertTriangle className="h-4 w-4" /> {collisions.size} ubicazioni sovrapposte: {locations.filter((row) => collisions.has(row.id)).map((row) => row.codice).join(", ")}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 bg-white px-3 py-3">
        <div className="flex gap-1 rounded-md bg-slate-100 p-1" aria-label="Modalita mappa">
          <ModeButton active={mode === "explore"} onClick={() => setMode("explore")} icon={Eye}>Esplora</ModeButton>
          <ModeButton active={mode === "move-location"} onClick={() => setMode("move-location")} icon={Move3D}>Sposta ubicazione</ModeButton>
          <ModeButton active={mode === "move-zone"} onClick={() => setMode("move-zone")} icon={Boxes}>Sposta zona</ModeButton>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
          <label className="flex items-center gap-2"><Switch checked={snap} onCheckedChange={setSnap} /><Grid3X3 className="h-4 w-4" /> Griglia</label>
          <label className="flex items-center gap-2"><Switch checked={showRoute} onCheckedChange={setShowRoute} /><Route className="h-4 w-4" /> Percorso</label>
          <div className="text-slate-500">{routeData.locations.length} tappe · {routeData.distance.toFixed(1)} m</div>
        </div>
      </div>

      <div className="relative -mx-4 h-[calc(100dvh-250px)] min-h-[460px] overflow-hidden bg-[#eef3f3] sm:-mx-6 lg:-mx-8" data-testid="warehouse-map-viewport">
        <WarehouseScene
          ref={sceneRef}
          locations={locations}
          setLocations={setLocations}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          mode={mode}
          snap={snap}
          map={map}
          routeData={routeData}
          collisions={collisions}
        />

        <div className="absolute left-4 top-4 flex gap-1 border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
          <Button size="sm" variant="ghost" onClick={() => sceneRef.current?.topView()}><Grid3X3 className="mr-2 h-4 w-4" /> Alto</Button>
          <Button size="sm" variant="ghost" onClick={() => sceneRef.current?.perspectiveView()}><Box className="mr-2 h-4 w-4" /> 3D</Button>
          <Button size="icon" variant="ghost" title="Inquadra mappa" aria-label="Inquadra mappa" onClick={() => sceneRef.current?.fitView()}><ScanLine className="h-4 w-4" /></Button>
        </div>

        <div className="absolute bottom-4 left-4 flex flex-wrap gap-3 border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur">
          <Legend color="#f0b86e" label="Pallet" /><Legend color="#76c7bc" label="Slot" /><Legend color="#d97706" label="Occupata" /><Legend color="#e11d48" label="Bloccata" />
        </div>

        <aside className={`absolute right-4 overflow-y-auto border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur max-md:left-4 max-md:top-auto max-md:w-auto max-md:max-h-[46%] ${selected ? "bottom-4 top-4 w-[320px]" : "top-4 w-[280px]"}`}>
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div><div className="text-xs font-bold uppercase text-slate-500">Ubicazione</div><h2 className="mt-1 text-xl font-black">{selected.codice}</h2></div>
                <Badge className={selected.tipo === "pallet" ? "bg-amber-100 text-amber-900" : selected.tipo === "slot" ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-800"}>{selected.tipo}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 py-4">
                <MapInput label="X (m)" value={selected.map_x} onChange={(value) => updateSelected({ map_x: value })} />
                <MapInput label="Z (m)" value={selected.map_z} onChange={(value) => updateSelected({ map_z: value })} />
                <MapInput label="Rotazione" value={selected.map_rotation} onChange={(value) => updateSelected({ map_rotation: value })} step={15} />
                <div><div className="mb-1 text-xs font-bold text-slate-500">Stato</div><div className="flex h-10 items-center font-semibold capitalize">{selected.stato}</div></div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => updateSelected({ map_rotation: (selected.map_rotation + 90) % 360 })}><RotateCcw className="mr-2 h-4 w-4" /> Ruota 90°</Button>
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
            </>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center text-center">
              <MapPinned className="h-8 w-8 text-slate-300" />
              <div className="mt-3 font-bold">Nessuna ubicazione selezionata</div>
              <div className="mt-1 text-sm text-slate-500">Seleziona un pallet o uno slot.</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon: Icon, children }) {
  return <button onClick={onClick} className={`flex h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}><Icon className="h-4 w-4" /> {children}</button>;
}

function Legend({ color, label }) {
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{label}</span>;
}

function MapInput({ label, value, onChange, step = 0.25 }) {
  return <label><span className="mb-1 block text-xs font-bold text-slate-500">{label}</span><input type="number" step={step} value={Number(value).toFixed(2)} onChange={(event) => onChange(Number(event.target.value))} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" /></label>;
}
