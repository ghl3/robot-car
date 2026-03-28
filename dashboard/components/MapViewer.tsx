"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useTopic } from "@/hooks/useTopic";
import { useTopicRef, type TopicOptions } from "@/hooks/useTopicRef";
import { usePose } from "@/hooks/usePose";
import type { Ros } from "roslib";
import type { RosStatus } from "@/hooks/useRobot";
import TabBar from "./TabBar";

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
const FREE_COLOR = [255, 255, 255, 255] as const;         // white (explored free space)
const OCCUPIED_LOW = [220, 160, 120] as const;            // warm tan (low occupancy)
const OCCUPIED_HIGH = [196, 48, 32] as const;             // dark red (high occupancy)
const UNKNOWN_COLOR = [0, 0, 0, 0] as const;              // transparent (shows background through)
const SCAN_COLOR = "#daa520";                             // gold for live scan
const ROBOT_COLOR = "#b8952a";                            // brass for robot
const GRID_COLOR = "rgba(180, 150, 80, 0.12)";

interface MapViewerProps {
  status: RosStatus;
  getRos: () => Ros | null;
  publish?: (topicName: string, messageType: string, data: Record<string, unknown>) => void;
  lidarDetected?: boolean;
  lidarActive?: boolean;
  slamActive?: boolean;
  navActive?: boolean;
  lastMapSave?: number;
  robotIp?: string;
  credentials?: { username: string; password: string };
  onRestartComponent?: (component: string) => Promise<unknown>;
}

export default function MapViewer({
  status, getRos, publish, lidarDetected, lidarActive, slamActive, navActive, lastMapSave,
  robotIp, credentials, onRestartComponent,
}: MapViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<LaserScan | null>(null);
  const mapRef = useRef<OccupancyGrid | null>(null);
  const mapImageRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const mapStatsRef = useRef({ free: 0, occupied: 0, total: 0 });

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

  // View mode toggle
  const [viewMode, setViewMode] = useState<"lidar" | "slam">("lidar");
  const autoSwitchedRef = useRef(false);
  const [resettingMap, setResettingMap] = useState(false);
  const suppressMapUntilRef = useRef(0);  // epoch ms -- ignore /map messages until this time

  // Navigation goal
  const navGoalRef = useRef<{ x: number; y: number } | null>(null);
  const [navStatus, setNavStatus] = useState<"idle" | "active" | "succeeded" | "aborted">("idle");
  const [contextMenu, setContextMenu] = useState<{ screenX: number; screenY: number; worldX: number; worldY: number } | null>(null);

  // Store transform params from draw loop so right-click can compute world coords
  const transformRef = useRef<{
    mapScreenX: number; mapScreenY: number; pxPerCell: number;
    originX: number; originY: number; resolution: number; mapHeight: number;
  } | null>(null);

  const connected = status === "connected";

  // Subscribe to /scan via useTopic (small, fast messages)
  const scanMessage = useTopic("/scan", "sensor_msgs/LaserScan", getRos, connected);

  useEffect(() => {
    if (scanMessage) scanRef.current = scanMessage as unknown as LaserScan;
  }, [scanMessage]);

  // Subscribe to move_base status for navigation feedback
  const navStatusMsg = useTopic("/move_base/status", "actionlib_msgs/GoalStatusArray", getRos, connected && navActive === true);
  useEffect(() => {
    if (!navStatusMsg || !navGoalRef.current) return;
    const statuses = (navStatusMsg as unknown as { status_list: Array<{ status: number }> }).status_list;
    if (!statuses || statuses.length === 0) return;
    const latest = statuses[statuses.length - 1].status;
    if (latest === 3) { // SUCCEEDED
      setNavStatus("succeeded");
      navGoalRef.current = null;
      setTimeout(() => setNavStatus("idle"), 2000);
    } else if (latest === 4 || latest === 5) { // ABORTED or REJECTED
      setNavStatus("aborted");
      navGoalRef.current = null;
      setTimeout(() => setNavStatus("idle"), 3000);
    }
  }, [navStatusMsg]);

  // Rebuild offscreen canvas when a new /map message arrives
  const rebuildMapImage = useCallback((grid: OccupancyGrid) => {
    // Ignore stale latched /map messages during reset
    if (Date.now() < suppressMapUntilRef.current) return;

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
    let freeCount = 0, occupiedCount = 0;

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
        freeCount++;
        pixels[pi] = FREE_COLOR[0];
        pixels[pi + 1] = FREE_COLOR[1];
        pixels[pi + 2] = FREE_COLOR[2];
        pixels[pi + 3] = FREE_COLOR[3];
      } else {
        occupiedCount++;
        const t = val / 100;
        pixels[pi] = Math.round(OCCUPIED_LOW[0] + t * (OCCUPIED_HIGH[0] - OCCUPIED_LOW[0]));
        pixels[pi + 1] = Math.round(OCCUPIED_LOW[1] + t * (OCCUPIED_HIGH[1] - OCCUPIED_LOW[1]));
        pixels[pi + 2] = Math.round(OCCUPIED_LOW[2] + t * (OCCUPIED_HIGH[2] - OCCUPIED_LOW[2]));
        pixels[pi + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    mapStatsRef.current = { free: freeCount, occupied: occupiedCount, total: grid.data.length };
  }, []);

  // Subscribe to /map with compression + throttle to reduce WiFi bandwidth
  const mapTopicOptions = useRef<TopicOptions>({
    compression: "cbor",     // binary encoding, ~50-90% smaller than JSON
    throttle_rate: 500,      // max 2 updates/sec (server-side)
    queue_length: 1,         // only latest map, drop stale ones
  });
  useTopicRef<OccupancyGrid>("/map", "nav_msgs/OccupancyGrid", getRos, connected, rebuildMapImage, mapTopicOptions.current);

  // Auto-switch to SLAM view when first map data arrives
  useEffect(() => {
    if (mapRef.current && mapImageRef.current && !autoSwitchedRef.current) {
      autoSwitchedRef.current = true;
      setViewMode("slam");
    }
  });

  // Clear map and scan data on disconnect
  useEffect(() => {
    if (!connected) {
      mapRef.current = null;
      mapImageRef.current = null;
      scanRef.current = null;
      autoSwitchedRef.current = false;
    }
  }, [connected]);

  // Clear trail on disconnect
  useEffect(() => {
    if (!connected) {
      trailRef.current = [];
      lastTrailPointRef.current = null;
    }
  }, [connected]);

  // Mouse/touch handlers for pan and zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomRef.current = Math.max(0.2, Math.min(20, zoomRef.current * factor));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setContextMenu(null);
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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (viewMode !== "slam" || !transformRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const t = transformRef.current;
    const col = (sx - t.mapScreenX) / t.pxPerCell;
    const row = (sy - t.mapScreenY) / t.pxPerCell;
    const worldX = col * t.resolution + t.originX;
    const worldY = (t.mapHeight - row) * t.resolution + t.originY;
    setContextMenu({ screenX: e.clientX, screenY: e.clientY, worldX, worldY });
  }, [viewMode]);

  const sendNavGoal = useCallback((worldX: number, worldY: number) => {
    if (!publish) return;
    navGoalRef.current = { x: worldX, y: worldY };
    setNavStatus("active");
    const pose = poseRef.current;
    const dx = worldX - (pose?.x ?? 0);
    const dy = worldY - (pose?.y ?? 0);
    const yaw = Math.atan2(dy, dx);
    publish("/move_base_simple/goal", "geometry_msgs/PoseStamped", {
      header: { frame_id: "map" },
      pose: {
        position: { x: worldX, y: worldY, z: 0 },
        orientation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
      },
    });
    setContextMenu(null);
  }, [publish, poseRef]);

  const cancelNavGoal = useCallback(() => {
    if (!publish) return;
    publish("/move_base/cancel", "actionlib_msgs/GoalID", {});
    navGoalRef.current = null;
    setNavStatus("idle");
  }, [publish]);

  // Reset map: kill SLAM + scan filter + nav, clear local state and saved maps, restart fresh
  const resetMap = useCallback(async () => {
    if (!onRestartComponent) return;
    setResettingMap(true);
    // Suppress stale latched /map messages for 8 seconds while SLAM restarts
    suppressMapUntilRef.current = Date.now() + 8000;
    mapRef.current = null;
    mapImageRef.current = null;
    trailRef.current = [];
    lastTrailPointRef.current = null;
    autoSwitchedRef.current = false;
    navGoalRef.current = null;
    setNavStatus("idle");
    setViewMode("lidar");
    const withTimeout = (p: Promise<unknown>, ms = 10000) =>
      Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
    try {
      await withTimeout(onRestartComponent("nav")).catch(() => {});
      await withTimeout(onRestartComponent("slam"));
      await withTimeout(onRestartComponent("scan_filter"));
    } catch {
      // timeout or error -- still clear the resetting state
    } finally {
      setResettingMap(false);
    }
  }, [onRestartComponent]);

  // Helper: convert world coords to screen coords (used in draw loop)
  // Defined inside draw so it captures the current transform state

  // Animation loop — wrapped in try/catch to prevent requestAnimationFrame chain from breaking
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animFrameRef.current = requestAnimationFrame(draw); return; }

    const ctx = canvas.getContext("2d");
    if (!ctx) { animFrameRef.current = requestAnimationFrame(draw); return; }

   try {
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
    let pose = poseRef.current;

    // If pose looks stale/reset (at origin) but trail has data, use last trail point
    const trail = trailRef.current;
    if (pose.x === 0 && pose.y === 0 && pose.theta === 0 && trail.length > 0) {
      const last = trail[trail.length - 1];
      pose = { x: last.x, y: last.y, theta: pose.theta };
    }

    if (viewMode === "slam" && map && mapImage) {
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

      // Store transform for right-click coordinate conversion
      transformRef.current = {
        mapScreenX, mapScreenY, pxPerCell,
        originX: origin.position.x, originY: origin.position.y,
        resolution, mapHeight: mh,
      };

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
        const screenY = robotScreenY - (gy - pose.y) * scale;
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
        const segCount = Math.min(trail.length - 1, 10);
        const segSize = Math.ceil((trail.length - 1) / segCount);

        ctx.lineWidth = 3.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        for (let s = 0; s < segCount; s++) {
          const startIdx = s * segSize;
          const endIdx = Math.min(startIdx + segSize, trail.length - 1);
          const alpha = 0.2 + 0.65 * ((s + 1) / segCount);
          ctx.strokeStyle = `rgba(180, 90, 20, ${alpha})`;
          ctx.beginPath();
          const p0 = worldToScreen(trail[startIdx].x, trail[startIdx].y);
          ctx.moveTo(p0.sx, p0.sy);
          for (let i = startIdx + 1; i <= endIdx; i++) {
            const p = worldToScreen(trail[i].x, trail[i].y);
            ctx.lineTo(p.sx, p.sy);
          }
          ctx.stroke();
        }
      }

      // Scan dots are NOT drawn in map view — the map is built from LIDAR scans
      // so overlaying them is redundant and visually noisy (they update at different rates).
      // Scan dots are shown in the scan-only view (no map) below.

      // Robot marker — arrow with halo for visibility
      ctx.save();
      ctx.translate(robotScreenX, robotScreenY);
      ctx.rotate(-pose.theta);
      const arrowLen = 20;
      const arrowWidth = 12;
      const drawArrow = () => {
        ctx.beginPath();
        ctx.moveTo(arrowLen, 0);
        ctx.lineTo(-arrowWidth, -arrowWidth);
        ctx.lineTo(-arrowWidth * 0.3, 0);
        ctx.lineTo(-arrowWidth, arrowWidth);
        ctx.closePath();
      };
      // Shadow for depth
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
      // White halo outline for contrast
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 5;
      drawArrow();
      ctx.stroke();
      // Fill and inner stroke
      ctx.shadowColor = "transparent";
      ctx.fillStyle = ROBOT_COLOR;
      ctx.strokeStyle = "rgba(100, 60, 20, 0.8)";
      ctx.lineWidth = 1.5;
      drawArrow();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Navigation goal marker — red crosshair at target
      const goal = navGoalRef.current;
      if (goal) {
        const gp = worldToScreen(goal.x, goal.y);
        ctx.save();
        ctx.strokeStyle = "#e63946";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(gp.sx, gp.sy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gp.sx - 14, gp.sy); ctx.lineTo(gp.sx + 14, gp.sy);
        ctx.moveTo(gp.sx, gp.sy - 14); ctx.lineTo(gp.sx, gp.sy + 14);
        ctx.stroke();
        ctx.restore();
      }

      // Map metadata overlay
      {
        const stats = mapStatsRef.current;
        const known = stats.free + stats.occupied;
        const pct = stats.total > 0 ? Math.round(100 * known / stats.total) : 0;
        const res = map.info.resolution;
        const saveAge = lastMapSave && lastMapSave > 0
          ? `Saved ${Math.round((Date.now() / 1000 - lastMapSave) / 60)}m ago`
          : "Not saved";
        const lines = [
          `${mw}×${mh} @ ${(res * 100).toFixed(0)}cm/cell`,
          `${pct}% explored (${known.toLocaleString()} cells)`,
          saveAge,
        ];
        const lineHeight = 13;
        const padding = 6;
        const boxW = 190;
        const boxH = lines.length * lineHeight + padding * 2;
        const boxX = 8;
        const boxY = h - boxH - 8;
        ctx.save();
        ctx.fillStyle = "rgba(236, 231, 224, 0.85)";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.font = "10px monospace";
        ctx.fillStyle = "rgba(90, 74, 56, 0.8)";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], boxX + padding, boxY + padding + (i + 1) * lineHeight - 2);
        }
        ctx.restore();
      }

      // Scale legend (bottom-right, Google Maps style)
      {
        const pixelsPerMeter = scale;
        // Pick a "nice" distance that fits in 60-150px
        const niceDistances = [0.25, 0.5, 1, 2, 5, 10];
        let scaleDist = 1;
        for (const d of niceDistances) {
          const px = d * pixelsPerMeter;
          if (px >= 40 && px <= 150) { scaleDist = d; break; }
          if (px < 40) scaleDist = d; // keep largest that's too small, next will be too big
        }
        const barPx = scaleDist * pixelsPerMeter;
        const label = scaleDist >= 1 ? `${scaleDist}m` : `${scaleDist * 100}cm`;
        const barX = w - barPx - 16;
        const barY = h - 18;
        ctx.save();
        // Background
        ctx.fillStyle = "rgba(236, 231, 224, 0.85)";
        ctx.fillRect(barX - 6, barY - 14, barPx + 12, 22);
        // Bar
        ctx.strokeStyle = "rgba(90, 74, 56, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barX, barY);
        ctx.lineTo(barX + barPx, barY);
        // End ticks
        ctx.moveTo(barX, barY - 4);
        ctx.lineTo(barX, barY + 1);
        ctx.moveTo(barX + barPx, barY - 4);
        ctx.lineTo(barX + barPx, barY + 1);
        ctx.stroke();
        // Label
        ctx.font = "10px monospace";
        ctx.fillStyle = "rgba(90, 74, 56, 0.8)";
        ctx.textAlign = "center";
        ctx.fillText(label, barX + barPx / 2, barY - 5);
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
      ctx.rotate(-pose.theta);
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

   } catch {
    // Prevent draw loop from dying on transient errors
   }
    animFrameRef.current = requestAnimationFrame(draw);
  }, [poseRef, viewMode]);

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
          <span>MAP</span>
          <TabBar
            tabs={[
              { key: "lidar", label: "LIDAR" },
              { key: "slam", label: "SLAM", disabled: !mapRef.current },
            ]}
            activeKey={viewMode}
            onSelect={(k) => { if (k === "slam" && !mapRef.current) return; setViewMode(k as "lidar" | "slam"); }}
          />
        </div>
      </div>

      {/* Toolbar — SLAM mode only */}
      {connected && viewMode === "slam" && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-panel-border bg-panel text-xs">
          <button
            onClick={clearTrail}
            className="rounded px-2 py-1 bg-input-bg border border-panel-border hover:bg-panel-border text-text-label transition-colors"
          >
            Reset Trail
          </button>
          <button
            onClick={resetMap}
            disabled={resettingMap || !slamActive}
            className="rounded px-2 py-1 border border-accent-red/40 text-accent-red hover:bg-accent-red/10 disabled:opacity-40 transition-colors"
          >
            {resettingMap ? "Resetting..." : "Reset Map"}
          </button>
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
          onContextMenu={handleContextMenu}
        />

        {/* Navigation context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-panel border border-panel-border rounded shadow-lg py-1"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          >
            <button
              onClick={() => sendNavGoal(contextMenu.worldX, contextMenu.worldY)}
              disabled={!navActive}
              className="block w-full text-left px-4 py-1.5 text-xs uppercase tracking-wider hover:bg-accent-red/10 text-foreground disabled:opacity-40"
            >
              Navigate here
            </button>
            <button
              onClick={() => setContextMenu(null)}
              className="block w-full text-left px-4 py-1.5 text-xs uppercase tracking-wider hover:bg-panel-border text-text-dim"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Cancel navigation button */}
        {navStatus === "active" && (
          <button
            onClick={cancelNavGoal}
            className="absolute top-2 right-2 z-10 rounded px-2 py-1 text-xs bg-accent-red text-white hover:bg-accent-red/80 transition-colors"
          >
            Cancel Nav
          </button>
        )}
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
