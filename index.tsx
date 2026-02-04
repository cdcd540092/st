/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Loader, useProgress, Environment, Grid, PerspectiveCamera, Stars, Extrude, Octahedron } from '@react-three/drei';
import * as THREE from 'three';
import { HandLandmarker, FilesetResolver, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { Play, RefreshCw, VideoOff, Hand, Sparkles, Download } from 'lucide-react';

// ==========================================
// TYPES
// ==========================================

enum GameStatus {
  LOADING = 'LOADING',
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}

type HandType = 'left' | 'right';

// 0: Up, 1: Down, 2: Left, 3: Right, 4: Any (Dot)
enum CutDirection {
  UP = 0,
  DOWN = 1,
  LEFT = 2,
  RIGHT = 3,
  ANY = 4
}

interface NoteData {
  id: string;
  time: number;     // Time in seconds when it should reach the player
  lineIndex: number; // 0-3 (horizontal position)
  lineLayer: number; // 0-2 (vertical position)
  type: HandType;    // which hand should cut it
  cutDirection: CutDirection;
  hit?: boolean;
  missed?: boolean;
  hitTime?: number; // Time when hit occurred
}

interface HandPositions {
  left: THREE.Vector3 | null;
  right: THREE.Vector3 | null;
  leftVelocity: THREE.Vector3;
  rightVelocity: THREE.Vector3;
  leftGripping: boolean;
  rightGripping: boolean;
  lastTimestamp: number;
}

const COLORS = {
  left: '#ef4444',  // Red-ish
  right: '#3b82f6', // Blue-ish
  track: '#111111',
  hittable: '#ffffff'
};

// ==========================================
// CONSTANTS
// ==========================================

// Game World Config
const TRACK_LENGTH = 50;
const SPAWN_Z = -30;
const PLAYER_Z = 0;
const MISS_Z = 5;
const NOTE_SPEED = 10; // Reduced from 15 for easier difficulty

const LANE_WIDTH = 0.8;
const LAYER_HEIGHT = 0.8;
const NOTE_SIZE = 0.5;

// Positions for the 4 lanes (centered around 0)
const LANE_X_POSITIONS = [-1.5 * LANE_WIDTH, -0.5 * LANE_WIDTH, 0.5 * LANE_WIDTH, 1.5 * LANE_WIDTH];
const LAYER_Y_POSITIONS = [0.8, 1.6, 2.4]; // Low, Mid, High

// Audio
const SONG_URL = 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race2.ogg';
const SONG_BPM = 140; 
const BEAT_TIME = 60 / SONG_BPM;

// Vectors for direction checking
const DIRECTION_VECTORS: Record<CutDirection, THREE.Vector3> = {
  [CutDirection.UP]: new THREE.Vector3(0, 1, 0),
  [CutDirection.DOWN]: new THREE.Vector3(0, -1, 0),
  [CutDirection.LEFT]: new THREE.Vector3(-1, 0, 0),
  [CutDirection.RIGHT]: new THREE.Vector3(1, 0, 0),
  [CutDirection.ANY]: new THREE.Vector3(0, 0, 0) // Magnitude check only
};

// Generate a simple rhythmic chart
const generateDemoChart = (): NoteData[] => {
  const notes: NoteData[] = [];
  let idCount = 0;

  // Simple pattern generator
  for (let i = 4; i < 200; i += 2) { // Start after 4 beats
    const time = i * BEAT_TIME;
    
    // Alternate hands every 4 beats, or do simultaneously sometimes
    const pattern = Math.floor(i / 16) % 3;

    if (pattern === 0) {
      // Simple alternation
      if (i % 4 === 0) {
         notes.push({
          id: `note-${idCount++}`,
          time: time,
          lineIndex: 1,
          lineLayer: 0,
          type: 'left',
          cutDirection: CutDirection.ANY
        });
      } else {
        notes.push({
          id: `note-${idCount++}`,
          time: time,
          lineIndex: 2,
          lineLayer: 0,
          type: 'right',
          cutDirection: CutDirection.ANY
        });
      }
    } else if (pattern === 1) {
      // Double hits
      if (i % 8 === 0) {
         notes.push(
           { id: `note-${idCount++}`, time, lineIndex: 0, lineLayer: 1, type: 'left', cutDirection: CutDirection.ANY },
           { id: `note-${idCount++}`, time, lineIndex: 3, lineLayer: 1, type: 'right', cutDirection: CutDirection.ANY }
         );
      }
    } else {
      // Streams (faster)
      notes.push({
        id: `note-${idCount++}`,
        time: time,
        lineIndex: 1,
        lineLayer: 0,
        type: 'left',
        cutDirection: CutDirection.ANY
      });
       notes.push({
        id: `note-${idCount++}`,
        time: time + BEAT_TIME,
        lineIndex: 2,
        lineLayer: 0,
        type: 'right',
        cutDirection: CutDirection.ANY
      });
    }
  }

  return notes.sort((a, b) => a.time - b.time);
};

const DEMO_CHART = generateDemoChart();

// ==========================================
// HOOKS
// ==========================================

// Mapping 2D normalized coordinates to 3D game world.
const mapHandToWorld = (x: number, y: number): THREE.Vector3 => {
  const GAME_X_RANGE = 5; 
  const GAME_Y_RANGE = 3.5;
  const Y_OFFSET = 0.8;

  const worldX = (0.5 - x) * GAME_X_RANGE; 
  const worldY = (1.0 - y) * GAME_Y_RANGE - (GAME_Y_RANGE / 2) + Y_OFFSET;
  const worldZ = -Math.max(0, worldY * 0.2);

  return new THREE.Vector3(worldX, Math.max(0.1, worldY), worldZ);
};

// Helper to check if hand is gripping
const checkGrip = (landmarks: any[]) => {
    const wrist = landmarks[0];
    let curledFingers = 0;
    
    const fingerIndices = [
        { tip: 8, pip: 6 },
        { tip: 12, pip: 10 },
        { tip: 16, pip: 14 },
        { tip: 20, pip: 18 }
    ];

    for (const finger of fingerIndices) {
        const tip = landmarks[finger.tip];
        const pip = landmarks[finger.pip];
        
        const dTip = Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2) + Math.pow(tip.z - wrist.z, 2);
        const dPip = Math.pow(pip.x - wrist.x, 2) + Math.pow(pip.y - wrist.y, 2) + Math.pow(pip.z - wrist.z, 2);

        if (dTip < dPip) {
            curledFingers++;
        }
    }

    return curledFingers >= 3;
};

const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handPositionsRef = useRef<{
    left: THREE.Vector3 | null;
    right: THREE.Vector3 | null;
    lastLeft: THREE.Vector3 | null;
    lastRight: THREE.Vector3 | null;
    leftVelocity: THREE.Vector3;
    rightVelocity: THREE.Vector3;
    leftGripping: boolean;
    rightGripping: boolean;
    lastTimestamp: number;
  }>({
    left: null,
    right: null,
    lastLeft: null,
    lastRight: null,
    leftVelocity: new THREE.Vector3(0,0,0),
    rightVelocity: new THREE.Vector3(0,0,0),
    leftGripping: false,
    rightGripping: false,
    lastTimestamp: 0
  });

  const lastResultsRef = useRef<HandLandmarkerResult | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    let isActive = true;

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        
        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        if (!isActive) {
             landmarker.close();
             return;
        }

        landmarkerRef.current = landmarker;
        startCamera();
      } catch (err: any) {
        console.error("Error initializing MediaPipe:", err);
        setError(`Failed to load hand tracking: ${err.message}`);
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
             if (isActive) {
                 setIsCameraReady(true);
                 predictWebcam();
             }
          };
        }
      } catch (err) {
        console.error("Camera Error:", err);
        setError("Could not access camera.");
      }
    };

    const predictWebcam = () => {
        if (!videoRef.current || !landmarkerRef.current || !isActive) return;

        const video = videoRef.current;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
             let startTimeMs = performance.now();
             try {
                 const results = landmarkerRef.current.detectForVideo(video, startTimeMs);
                 lastResultsRef.current = results;
                 processResults(results);
             } catch (e) {
                 console.warn("Detection failed this frame", e);
             }
        }
        requestRef.current = requestAnimationFrame(predictWebcam);
    };

    const processResults = (results: HandLandmarkerResult) => {
        const now = performance.now();
        const deltaTime = (now - handPositionsRef.current.lastTimestamp) / 1000;
        handPositionsRef.current.lastTimestamp = now;

        let newLeft: THREE.Vector3 | null = null;
        let newRight: THREE.Vector3 | null = null;
        let leftGrip = false;
        let rightGrip = false;

        if (results.landmarks) {
          for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i];

            // SAFETY CHECK: Ensure handedness exists for this index before accessing [0]
            if (!results.handedness || !results.handedness[i] || !results.handedness[i][0]) {
                continue;
            }

            const classification = results.handedness[i][0];
            const isRight = classification.categoryName === 'Right'; 
            
            const tip = landmarks[8];
            const worldPos = mapHandToWorld(tip.x, tip.y);
            const isGripping = checkGrip(landmarks);

            if (isRight) {
                 newRight = worldPos; 
                 rightGrip = isGripping;
            } else {
                 newLeft = worldPos;
                 leftGrip = isGripping;
            }
          }
        }

        const s = handPositionsRef.current;
        const LERP = 0.6; 

        // Update Left
        if (newLeft) {
            if (s.left) {
                newLeft.lerpVectors(s.left, newLeft, LERP);
                if (deltaTime > 0.001) { 
                     s.leftVelocity.subVectors(newLeft, s.left).divideScalar(deltaTime);
                }
            }
            s.lastLeft = s.left ? s.left.clone() : newLeft.clone();
            s.left = newLeft;
            s.leftGripping = leftGrip;
        } else {
            s.left = null;
            s.leftGripping = false;
        }

        // Update Right
        if (newRight) {
             if (s.right) {
                 newRight.lerpVectors(s.right, newRight, LERP);
                 if (deltaTime > 0.001) {
                      s.rightVelocity.subVectors(newRight, s.right).divideScalar(deltaTime);
                 }
             }
             s.lastRight = s.right ? s.right.clone() : newRight.clone();
             s.right = newRight;
             s.rightGripping = rightGrip;
        } else {
            s.right = null;
            s.rightGripping = false;
        }
    };

    setupMediaPipe();

    return () => {
      isActive = false;
      if (requestRef.current) {
          cancelAnimationFrame(requestRef.current);
      }
      if (landmarkerRef.current) {
          landmarkerRef.current.close();
      }
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [videoRef]);

  return { isCameraReady, handPositionsRef, lastResultsRef, error };
};

// ==========================================
// COMPONENTS
// ==========================================

// --- SABER ---

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
  const saberLength = 1.0; 

  const targetRotation = useRef(new THREE.Euler());

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    const targetPos = positionRef.current;
    const velocity = velocityRef.current;
    const isGripping = isGrippingRef.current;

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

      // Grip Effect: Pulse or Thicken blade
      if (bladeRef.current && glowRef.current) {
         const targetScale = isGripping ? 1.5 : 1.0;
         const currentScale = bladeRef.current.scale.x;
         const newScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.1);
         
         bladeRef.current.scale.set(newScale, 1, newScale);
         glowRef.current.scale.set(newScale, 1, newScale);
         
         const material = glowRef.current.material as THREE.MeshStandardMaterial;
         material.emissiveIntensity = isGripping ? 8 : 4;
      }

    } else {
      meshRef.current.visible = false;
    }
  });

  const color = type === 'left' ? COLORS.left : COLORS.right;

  return (
    <group ref={meshRef}>
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
      <mesh position={[0, 0.036, 0]} rotation={[Math.PI/2, 0, 0]}>
        <ringGeometry args={[0.015, 0.03, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={bladeRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.008, saberLength, 12]} />
        <meshBasicMaterial color="white" toneMapped={false} />
      </mesh>
      <mesh ref={glowRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <capsuleGeometry args={[0.02, saberLength, 16, 32]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color} 
          emissiveIntensity={4} 
          toneMapped={false} 
          transparent
          opacity={0.6} 
          roughness={0.1}
          metalness={0}
        />
      </mesh>
      <pointLight color={color} intensity={2} distance={3} decay={2} position={[0, 0.5, 0]} />
    </group>
  );
};

// --- NOTE ---

interface NoteProps {
  data: NoteData;
  zPos: number;
  currentTime: number;
}

const createSparkShape = (size: number) => {
  const shape = new THREE.Shape();
  const s = size / 1.8; 
  shape.moveTo(0, s);
  shape.quadraticCurveTo(0, 0, s, 0);
  shape.quadraticCurveTo(0, 0, 0, -s);
  shape.quadraticCurveTo(0, 0, -s, 0);
  shape.quadraticCurveTo(0, 0, 0, s);
  return shape;
};

const SPARK_SHAPE = createSparkShape(NOTE_SIZE);
const EXTRUDE_SETTINGS = { depth: NOTE_SIZE * 0.4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };

const Debris: React.FC<{ data: NoteData, timeSinceHit: number, color: string }> = ({ data, timeSinceHit, color }) => {
    const groupRef = useRef<THREE.Group>(null);
    const flashRef = useRef<THREE.Mesh>(null);

    const flySpeed = 6.0;
    const rotationSpeed = 10.0;
    const distance = flySpeed * timeSinceHit;

    useFrame(() => {
        if (groupRef.current) {
             groupRef.current.scale.setScalar(Math.max(0.01, 1 - timeSinceHit * 1.5));
        }
        if (flashRef.current) {
            const flashDuration = 0.15;
            if (timeSinceHit < flashDuration) {
                const t = timeSinceHit / flashDuration;
                flashRef.current.visible = true;
                flashRef.current.scale.setScalar(1 + t * 4);
                (flashRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t;
            } else {
                flashRef.current.visible = false;
            }
        }
    });
    
    const Shard = ({ offsetDir, moveDir, scale = 1 }: { offsetDir: number[], moveDir: number[], scale?: number }) => {
        const meshRef = useRef<THREE.Mesh>(null);
        useFrame(() => {
             if (meshRef.current) {
                 meshRef.current.position.x = offsetDir[0] + moveDir[0] * distance;
                 meshRef.current.position.y = offsetDir[1] + moveDir[1] * distance;
                 meshRef.current.position.z = offsetDir[2] + moveDir[2] * distance;
                 meshRef.current.rotation.x += moveDir[1] * 0.1 * rotationSpeed;
                 meshRef.current.rotation.y += moveDir[0] * 0.1 * rotationSpeed;
             }
        });
        return (
            <Octahedron ref={meshRef} args={[NOTE_SIZE * 0.3 * scale]} position={[offsetDir[0], offsetDir[1], offsetDir[2]]}>
                 <meshStandardMaterial color={color} roughness={0.1} metalness={0.9} emissive={color} emissiveIntensity={0.5} />
            </Octahedron>
        )
    }

    return (
        <group ref={groupRef}>
            <mesh ref={flashRef}>
                <sphereGeometry args={[NOTE_SIZE * 1.2, 16, 16]} />
                <meshBasicMaterial color="white" transparent toneMapped={false} />
            </mesh>
            <Shard offsetDir={[0, 0.2, 0]} moveDir={[0, 1.5, -0.5]} scale={0.8} />
            <Shard offsetDir={[0.2, 0, 0]} moveDir={[1.5, 0, -0.5]} scale={0.8} />
            <Shard offsetDir={[0, -0.2, 0]} moveDir={[0, -1.5, -0.5]} scale={0.8} />
            <Shard offsetDir={[-0.2, 0, 0]} moveDir={[-1.5, 0, -0.5]} scale={0.8} />
            <Shard offsetDir={[0.1, 0.1, 0.1]} moveDir={[1, 1, 1]} scale={0.5} />
            <Shard offsetDir={[-0.1, -0.1, -0.1]} moveDir={[-1, -1, 1]} scale={0.5} />
        </group>
    );
};

const Note: React.FC<NoteProps> = React.memo(({ data, zPos, currentTime }) => {
  const color = data.type === 'left' ? COLORS.left : COLORS.right;
  
  const position: [number, number, number] = useMemo(() => {
     return [
         LANE_X_POSITIONS[data.lineIndex],
         LAYER_Y_POSITIONS[data.lineLayer],
         zPos
     ];
  }, [data.lineIndex, data.lineLayer, zPos]);

  if (data.missed) return null;

  if (data.hit && data.hitTime) {
      return (
          <group position={position}>
              <Debris data={data} timeSinceHit={currentTime - data.hitTime} color={color} />
          </group>
      );
  }

  return (
    <group position={position}>
      <group rotation={[0, 0, 0]}> 
        <group position={[0, 0, -NOTE_SIZE * 0.2]}>
            <Extrude args={[SPARK_SHAPE, EXTRUDE_SETTINGS]} castShadow receiveShadow>
                <meshPhysicalMaterial 
                    color={color} 
                    roughness={0.2} 
                    metalness={0.1}
                    transmission={0.1} 
                    thickness={0.5}
                    emissive={color}
                    emissiveIntensity={0.8} 
                />
            </Extrude>
        </group>
      </group>
      <mesh position={[0, 0, NOTE_SIZE * 0.1]}>
         <octahedronGeometry args={[NOTE_SIZE * 0.2, 0]} />
         <meshBasicMaterial color="white" toneMapped={false} transparent opacity={0.8} />
      </mesh>
      <group position={[0, 0, -NOTE_SIZE * 0.2]}>
          <mesh>
             <extrudeGeometry args={[SPARK_SHAPE, { ...EXTRUDE_SETTINGS, depth: EXTRUDE_SETTINGS.depth * 1.1 }]} />
             <meshBasicMaterial color={color} wireframe transparent opacity={0.3} />
          </mesh>
      </group>
    </group>
  );
}, (prev, next) => {
    if (next.data.hit) return false;
    return prev.zPos === next.zPos && prev.data.hit === next.data.hit && prev.data.missed === next.data.missed;
});

// --- GAMESCENE ---

interface GameSceneProps {
  gameStatus: GameStatus;
  audioRef: React.RefObject<HTMLAudioElement>;
  handPositionsRef: React.MutableRefObject<any>; 
  chart: NoteData[];
  onNoteHit: (note: NoteData, goodCut: boolean) => void;
  onNoteMiss: (note: NoteData) => void;
  onSongEnd: () => void;
}

const GameScene: React.FC<GameSceneProps> = ({ 
    gameStatus, 
    audioRef, 
    handPositionsRef, 
    chart,
    onNoteHit,
    onNoteMiss,
    onSongEnd
}) => {
  const [notesState, setNotesState] = useState<NoteData[]>(chart);
  const [currentTime, setCurrentTime] = useState(0);

  const activeNotesRef = useRef<NoteData[]>([]);
  const nextNoteIndexRef = useRef(0);
  const shakeIntensity = useRef(0);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);

  const vecA = useMemo(() => new THREE.Vector3(), []);
  const vecB = useMemo(() => new THREE.Vector3(), []);

  const handleHit = (note: NoteData, goodCut: boolean) => {
      shakeIntensity.current = goodCut ? 0.3 : 0.15;
      onNoteHit(note, goodCut);
  }

  useFrame((state, delta) => {
    if (audioRef.current && gameStatus === GameStatus.PLAYING) {
        const time = audioRef.current.currentTime;
        const beatPhase = (time % BEAT_TIME) / BEAT_TIME;
        const pulse = Math.pow(1 - beatPhase, 4); 
        
        if (ambientLightRef.current) {
            ambientLightRef.current.intensity = 0.1 + (pulse * 0.3);
        }
        if (spotLightRef.current) {
            spotLightRef.current.intensity = 0.5 + (pulse * 1.5);
        }
    }

    if (shakeIntensity.current > 0 && cameraRef.current) {
        const shake = shakeIntensity.current;
        cameraRef.current.position.x = (Math.random() - 0.5) * shake;
        cameraRef.current.position.y = 1.8 + (Math.random() - 0.5) * shake;
        cameraRef.current.position.z = 4 + (Math.random() - 0.5) * shake;
        
        shakeIntensity.current = THREE.MathUtils.lerp(shakeIntensity.current, 0, 10 * delta);
        if (shakeIntensity.current < 0.01) {
             shakeIntensity.current = 0;
             cameraRef.current.position.set(0, 1.8, 4);
        }
    }

    if (gameStatus !== GameStatus.PLAYING || !audioRef.current) return;

    const time = audioRef.current.currentTime;
    setCurrentTime(time);

    if (audioRef.current.ended) {
        onSongEnd();
        return;
    }

    const spawnAheadTime = Math.abs(SPAWN_Z - PLAYER_Z) / NOTE_SPEED;
    
    while (nextNoteIndexRef.current < notesState.length) {
      const nextNote = notesState[nextNoteIndexRef.current];
      if (nextNote.time - spawnAheadTime <= time) {
        activeNotesRef.current.push(nextNote);
        nextNoteIndexRef.current++;
      } else {
        break;
      }
    }

    const hands = handPositionsRef.current as HandPositions;

    for (let i = activeNotesRef.current.length - 1; i >= 0; i--) {
        const note = activeNotesRef.current[i];
        if (note.hit || note.missed) continue;

        const timeDiff = note.time - time; 
        const currentZ = PLAYER_Z - (timeDiff * NOTE_SPEED);

        if (currentZ > MISS_Z) {
            note.missed = true;
            onNoteMiss(note);
            activeNotesRef.current.splice(i, 1);
            continue;
        }

        if (currentZ > PLAYER_Z - 1.5 && currentZ < PLAYER_Z + 1.0) {
            const handPos = note.type === 'left' ? hands.left : hands.right;
            const handVel = note.type === 'left' ? hands.leftVelocity : hands.rightVelocity;

            if (handPos) {
                 const notePos = vecA.set(
                     LANE_X_POSITIONS[note.lineIndex],
                     LAYER_Y_POSITIONS[note.lineLayer],
                     currentZ
                 );

                 if (handPos.distanceTo(notePos) < 0.8) {
                     let goodCut = true;
                     const speed = handVel.length();

                     if (note.cutDirection !== CutDirection.ANY) {
                         const requiredDir = DIRECTION_VECTORS[note.cutDirection];
                         vecB.copy(handVel).normalize();
                         const dot = vecB.dot(requiredDir);
                         
                         if (dot < 0.3 || speed < 1.5) { 
                             goodCut = false;
                         }
                     } else {
                         if (speed < 1.5) goodCut = false; 
                     }

                     note.hit = true;
                     note.hitTime = time;
                     handleHit(note, goodCut);
                     activeNotesRef.current.splice(i, 1);
                 }
            }
        }
    }
  });

  const visibleNotes = useMemo(() => {
     return notesState.filter(n => 
         !n.missed && 
         (!n.hit || (currentTime - (n.hitTime || 0) < 0.5)) && 
         (n.time - currentTime) < 5 && 
         (n.time - currentTime) > -2 
     );
  }, [notesState, currentTime]);

  const leftHandPosRef = useRef<THREE.Vector3 | null>(null);
  const rightHandPosRef = useRef<THREE.Vector3 | null>(null);
  const leftHandVelRef = useRef<THREE.Vector3 | null>(null);
  const rightHandVelRef = useRef<THREE.Vector3 | null>(null);
  const leftGripRef = useRef<boolean>(false);
  const rightGripRef = useRef<boolean>(false);

  useFrame(() => {
     leftHandPosRef.current = handPositionsRef.current.left;
     rightHandPosRef.current = handPositionsRef.current.right;
     leftHandVelRef.current = handPositionsRef.current.leftVelocity;
     rightHandVelRef.current = handPositionsRef.current.rightVelocity;
     leftGripRef.current = handPositionsRef.current.leftGripping;
     rightGripRef.current = handPositionsRef.current.rightGripping;
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 1.8, 4]} fov={60} />
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#050505', 10, 50]} />
      
      <ambientLight ref={ambientLightRef} intensity={0.2} />
      <spotLight ref={spotLightRef} position={[0, 10, 5]} angle={0.5} penumbra={1} intensity={1} castShadow />
      
      <Environment preset="night" />

      <Grid position={[0, 0, 0]} args={[6, 100]} cellThickness={0.1} cellColor="#333" sectionSize={5} sectionThickness={1.5} sectionColor={COLORS.right} fadeDistance={60} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[4, 100]} />
          <meshStandardMaterial color="#111" roughness={0.8} metalness={0.5} />
      </mesh>
      
      <Stars radius={50} depth={50} count={2000} factor={4} saturation={0} fade speed={1} />

      <Saber type="left" positionRef={leftHandPosRef} velocityRef={leftHandVelRef} isGrippingRef={leftGripRef} />
      <Saber type="right" positionRef={rightHandPosRef} velocityRef={rightHandVelRef} isGrippingRef={rightGripRef} />

      {visibleNotes.map(note => (
          <Note 
            key={note.id} 
            data={note} 
            zPos={PLAYER_Z - ((note.time - currentTime) * NOTE_SPEED)} 
            currentTime={currentTime}
          />
      ))}
    </>
  );
};

// --- WEBCAM PREVIEW ---

interface WebcamPreviewProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    resultsRef: React.MutableRefObject<HandLandmarkerResult | null>;
    isCameraReady: boolean;
}

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8], // Index
    [0, 9], [9, 10], [10, 11], [11, 12], // Middle
    [0, 13], [13, 14], [14, 15], [15, 16], // Ring
    [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
    [5, 9], [9, 13], [13, 17], [0, 5], [0, 17] // Palm
];

const WebcamPreview: React.FC<WebcamPreviewProps> = ({ videoRef, resultsRef, isCameraReady }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!isCameraReady) return;
        let animationFrameId: number;

        const render = () => {
            const canvas = canvasRef.current;
            const video = videoRef.current;

            if (canvas && video && video.readyState >= 2) { 
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
                    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    ctx.save();
                    ctx.scale(-1, 1);
                    ctx.translate(-canvas.width, 0);
                    ctx.globalAlpha = 0.8;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                    ctx.globalAlpha = 1.0;

                    if (resultsRef.current && resultsRef.current.landmarks) {
                        for (let i = 0; i < resultsRef.current.landmarks.length; i++) {
                            const landmarks = resultsRef.current.landmarks[i];
                            const handInfo = resultsRef.current.handedness?.[i];
                            if (!handInfo || !handInfo[0]) continue;

                            const handedness = handInfo[0];
                            const isRight = handedness.categoryName === 'Right';
                            const color = isRight ? COLORS.right : COLORS.left;
                            const isGripping = checkGrip(landmarks);

                            ctx.strokeStyle = color;
                            ctx.fillStyle = color;
                            ctx.lineWidth = isGripping ? 6 : 3; // Thicker lines when gripping

                            ctx.beginPath();
                            for (const [start, end] of HAND_CONNECTIONS) {
                                const p1 = landmarks[start];
                                const p2 = landmarks[end];
                                ctx.moveTo((1 - p1.x) * canvas.width, p1.y * canvas.height);
                                ctx.lineTo((1 - p2.x) * canvas.width, p2.y * canvas.height);
                            }
                            ctx.stroke();

                            for (const lm of landmarks) {
                                ctx.beginPath();
                                ctx.arc((1 - lm.x) * canvas.width, lm.y * canvas.height, 4, 0, 2 * Math.PI);
                                ctx.fill();
                            }

                            const tip = landmarks[8];
                            ctx.beginPath();
                            ctx.fillStyle = 'white';
                            ctx.arc((1 - tip.x) * canvas.width, tip.y * canvas.height, 7, 0, 2 * Math.PI);
                            ctx.fill();

                            if (isGripping) {
                                ctx.font = "bold 24px monospace";
                                ctx.fillStyle = "white";
                                ctx.strokeStyle = "black";
                                ctx.lineWidth = 4;
                                const cx = (1 - landmarks[0].x) * canvas.width;
                                const cy = landmarks[0].y * canvas.height;
                                ctx.strokeText("GRIP", cx - 30, cy - 20);
                                ctx.fillText("GRIP", cx - 30, cy - 20);
                            }
                        }
                    }
                }
            }
            animationFrameId = requestAnimationFrame(render);
        };
        render();

        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, [isCameraReady, videoRef, resultsRef]);

    if (!isCameraReady) return null;

    return (
        <div className="fixed bottom-4 right-4 w-64 h-48 bg-black/60 border-2 border-blue-500/30 rounded-xl overflow-hidden backdrop-blur-md z-50 shadow-[0_0_20px_rgba(0,0,0,0.5)] pointer-events-none transition-opacity duration-500">
            <div className="absolute top-0 left-0 right-0 bg-black/40 text-[10px] text-blue-300/70 px-2 py-1 font-mono uppercase tracking-widest">
                即時追蹤
            </div>
            <canvas ref={canvasRef} className="w-full h-full object-cover mt-4" />
        </div>
    );
};

// ==========================================
// APP COMPONENT
// ==========================================

const App: React.FC = () => {
  const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.LOADING);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [health, setHealth] = useState(100);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  const audioRef = useRef<HTMLAudioElement>(new Audio(SONG_URL));
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const { isCameraReady, handPositionsRef, lastResultsRef, error: cameraError } = useMediaPipe(videoRef);
  const { progress } = useProgress(); 

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const handleNoteHit = useCallback((note: NoteData, goodCut: boolean) => {
     let points = 100;
     if (goodCut) points += 50; 

     if (navigator.vibrate) {
         navigator.vibrate(goodCut ? 40 : 20);
     }

     setCombo(c => {
       const newCombo = c + 1;
       if (newCombo > 30) setMultiplier(8);
       else if (newCombo > 20) setMultiplier(4);
       else if (newCombo > 10) setMultiplier(2);
       else setMultiplier(1);
       return newCombo;
     });

     setScore(s => s + (points * multiplier));
     setHealth(h => Math.min(100, h + 2));
  }, [multiplier]);

  const handleNoteMiss = useCallback((note: NoteData) => {
      setCombo(0);
      setMultiplier(1);
      setHealth(h => {
          const newHealth = h - 15;
          if (newHealth <= 0) {
             setTimeout(() => endGame(false), 0);
             return 0;
          }
          return newHealth;
      });
  }, []);

  const startGame = async () => {
    if (!isCameraReady) return;
    
    setScore(0);
    setCombo(0);
    setMultiplier(1);
    setHealth(100);

    DEMO_CHART.forEach(n => { n.hit = false; n.missed = false; });

    try {
      if (audioRef.current) {
          audioRef.current.currentTime = 0;
          await audioRef.current.play();
          setGameStatus(GameStatus.PLAYING);
      }
    } catch (e) {
        console.error("Audio play failed", e);
        alert("無法播放音效，請先點擊畫面互動。");
    }
  };

  const endGame = (victory: boolean) => {
      setGameStatus(victory ? GameStatus.VICTORY : GameStatus.GAME_OVER);
      if (audioRef.current) {
          audioRef.current.pause();
      }
  };

  useEffect(() => {
      if (gameStatus === GameStatus.LOADING && isCameraReady) {
          setGameStatus(GameStatus.IDLE);
      }
  }, [isCameraReady, gameStatus]);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans">
      <video 
        ref={videoRef} 
        className="absolute opacity-0 pointer-events-none"
        playsInline
        muted
        autoPlay
        style={{ width: '640px', height: '480px' }}
      />

      <Canvas shadows dpr={[1, 2]}>
          {gameStatus !== GameStatus.LOADING && (
             <GameScene 
                gameStatus={gameStatus}
                audioRef={audioRef}
                handPositionsRef={handPositionsRef}
                chart={DEMO_CHART}
                onNoteHit={handleNoteHit}
                onNoteMiss={handleNoteMiss}
                onSongEnd={() => endGame(true)}
             />
          )}
      </Canvas>

      <WebcamPreview 
          videoRef={videoRef} 
          resultsRef={lastResultsRef} 
          isCameraReady={isCameraReady} 
      />

      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10">
          
          {/* HUD (Top) */}
          <div className="flex items-start text-white w-full">
             {/* Health Bar (Left 1/3) */}
             <div className="w-1/3">
                 <div className="max-w-xs">
                    <div className="h-4 bg-gray-800 rounded-full overflow-hidden border-2 border-gray-700">
                        <div 
                           className={`h-full transition-all duration-300 ease-out ${health > 50 ? 'bg-green-500' : health > 20 ? 'bg-yellow-500' : 'bg-red-600'}`}
                           style={{ width: `${health}%` }}
                        />
                    </div>
                    {/* CHANGED: Text updated from 系統完整度 to 血量 */}
                    <p className="text-xs mt-1 opacity-70">血量</p>
                 </div>
             </div>

             {/* Score & Combo (Center 1/3) */}
             <div className="w-1/3 flex flex-col items-center">
                 <h1 className="text-5xl font-bold tracking-wider drop-shadow-[0_0_10px_rgba(59,130,246,0.8)]">
                     {score.toLocaleString()}
                 </h1>
                 <div className="mt-2 flex flex-col items-center">
                     <p className={`text-2xl font-bold ${combo > 10 ? 'text-blue-400 scale-110' : 'text-gray-300'} transition-all`}>
                         {combo} 連擊
                     </p>
                     {multiplier > 1 && (
                         <span className="text-sm px-2 py-1 bg-blue-900 rounded-full mt-1 animate-pulse">
                             {multiplier}x 倍率加成!
                         </span>
                     )}
                 </div>
             </div>
             
             {/* Spacer (Right 1/3) */}
             <div className="w-1/3"></div>
          </div>

          {/* Menus (Centered) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
              
              {gameStatus === GameStatus.LOADING && (
                  <div className="bg-black/80 p-10 rounded-2xl flex flex-col items-center border border-blue-900/50 backdrop-blur-md">
                      <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-6"></div>
                      <h2 className="text-2xl text-white font-bold mb-2">系統初始化中</h2>
                      <p className="text-blue-300">{!isCameraReady ? "等待鏡頭訊號..." : "載入資源中..."}</p>
                      {cameraError && <p className="text-red-500 mt-4 max-w-xs text-center">{cameraError}</p>}
                  </div>
              )}

              {gameStatus === GameStatus.IDLE && (
                  <div className="bg-black/80 p-12 rounded-3xl text-center border-2 border-blue-500/30 backdrop-blur-xl max-w-lg">
                      <div className="mb-6 flex justify-center">
                         <Sparkles className="w-16 h-16 text-blue-400" />
                      </div>
                      <h1 className="text-7xl font-black text-white mb-6 tracking-tighter italic drop-shadow-[0_0_30px_rgba(59,130,246,0.6)]">
                          TEMPO <span className="text-blue-500">STRIKE</span>
                      </h1>
                      <div className="space-y-4 text-gray-300 mb-8">
                          <p className="flex items-center justify-center gap-2">
                              <Hand className="w-5 h-5 text-blue-400" /> 
                              <span>請往後站，確保雙手在鏡頭範圍內。</span>
                          </p>
                          <p>使用你的 <span className="text-red-500 font-bold">左手</span> 與 <span className="text-blue-500 font-bold">右手</span>。</p>
                          <p>跟隨節奏擊碎 <span className="text-white font-bold">方塊</span>！</p>
                      </div>

                      <div className="flex flex-col gap-4 items-center">
                        {!isCameraReady ? (
                             <div className="flex items-center justify-center text-red-400 gap-2 bg-red-900/20 p-4 rounded-lg">
                                 <VideoOff /> 攝影機尚未就緒
                             </div>
                        ) : (
                            <button 
                                onClick={startGame}
                                className="bg-blue-600 hover:bg-blue-500 text-white text-xl font-bold py-4 px-12 rounded-full transition-all transform hover:scale-105 hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] flex items-center justify-center gap-3"
                            >
                                <Play fill="currentColor" /> 開始遊戲
                            </button>
                        )}
                        
                        {installPrompt && (
                          <button 
                             onClick={handleInstallClick}
                             className="text-blue-300 hover:text-white hover:bg-white/10 text-sm py-2 px-6 rounded-full transition-colors flex items-center gap-2"
                          >
                             <Download size={16} /> 安裝應用程式
                          </button>
                        )}
                      </div>

                      <div className="text-white/30 text-sm text-center mt-8">
                           作者： <span className="text-blue-400">liangcheyu</span>
                      </div>
                  </div>
              )}

              {(gameStatus === GameStatus.GAME_OVER || gameStatus === GameStatus.VICTORY) && (
                  <div className="bg-black/90 p-12 rounded-3xl text-center border-2 border-white/10 backdrop-blur-xl">
                      <h2 className={`text-6xl font-bold mb-4 ${gameStatus === GameStatus.VICTORY ? 'text-green-400' : 'text-red-500'}`}>
                          {gameStatus === GameStatus.VICTORY ? "演奏完成" : "系統崩潰"}
                      </h2>
                      <p className="text-white text-3xl mb-8">最終分數: {score.toLocaleString()}</p>
                      <button 
                          onClick={() => setGameStatus(GameStatus.IDLE)}
                          className="bg-white/10 hover:bg-white/20 text-white text-xl py-3 px-8 rounded-full flex items-center justify-center mx-auto gap-2 transition-colors"
                      >
                          <RefreshCw /> 再玩一次
                      </button>
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};

// ==========================================
// ROOT
// ==========================================

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Clear loading text
const loadingText = document.getElementById('loading-text');
if (loadingText) loadingText.style.display = 'none';

const root = ReactDOM.createRoot(rootElement);
root.render(
  <>
    <App />
  </>
);