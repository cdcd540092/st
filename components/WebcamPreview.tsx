/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useEffect, useRef } from 'react';
import { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { COLORS } from '../types.ts';

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

// Helper to check if hand is gripping
// Logic: Check if finger tips are closer to wrist than PIP joints
const checkGrip = (landmarks: any[]) => {
    const wrist = landmarks[0];
    let curledFingers = 0;
    
    // Indices for [Index, Middle, Ring, Pinky]
    // Tip, PIP (Proximal Interphalangeal joint - the middle knuckle)
    const fingerIndices = [
        { tip: 8, pip: 6 },
        { tip: 12, pip: 10 },
        { tip: 16, pip: 14 },
        { tip: 20, pip: 18 }
    ];

    for (const finger of fingerIndices) {
        const tip = landmarks[finger.tip];
        const pip = landmarks[finger.pip];
        
        // Calculate squared distance to wrist
        const dTip = Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2) + Math.pow(tip.z - wrist.z, 2);
        const dPip = Math.pow(pip.x - wrist.x, 2) + Math.pow(pip.y - wrist.y, 2) + Math.pow(pip.z - wrist.z, 2);

        // If tip is closer to wrist than PIP, it's curled
        if (dTip < dPip) {
            curledFingers++;
        }
    }

    // If 3 or more fingers are curled, consider it a grip
    return curledFingers >= 3;
};

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
                            
                            // SAFETY CHECK: Ensure handedness exists for this index
                            if (!resultsRef.current.handedness || !resultsRef.current.handedness[i] || !resultsRef.current.handedness[i][0]) {
                                continue;
                            }

                            const handInfo = resultsRef.current.handedness[i];
                            const handedness = handInfo[0];
                            const isRight = handedness.categoryName === 'Right';
                            const color = isRight ? COLORS.right : COLORS.left;
                            const isGripping = checkGrip(landmarks);

                            ctx.strokeStyle = color;
                            ctx.fillStyle = color;
                            ctx.lineWidth = isGripping ? 6 : 3;

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

export default WebcamPreview;