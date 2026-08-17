import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { CHART_PALETTE } from '../../lib/apexTheme';
import { useUIStore } from '../../store/uiStore';

// Kept compact so long department names still fit inside the card on desktop,
// where this chart only gets ~1/3 of the dashboard row's width.
const RADIUS = 2.1;
const INNER_RADIUS = 1.0;
const DEPTH = 0.55;
const HOVER_LIFT = -DEPTH / 2;

/** Local (x, y, z=depth/2) becomes world (x, -depth/2, y) once the slice mesh
 *  is rotated 90° on X — used to place leader lines/labels in the same plane. */
function rimPoint(angle, r) {
  return [Math.cos(angle) * r, HOVER_LIFT, Math.sin(angle) * r];
}

/** A single extruded 3D donut segment that eases outward + glows on hover. */
function PieSlice3D({ startAngle, endAngle, color, index, isHovered, onHoverStart, onHoverEnd }) {
  const meshRef = useRef();
  const materialRef = useRef();
  const midAngle = (startAngle + endAngle) / 2;
  const dirX = Math.cos(midAngle);
  const dirZ = Math.sin(midAngle);
  const targetOffset = useRef(0);
  const currentOffset = useRef(0);

  useEffect(() => {
    targetOffset.current = isHovered ? 0.35 : 0;
  }, [isHovered]);

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const segments = 32;
    const angleStep = (endAngle - startAngle) / segments;

    shape.moveTo(Math.cos(startAngle) * INNER_RADIUS, Math.sin(startAngle) * INNER_RADIUS);
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + angleStep * i;
      shape.lineTo(Math.cos(angle) * RADIUS, Math.sin(angle) * RADIUS);
    }
    for (let i = segments; i >= 0; i--) {
      const angle = startAngle + angleStep * i;
      shape.lineTo(Math.cos(angle) * INNER_RADIUS, Math.sin(angle) * INNER_RADIUS);
    }
    shape.closePath();

    return new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.02,
      bevelSegments: 4,
    });
  }, [startAngle, endAngle]);

  const prevGeo = useRef();
  if (prevGeo.current && prevGeo.current !== geometry) prevGeo.current.dispose();
  prevGeo.current = geometry;

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const lerp = Math.min(1, delta * 8);
    currentOffset.current += (targetOffset.current - currentOffset.current) * lerp;
    meshRef.current.position.x = dirX * currentOffset.current;
    meshRef.current.position.z = dirZ * currentOffset.current;
    meshRef.current.position.y = HOVER_LIFT + Math.sin(state.clock.elapsedTime * 0.8 + index) * 0.02;
    if (materialRef.current) {
      const targetEmissive = isHovered ? 0.45 : 0;
      materialRef.current.emissiveIntensity += (targetEmissive - materialRef.current.emissiveIntensity) * lerp;
    }
  });

  return (
    <>
      {/* Invisible hit-sensor fixed at the slice's resting spot to avoid hover flicker. */}
      <mesh
        geometry={geometry}
        position={[0, HOVER_LIFT, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHoverStart(); }}
        onPointerOut={(e) => { e.stopPropagation(); onHoverEnd(); }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} geometry={geometry} rotation={[Math.PI / 2, 0, 0]} castShadow raycast={() => null}>
        <meshStandardMaterial
          ref={materialRef}
          color={color}
          emissive={color}
          emissiveIntensity={0}
          metalness={0.15}
          roughness={0.25}
          transparent
          opacity={0.95}
        />
      </mesh>
    </>
  );
}

/**
 * True 3D donut of department distribution: rim labels + hover explode tooltip.
 * Accepts `[{ name, value }]`.
 */
function DepartmentPie3D({ data = [] }) {
  const isDark = useUIStore((s) => s.isDark);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const slices = useMemo(() => {
    let currentAngle = -Math.PI / 2;
    return data.map((d, i) => {
      const sliceAngle = (d.value / total) * Math.PI * 2;
      const start = currentAngle;
      currentAngle += sliceAngle;
      return { ...d, start, end: currentAngle, color: CHART_PALETTE[i % CHART_PALETTE.length] };
    });
  }, [data, total]);

  const hovered = hoveredIndex != null ? slices[hoveredIndex] : null;
  const labelColor = isDark ? '#E5E7EB' : '#374151';
  const outlineColor = isDark ? '#13122A' : '#FFFFFF';
  const labelLayouts = useMemo(() => {
    if (!slices.length) return [];
    const MIN_SHARE = 0.04; // hide tiny slices that make labels unreadable
    const MAX_LABELS = 6;
    const selected = slices
      .map((slice, i) => ({ ...slice, i, mid: (slice.start + slice.end) / 2, share: slice.value / total }))
      .filter((s) => s.share >= MIN_SHARE)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_LABELS);

    const left = selected
      .filter((s) => Math.cos(s.mid) < 0)
      .sort((a, b) => Math.sin(b.mid) - Math.sin(a.mid));
    const right = selected
      .filter((s) => Math.cos(s.mid) >= 0)
      .sort((a, b) => Math.sin(b.mid) - Math.sin(a.mid));

    const place = (arr, side) => {
      const count = arr.length || 1;
      return arr.map((s, idx) => {
        const slot = count === 1 ? 0 : 1 - (idx * 2) / (count - 1); // 1..-1
        const z = slot * 1.55;
        const x = side === 'right' ? RADIUS + 1.25 : -(RADIUS + 1.25);
        const rim = rimPoint(s.mid, RADIUS + 0.06);
        const elbow = [side === 'right' ? rim[0] + 0.3 : rim[0] - 0.3, rim[1], z];
        return {
          index: s.i,
          name: s.name,
          color: s.color,
          side,
          rim,
          elbow,
          text: [x, rim[1], z],
        };
      });
    };

    return [...place(left, 'left'), ...place(right, 'right')];
  }, [slices, total]);

  return (
    <div
      className="w-full h-[300px] md:h-[340px] rounded-2xl overflow-hidden"
      style={{
        background: isDark
          ? 'linear-gradient(135deg, #241f47 0%, #16142b 100%)'
          : 'linear-gradient(135deg, #E4E1FF 0%, #C9C3FF 100%)',
      }}
    >
      <Canvas camera={{ position: [0, 6.2, 7.2], fov: 36 }} shadows gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
        <ambientLight intensity={isDark ? 0.55 : 0.75} />
        <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
        <pointLight position={[-4, 4, 4]} intensity={0.5} color="#6C63FF" />

        {slices.map((slice, i) => (
          <PieSlice3D
            key={slice.name}
            startAngle={slice.start}
            endAngle={slice.end}
            color={slice.color}
            index={i}
            isHovered={hoveredIndex === i}
            onHoverStart={() => setHoveredIndex(i)}
            onHoverEnd={() => setHoveredIndex((h) => (h === i ? null : h))}
          />
        ))}

        {labelLayouts.map((label) => {
          const isRight = label.side === 'right';
          const dim = hoveredIndex !== null && hoveredIndex !== label.index;
          return (
            <group key={label.name + '-label'}>
              <Line
                points={[label.rim, label.elbow, label.text]}
                color={label.color}
                lineWidth={1.4}
                transparent
                opacity={dim ? 0.25 : 0.95}
              />
              <Text
                position={[label.text[0] + (isRight ? 0.08 : -0.08), label.text[1], label.text[2]]}
                fontSize={0.16}
                maxWidth={1.8}
                color={labelColor}
                anchorX={isRight ? 'left' : 'right'}
                anchorY="middle"
                outlineWidth={0.008}
                outlineColor={outlineColor}
                fillOpacity={dim ? 0.35 : 1}
              >
                {label.name}
              </Text>
            </group>
          );
        })}

        {hovered && (
          <Html position={rimPoint((hovered.start + hovered.end) / 2, RADIUS * 0.55)} center zIndexRange={[100, 0]}>
            <div className="pointer-events-none rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-card-hover whitespace-nowrap animate-scale-in">
              <p className="font-semibold text-fg">{hovered.name}</p>
              <p className="text-fg-muted">
                {hovered.value} employees · {Math.round((hovered.value / total) * 100)}%
              </p>
            </div>
          </Html>
        )}

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI / 2.4}
        />
      </Canvas>
    </div>
  );
}

export default memo(DepartmentPie3D);
