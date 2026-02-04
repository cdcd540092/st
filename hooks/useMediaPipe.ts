/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import * as THREE from 'three';

// Mapping 2D normalized coordinates to 3D game world.
const mapHandToWorld = (x: number, y: number): THREE.Vector3 => {
  const GAME_X_RANGE = 5;
  const GAME_Y_RANGE = 3.5;
  const Y_OFFSET = 0.8;

  // MediaPipe often returns mirrored X if facingMode is 'user'.
  // We might need to invert X depending on the final behavior.
  // For now, assuming standard mirroring where 0 is left-screen (user's right hand physically if mirrored).
  const worldX = (0.5 - x) * GAME_X_RANGE;
  const worldY = (1.0 - y) * GAME_Y_RANGE - (GAME_Y_RANGE / 2) + Y_OFFSET;

  const worldZ = -Math.max(0, worldY * 0.2);

  return new THREE.Vector3(worldX, Math.max(0.1, worldY), worldZ);
};

// Helper to check if hand is gripping
// Logic: Check if finger tips are closer to wrist than PIP joints
const checkGrip = (landmarks: any[]) => {
  let curledFingers = 0;

  // Finger indices for [Index, Middle, Ring, Pinky]
  // Tip (8/12/16/20), PIP (6/10/14/18)
  const fingerJoints = [
    { tip: 8, pip: 6 },
    { tip: 12, pip: 10 },
    { tip: 16, pip: 14 },
    { tip: 20, pip: 18 }
  ];

  for (const finger of fingerJoints) {
    const tip = landmarks[finger.tip];
    const pip = landmarks[finger.pip];

    // 在標準握拳姿勢下，指尖 (Tip) 的 Y 座標應該大於（即視覺上低於）
    // 第二關節 (PIP) 的 Y 座標。
    // 如果使用者「比 1」或手指伸直，指尖會明顯高於或等於第二關節。
    if (tip.y > pip.y + 0.02) {
      curledFingers++;
    }
  }

  // 必須四指全部向下彎曲才算握拳。這能徹底排除食指伸出的情況。
  return curledFingers === 4;
};

export const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
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
    leftVelocity: new THREE.Vector3(0, 0, 0),
    rightVelocity: new THREE.Vector3(0, 0, 0),
    leftGripping: false,
    rightGripping: false,
    lastTimestamp: 0
  });

  // To expose raw results for UI preview
  const lastResultsRef = useRef<HandLandmarkerResult | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    let isActive = true;

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
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
      // Only process if video has data
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        let startTimeMs = performance.now();
        try {
          const results = landmarkerRef.current.detectForVideo(video, startTimeMs);
          lastResultsRef.current = results;
          processResults(results);
        } catch (e) {
          // Sometimes detectForVideo fails if timestamps aren't strictly increasing or video is not ready
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