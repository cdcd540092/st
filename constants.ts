/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { CutDirection, NoteData } from "./types.ts";
import * as THREE from 'three';

// Game World Config
export const TRACK_LENGTH = 50;
export const SPAWN_Z = -30;
export const PLAYER_Z = 0;
export const MISS_Z = 5;
export const NOTE_SPEED = 4; // Ultra slow for maximum reaction time

export const LANE_WIDTH = 0.8;
export const LAYER_HEIGHT = 0.8;
export const NOTE_SIZE = 0.5;

// Positions for the 4 lanes (centered around 0)
export const LANE_X_POSITIONS = [-1.5 * LANE_WIDTH, -0.5 * LANE_WIDTH, 0.5 * LANE_WIDTH, 1.5 * LANE_WIDTH];
export const LAYER_Y_POSITIONS = [0.8, 1.6, 2.4]; // Low, Mid, High

// Audio
// Using a solid rhythmic track that is free to use.
export const SONG_URL = 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race2.ogg';
export const SONG_BPM = 140;
const BEAT_TIME = 60 / SONG_BPM;

export const generateDemoChart = (): NoteData[] => {
  const notes: NoteData[] = [];
  let idCount = 0;

  // Total beats in the track (roughly 3 minutes at 140 BPM)
  const totalBeats = 400;

  for (let i = 12; i < totalBeats; i++) {
    const time = i * BEAT_TIME;

    // --- 極致優化：音符規律性與極低密度 ---

    // 1. 下重藥：只在每 4 拍（一小節的正拍）考慮出現音符
    if (i % 4 !== 0) continue;

    // 2. 在正拍也有 40% 的機率跳過，確保音符之間有 4~8 拍的超長間距
    if (Math.random() > 0.6) continue;

    // 3. 隨機手部但保持簡單
    const type = Math.random() > 0.5 ? 'left' : 'right';

    // 4. 隨機位置分布
    const lineIndex = Math.floor(Math.random() * 4);
    const lineLayer = Math.floor(Math.random() * 3);

    // 5. 移除所有複雜方向：強制使用 ANY 方向
    const cutDirection = CutDirection.ANY;

    notes.push({
      id: `note-${idCount++}`,
      time,
      lineIndex,
      lineLayer,
      type,
      cutDirection,
      // 提高握拳音符機率至 30% (之前為 10%)
      requiresGrip: Math.random() > 0.7
    });

    // 完全移除雙擊音符邏輯，確保一次只處理一個音符
  }

  return notes.sort((a, b) => a.time - b.time);
};

export const DEMO_CHART = generateDemoChart();

// Vectors for direction checking
export const DIRECTION_VECTORS: Record<CutDirection, THREE.Vector3> = {
  [CutDirection.UP]: new THREE.Vector3(0, 1, 0),
  [CutDirection.DOWN]: new THREE.Vector3(0, -1, 0),
  [CutDirection.LEFT]: new THREE.Vector3(-1, 0, 0),
  [CutDirection.RIGHT]: new THREE.Vector3(1, 0, 0),
  [CutDirection.ANY]: new THREE.Vector3(0, 0, 0) // Magnitude check only
};