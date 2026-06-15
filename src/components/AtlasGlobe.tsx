"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls } from "@react-three/drei";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import * as THREE from "three";
import { prefersReducedMotion, setBugOrigin } from "@/lib/transition";
import type { Rarity } from "@/lib/types";
import type { RangeKind } from "@/lib/geo";

export interface AtlasPin {
  slug: string;
  commonName: string;
  rarity: Rarity;
  lat: number;
  lng: number;
  region: string;
  rangeKind: RangeKind;
}

const GLOBE_RADIUS = 2;
const STALK = 0.13;
const DISC = 0.085; // smaller pins so they read as spaced, and zoom enlarges them
const RIM = 0.006; // hairline rarity rim

const RIM_COLOR: Record<Rarity, string | null> = {
  common: null,
  uncommon: "#fcd34d",
  rare: "#7dd3fc",
  legendary: "#fbbf24",
};

function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = ((lng + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

// --- pin textures (downscaled from /bugs/<slug>.png) -------------------------
function usePinTextures(slugs: string[]): Record<string, THREE.Texture> | null {
  const key = slugs.join(",");
  const [textures, setTextures] = useState<Record<string, THREE.Texture> | null>(null);
  useEffect(() => {
    let alive = true;
    const out: Record<string, THREE.Texture> = {};
    let remaining = slugs.length;
    if (remaining === 0) {
      setTextures({});
      return;
    }
    const done = () => {
      remaining -= 1;
      if (remaining === 0 && alive) setTextures(out);
    };
    for (const slug of slugs) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = 160;
        c.getContext("2d")!.drawImage(img, 0, 0, 160, 160);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        out[slug] = t;
        done();
      };
      img.onerror = done;
      img.src = `/bugs/${slug}.png`;
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return textures;
}

type LandGeo = {
  features: { geometry: { type: string; coordinates: number[][][][] | number[][][] } }[];
};

// --- low-poly faceted globe geometry ----------------------------------------
const GLOBE_DETAIL = 3;

function vecToLatLng(x: number, y: number, z: number): [number, number] {
  const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
  let lng = (Math.atan2(z, -x) * 180) / Math.PI - 180;
  if (lng < -180) lng += 360;
  return [lat, lng];
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isLand(lng: number, lat: number, land: LandGeo): boolean {
  for (const f of land.features) {
    const g = f.geometry;
    const polys =
      g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : [g.coordinates as number[][][]];
    for (const poly of polys) {
      if (poly.length === 0) continue;
      if (pointInRing(lng, lat, poly[0])) {
        let hole = false;
        for (let k = 1; k < poly.length; k++) {
          if (pointInRing(lng, lat, poly[k])) {
            hole = true;
            break;
          }
        }
        if (!hole) return true;
      }
    }
  }
  return false;
}

function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function buildLowPolyGlobe(land: LandGeo | null): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(GLOBE_RADIUS, GLOBE_DETAIL).toNonIndexed();
  const pos = geo.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const ocean: [number, number, number] = [0.905, 0.847, 0.741];
  const landC: [number, number, number] = [0.74, 0.63, 0.43];
  for (let f = 0; f < n; f += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(f + k);
      cy += pos.getY(f + k);
      cz += pos.getZ(f + k);
    }
    const len = Math.hypot(cx, cy, cz) || 1;
    const [lat, lng] = vecToLatLng(cx / len, cy / len, cz / len);
    const base = land && isLand(lng, lat, land) ? landC : ocean;
    const mottle = (rand01(f) * 2 - 1) * 0.05;
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = clamp01(base[0] + mottle);
      colors[(f + k) * 3 + 1] = clamp01(base[1] + mottle);
      colors[(f + k) * 3 + 2] = clamp01(base[2] + mottle);
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function Globe({
  land,
  meshRef,
}: {
  land: LandGeo | null;
  meshRef: React.RefObject<THREE.Mesh | null>;
}) {
  const geometry = useMemo(() => buildLowPolyGlobe(land), [land]);
  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial vertexColors flatShading roughness={1} metalness={0} />
    </mesh>
  );
}

// --- responsive camera: fit the whole globe in any viewport ------------------
function FitCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { update: () => void } | null;
  useEffect(() => {
    const vfov = (camera.fov * Math.PI) / 180;
    const aspect = size.width / size.height;
    const distV = GLOBE_RADIUS / Math.tan(vfov / 2);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const distH = GLOBE_RADIUS / Math.tan(hfov / 2);
    const dist = Math.max(distV, distH) * 1.3; // margin so it never touches edges
    camera.position.set(0, 0.25 * dist, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls?.update();
  }, [size.width, size.height, camera, controls]);
  return null;
}

// --- a single pinned specimen ------------------------------------------------
function Pin({
  pin,
  lat,
  lng,
  texture,
}: {
  pin: AtlasPin;
  lat: number;
  lng: number;
  texture?: THREE.Texture;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  const surface = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS), [lat, lng]);
  const tip = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS + STALK), [lat, lng]);
  const stalkGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([surface, tip]),
    [surface, tip],
  );
  const rim = RIM_COLOR[pin.rarity];

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  const open = () => {
    setBugOrigin("/atlas");
    router.push(`/bug/${pin.slug}`);
  };

  return (
    <group>
      <line>
        <primitive object={stalkGeom} attach="geometry" />
        <lineBasicMaterial color="#b8924a" transparent opacity={0.7} />
      </line>
      <group position={tip}>
        <Billboard>
          {rim && (
            <mesh scale={hovered ? 1.35 : 1}>
              <ringGeometry args={[DISC, DISC + RIM, 40]} />
              <meshBasicMaterial color={rim} toneMapped={false} />
            </mesh>
          )}
          {texture && (
            <mesh
              scale={hovered ? 1.35 : 1}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(true);
              }}
              onPointerOut={() => setHovered(false)}
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
            >
              <circleGeometry args={[DISC, 40]} />
              <meshBasicMaterial map={texture} toneMapped={false} />
            </mesh>
          )}
        </Billboard>
        {hovered && (
          <Html center distanceFactor={6} position={[0, DISC + 0.06, 0]} pointerEvents="none">
            <div className="whitespace-nowrap rounded-full bg-black/80 px-2 py-1 text-[11px] text-amber-100 ring-1 ring-amber-200/30">
              {pin.commonName}
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

// --- crisp HTML region label (occluded by the globe) -------------------------
function RegionLabel({
  text,
  lat,
  lng,
  globeRef,
}: {
  text: string;
  lat: number;
  lng: number;
  globeRef: React.RefObject<THREE.Mesh | null>;
}) {
  const pos = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS + 0.03), [lat, lng]);
  return (
    <Html
      position={pos}
      center
      occlude={[globeRef as React.RefObject<THREE.Object3D>]}
      pointerEvents="none"
      zIndexRange={[20, 0]}
    >
      <div
        className="select-none whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-50/95"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)" }}
      >
        {text}
      </div>
    </Html>
  );
}

// --- region grouping + spreading --------------------------------------------
interface RegionGroup {
  region: string;
  members: AtlasPin[];
  lat: number;
  lng: number;
}

function buildGroups(pins: AtlasPin[]): RegionGroup[] {
  const map = new Map<string, AtlasPin[]>();
  for (const p of pins) {
    const arr = map.get(p.region) ?? [];
    arr.push(p);
    map.set(p.region, arr);
  }
  return [...map.entries()].map(([region, members]) => ({
    region,
    members,
    lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
    lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
  }));
}

/** Sunflower-spread member i of n around a region centroid (degrees). */
function spread(clat: number, clng: number, i: number, n: number): [number, number] {
  if (n <= 1) return [clat, clng];
  const golden = 2.399963229728653;
  const step = 8.5;
  const r = step * Math.sqrt(i + 0.5);
  const a = i * golden;
  const dLat = r * Math.sin(a);
  const dLng = (r * Math.cos(a)) / Math.max(0.35, Math.cos((clat * Math.PI) / 180));
  return [Math.max(-85, Math.min(85, clat + dLat)), clng + dLng];
}

function Scene({ pins, reduced }: { pins: AtlasPin[]; reduced: boolean }) {
  const slugs = useMemo(() => pins.map((p) => p.slug), [pins]);
  const textures = usePinTextures(slugs);
  const groups = useMemo(() => buildGroups(pins), [pins]);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const sceneRef = useRef<THREE.Group>(null);
  const played = useRef(false);

  const [land, setLand] = useState<LandGeo | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/atlas/land.geo.json")
      .then((r) => r.json())
      .then((d) => alive && setLand(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Both the continents AND the pin images must be loaded before we reveal —
  // otherwise the user briefly sees a blank globe with empty pin rings.
  const ready = land !== null && textures !== null;

  // Hide the scene (a dot) before first paint so nothing un-textured flashes.
  useLayoutEffect(() => {
    const g = sceneRef.current;
    if (g && !played.current) g.scale.setScalar(0);
  }, []);

  // Once ready, grow + spin into view from the dot.
  useEffect(() => {
    const g = sceneRef.current;
    if (!g || !ready || played.current) return;
    played.current = true;
    if (reduced) {
      g.scale.setScalar(1);
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(
      g.scale,
      { x: 0.001, y: 0.001, z: 0.001 },
      { x: 1, y: 1, z: 1, duration: 1.1, ease: "power3.out" },
      0,
    );
    tl.fromTo(g.rotation, { y: -Math.PI * 1.25 }, { y: 0, duration: 1.4, ease: "power3.out" }, 0);
    return () => {
      tl.kill();
    };
  }, [ready, reduced]);

  return (
    <group ref={sceneRef}>
      <Globe land={land} meshRef={globeRef} />
      {groups.map((g) => {
        const labelLat = Math.min(88, g.lat + 8.5 * Math.sqrt(g.members.length) + 7);
        return (
          <group key={g.region}>
            <RegionLabel text={g.region} lat={labelLat} lng={g.lng} globeRef={globeRef} />
            {g.members.map((pin, i) => {
              const [lat, lng] = spread(g.lat, g.lng, i, g.members.length);
              return <Pin key={pin.slug} pin={pin} lat={lat} lng={lng} texture={textures?.[pin.slug]} />;
            })}
          </group>
        );
      })}
    </group>
  );
}

export default function AtlasGlobe({ pins }: { pins: AtlasPin[] }) {
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 2, 8], fov: 45 }} className="!absolute inset-0">
      <color attach="background" args={["#0e0d0b"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 3, 5]} intensity={1.1} />

      <FitCamera />
      <Scene pins={pins} reduced={reduced} />

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={2.6}
        maxDistance={16}
        autoRotate={!reduced}
        autoRotateSpeed={0.4}
      />
    </Canvas>
  );
}
