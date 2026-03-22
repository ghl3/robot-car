"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useTopic } from "@/hooks/useTopic";
import { useTopicRef } from "@/hooks/useTopicRef";
import { usePose } from "@/hooks/usePose";
import type { Ros } from "roslib";
import type { RosStatus } from "@/hooks/useRobot";

interface LaserScan {
  angle_min: number;
  angle_increment: number;
  ranges: number[];
  range_min: number;
  range_max: number;
}

interface OccupancyGrid {
  info: {
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[];
}

// Vintage color scheme
const BG_COLOR = "#ece7e0";
const FREE_COLOR = [255, 255, 255, 255] as const;       // white
const OCCUPIED_COLOR = [196, 48, 32, 255] as const;      // dark red
const UNKNOWN_COLOR = [224, 219, 212, 255] as const;     // warm cream
const SCAN_COLOR = "#daa520";                             // gold for live scan
const ROBOT_COLOR = "#b8952a";                            // brass for robot
const TRAIL_COLOR = "rgba(218, 165, 32, 0.4)";
const GRID_COLOR = "rgba(180, 150, 80, 0.12)";

interface MapViewerProps {
  status: RosStatus;
  getRos: () => Ros | null;
  lidarDetected?: boolean;
  lidarActive?: boolean;
  slamActive?: boolean;
  robotIp?: string;
  credentials?: { username: string; password: string };
  recordingActive?: boolean;
  playbackActive?: boolean;
}

interface SavedMap {
  name: string;
  timestamp: number;
}

interface SavedBag {
  name: string;
  size: string;
  timestamp: number;
}

export default function MapViewer({
  status, getRos, lidarDetected, lidarActive, slamActive,
  robotIp, credentials, recordingActive, playbackActive,
}: MapViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<LaserScan | null>(null);
  const mapRef = useRef<OccupancyGrid | null>(null);
  const mapImageRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Camera state for pan/zoom
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const autoTrackRef = useRef(true);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Phase 1: Robot pose tracking
  const poseRef = usePose(getRos, status === "connected");

  // Phase 2: Odometry trail
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastTrailPointRef = useRef<{ x: number; y: number } | null>(null);

  // Phase 3: Map save/load state
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([]);
  const [showMaps, setShowMaps] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Phase 4: Rosbag state
  const [savedBags, setSavedBags] = useState<SavedBag[]>([]);
  const [showBags, setShowBags] = useState(false);
  const [localRecording, setLocalRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [recordingElapsed, setRecordingElapsed] = useState("");

  const connected = status === "connected";
  const isRecording = recordingActive || localRecording;
  const isPlaying = playbackActive ?? false;

  // Helper for API calls with credentials
  const credParams = useCallback(() => {
    const params = new URLSearchParams();
    if (robotIp) params.set("ip", robotIp);
    if (credentials?.username) params.set("username", credentials.username);
    if (credentials?.password) params.set("password", credentials.password);
    return params.toString();
  }, [robotIp, credentials]);

  const credBody = useCallback((data: Record<string, unknown>) => ({
    ...data,
    ip: robotIp,
    username: credentials?.username,
    password: credentials?.password,
  }), [robotIp, credentials]);

  // Subscribe to /scan via useTopic (small, fast messages)
  const scanMessage = useTopic("/scan", "sensor_msgs/LaserScan", getRos, connected);

  useEffect(() => {
    if (scanMessage) scanRef.current = scanMessage as unknown as LaserScan;
  }, [scanMessage]);

  // Rebuild offscreen canvas when a new /map message arrives
  const rebuildMapImage = useCallback((grid: OccupancyGrid) => {
    mapRef.current = grid;
    const { width, height } = grid.info;
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return;

    let offscreen = mapImageRef.current;
    if (!offscreen || offscreen.width !== width || offscreen.height !== height) {
      offscreen = document.createElement("canvas");
      offscreen.width = width;
      offscreen.height = height;
      mapImageRef.current = offscreen;
    }

    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    for (let i = 0; i < grid.data.length; i++) {
      const val = grid.data[i];
      const col = i % width;
      const row = height - 1 - Math.floor(i / width);
      const pi = (row * width + col) * 4;

      if (val === -1) {
        pixels[pi] = UNKNOWN_COLOR[0];
        pixels[pi + 1] = UNKNOWN_COLOR[1];
        pixels[pi + 2] = UNKNOWN_COLOR[2];
        pixels[pi + 3] = UNKNOWN_COLOR[3];
      } else if (val === 0) {
        pixels[pi] = FREE_COLOR[0];
        pixels[pi + 1] = FREE_COLOR[1];
        pixels[pi + 2] = FREE_COLOR[2];
        pixels[pi + 3] = FREE_COLOR[3];
      } else {
        const t = val / 100;
        pixels[pi] = Math.round(255 - t * (255 - OCCUPIED_COLOR[0]));
        pixels[pi + 1] = Math.round(255 - t * (255 - OCCUPIED_COLOR[1]));
        pixels[pi + 2] = Math.round(255 - t * (255 - OCCUPIED_COLOR[2]));
        pixels[pi + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Subscribe to /map via ref-based hook (large messages, no re-renders)
  useTopicRef<OccupancyGrid>("/map", "nav_msgs/OccupancyGrid", getRos, connected, rebuildMapImage);

  // Clear map data on disconnect
  useEffect(() => {
    if (!connected) {
      mapRef.current = null;
      mapImageRef.current = null;
    }
  }, [connected]);

  // Clear trail on disconnect
  useEffect(() => {
    if (!connected) {
      trailRef.current = [];
      lastTrailPointRef.current = null;
    }
  }, [connected]);

  // Recording elapsed timer
  useEffect(() => {
    if (!recordingStart) {
      setRecordingElapsed("");
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      setRecordingElapsed(`${m}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [recordingStart]);

  // Mouse/touch handlers for pan and zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomRef.current = Math.max(0.2, Math.min(20, zoomRef.current * factor));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    panRef.current = {
      x: dragRef.current.panX + dx,
      y: dragRef.current.panY + dy,
    };
    autoTrackRef.current = false;
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleDoubleClick = useCallback(() => {
    autoTrackRef.current = true;
    panRef.current = { x: 0, y: 0 };
    zoomRef.current = 1;
  }, []);

  // Phase 3: Map operations
  const fetchMaps = useCallback(async () => {
    if (!robotIp) return;
    try {
      const res = await fetch(`/api/robot/maps?${credParams()}`);
      const data = await res.json();
      if (data.success) setSavedMaps(data.maps || []);
    } catch { /* ignore */ }
  }, [robotIp, credParams]);

  const saveMap = useCallback(async (name?: string) => {
    if (!robotIp) return;
    setSaveStatus("Saving...");
    try {
      const res = await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "save", name })),
      });
      const data = await res.json();
      setSaveStatus(data.success ? `Saved: ${data.name}` : data.message);
      if (data.success) fetchMaps();
    } catch (err) {
      setSaveStatus((err as Error).message);
    }
    setTimeout(() => setSaveStatus(null), 3000);
  }, [robotIp, credBody, fetchMaps]);

  const deleteMap = useCallback(async (name: string) => {
    if (!robotIp) return;
    try {
      await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "delete_map", name })),
      });
      fetchMaps();
    } catch { /* ignore */ }
  }, [robotIp, credBody, fetchMaps]);

  // Phase 4: Rosbag operations
  const fetchBags = useCallback(async () => {
    if (!robotIp) return;
    try {
      const res = await fetch(`/api/robot/maps?${credParams()}&type=bags`);
      const data = await res.json();
      if (data.success) setSavedBags(data.bags || []);
    } catch { /* ignore */ }
  }, [robotIp, credParams]);

  const startRecording = useCallback(async () => {
    if (!robotIp) return;
    try {
      const res = await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "start_recording" })),
      });
      const data = await res.json();
      if (data.success) {
        setLocalRecording(true);
        setRecordingStart(Date.now());
      }
    } catch { /* ignore */ }
  }, [robotIp, credBody]);

  const stopRecording = useCallback(async () => {
    if (!robotIp) return;
    try {
      await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "stop_recording" })),
      });
      setLocalRecording(false);
      setRecordingStart(null);
      fetchBags();
    } catch { /* ignore */ }
  }, [robotIp, credBody, fetchBags]);

  const playBag = useCallback(async (name: string) => {
    if (!robotIp) return;
    try {
      await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "play_bag", name })),
      });
    } catch { /* ignore */ }
  }, [robotIp, credBody]);

  const stopPlayback = useCallback(async () => {
    if (!robotIp) return;
    try {
      await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "stop_playback" })),
      });
    } catch { /* ignore */ }
  }, [robotIp, credBody]);

  const deleteBag = useCallback(async (name: string) => {
    if (!robotIp) return;
    try {
      await fetch("/api/robot/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action: "delete_bag", name })),
      });
      fetchBags();
    } catch { /* ignore */ }
  }, [robotIp, credBody, fetchBags]);

  // Helper: convert world coords to screen coords (used in draw loop)
  // Defined inside draw so it captures the current transform state

  // Animation loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const centerX = w / 2;
    const centerY = h / 2;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const map = mapRef.current;
    const mapImage = mapImageRef.current;
    const pose = poseRef.current;

    if (map && mapImage) {
      const { resolution, width: mw, height: mh, origin } = map.info;

      // Pixels per meter on screen
      const baseScale = Math.min(w, h) / (Math.max(mw, mh) * resolution * 1.2);
      const zoom = zoomRef.current;
      const scale = baseScale * zoom;
      const pxPerCell = resolution * scale;

      // Robot position in map pixel coords (using live pose)
      const robotMapCol = (pose.x - origin.position.x) / resolution;
      const robotMapRow = mh - (pose.y - origin.position.y) / resolution;

      // Screen position of robot
      let robotScreenX: number;
      let robotScreenY: number;

      if (autoTrackRef.current) {
        robotScreenX = centerX;
        robotScreenY = centerY;
      } else {
        robotScreenX = centerX + panRef.current.x;
        robotScreenY = centerY + panRef.current.y;
      }

      // Map image origin on screen
      const mapScreenX = robotScreenX - robotMapCol * pxPerCell;
      const mapScreenY = robotScreenY - robotMapRow * pxPerCell;

      // World-to-screen conversion helper
      const worldToScreen = (wx: number, wy: number) => {
        const col = (wx - origin.position.x) / resolution;
        const row = mh - (wy - origin.position.y) / resolution;
        return {
          sx: mapScreenX + col * pxPerCell,
          sy: mapScreenY + row * pxPerCell,
        };
      };

      // Draw grid lines (1m spacing)
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = -50; gx <= 50; gx++) {
        const screenX = robotScreenX + (gx - pose.x) * scale;
        if (screenX >= 0 && screenX <= w) {
          ctx.moveTo(screenX, 0);
          ctx.lineTo(screenX, h);
        }
      }
      for (let gy = -50; gy <= 50; gy++) {
        const screenY = robotScreenY + (gy - pose.y) * scale;
        if (screenY >= 0 && screenY <= h) {
          ctx.moveTo(0, screenY);
          ctx.lineTo(w, screenY);
        }
      }
      ctx.stroke();

      // Draw map image
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        mapImage,
        mapScreenX,
        mapScreenY,
        mw * pxPerCell,
        mh * pxPerCell
      );

      // Phase 2: Update and draw odometry trail
      const trail = trailRef.current;
      const last = lastTrailPointRef.current;
      if (!last || Math.hypot(pose.x - last.x, pose.y - last.y) >= 0.03) {
        if (trail.length >= 5000) trail.shift();
        trail.push({ x: pose.x, y: pose.y });
        lastTrailPointRef.current = { x: pose.x, y: pose.y };
      }

      if (trail.length > 1) {
        ctx.strokeStyle = TRAIL_COLOR;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        const p0 = worldToScreen(trail[0].x, trail[0].y);
        ctx.moveTo(p0.sx, p0.sy);
        for (let i = 1; i < trail.length; i++) {
          const p = worldToScreen(trail[i].x, trail[i].y);
          ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }

      // Overlay live scan points (rotated by robot heading)
      const scan = scanRef.current;
      if (scan) {
        ctx.fillStyle = SCAN_COLOR;
        const { angle_min, angle_increment, ranges, range_min, range_max } = scan;
        const theta = pose.theta;
        for (let i = 0; i < ranges.length; i++) {
          const range = ranges[i];
          if (range < range_min || range > range_max) continue;
          const angle = angle_min + angle_increment * i + theta;
          // In ROS, x is forward. On screen, we need to map:
          // world x (forward) -> screen up (-y), world y (left) -> screen left (-x)
          const wx = pose.x + Math.cos(angle) * range;
          const wy = pose.y + Math.sin(angle) * range;
          const sp = worldToScreen(wx, wy);
          ctx.beginPath();
          ctx.arc(sp.sx, sp.sy, 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Robot marker — arrow pointing in heading direction
      ctx.save();
      ctx.translate(robotScreenX, robotScreenY);
      // Convert ROS heading to screen angle: ROS theta=0 is +x (right),
      // but in map pixel space Y is flipped, so screen angle = -theta
      ctx.rotate(-pose.theta - Math.PI / 2);
      ctx.fillStyle = ROBOT_COLOR;
      ctx.strokeStyle = ROBOT_COLOR;
      ctx.lineWidth = 2;
      const arrowLen = 16;
      const arrowWidth = 8;
      ctx.beginPath();
      ctx.moveTo(arrowLen, 0);
      ctx.lineTo(-arrowWidth, -arrowWidth);
      ctx.lineTo(-arrowWidth * 0.3, 0);
      ctx.lineTo(-arrowWidth, arrowWidth);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Phase 4: Playback indicator
      if (isPlaying) {
        ctx.save();
        ctx.fillStyle = "rgba(218, 165, 32, 0.8)";
        ctx.font = "bold 14px monospace";
        ctx.fillText("▶ PLAYBACK", 10, h - 10);
        ctx.restore();
      }
    } else {
      // No map yet — draw scan-only view
      const scale = Math.min(w, h) / 12;

      // Grid
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = centerX % scale; x < w; x += scale) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = centerY % scale; y < h; y += scale) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Distance circles
      ctx.strokeStyle = "rgba(180, 150, 80, 0.25)";
      for (let r = 1; r <= 6; r++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r * scale, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Labels
      ctx.fillStyle = "rgba(90, 74, 56, 0.5)";
      ctx.font = "10px monospace";
      for (let r = 1; r <= 6; r++) {
        ctx.fillText(`${r}m`, centerX + r * scale + 3, centerY - 3);
      }

      // Robot marker
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-pose.theta - Math.PI / 2);
      ctx.fillStyle = ROBOT_COLOR;
      ctx.strokeStyle = ROBOT_COLOR;
      ctx.lineWidth = 2;
      const arrowLen2 = 14;
      const arrowWidth2 = 7;
      ctx.beginPath();
      ctx.moveTo(arrowLen2, 0);
      ctx.lineTo(-arrowWidth2, -arrowWidth2);
      ctx.lineTo(-arrowWidth2 * 0.3, 0);
      ctx.lineTo(-arrowWidth2, arrowWidth2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Scan points (rotated by heading)
      const scan = scanRef.current;
      if (scan) {
        ctx.fillStyle = SCAN_COLOR;
        const { angle_min, angle_increment, ranges, range_min, range_max } = scan;
        const theta = pose.theta;
        for (let i = 0; i < ranges.length; i++) {
          const range = ranges[i];
          if (range < range_min || range > range_max) continue;
          const angle = angle_min + angle_increment * i + theta;
          const x = centerX + Math.sin(angle) * range * scale;
          const y = centerY - Math.cos(angle) * range * scale;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [poseRef, isPlaying]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  const clearTrail = useCallback(() => {
    trailRef.current = [];
    lastTrailPointRef.current = null;
  }, []);

  return (
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm h-full flex flex-col">
      <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span>SLAM MAP</span>
          {isRecording && (
            <span className="flex items-center gap-1 text-accent-red animate-pulse normal-case tracking-normal">
              <span className="inline-block w-2 h-2 rounded-full bg-accent-red" />
              REC {recordingElapsed}
            </span>
          )}
        </div>
        <button
          onClick={clearTrail}
          className="text-panel-header-text/60 hover:text-panel-header-text text-xs normal-case tracking-normal transition-colors"
          title="Clear trail"
        >
          Clear Trail
        </button>
      </div>

      {/* Toolbar */}
      {connected && robotIp && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-panel-border bg-panel text-xs">
          {/* Map save */}
          <button
            onClick={() => saveMap()}
            disabled={!slamActive}
            className="rounded px-2 py-1 bg-input-bg border border-panel-border hover:bg-panel-border text-text-label disabled:opacity-40 transition-colors"
            title={slamActive ? "Save current map" : "Start SLAM first"}
          >
            Save Map
          </button>

          {/* Saved maps dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowMaps(!showMaps); if (!showMaps) fetchMaps(); }}
              className="rounded px-2 py-1 bg-input-bg border border-panel-border hover:bg-panel-border text-text-label transition-colors"
            >
              Maps {savedMaps.length > 0 && `(${savedMaps.length})`}
            </button>
            {showMaps && (
              <div className="absolute top-full left-0 mt-1 bg-panel border border-panel-border rounded shadow-lg z-10 min-w-[200px] max-h-48 overflow-y-auto">
                {savedMaps.length === 0 ? (
                  <div className="px-3 py-2 text-text-dim">No saved maps</div>
                ) : (
                  savedMaps.map((m) => (
                    <div key={m.name} className="flex items-center justify-between px-3 py-1.5 hover:bg-input-bg">
                      <span className="text-text-label truncate">{m.name}</span>
                      <button
                        onClick={() => deleteMap(m.name)}
                        className="text-accent-red/60 hover:text-accent-red ml-2 shrink-0"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-panel-border mx-1" />

          {/* Recording toggle */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`rounded px-2 py-1 border transition-colors ${
              isRecording
                ? "bg-accent-red/20 border-accent-red/50 text-accent-red"
                : "bg-input-bg border-panel-border hover:bg-panel-border text-text-label"
            }`}
          >
            {isRecording ? "⏹ Stop Rec" : "⏺ Record"}
          </button>

          {/* Bags dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowBags(!showBags); if (!showBags) fetchBags(); }}
              className="rounded px-2 py-1 bg-input-bg border border-panel-border hover:bg-panel-border text-text-label transition-colors"
            >
              Bags {savedBags.length > 0 && `(${savedBags.length})`}
            </button>
            {showBags && (
              <div className="absolute top-full left-0 mt-1 bg-panel border border-panel-border rounded shadow-lg z-10 min-w-[240px] max-h-48 overflow-y-auto">
                {savedBags.length === 0 ? (
                  <div className="px-3 py-2 text-text-dim">No recorded bags</div>
                ) : (
                  savedBags.map((b) => (
                    <div key={b.name} className="flex items-center justify-between px-3 py-1.5 hover:bg-input-bg gap-2">
                      <span className="text-text-label truncate flex-1">{b.name}</span>
                      <span className="text-text-dim shrink-0">{b.size}</span>
                      <button
                        onClick={() => playBag(b.name)}
                        className="text-accent-green hover:text-accent-green/80 shrink-0"
                        title="Play"
                      >
                        ▶
                      </button>
                      <button
                        onClick={() => deleteBag(b.name)}
                        className="text-accent-red/60 hover:text-accent-red shrink-0"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {isPlaying && (
            <button
              onClick={stopPlayback}
              className="rounded px-2 py-1 bg-accent-amber/20 border border-accent-amber/50 text-accent-amber transition-colors"
            >
              ⏹ Stop Play
            </button>
          )}

          {/* Save status toast */}
          {saveStatus && (
            <span className="ml-auto text-text-dim">{saveStatus}</span>
          )}
        </div>
      )}

      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="w-full aspect-video"
          style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        />
        {(() => {
          if (!connected) {
            return (
              <div className="absolute inset-0 flex items-center justify-center bg-input-bg/80">
                <span className="text-text-dim uppercase tracking-wider">NO SIGNAL</span>
              </div>
            );
          }
          if (!lidarDetected) {
            return (
              <div className="absolute inset-0 flex items-center justify-center bg-input-bg/80">
                <span className="text-text-dim uppercase tracking-wider">NO LIDAR DETECTED</span>
              </div>
            );
          }
          if (!lidarActive) {
            return (
              <div className="absolute inset-0 flex items-center justify-center bg-input-bg/80">
                <span className="text-accent-amber uppercase tracking-wider">LIDAR OFF &mdash; FLIP HARDWARE SWITCH</span>
              </div>
            );
          }
          if (lidarActive && !slamActive) {
            return (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-accent-amber/70 uppercase tracking-wider text-sm">MAPPING...</span>
              </div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}
