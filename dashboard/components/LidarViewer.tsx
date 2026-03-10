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

// Warm cream background matching the panel
const BG_COLOR = "#ece7e0";
// Gold/brass grid and circles like dial markings
const GRID_COLOR = "rgba(180, 150, 80, 0.15)";
const CIRCLE_COLOR = "rgba(180, 150, 80, 0.25)";
// Points in warm red — like indicator lights
const POINT_COLOR = "#c43020";
const LABEL_COLOR = "rgba(90, 74, 56, 0.5)";

interface LidarViewerProps {
  status: RosStatus;
  getRos: () => Ros | null;
}

export default function LidarViewer({ status, getRos }: LidarViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<LaserScan | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const connected = status === "connected";

  const message = useTopic("/scan", "sensor_msgs/LaserScan", getRos, connected);

  useEffect(() => {
    if (message) scanRef.current = message as unknown as LaserScan;
  }, [message]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Resize canvas to match display size
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const w = rect.width;
    const h = rect.height;
    const centerX = w / 2;
    const centerY = h / 2;
    const scale = Math.min(w, h) / 12; // ~6 meters visible in each direction

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

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

    // Distance circles — like dial rings
    ctx.strokeStyle = CIRCLE_COLOR;
    ctx.lineWidth = 1;
    for (let r = 1; r <= 6; r++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r * scale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Label circles
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = "10px monospace";
    for (let r = 1; r <= 6; r++) {
      ctx.fillText(`${r}m`, centerX + r * scale + 3, centerY - 3);
    }

    // Robot position marker — brass dot
    ctx.fillStyle = "#b8952a";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
    ctx.fill();

    // LIDAR points
    const scan = scanRef.current;
    if (scan) {
      ctx.fillStyle = POINT_COLOR;
      const { angle_min, angle_increment, ranges, range_min, range_max } = scan;

      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        if (range < range_min || range > range_max) continue;

        const angle = angle_min + angle_increment * i;
        const x = centerX + Math.cos(angle) * range * scale;
        const y = centerY + Math.sin(angle) * range * scale;

        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
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
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2">
        LIDAR SCANNER
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full aspect-square"
          style={{ display: "block" }}
        />
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center bg-input-bg/80">
            <span className="text-text-dim uppercase tracking-wider">NO SIGNAL</span>
          </div>
        )}
      </div>
    </div>
  );
}
