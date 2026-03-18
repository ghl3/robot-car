"use client";

import { useRef, useEffect, useCallback } from "react";
import { useTopic } from "@/hooks/useTopic";
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
const GRID_COLOR = "rgba(180, 150, 80, 0.12)";

interface MapViewerProps {
  status: RosStatus;
  getRos: () => Ros | null;
  lidarDetected?: boolean;
  lidarActive?: boolean;
  slamActive?: boolean;
}

export default function MapViewer({ status, getRos, lidarDetected, lidarActive, slamActive }: MapViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<LaserScan | null>(null);
  const mapRef = useRef<OccupancyGrid | null>(null);
  const mapImageRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mapListenerRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Camera state for pan/zoom
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const autoTrackRef = useRef(true);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const connected = status === "connected";

  // Subscribe to /scan via useTopic (small, fast messages)
  const scanMessage = useTopic("/scan", "sensor_msgs/LaserScan", getRos, connected);

  useEffect(() => {
    if (scanMessage) scanRef.current = scanMessage as unknown as LaserScan;
  }, [scanMessage]);

  // Subscribe to /map manually (large messages, write to ref to avoid re-renders)
  useEffect(() => {
    if (!connected) {
      mapRef.current = null;
      mapImageRef.current = null;
      return;
    }

    const ros = getRos();
    if (!ros || !ros.isConnected) return;

    let cancelled = false;

    (async () => {
      const roslib = await import("roslib");
      if (cancelled) return;

      const listener = new roslib.Topic({
        ros,
        name: "/map",
        messageType: "nav_msgs/OccupancyGrid",
      });

      mapListenerRef.current = listener;

      listener.subscribe((msg) => {
        if (cancelled) return;
        const grid = msg as unknown as OccupancyGrid;
        mapRef.current = grid;

        // Rebuild map image
        const { width, height, resolution } = grid.info;
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
          // Map row 0 is at the bottom in ROS, so flip Y
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
            // Occupied: interpolate from light to dark red based on value (1-100)
            const t = val / 100;
            pixels[pi] = Math.round(255 - t * (255 - OCCUPIED_COLOR[0]));
            pixels[pi + 1] = Math.round(255 - t * (255 - OCCUPIED_COLOR[1]));
            pixels[pi + 2] = Math.round(255 - t * (255 - OCCUPIED_COLOR[2]));
            pixels[pi + 3] = 255;
          }
        }

        ctx.putImageData(imageData, 0, 0);
      });
    })();

    return () => {
      cancelled = true;
      if (mapListenerRef.current) {
        mapListenerRef.current.unsubscribe();
        mapListenerRef.current = null;
      }
    };
  }, [connected, getRos]);

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

    if (map && mapImage) {
      const { resolution, width: mw, height: mh, origin } = map.info;

      // Pixels per meter on screen
      const baseScale = Math.min(w, h) / (Math.max(mw, mh) * resolution * 1.2);
      const zoom = zoomRef.current;
      const scale = baseScale * zoom;
      const pxPerCell = resolution * scale;

      // Robot position in map: assume robot is at world origin (0, 0)
      // Convert to map pixel coords
      const robotMapCol = (0 - origin.position.x) / resolution;
      const robotMapRow = mh - (0 - origin.position.y) / resolution;

      // Screen position of robot
      let robotScreenX: number;
      let robotScreenY: number;

      if (autoTrackRef.current) {
        // Center the map so robot is at screen center
        robotScreenX = centerX;
        robotScreenY = centerY;
      } else {
        robotScreenX = centerX + panRef.current.x;
        robotScreenY = centerY + panRef.current.y;
      }

      // Map image origin on screen
      const mapScreenX = robotScreenX - robotMapCol * pxPerCell;
      const mapScreenY = robotScreenY - robotMapRow * pxPerCell;

      // Draw grid lines (1m spacing)
      const gridSpacing = scale; // 1 meter = scale pixels
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startWorldX = -Math.ceil((mapScreenX) / gridSpacing);
      const endWorldX = Math.ceil((w - mapScreenX) / gridSpacing);
      for (let gx = startWorldX; gx <= endWorldX; gx++) {
        const sx = mapScreenX + (gx - origin.position.x / resolution * 0) * gridSpacing + ((0 - origin.position.x) % 1) * scale;
        // Simpler: just draw grid at 1m intervals from the origin
        const worldX = gx;
        const screenX = robotScreenX + worldX * scale;
        if (screenX >= 0 && screenX <= w) {
          ctx.moveTo(screenX, 0);
          ctx.lineTo(screenX, h);
        }
      }
      for (let gy = -50; gy <= 50; gy++) {
        const screenY = robotScreenY + gy * scale;
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

      // Overlay live scan points
      const scan = scanRef.current;
      if (scan) {
        ctx.fillStyle = SCAN_COLOR;
        const { angle_min, angle_increment, ranges, range_min, range_max } = scan;
        for (let i = 0; i < ranges.length; i++) {
          const range = ranges[i];
          if (range < range_min || range > range_max) continue;
          const angle = angle_min + angle_increment * i;
          // Rotated so forward (angle 0) = up on screen
          const sx = robotScreenX + Math.sin(angle) * range * scale;
          const sy = robotScreenY + Math.cos(angle) * range * scale;
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Robot marker — arrow pointing up (forward)
      ctx.save();
      ctx.translate(robotScreenX, robotScreenY);
      ctx.rotate(-Math.PI / 2); // arrow points up = car's forward
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
    } else {
      // No map yet — draw scan-only view (like old LidarViewer)
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

      // Robot marker — arrow pointing up (forward)
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-Math.PI / 2);
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

      // Scan points
      const scan = scanRef.current;
      if (scan) {
        ctx.fillStyle = SCAN_COLOR;
        const { angle_min, angle_increment, ranges, range_min, range_max } = scan;
        for (let i = 0; i < ranges.length; i++) {
          const range = ranges[i];
          if (range < range_min || range > range_max) continue;
          const angle = angle_min + angle_increment * i;
          const x = centerX + Math.sin(angle) * range * scale;
          const y = centerY + Math.cos(angle) * range * scale;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  return (
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm h-full flex flex-col">
      <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2">
        SLAM MAP
      </div>
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
