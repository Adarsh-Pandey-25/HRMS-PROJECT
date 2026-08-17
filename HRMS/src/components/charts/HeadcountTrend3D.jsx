import { memo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { useSpring, animated } from '@react-spring/three';
import { useUIStore } from '../../store/uiStore';

/** One animated bar that grows from the floor then gently floats. */
function Bar3D({ position, height, color, delay }) {
  const meshRef = useRef();
  const { scale } = useSpring({
    from: { scale: [1, 0, 1] },
    to: { scale: [1, 1, 1] },
    delay,
    config: { mass: 1, tension: 180, friction: 20 },
  });

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + delay * 0.01) * 0.02;
    }
  });

  return (
    <animated.mesh ref={meshRef} position={position} scale={scale} castShadow>
      <boxGeometry args={[0.6, height, 0.6]} />
      <meshStandardMaterial color={color} metalness={0.2} roughness={0.3} transparent opacity={0.92} />
    </animated.mesh>
  );
}

/**
 * True 3D headcount bar chart (WebGL via Three.js). Accepts the app's
 * `headcountTrend` shape `[{ month, count }]` (also tolerates `{ label, value }`).
 */
function HeadcountTrend3D({ data = [] }) {
  const isDark = useUIStore((s) => s.isDark);
  const rows = data.map((d) => ({ label: d.month ?? d.label, value: d.count ?? d.value }));
  const maxVal = Math.max(1, ...rows.map((d) => d.value));
  const labelColor = isDark ? '#9CA3AF' : '#6B7280';

  return (
    <div
      className={`w-full h-[300px] md:h-[340px] rounded-2xl overflow-hidden ${
        isDark
          ? 'bg-gradient-to-br from-[#1e1b3a] to-[#161428]'
          : 'bg-gradient-to-br from-[#F5F4FF] to-[#EEF0FF]'
      }`}
    >
      <Canvas camera={{ position: [8, 6, 12], fov: 45 }} shadows gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={isDark ? 0.4 : 0.6} />
        <directionalLight
          position={[10, 15, 10]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <pointLight position={[-5, 8, -5]} intensity={0.4} color="#6C63FF" />
        <pointLight position={[5, 3, 10]} intensity={0.3} color="#14B8A6" />

        <gridHelper
          args={[20, 20, isDark ? '#3f3a63' : '#E5E7EB', isDark ? '#2a2745' : '#F3F4F6']}
          position={[0, -0.01, 0]}
        />

        {rows.map((d, i) => {
          const height = (d.value / maxVal) * 5;
          const x = (i - rows.length / 2) * 1.1;
          const color = `hsl(${245 + i * 4}, 70%, ${55 + i * 1.5}%)`;
          return <Bar3D key={d.label} position={[x, height / 2, 0]} height={height} color={color} delay={i * 80} />;
        })}

        {rows.map((d, i) => (
          <Text
            key={d.label + '-label'}
            position={[(i - rows.length / 2) * 1.1, -0.4, 0]}
            fontSize={0.28}
            color={labelColor}
            anchorX="center"
            anchorY="top"
          >
            {d.label}
          </Text>
        ))}

        {rows.map((d, i) => {
          const height = (d.value / maxVal) * 5;
          return (
            <Text
              key={d.label + '-val'}
              position={[(i - rows.length / 2) * 1.1, height + 0.3, 0]}
              fontSize={0.26}
              color="#6C63FF"
              anchorX="center"
            >
              {String(d.value)}
            </Text>
          );
        })}

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.5}
          minAzimuthAngle={-Math.PI / 6}
          maxAzimuthAngle={Math.PI / 6}
          autoRotate
          autoRotateSpeed={0.4}
        />
      </Canvas>
    </div>
  );
}

export default memo(HeadcountTrend3D);
