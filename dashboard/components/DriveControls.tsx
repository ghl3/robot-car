"use client";

import { useState, useCallback, useRef } from "react";
import { useKeyboardControls } from "@/hooks/useKeyboardControls";
import type { RosStatus, PublishFn } from "@/hooks/useRobot";

interface DPadButtonProps {
  label: string;
  onStart: () => void;
  onStop: () => void;
  className?: string;
}

function DPadButton({ label, onStart, onStop, className = "" }: DPadButtonProps) {
  return (
    <button
      onMouseDown={onStart}
      onMouseUp={onStop}
      onMouseLeave={onStop}
      onTouchStart={(e) => { e.preventDefault(); onStart(); }}
      onTouchEnd={(e) => { e.preventDefault(); onStop(); }}
      className={`flex items-center justify-center w-12 h-12 rounded bg-panel border-2 border-panel-border text-text-label font-mono text-xs font-bold select-none hover:bg-input-bg hover:border-accent-gold active:bg-input-bg active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] transition-colors ${className}`}
    >
      {label}
    </button>
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
  const pressedRef = useRef(new Set<string>());
  const connected = status === "connected";

  useKeyboardControls(publish, status, speed, turnRate, turnSpeed);

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
      if (pressedRef.current.size === 0) {
        stop();
      } else {
        startDirection(dir);
        pressedRef.current.delete(dir);
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
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      <div className="px-4 py-2 flex items-center gap-6">
        {/* D-Pad */}
        <div className="grid grid-cols-3 gap-0.5 shrink-0">
          <div />
          <DPadButton
            label="FWD"
            onStart={() => startDirection("forward")}
            onStop={() => stopDirection("forward")}
          />
          <div />
          <DPadButton
            label="LEFT"
            onStart={() => startDirection("left")}
            onStop={() => stopDirection("left")}
          />
          <DPadButton
            label="REV"
            onStart={() => startDirection("backward")}
            onStop={() => stopDirection("backward")}
          />
          <DPadButton
            label="RIGHT"
            onStart={() => startDirection("right")}
            onStop={() => stopDirection("right")}
          />
        </div>

        {/* Emergency Stop */}
        <button
          onClick={stop}
          className="shrink-0 px-6 py-5 rounded bg-accent-red hover:bg-accent-red-bright text-white font-bold text-sm transition-colors shadow-md active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
        >
          E-STOP
        </button>

        {/* Sliders */}
        <div className="flex-1 flex flex-col gap-1.5 text-sm min-w-0">
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

        {/* Keyboard hint */}
        {connected && (
          <span className="text-xs text-text-dim shrink-0 hidden md:block">WASD / Arrows</span>
        )}
        {!connected && (
          <span className="text-xs text-text-dim shrink-0">Not connected</span>
        )}
      </div>
    </div>
  );
}
