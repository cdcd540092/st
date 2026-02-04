/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HandType, COLORS } from '../types.ts';

interface SaberProps {
  type: HandType;
  positionRef: React.MutableRefObject<THREE.Vector3 | null>;
  velocityRef: React.MutableRefObject<THREE.Vector3 | null>;
  isGrippingRef: React.MutableRefObject<boolean>;
}

const Saber: React.FC<SaberProps> = ({ type, positionRef, velocityRef, isGrippingRef }) => {
  const meshRef = useRef<THREE.Group>(null);
  const bladeRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const outerGlowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  // Common refs for the "Power-up" effects
  const spikesRef = useRef<THREE.Group>(null);

  const saberLength = 1.0;
  const targetRotation = useRef(new THREE.Euler());

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const targetPos = positionRef.current;
    const velocity = velocityRef.current;
    const isGripping = isGrippingRef.current;
    const time = state.clock.elapsedTime;

    if (targetPos) {
      meshRef.current.visible = true;
      meshRef.current.position.lerp(targetPos, 0.5);

      const restingX = -Math.PI / 3.5;
      const restingY = 0;
      const restingZ = type === 'left' ? 0.2 : -0.2;

      let swayX = 0;
      let swayY = 0;
      let swayZ = 0;

      if (velocity) {
        swayX = velocity.y * 0.05;
        swayZ = -velocity.x * 0.05;
        swayX += velocity.z * 0.02;
      }

      targetRotation.current.set(
        restingX + swayX,
        restingY + swayY,
        restingZ + swayZ
      );

      meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, targetRotation.current.x, 0.2);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, targetRotation.current.y, 0.2);
      meshRef.current.rotation.z = THREE.MathUtils.lerp(meshRef.current.rotation.z, targetRotation.current.z, 0.2);

      const dt = 10 * delta;

      // --- Common Light Effect ---
      const targetLightIntensity = isGripping ? 8.0 : 2.0;
      const targetLightDistance = isGripping ? 6 : 3;
      if (lightRef.current) {
        lightRef.current.intensity = THREE.MathUtils.lerp(lightRef.current.intensity, targetLightIntensity, dt);
        lightRef.current.distance = THREE.MathUtils.lerp(lightRef.current.distance, targetLightDistance, dt);
      }

      // --- Unified Animation (Based on Red style) ---

      // Visual: Blade thickens and shakes. Spikes protrude.
      const shake = isGripping ? (Math.random() - 0.5) * 0.05 : 0;
      const pulse = isGripping ? Math.sin(time * 30) * 0.2 : 0;
      const targetCoreScale = isGripping ? 1.8 : 1.0;

      if (bladeRef.current) {
        const s = THREE.MathUtils.lerp(bladeRef.current.scale.x, targetCoreScale + pulse, dt);
        bladeRef.current.scale.set(s, 1, s);
        bladeRef.current.position.x = shake;
        bladeRef.current.position.z = shake;

        // Core turns slightly more intense white on grip
        (bladeRef.current.material as THREE.MeshBasicMaterial).color.set(isGripping ? '#ffffff' : 'white');
      }

      if (glowRef.current) {
        const targetInnerScale = isGripping ? 1.5 : 1.0;
        const s = THREE.MathUtils.lerp(glowRef.current.scale.x, targetInnerScale, dt);
        glowRef.current.scale.set(s, 1, s);
      }

      if (spikesRef.current) {
        const targetSpikeScale = isGripping ? 1.2 : 0.0;
        const currentScale = spikesRef.current.scale.x;
        const nextScale = THREE.MathUtils.lerp(currentScale, targetSpikeScale, dt);
        spikesRef.current.scale.setScalar(nextScale);

        spikesRef.current.rotation.x += delta;
        spikesRef.current.rotation.z -= delta * 2;
      }

      // Outer glow flickers on both
      if (outerGlowRef.current) {
        const targetOpacity = isGripping ? 0.5 + Math.random() * 0.2 : 0.05;
        const targetScale = isGripping ? 3.0 : 1.2;

        const s = THREE.MathUtils.lerp(outerGlowRef.current.scale.x, targetScale, dt);
        outerGlowRef.current.scale.set(s, 1, s);
        (outerGlowRef.current.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.lerp(
          (outerGlowRef.current.material as THREE.MeshBasicMaterial).opacity, targetOpacity, dt
        );
      }

    } else {
      meshRef.current.visible = false;
    }
  });

  const color = type === 'left' ? COLORS.left : COLORS.right;
  // Specific lighter color for the energy spikes
  const effectColor = type === 'left' ? '#93c5fd' : '#fca5a5';

  return (
    <group ref={meshRef}>
      {/* --- HANDLE --- */}
      <mesh position={[0, -0.06, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.12, 16]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.8} />
      </mesh>
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.02, 16]} />
        <meshStandardMaterial color="#888" roughness={0.3} metalness={1} />
      </mesh>
      <mesh position={[0, -0.08, 0]}>
        <torusGeometry args={[0.021, 0.002, 8, 24]} />
        <meshStandardMaterial color="#aaa" roughness={0.2} metalness={1} />
      </mesh>
      <mesh position={[0, -0.04, 0]}>
        <torusGeometry args={[0.021, 0.002, 8, 24]} />
        <meshStandardMaterial color="#aaa" roughness={0.2} metalness={1} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.035, 0.025, 0.05, 16]} />
        <meshStandardMaterial color="#C0C0C0" roughness={0.2} metalness={1} />
      </mesh>
      <mesh position={[0, 0.036, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.015, 0.03, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      {/* --- BLADE & EFFECTS --- */}

      {/* 1. Core (White Hot Center) */}
      <mesh ref={bladeRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.008, saberLength, 12]} />
        <meshBasicMaterial color="white" toneMapped={false} />
      </mesh>

      {/* 2. Inner Glow (Main Color) */}
      <mesh ref={glowRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <capsuleGeometry args={[0.02, saberLength, 16, 32]} />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* 3. Outer Halo */}
      <mesh ref={outerGlowRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <capsuleGeometry args={[0.035, saberLength * 1.05, 16, 32]} />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* 4. Energy Spikes (Now for BOTH) */}
      <group ref={spikesRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <mesh position={[0, 0, 0]} scale={[0.5, 2, 0.5]}>
          <icosahedronGeometry args={[0.08, 0]} />
          <meshBasicMaterial
            color={effectColor}
            toneMapped={false}
            transparent
            opacity={0.4}
            blending={THREE.AdditiveBlending}
            wireframe={true}
          />
        </mesh>
        <mesh position={[0, -0.2, 0]} scale={[0.6, 1, 0.6]}>
          <icosahedronGeometry args={[0.1, 0]} />
          <meshBasicMaterial
            color={effectColor}
            toneMapped={false}
            transparent
            opacity={0.2}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* Dynamic Light */}
      <pointLight
        ref={lightRef}
        color={color}
        intensity={2}
        distance={3}
        decay={2}
        position={[0, 0.5, 0]}
      />
    </group>
  );
};

export default Saber;