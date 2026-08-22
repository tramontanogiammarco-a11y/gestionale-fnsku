import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AlertTriangle, Box, Boxes, Eye, Grid3X3, Loader2, MapPinned, Move3D,
  PackageCheck, PackageOpen, RotateCcw, Route, Save, ScanLine, Sparkles, Trash2, Truck, Undo2, Warehouse, Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { calculateWarehouseRoute, normalizeAisles } from "@/lib/wmsRouting";

const DEFAULT_MAP = { width: 34, depth: 24, entrance_x: 0, entrance_z: 10.5, aisles: [] };
const OPERATIONAL_TYPES = new Set(["pallet", "slot"]);
const HIDDEN_MAP_CODES = new Set(["QUARANTENA-01"]);

function locationLabel(location) {
  if (location.tipo === "outbound" || location.codice === "OUTBOUND-01") return "OUTBOUND";
  if (location.tipo === "packing" || location.codice === "PACK-01") return "PACKING STATION";
  if (location.codice === "INBOUND-01") return "INBOUND";
  return location.codice;
}

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
  if (location.codice === "OUTBOUND-01") return { ...location, map_x: 4, map_z: 10.8, map_rotation: 0 };
  if (location.codice === "PACK-01") return { ...location, map_x: 0, map_z: -10.8, map_rotation: 0 };
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
  const visibleRows = rows.filter((row) => !HIDDEN_MAP_CODES.has(row.codice));
  const smartRows = smartLocations(visibleRows);
  return visibleRows.map((row, index) => {
    const fallback = smartRows[index];
    return {
      ...fallback,
      map_x: Number(row.map_x ?? fallback.map_x ?? 0),
      map_z: Number(row.map_z ?? fallback.map_z ?? 0),
      map_rotation: Number(row.map_rotation || 0),
      map_width: Number(row.map_width || (row.tipo === "pallet" ? 1.6 : row.tipo === "slot" ? 0.92 : row.tipo === "packing" ? 4.5 : 3)),
      map_depth: Number(row.map_depth || (row.tipo === "pallet" ? 0.72 : row.tipo === "slot" ? 0.62 : row.tipo === "packing" ? 2.4 : 1.6)),
      access_side: row.access_side || "front",
    };
  });
}

function normalizeMap(value = {}) {
  return { ...DEFAULT_MAP, ...value, aisles: normalizeAisles(value.aisles) };
}

function mapSnapshot(locations, map) {
  return JSON.stringify({
    locations: locations.map(({ id, map_x, map_z, map_rotation, access_side }) => [id, map_x, map_z, map_rotation, access_side]),
    map: [map.width, map.depth, map.entrance_x, map.entrance_z, map.aisles],
  });
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

function locationsOverlap(left, right, padding = 0.08) {
  const delta = { x: right.map_x - left.map_x, z: right.map_z - left.map_z };
  const axes = [...locationAxes(left), ...locationAxes(right)];
  return axes.every((axis) => {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    return distance < projectedRadius(left, axis) + projectedRadius(right, axis) + padding;
  });
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
  locations, onMoveCommit, onDragStateChange, onAislePoint, selectedId, setSelectedId, mode, snap, map, routeData, collisions, draftAislePoints,
}, ref) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);
  const locationsRef = useRef(locations);
  const propsRef = useRef({ onMoveCommit, onDragStateChange, onAislePoint, setSelectedId, mode, snap, map });

  locationsRef.current = locations;
  propsRef.current = { onMoveCommit, onDragStateChange, onAislePoint, setSelectedId, mode, snap, map };

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
      const label = createTextSprite(locationLabel(location), { scale: location.tipo === "slot" ? 0.76 : location.tipo === "packing" ? 1.12 : 0.86 });
      label.position.set(0, height / 2 + 0.48, 0);
      mesh.add(label);
      const accessMarker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24),
        new THREE.MeshStandardMaterial({ color: "#0891b2", emissive: "#164e63", emissiveIntensity: 0.2 })
      );
      accessMarker.position.y = -height / 2 + 0.08;
      mesh.add(accessMarker);
      meshes.set(location.id, { mesh, hitMesh, label, material, height, accessMarker });
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
      propsRef.current.onDragStateChange?.({ active: false, invalid: false, count: 0 });
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
        const step = propsRef.current.snap ? 0.5 : 0.01;
        const halfWidth = propsRef.current.map.width / 2;
        const halfDepth = propsRef.current.map.depth / 2;
        propsRef.current.onAislePoint?.({
          x: Math.max(-halfWidth, Math.min(halfWidth, Math.round(planeHit.x / step) * step)),
          z: Math.max(-halfDepth, Math.min(halfDepth, Math.round(planeHit.z / step) * step)),
        });
        return;
      }
      const hit = raycaster.intersectObjects(clickMeshes, false)[0];
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
      propsRef.current.onDragStateChange?.({ active: true, invalid: false, count: drag.ids.length });
    };

    const onPointerMove = (event) => {
      if (!drag.active) {
        if (propsRef.current.mode === "draw-aisle") {
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
      const step = propsRef.current.snap ? 0.5 : 0.01;
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
      const previewLocations = locationsRef.current.map((location) => {
        const origin = drag.origins.get(location.id);
        return origin ? { ...location, map_x: origin.x + dx, map_z: origin.z + dz } : location;
      });
      const previewCollisions = collisionIds(previewLocations);
      const invalidIds = new Set(drag.ids.filter((id) => previewCollisions.has(id)));
      const previewById = new Map(previewLocations.map((location) => [location.id, location]));
      drag.ids.forEach((id) => {
        const item = meshes.get(id);
        const location = previewById.get(id);
        if (!item || !location) return;
        item.mesh.position.x = location.map_x;
        item.mesh.position.z = location.map_z;
        item.material.color.set(invalidIds.size ? "#e11d48" : "#0891b2");
        item.material.emissive.set(invalidIds.size ? "#4c0519" : "#164e63");
        item.material.emissiveIntensity = 0.28;
      });
      drag.previewLocations = previewLocations;
      drag.invalidIds = invalidIds;
      propsRef.current.onDragStateChange?.({ active: true, invalid: invalidIds.size > 0, count: drag.ids.length });
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
      const side = location.access_side || "front";
      const accessOffset = side === "left" || side === "right" ? location.map_width / 2 + 0.65 : location.map_depth / 2 + 0.65;
      item.accessMarker.position.x = side === "left" ? -accessOffset : side === "right" ? accessOffset : 0;
      item.accessMarker.position.z = side === "back" ? -accessOffset : side === "front" ? accessOffset : 0;
      const selected = location.id === selectedId;
      const colliding = collisions.has(location.id);
      const color = colliding ? "#dc2626"
        : selected ? "#0284c7"
          : location.stato === "bloccata" ? "#e11d48"
            : location.tipo === "pallet" ? (location.occupata ? "#d97706" : "#f0b86e")
              : location.tipo === "slot" ? (location.occupata ? "#0f766e" : "#76c7bc")
                : location.tipo === "outbound" ? "#22c55e"
                  : location.tipo === "packing" ? "#38bdf8"
                    : location.tipo === "quarantena" ? "#a855f7" : "#64748b";
      item.material.color.set(color);
      item.material.emissive.set(selected ? "#0c4a6e" : colliding ? "#450a0a" : "#000000");
      item.material.emissiveIntensity = selected || colliding ? 0.22 : 0;
      item.accessMarker.visible = selected;
      const ordinal = locationNumber(location.codice);
      item.label.visible = selected || location.occupata || ordinal % 10 === 0 || !OPERATIONAL_TYPES.has(location.tipo);
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
  }, [collisions, draftAislePoints, locations, map.aisles, map.entrance_x, map.entrance_z, routeData.pathPoints, selectedId]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.controls.enabled = mode === "explore";
    state.renderer.domElement.style.cursor = mode.startsWith("move") ? "grab" : mode === "draw-aisle" ? "crosshair" : "default";
  }, [mode]);

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
  const [draftAislePoints, setDraftAislePoints] = useState([]);
  const [selectedAisleId, setSelectedAisleId] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [dragState, setDragState] = useState({ active: false, invalid: false, count: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/wms/mappa");
      const nextLocations = normalizeLocations(response.data.locations || []);
      const nextMap = normalizeMap(response.data.map || {});
      setLocations(nextLocations);
      setMap(nextMap);
      setInitialSnapshot(mapSnapshot(nextLocations, nextMap));
      setMoveHistory([]);
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Mappa non disponibile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => locations.find((location) => location.id === selectedId) || null, [locations, selectedId]);
  const collisions = useMemo(() => collisionIds(locations), [locations]);
  const routeData = useMemo(() => showRoute
    ? calculateWarehouseRoute(locations.filter((location) => location.occupata && OPERATIONAL_TYPES.has(location.tipo)), { ...map, obstacles: locations })
    : { locations: [], distance: 0, pathPoints: [], mode: "direct" }, [locations, map, showRoute]);
  const dirty = useMemo(() => Boolean(initialSnapshot) && mapSnapshot(locations, map) !== initialSnapshot, [initialSnapshot, locations, map]);
  const stats = useMemo(() => ({
    pallets: locations.filter((row) => row.tipo === "pallet").length,
    slots: locations.filter((row) => row.tipo === "slot").length,
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
    setDragState({ active: false, invalid: false, count: 0 });
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

  const save = async () => {
    if (collisions.size) {
      toast.error("Risolvi le sovrapposizioni prima di salvare");
      return;
    }
    setSaving(true);
    try {
      const response = await api.put("/wms/mappa", {
        locations: locations.map(({ id, map_x, map_z, map_rotation, access_side }) => ({ id, map_x, map_z, map_rotation, access_side })),
        map: { width: map.width, depth: map.depth, entrance_x: map.entrance_x, entrance_z: map.entrance_z, aisles: map.aisles },
      });
      const nextLocations = normalizeLocations(response.data.locations || []);
      const nextMap = normalizeMap(response.data.map || {});
      setLocations(nextLocations);
      setMap(nextMap);
      setInitialSnapshot(mapSnapshot(nextLocations, nextMap));
      setMoveHistory([]);
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
            <Badge variant="outline"><Truck className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Outbound</Badge>
            <Badge variant="outline"><PackageCheck className="mr-1 h-3.5 w-3.5 text-sky-600" /> Packing station</Badge>
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

      {routeData.unreachable?.length > 0 && (
        <div className="flex items-center gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4" /> Passaggio bloccato verso: {routeData.unreachable.map((location) => location.codice).join(", ")}. Lascia almeno una casella libera.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 bg-white px-3 py-3">
        <div className="flex gap-1 rounded-md bg-slate-100 p-1" aria-label="Modalita mappa">
          <ModeButton active={mode === "explore"} onClick={() => setMode("explore")} icon={Eye}>Esplora</ModeButton>
          <ModeButton active={mode === "move-location"} onClick={() => activateMoveMode("move-location")} icon={Move3D}>Sposta ubicazione</ModeButton>
          <ModeButton active={mode === "move-zone"} onClick={() => activateMoveMode("move-zone")} icon={Boxes}>Sposta zona</ModeButton>
          <ModeButton active={mode === "draw-aisle"} onClick={activateAisleMode} icon={Waypoints}>Disegna corridoio</ModeButton>
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
          <label className="flex items-center gap-2"><Switch checked={snap} onCheckedChange={setSnap} /><Grid3X3 className="h-4 w-4" /> Caselle 50 cm</label>
          <label className="flex items-center gap-2"><Switch checked={showRoute} onCheckedChange={setShowRoute} /><Route className="h-4 w-4" /> Percorso</label>
          <div className="text-slate-500">{routeData.locations.length} tappe · {routeData.distance.toFixed(1)} m · {routeData.mode === "grid" ? "su caselle libere" : routeData.mode === "aisles" ? "su corridoi" : "diretto"}</div>
        </div>
      </div>

      <div className="relative -mx-4 h-[calc(100dvh-250px)] min-h-[460px] overflow-hidden bg-[#eef3f3] sm:-mx-6 lg:-mx-8" data-testid="warehouse-map-viewport">
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
          map={map}
          routeData={routeData}
          collisions={collisions}
          draftAislePoints={draftAislePoints}
        />

        {mode.startsWith("move") && (
          <div className={`pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 border px-4 py-2 text-sm font-bold shadow-sm backdrop-blur ${
            dragState.invalid
              ? "border-rose-300 bg-rose-50/95 text-rose-800"
              : dragState.active
                ? "border-cyan-300 bg-cyan-50/95 text-cyan-900"
                : "border-slate-200 bg-white/95 text-slate-700"
          }`}>
            {dragState.invalid
              ? "Posizione occupata: scegli un'area libera"
              : dragState.active
                ? `Spostamento di ${dragState.count} ${dragState.count === 1 ? "ubicazione" : "ubicazioni"}`
                : mode === "move-zone"
                  ? "Trascina un pallet o uno slot per spostare tutta la zona"
                  : "Trascina l'ubicazione nella nuova posizione"}
          </div>
        )}

        {mode === "draw-aisle" && (
          <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 border border-cyan-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur">
            <span>{draftAislePoints.length ? `${draftAislePoints.length} punti: tocca il pavimento per continuare` : "Tocca il pavimento per iniziare il corridoio"}</span>
            <Button size="sm" onClick={finishAisle} disabled={draftAislePoints.length < 2}>Termina</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraftAislePoints([]); setMode("explore"); }}>Annulla</Button>
          </div>
        )}

        <div className="absolute left-4 top-4 flex gap-1 border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
          <Button size="sm" variant="ghost" onClick={() => sceneRef.current?.topView()}><Grid3X3 className="mr-2 h-4 w-4" /> Alto</Button>
          <Button size="sm" variant="ghost" onClick={() => sceneRef.current?.perspectiveView()}><Box className="mr-2 h-4 w-4" /> 3D</Button>
          <Button size="icon" variant="ghost" title="Inquadra mappa" aria-label="Inquadra mappa" onClick={() => sceneRef.current?.fitView()}><ScanLine className="h-4 w-4" /></Button>
        </div>

        <div className="absolute bottom-4 left-4 flex flex-wrap gap-3 border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur">
          <Legend color="#f0b86e" label="Pallet" /><Legend color="#76c7bc" label="Slot" /><Legend color="#38bdf8" label="Packing station" /><Legend color="#22c55e" label="Outbound" /><Legend color="#22d3ee" label="Percorso" /><Legend color="#d97706" label="Occupata" /><Legend color="#e11d48" label="Bloccata" />
        </div>

        <aside className={`absolute right-4 overflow-y-auto border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur max-md:hidden ${selected ? "bottom-4 top-4 w-[320px]" : "top-4 w-[280px]"}`}>
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
            <div>
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div><div className="text-xs font-bold uppercase text-slate-500">Viabilità</div><h2 className="mt-1 text-lg font-black">Corridoi</h2></div>
                <Badge variant="outline">{map.aisles.length}</Badge>
              </div>
              {!map.aisles.length ? (
                <div className="flex min-h-36 flex-col items-center justify-center text-center">
                  <Waypoints className="h-8 w-8 text-slate-300" />
                  <div className="mt-3 font-bold">Nessun corridoio</div>
                  <div className="mt-1 text-sm text-slate-500">Usa “Disegna corridoio” e indica i passaggi percorribili.</div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {map.aisles.map((aisle) => (
                    <div key={aisle.id} className={`border p-2 ${selectedAisleId === aisle.id ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" className="min-w-0 flex-1 text-left text-sm font-bold" onClick={() => setSelectedAisleId((current) => current === aisle.id ? null : aisle.id)}>{aisle.name}</button>
                        <button type="button" title="Elimina corridoio" aria-label={`Elimina ${aisle.name}`} className="flex h-8 w-8 items-center justify-center text-rose-600 hover:bg-rose-50" onClick={() => removeAisle(aisle.id)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                      {selectedAisleId === aisle.id && (
                        <div className="mt-2 space-y-2 border-t border-cyan-200 pt-2">
                          {aisle.points.map((aislePoint, index) => (
                            <div key={`${aisle.id}-${index}`} className="grid grid-cols-[32px_1fr_1fr] items-end gap-2">
                              <span className="pb-2 text-xs font-bold text-slate-500">{index + 1}</span>
                              <MapInput label="X" value={aislePoint.x} onChange={(value) => updateAislePoint(aisle.id, index, { x: value })} />
                              <MapInput label="Z" value={aislePoint.z} onChange={(value) => updateAislePoint(aisle.id, index, { z: value })} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" className="mt-3 w-full" onClick={activateAisleMode}><Waypoints className="mr-2 h-4 w-4" /> Nuovo corridoio</Button>
              {routeData.mode !== "aisles" && <div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">Finché non disegni i corridoi, la rotta resta una stima diretta.</div>}
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
