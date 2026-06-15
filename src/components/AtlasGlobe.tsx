"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls } from "@react-three/drei";
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
const DISC = 0.085;
const RIM = 0.006;

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
    const dist = Math.max(distV, distH) * 1.3;
    camera.position.set(0, 0.25 * dist, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls?.update();
  }, [size.width, size.height, camera, controls]);
  return null;
}

// --- on-globe pin (just the disc; the popup is a DOM overlay) -----------------
function Pin({
  pin,
  lat,
  lng,
  texture,
  selected,
  reduced,
  onSelect,
}: {
  pin: AtlasPin;
  lat: number;
  lng: number;
  texture?: THREE.Texture;
  selected: boolean;
  reduced: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const discRef = useRef<THREE.Group>(null);

  const surface = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS), [lat, lng]);
  const tip = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS + STALK), [lat, lng]);
  const stalkGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([surface, tip]),
    [surface, tip],
  );
  const rim = RIM_COLOR[pin.rarity];

  // The selected disc shrinks away as the DOM pill takes over (morph into pill);
  // on deselect it grows back to a dot (morph back).
  useEffect(() => {
    const g = discRef.current;
    if (!g) return;
    const target = selected ? 0.001 : 1;
    if (reduced) {
      g.scale.setScalar(selected ? 0.001 : 1);
      return;
    }
    const tw = gsap.to(g.scale, { x: target, y: target, z: target, duration: 0.32, ease: "power3.out" });
    return () => {
      tw.kill();
    };
  }, [selected, reduced]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <group>
      <line>
        <primitive object={stalkGeom} attach="geometry" />
        <lineBasicMaterial color="#b8924a" transparent opacity={0.7} />
      </line>
      <group position={tip}>
        <Billboard>
          <group ref={discRef} scale={hovered ? 1.25 : 1}>
            {rim && (
              <mesh>
                <ringGeometry args={[DISC, DISC + RIM, 40]} />
                <meshBasicMaterial color={rim} toneMapped={false} />
              </mesh>
            )}
            {texture && (
              <mesh
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHovered(true);
                }}
                onPointerOut={() => setHovered(false)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
              >
                <circleGeometry args={[DISC, 40]} />
                <meshBasicMaterial map={texture} toneMapped={false} />
              </mesh>
            )}
          </group>
        </Billboard>
      </group>
    </group>
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

interface Placed {
  pin: AtlasPin;
  lat: number;
  lng: number;
  dir: THREE.Vector3;
}

function buildPlaced(pins: AtlasPin[]): Placed[] {
  const out: Placed[] = [];
  for (const g of buildGroups(pins)) {
    g.members.forEach((pin, i) => {
      const [lat, lng] = spread(g.lat, g.lng, i, g.members.length);
      out.push({ pin, lat, lng, dir: latLngToVec3(lat, lng, 1).normalize() });
    });
  }
  return out;
}

// --- projects the selected pin to screen space, driving the DOM pill ----------
function PillProjector({
  target,
  overlayRef,
}: {
  target: { lat: number; lng: number; slug: string } | null;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const tRef = useRef(target);
  tRef.current = target;
  const lastSlug = useRef<string | null>(null);
  const dir = useRef<"l" | "r">("l");
  useFrame(() => {
    const el = overlayRef.current;
    if (!el) return;
    const t = tRef.current;
    if (!t) {
      el.style.display = "none";
      lastSlug.current = null;
      return;
    }
    const world = latLngToVec3(t.lat, t.lng, GLOBE_RADIUS + STALK);
    const facing = world.clone().normalize().dot(camera.position.clone().normalize()) > 0.12;
    if (!facing) {
      el.style.display = "none";
      return;
    }
    const ndc = world.clone().project(camera);
    const x = (ndc.x * 0.5 + 0.5) * size.width;
    const y = (-ndc.y * 0.5 + 0.5) * size.height;

    // Decide expand direction ONCE per selection (avoids flip-flop while spinning):
    // right-half bugs open left (image on the right), left-half open right.
    if (t.slug !== lastSlug.current) {
      lastSlug.current = t.slug;
      dir.current = x > size.width * 0.52 ? "r" : "l";
      const pill = el.firstElementChild as HTMLElement | null;
      if (pill) {
        pill.style.flexDirection = dir.current === "r" ? "row-reverse" : "row";
        pill.style.paddingLeft = dir.current === "r" ? "0.75rem" : "0.25rem";
        pill.style.paddingRight = dir.current === "r" ? "0.25rem" : "0.75rem";
      }
    }

    el.style.display = "block";
    // Anchor the image's center (~24px in) on the pin; for "r" the right edge is
    // pinned so the pill grows leftward into the viewport.
    el.style.transform =
      dir.current === "r"
        ? `translate(${x + 24}px, ${y}px) translate(-100%, -50%)`
        : `translate(${x - 24}px, ${y}px) translate(0%, -50%)`;
  });
  return null;
}

// --- the DOM pill: image left, name/region right; morphs open -----------------
function BugPill({
  pin,
  reduced,
  onInfo,
}: {
  pin: AtlasPin;
  reduced: boolean;
  onInfo: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const rim = RIM_COLOR[pin.rarity];

  useEffect(() => {
    const el = ref.current;
    const tx = textRef.current;
    if (!el) return;
    if (reduced) {
      el.style.width = "auto";
      return;
    }
    const full = el.scrollWidth;
    const tl = gsap.timeline();
    tl.fromTo(el, { width: 48, scale: 0.55 }, { width: full, scale: 1, duration: 0.42, ease: "back.out(1.5)" }, 0);
    if (tx) tl.fromTo(tx, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.3 }, 0.14);
    tl.set(el, { width: "auto" });
    return () => {
      tl.kill();
    };
  }, [pin.slug, reduced]);

  return (
    <div
      ref={ref}
      className="pointer-events-auto flex items-center gap-2.5 overflow-hidden rounded-full bg-black/85 p-1 pr-3 shadow-xl ring-1 ring-amber-200/25 backdrop-blur-sm"
      style={{ width: 48 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/bugs/${pin.slug}.png`}
        alt={pin.commonName}
        draggable={false}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
        style={rim ? { boxShadow: `0 0 0 2px ${rim}` } : undefined}
      />
      <div ref={textRef} className="leading-tight">
        <div className="whitespace-nowrap font-serif text-[13px] text-amber-100">
          {pin.commonName}
        </div>
        <div className="whitespace-nowrap text-[10px] uppercase tracking-wider text-zinc-400">
          {pin.region}
        </div>
      </div>
      <button
        onClick={onInfo}
        aria-label={`View ${pin.commonName} details`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-amber-100 ring-1 ring-amber-200/40 transition-colors hover:bg-amber-200/15"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>
    </div>
  );
}

function Scene({
  placed,
  textures,
  reduced,
  selected,
  select,
  lastManual,
  globeRef,
}: {
  placed: Placed[];
  textures: Record<string, THREE.Texture> | null;
  reduced: boolean;
  selected: string | null;
  select: (slug: string | null, manual?: boolean) => void;
  lastManual: React.RefObject<number>;
  globeRef: React.RefObject<THREE.Mesh | null>;
}) {
  const camera = useThree((s) => s.camera);
  const sceneRef = useRef<THREE.Group>(null);
  const played = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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

  const ready = land !== null && textures !== null;

  useLayoutEffect(() => {
    const g = sceneRef.current;
    if (g && !played.current) g.scale.setScalar(0);
  }, []);

  useEffect(() => {
    const g = sceneRef.current;
    if (!g || !ready || played.current) return;
    played.current = true;
    if (reduced) {
      g.scale.setScalar(1);
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(g.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: 1.1, ease: "power3.out" }, 0);
    tl.fromTo(g.rotation, { y: -Math.PI * 1.25 }, { y: 0, duration: 1.4, ease: "power3.out" }, 0);
    return () => {
      tl.kill();
    };
  }, [ready, reduced]);

  // Auto-spotlight a random front-facing bug as the globe spins.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      if (Date.now() - lastManual.current < 6000) return;
      const camDir = camera.position.clone().normalize();
      const front = placed.filter(
        (p) => p.dir.dot(camDir) > 0.6 && p.pin.slug !== selectedRef.current,
      );
      const pool = front.length ? front : placed;
      if (!pool.length) return;
      select(pool[Math.floor(Math.random() * pool.length)].pin.slug, false);
    };
    const start = window.setTimeout(tick, 1900);
    const interval = window.setInterval(tick, 3800);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [ready, placed, camera, select, lastManual]);

  return (
    <group ref={sceneRef}>
      <Globe land={land} meshRef={globeRef} />
      {placed.map(({ pin, lat, lng }) => (
        <Pin
          key={pin.slug}
          pin={pin}
          lat={lat}
          lng={lng}
          texture={textures?.[pin.slug]}
          selected={selected === pin.slug}
          reduced={reduced}
          onSelect={() => select(pin.slug, true)}
        />
      ))}
    </group>
  );
}

export default function AtlasGlobe({ pins }: { pins: AtlasPin[] }) {
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  const router = useRouter();
  const slugs = useMemo(() => pins.map((p) => p.slug), [pins]);
  const textures = usePinTextures(slugs);
  const placed = useMemo(() => buildPlaced(pins), [pins]);

  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const lastManual = useRef(0);
  const pauseTimer = useRef<number | undefined>(undefined);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);

  const select = useCallback((slug: string | null, manual = false) => {
    setSelected(slug);
    if (manual) {
      lastManual.current = Date.now();
      setPaused(true);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      pauseTimer.current = window.setTimeout(() => setPaused(false), 6000);
    }
  }, []);

  const selectedPlaced = placed.find((p) => p.pin.slug === selected) ?? null;
  const target = selectedPlaced
    ? { lat: selectedPlaced.lat, lng: selectedPlaced.lng, slug: selectedPlaced.pin.slug }
    : null;

  const openDetail = () => {
    if (!selected) return;
    setBugOrigin("/atlas");
    router.push(`/bug/${selected}`);
  };

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 2, 8], fov: 45 }}
        className="h-full w-full"
        onPointerMissed={() => {
          setSelected(null);
          setPaused(false);
        }}
      >
        <color attach="background" args={["#0e0d0b"]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[5, 3, 5]} intensity={1.1} />

        <FitCamera />
        <Scene
          placed={placed}
          textures={textures}
          reduced={reduced}
          selected={selected}
          select={select}
          lastManual={lastManual}
          globeRef={globeRef}
        />
        <PillProjector target={target} overlayRef={overlayRef} />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          minDistance={2.6}
          maxDistance={16}
          autoRotate={!reduced && !paused}
          autoRotateSpeed={0.85}
        />
      </Canvas>

      <div ref={overlayRef} className="pointer-events-none absolute left-0 top-0 z-20" style={{ display: "none" }}>
        {selectedPlaced && (
          <BugPill key={selectedPlaced.pin.slug} pin={selectedPlaced.pin} reduced={reduced} onInfo={openDetail} />
        )}
      </div>
    </div>
  );
}
