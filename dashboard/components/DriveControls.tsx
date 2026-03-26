"use client";

import { useState, useCallback, useRef } from "react";
import { useKeyboardControls } from "@/hooks/useKeyboardControls";
import type { RosStatus, PublishFn } from "@/hooks/useRobot";

interface DPadButtonProps {
  label: string;
  onStart: () => void;
  onStop: () => void;
  active?: boolean;
  className?: string;
}

function DPadButton({ label, onStart, onStop, active = false, className = "" }: DPadButtonProps) {
  const pressedRef = useRef(false);
  return (
    <button
      onMouseDown={() => { pressedRef.current = true; onStart(); }}
      onMouseUp={() => { if (pressedRef.current) { pressedRef.current = false; onStop(); } }}
      onMouseLeave={() => { if (pressedRef.current) { pressedRef.current = false; onStop(); } }}
      onTouchStart={(e) => { e.preventDefault(); pressedRef.current = true; onStart(); }}
      onTouchEnd={(e) => { e.preventDefault(); if (pressedRef.current) { pressedRef.current = false; onStop(); } }}
      className={`flex items-center justify-center w-14 h-14 rounded border-2 font-mono text-xs font-bold select-none transition-colors ${
        active
          ? "bg-accent-gold text-white border-accent-gold-dim"
          : "bg-panel border-panel-border text-text-label hover:bg-input-bg hover:border-accent-gold active:bg-input-bg active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
      } ${className}`}
    >
      {label}
    </button>
  );
}

function KeyCap({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={`flex items-center justify-center w-7 h-7 rounded text-[10px] font-mono font-bold border transition-colors ${
        active
          ? "bg-accent-gold text-white border-accent-gold-dim"
          : "bg-input-bg text-text-dim border-panel-border"
      }`}
    >
      {label}
    </div>
  );
}

interface DriveControlsProps {
  publish: PublishFn;
  status: RosStatus;
}

export default function DriveControls({ publish, status }: DriveControlsProps) {
  const [speed, setSpeed] = useState(0.5);
  const [turnRate, setTurnRate] = useState(0.6);
  const [turnSpeed, setTurnSpeed] = useState(0.35);
  const [dpadActive, setDpadActive] = useState<Set<string>>(new Set());
  const pressedRef = useRef(new Set<string>());
  const connected = status === "connected";

  const { activeKeys } = useKeyboardControls(publish, status, speed, turnRate, turnSpeed);

  const isActive = (dir: string) => activeKeys.has(dir) || dpadActive.has(dir);

  const sendCmd = useCallback(
    (linearX: number, steeringAngle: number) => {
      if (!connected) return;
      publish("/cmd_vel", "geometry_msgs/Twist", {
        linear: { x: linearX, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: steeringAngle },
      });
    },
    [publish, connected]
  );

  const stop = useCallback(() => sendCmd(0, 0), [sendCmd]);

  const startDirection = useCallback(
    (dir: string) => {
      pressedRef.current.add(dir);
      setDpadActive(new Set(pressedRef.current));
      const p = pressedRef.current;
      let lx = 0, sa = 0;
      if (p.has("forward")) lx = speed;
      else if (p.has("backward")) lx = -speed;
      if (p.has("left")) { sa = turnRate; if (lx === 0) lx = turnSpeed; }
      else if (p.has("right")) { sa = -turnRate; if (lx === 0) lx = turnSpeed; }
      sendCmd(lx, sa);
    },
    [speed, turnRate, turnSpeed, sendCmd]
  );

  const stopDirection = useCallback(
    (dir: string) => {
      pressedRef.current.delete(dir);
      setDpadActive(new Set(pressedRef.current));
      if (pressedRef.current.size === 0) {
        stop();
      } else {
        const p = pressedRef.current;
        let lx = 0, sa = 0;
        if (p.has("forward")) lx = speed;
        else if (p.has("backward")) lx = -speed;
        if (p.has("left")) { sa = turnRate; if (lx === 0) lx = turnSpeed; }
        else if (p.has("right")) { sa = -turnRate; if (lx === 0) lx = turnSpeed; }
        sendCmd(lx, sa);
      }
    },
    [speed, turnRate, turnSpeed, sendCmd, stop]
  );

  return (
    <div className={`bg-panel border border-panel-border rounded overflow-hidden shadow-sm ${!connected ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="bg-panel-header px-3 py-1">
        <span className="text-panel-header-text text-xs font-bold tracking-wider">DRIVE CONTROLS</span>
      </div>
      <div className="px-4 py-2 flex items-center justify-center gap-8">
        {/* D-Pad */}
        <div className="grid grid-cols-3 gap-0.5 shrink-0">
          <div />
          <DPadButton
            label="FWD"
            active={isActive("forward")}
            onStart={() => startDirection("forward")}
            onStop={() => stopDirection("forward")}
          />
          <div />
          <DPadButton
            label="LEFT"
            active={isActive("left")}
            onStart={() => startDirection("left")}
            onStop={() => stopDirection("left")}
          />
          <DPadButton
            label="REV"
            active={isActive("backward")}
            onStart={() => startDirection("backward")}
            onStop={() => stopDirection("backward")}
          />
          <DPadButton
            label="RIGHT"
            active={isActive("right")}
            onStart={() => startDirection("right")}
            onStop={() => stopDirection("right")}
          />
        </div>

        {/* WASD Indicator */}
        <div className="shrink-0 flex flex-col items-center gap-0.5">
          <KeyCap label="W" active={isActive("forward")} />
          <div className="flex gap-0.5">
            <KeyCap label="A" active={isActive("left")} />
            <KeyCap label="S" active={isActive("backward")} />
            <KeyCap label="D" active={isActive("right")} />
          </div>
        </div>

        {/* Emergency Stop */}
        <button
          onClick={stop}
          className="shrink-0 px-6 py-5 rounded bg-accent-red hover:bg-accent-red-bright text-white font-bold text-sm transition-colors shadow-md active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
        >
          E-STOP
        </button>

        {/* Sliders */}
        <div className="w-56 flex flex-col gap-1.5 text-sm">
          <label className="flex items-center gap-3 text-text-label">
            <span className="w-16 text-xs shrink-0">Speed</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="flex-1 min-w-0"
            />
            <span className="w-10 text-right text-foreground text-xs font-mono">{speed.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-3 text-text-label">
            <span className="w-16 text-xs shrink-0">Steering</span>
            <input
              type="range"
              min="0.1"
              max="0.6"
              step="0.05"
              value={turnRate}
              onChange={(e) => setTurnRate(parseFloat(e.target.value))}
              className="flex-1 min-w-0"
            />
            <span className="w-10 text-right text-foreground text-xs font-mono">{turnRate.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-3 text-text-label">
            <span className="w-16 text-xs shrink-0">Turn drive</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={turnSpeed}
              onChange={(e) => setTurnSpeed(parseFloat(e.target.value))}
              className="flex-1 min-w-0"
            />
            <span className="w-10 text-right text-foreground text-xs font-mono">{turnSpeed.toFixed(2)}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
