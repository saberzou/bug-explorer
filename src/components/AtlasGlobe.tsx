"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls } from "@react-three/drei";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import * as THREE from "three";
import { prefersReducedMotion } from "@/lib/transition";
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
const STALK = 0.22;
const CLUSTER_MIN = 4; // a region with at least this many bugs collapses to a badge

const RIM: Record<Rarity, string | null> = {
  common: null,
  uncommon: "#fcd34d",
  rare: "#7dd3fc",
  legendary: "#fbbf24",
};

/** lat/lng (deg) → point on a sphere, matching three's SphereGeometry UVs. */
function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = ((lng + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

// --- textures ----------------------------------------------------------------
/**
 * Load each bug's full-size thumbnail and downscale it to a 128px canvas
 * texture on the client. Uses /bugs/<slug>.png directly (which every specimen
 * has), so a newly added bug needs no pre-generated pin asset — it just works.
 */
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
        c.width = 128;
        c.height = 128;
        c.getContext("2d")!.drawImage(img, 0, 0, 128, 128);
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
const GLOBE_DETAIL = 3; // icosphere subdivision: low enough to read as faceted

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

/** Deterministic [0,1) PRNG so the paper mottle is stable across renders. */
function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Build a low-poly icosphere with flat per-face colors: ocean = warm cream,
 * land = deeper tan (classified by testing each face centroid against the land
 * polygons). A small per-face brightness jitter gives a paper-grain mottle that
 * suits the faceted style. flatShading makes each triangle read as a facet.
 */
function buildLowPolyGlobe(land: LandGeo | null): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(GLOBE_RADIUS, GLOBE_DETAIL).toNonIndexed();
  const pos = geo.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const ocean: [number, number, number] = [0.905, 0.847, 0.741]; // ~#e7d8bd
  const landC: [number, number, number] = [0.74, 0.63, 0.43]; // ~#bda06e
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
    const mottle = (rand01(f) * 2 - 1) * 0.05; // ±5% paper grain
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = clamp01(base[0] + mottle);
      colors[(f + k) * 3 + 1] = clamp01(base[1] + mottle);
      colors[(f + k) * 3 + 2] = clamp01(base[2] + mottle);
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function makeCountTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1712";
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#fbbf24";
  ctx.stroke();
  ctx.fillStyle = "#f5e6c0";
  ctx.font = "bold 54px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- globe -------------------------------------------------------------------
function Globe() {
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
  const geometry = useMemo(() => buildLowPolyGlobe(land), [land]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors flatShading roughness={1} metalness={0} />
    </mesh>
  );
}

// --- camera fly-to -----------------------------------------------------------
function CameraController({ target, reduced }: { target: THREE.Vector3 | null; reduced: boolean }) {
  const camera = useThree((s) => s.camera);
  // drei OrbitControls (makeDefault) registers itself here.
  const controls = useThree((s) => s.controls) as { enabled: boolean; update: () => void } | null;
  useEffect(() => {
    if (!target) return;
    const dist = Math.min(Math.max(camera.position.length() || 6, 3.6), 5.5);
    const dir = target.clone().normalize().multiplyScalar(dist);
    if (reduced) {
      camera.position.copy(dir);
      camera.lookAt(0, 0, 0);
      controls?.update();
      return;
    }
    if (controls) controls.enabled = false;
    const tw = gsap.to(camera.position, {
      x: dir.x,
      y: dir.y,
      z: dir.z,
      duration: 1.0,
      ease: "power3.inOut",
      onUpdate: () => camera.lookAt(0, 0, 0),
      onComplete: () => {
        if (controls) {
          controls.enabled = true;
          controls.update();
        }
      },
    });
    return () => {
      tw.kill();
    };
  }, [target, reduced, camera, controls]);
  return null;
}

// --- single pinned specimen --------------------------------------------------
function Pin({
  pin,
  texture,
  index,
  reduced,
}: {
  pin: AtlasPin;
  texture?: THREE.Texture;
  index: number;
  reduced: boolean;
}) {
  const router = useRouter();
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const surface = useMemo(() => latLngToVec3(pin.lat, pin.lng, GLOBE_RADIUS), [pin.lat, pin.lng]);
  const tip = useMemo(() => latLngToVec3(pin.lat, pin.lng, GLOBE_RADIUS + STALK), [pin.lat, pin.lng]);
  const stalkGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([surface, tip]),
    [surface, tip],
  );
  const rim = RIM[pin.rarity];

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (reduced) {
      g.scale.setScalar(1);
      return;
    }
    g.scale.setScalar(0);
    const tw = gsap.to(g.scale, {
      x: 1,
      y: 1,
      z: 1,
      duration: 0.5,
      ease: "back.out(1.7)",
      delay: 0.1 + index * 0.01,
    });
    return () => {
      tw.kill();
    };
  }, [index, reduced]);

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
        <lineBasicMaterial color="#b8924a" transparent opacity={0.75} />
      </line>
      <group ref={groupRef} position={tip}>
        <Billboard>
          {rim && (
            <mesh position={[0, 0, -0.001]} scale={hovered ? 1.35 : 1}>
              <circleGeometry args={[0.15, 32]} />
              <meshBasicMaterial color={rim} />
            </mesh>
          )}
          {texture && (
            <mesh
              scale={hovered ? 1.3 : 1}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(true);
              }}
              onPointerOut={() => setHovered(false)}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/bug/${pin.slug}`);
              }}
            >
              <circleGeometry args={[0.13, 32]} />
              <meshBasicMaterial map={texture} toneMapped={false} />
            </mesh>
          )}
        </Billboard>
      </group>
    </group>
  );
}

// --- collapsed region badge --------------------------------------------------
function ClusterBadge({
  group,
  onClick,
  index,
  reduced,
}: {
  group: RegionGroup;
  onClick: () => void;
  index: number;
  reduced: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const tip = useMemo(
    () => latLngToVec3(group.lat, group.lng, GLOBE_RADIUS + STALK),
    [group.lat, group.lng],
  );
  const tex = useMemo(() => makeCountTexture(group.members.length), [group.members.length]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (reduced) {
      g.scale.setScalar(1);
      return;
    }
    g.scale.setScalar(0);
    const tw = gsap.to(g.scale, {
      x: 1,
      y: 1,
      z: 1,
      duration: 0.5,
      ease: "back.out(1.7)",
      delay: 0.1 + index * 0.03,
    });
    return () => {
      tw.kill();
    };
  }, [index, reduced]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <group ref={groupRef} position={tip}>
      <Billboard>
        <mesh
          scale={hovered ? 1.18 : 1}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <circleGeometry args={[0.22, 40]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

// --- region grouping ---------------------------------------------------------
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

// --- scene -------------------------------------------------------------------
export default function AtlasGlobe({ pins }: { pins: AtlasPin[] }) {
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  const slugs = useMemo(() => pins.map((p) => p.slug), [pins]);
  const textures = usePinTextures(slugs);
  const groups = useMemo(() => buildGroups(pins), [pins]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const flyTarget = useMemo(() => {
    if (!expanded) return null;
    const g = groups.find((x) => x.region === expanded);
    return g ? latLngToVec3(g.lat, g.lng, GLOBE_RADIUS) : null;
  }, [expanded, groups]);

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.6, 6], fov: 45 }}
      className="!absolute inset-0"
      onPointerMissed={() => setExpanded(null)}
    >
      <color attach="background" args={["#0e0d0b"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 3, 5]} intensity={1.1} />

      <Globe />
      <CameraController target={flyTarget} reduced={reduced} />

      {groups.map((g, gi) => {
        const collapse = g.members.length >= CLUSTER_MIN && expanded !== g.region;
        if (collapse) {
          return (
            <ClusterBadge
              key={g.region}
              group={g}
              index={gi}
              reduced={reduced}
              onClick={() => setExpanded(g.region)}
            />
          );
        }
        return g.members.map((pin, i) => (
          <Pin key={pin.slug} pin={pin} texture={textures?.[pin.slug]} index={i} reduced={reduced} />
        ));
      })}

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={3.2}
        maxDistance={9}
        autoRotate={!expanded && !reduced}
        autoRotateSpeed={0.45}
      />
    </Canvas>
  );
}
