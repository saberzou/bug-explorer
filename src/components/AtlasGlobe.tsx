"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
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
const STALK = 0.22; // pin height above the surface

// Rarity rim colors, echoing the grid's gold/sky language. Common = none.
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

// --- paper + continents texture (drawn to a canvas, no external image) -------
type LandGeo = {
  features: { geometry: { type: string; coordinates: number[][][][] | number[][][] } }[];
};

function makeGlobeTexture(land: LandGeo | null): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // Warm cream paper base (oceans).
  ctx.fillStyle = "#e7dabd";
  ctx.fillRect(0, 0, W, H);

  // Paper grain: faint specks/fibers.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const a = Math.random() * 0.06;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(90,70,40,${a})` : `rgba(255,250,235,${a})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Land polygons in a slightly deeper paper tone with an ink coastline.
  if (land?.features?.length) {
    const project = (lng: number, lat: number): [number, number] => [
      ((lng + 180) / 360) * W,
      ((90 - lat) / 180) * H,
    ];
    const drawRing = (ring: number[][]) => {
      ctx.beginPath();
      ring.forEach(([lng, lat], i) => {
        const [x, y] = project(lng, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };
    ctx.fillStyle = "#cdb98c";
    ctx.strokeStyle = "rgba(80,62,35,0.55)";
    ctx.lineWidth = 1.5;
    for (const f of land.features) {
      const g = f.geometry;
      const polys =
        g.type === "MultiPolygon"
          ? (g.coordinates as number[][][][])
          : [g.coordinates as number[][][]];
      for (const poly of polys) {
        for (const ring of poly) {
          drawRing(ring);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- low-poly paper globe ----------------------------------------------------
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
  const texture = useMemo(() => makeGlobeTexture(land), [land]);

  return (
    <mesh>
      {/* Low segment count + flatShading → faceted, low-poly paper look. */}
      <sphereGeometry args={[GLOBE_RADIUS, 36, 24]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} flatShading />
    </mesh>
  );
}

// --- a single pinned specimen ------------------------------------------------
function Pin({
  pin,
  texture,
  index,
  reduced,
}: {
  pin: AtlasPin;
  texture: THREE.Texture;
  index: number;
  reduced: boolean;
}) {
  const router = useRouter();
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const surface = useMemo(() => latLngToVec3(pin.lat, pin.lng, GLOBE_RADIUS), [pin.lat, pin.lng]);
  const tip = useMemo(
    () => latLngToVec3(pin.lat, pin.lng, GLOBE_RADIUS + STALK),
    [pin.lat, pin.lng],
  );
  const stalkPoints = useMemo(() => [surface, tip], [surface, tip]);
  const rim = RIM[pin.rarity];

  // GSAP entry: pins "plant" into the surface with a staggered pop.
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
      delay: 0.15 + index * 0.012,
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

  const stalkGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(stalkPoints),
    [stalkPoints],
  );

  return (
    <group>
      {/* entomology-pin stalk from the surface to the disc */}
      <line>
        <primitive object={stalkGeom} attach="geometry" />
        <lineBasicMaterial color="#b8924a" transparent opacity={0.75} />
      </line>

      <group ref={groupRef} position={tip}>
        <Billboard>
          {/* rarity rim (slightly larger disc behind the image) */}
          {rim && (
            <mesh position={[0, 0, -0.001]} scale={hovered ? 1.35 : 1}>
              <circleGeometry args={[0.15, 32]} />
              <meshBasicMaterial color={rim} />
            </mesh>
          )}
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
        </Billboard>
      </group>
    </group>
  );
}

function Pins({ pins, reduced }: { pins: AtlasPin[]; reduced: boolean }) {
  const textures = useLoader(
    THREE.TextureLoader,
    pins.map((p) => `/bugs/pins/${p.slug}.png`),
  );
  return (
    <>
      {pins.map((pin, i) => (
        <Pin key={pin.slug} pin={pin} texture={textures[i]} index={i} reduced={reduced} />
      ))}
    </>
  );
}

export default function AtlasGlobe({ pins }: { pins: AtlasPin[] }) {
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.6, 6], fov: 45 }}
      className="!absolute inset-0"
    >
      <color attach="background" args={["#0e0d0b"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 3, 5]} intensity={1.1} />
      <Suspense fallback={null}>
        <Globe />
        <Pins pins={pins} reduced={reduced} />
      </Suspense>
      <OrbitControls
        enablePan={false}
        enableDamping
        minDistance={3.2}
        maxDistance={9}
        autoRotate={!reduced}
        autoRotateSpeed={0.45}
      />
    </Canvas>
  );
}
