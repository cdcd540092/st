/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameStatus, NoteData } from './types.ts';
import { DEMO_CHART, SONG_URL } from './constants.ts';
import { useMediaPipe } from './hooks/useMediaPipe.ts';
import GameScene from './components/GameScene.tsx';
import WebcamPreview from './components/WebcamPreview.tsx';
import { Play, RefreshCw, VideoOff, Hand, Sparkles, Download } from 'lucide-react';

const App: React.FC = () => {
    const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.LOADING);
    const [score, setScore] = useState(0);
    const [combo, setCombo] = useState(0);
    const [multiplier, setMultiplier] = useState(1);
    const [health, setHealth] = useState(100);
    const [installPrompt, setInstallPrompt] = useState<any>(null);

    // Audio reference
    const audioRef = useRef<HTMLAudioElement>(new Audio(SONG_URL));
    const videoRef = useRef<HTMLVideoElement>(null);

    // Custom Hook for MediaPipe
    const { isCameraReady, handPositionsRef, lastResultsRef, error: cameraError } = useMediaPipe(videoRef);

    // Handle PWA Install Prompt
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

    // Logic: When a note is successfully hit
    const handleNoteHit = useCallback((note: NoteData, goodCut: boolean) => {
        if (goodCut) {
            let points = 150; // Base points for good hit

            // Vibration feedback
            if (navigator.vibrate) {
                navigator.vibrate(40);
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
        } else {
            // Bad cut (e.g., illegal grip, wrong direction, or too slow)
            // Reset combo as requested by user
            setCombo(0);
            setMultiplier(1);
            setScore(s => Math.max(0, s - 50)); // Penalty for bad hit
            setHealth(h => Math.max(0, h - 5)); // Slight health penalty for bad hit

            if (navigator.vibrate) {
                navigator.vibrate(20);
            }
        }
    }, [multiplier]);

    // Logic: When a note is missed
    const handleNoteMiss = useCallback((note: NoteData) => {
        setCombo(0);
        setMultiplier(1);
        setScore(s => Math.max(0, s - 50));
        setHealth(h => {
            const newHealth = h - 15;
            // Trigger Game Over if health drops to 0
            if (newHealth <= 0) {
                // Defer state update to avoid render loop issues
                setTimeout(() => endGame(false), 0);
                return 0;
            }
            return newHealth;
        });
    }, []);

    // Start the game
    const startGame = async () => {
        if (!isCameraReady) return;

        // Reset Stats
        setScore(0);
        setCombo(0);
        setMultiplier(1);
        setHealth(100);

        // Reset Chart Data
        DEMO_CHART.forEach(n => { n.hit = false; n.missed = false; });

        try {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                await audioRef.current.play();
                setGameStatus(GameStatus.PLAYING);
            }
        } catch (e) {
            console.error("Audio play failed", e);
            alert("無法播放音效，請確保您的瀏覽器允許自動播放。");
        }
    };

    const endGame = (victory: boolean) => {
        setGameStatus(victory ? GameStatus.VICTORY : GameStatus.GAME_OVER);
        if (audioRef.current) {
            audioRef.current.pause();
        }
    };

    // Auto-transition from Loading to Idle once camera is ready
    useEffect(() => {
        if (gameStatus === GameStatus.LOADING && isCameraReady) {
            setGameStatus(GameStatus.IDLE);
        }
    }, [isCameraReady, gameStatus]);

    return (
        <div className="relative w-full h-screen bg-black overflow-hidden font-sans">
            {/* Hidden Video Element for MediaPipe */}
            <video
                ref={videoRef}
                className="absolute opacity-0 pointer-events-none"
                playsInline
                muted
                autoPlay
                style={{ width: '640px', height: '480px' }}
            />

            {/* 3D Game World */}
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

            {/* 2D Webcam Overlay (Bottom Right) */}
            <WebcamPreview
                videoRef={videoRef}
                resultsRef={lastResultsRef}
                isCameraReady={isCameraReady}
            />

            {/* UI Layer */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10">

                {/* Top HUD */}
                <div className="flex items-start text-white w-full">
                    {/* Health Bar */}
                    <div className="w-1/3">
                        <div className="max-w-xs">
                            <div className="h-4 bg-gray-800 rounded-full overflow-hidden border-2 border-gray-700">
                                <div
                                    className={`h-full transition-all duration-300 ease-out ${health > 50 ? 'bg-green-500' : health > 20 ? 'bg-yellow-500' : 'bg-red-600'}`}
                                    style={{ width: `${health}%` }}
                                />
                            </div>
                            <p className="text-xs mt-1 opacity-70">生命值 (HP)</p>
                        </div>
                    </div>

                    {/* Score Display */}
                    <div className="w-1/3 flex flex-col items-center">
                        <h1 className="text-5xl font-bold tracking-wider drop-shadow-[0_0_10px_rgba(59,130,246,0.8)]">
                            {score.toLocaleString()}
                        </h1>
                        <div className="mt-2 flex flex-col items-center">
                            <p className={`text-2xl font-bold ${combo > 10 ? 'text-blue-400 scale-110' : 'text-gray-300'} transition-all`}>
                                {combo} 連擊 (COMBO)
                            </p>
                            {multiplier > 1 && (
                                <span className="text-sm px-2 py-1 bg-blue-900 rounded-full mt-1 animate-pulse">
                                    {multiplier}x 分數加成
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Right Spacer */}
                    <div className="w-1/3"></div>
                </div>

                {/* Menus / Modals */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">

                    {gameStatus === GameStatus.LOADING && (
                        <div className="bg-black/80 p-10 rounded-2xl flex flex-col items-center border border-blue-900/50 backdrop-blur-md">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-6"></div>
                            <h2 className="text-2xl text-white font-bold mb-2">系統初始化中</h2>
                            <p className="text-blue-300">{!isCameraReady ? "等待攝影機啟動..." : "載入資源中..."}</p>
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
                                    <span>請與攝影機保持約 1.5 公尺距離</span>
                                </p>
                                <p>使用 <span className="text-blue-500 font-bold">左手</span> 與 <span className="text-red-500 font-bold">右手</span> 進行揮擊</p>
                                <p className="text-yellow-400 font-bold">看到「圓球」請握拳揮擊！</p>
                                <p>跟隨節奏擊碎所有音符！</p>
                            </div>

                            <div className="flex flex-col gap-4 items-center">
                                {!isCameraReady ? (
                                    <div className="flex items-center justify-center text-red-400 gap-2 bg-red-900/20 p-4 rounded-lg">
                                        <VideoOff /> 攝影機未就緒
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
                                版本 v1.0.0
                            </div>
                        </div>
                    )}

                    {(gameStatus === GameStatus.GAME_OVER || gameStatus === GameStatus.VICTORY) && (
                        <div className="bg-black/90 p-12 rounded-3xl text-center border-2 border-white/10 backdrop-blur-xl">
                            <h2 className={`text-6xl font-bold mb-4 ${gameStatus === GameStatus.VICTORY ? 'text-green-400' : 'text-red-500'}`}>
                                {gameStatus === GameStatus.VICTORY ? "任務達成" : "遊戲結束"}
                            </h2>
                            <p className="text-white text-3xl mb-8">總分: {score.toLocaleString()}</p>
                            <button
                                onClick={() => setGameStatus(GameStatus.IDLE)}
                                className="bg-white/10 hover:bg-white/20 text-white text-xl py-3 px-8 rounded-full flex items-center justify-center mx-auto gap-2 transition-colors"
                            >
                                <RefreshCw /> 再次挑戰
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default App;