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
      className={`flex items-center justify-center w-14 h-14 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-sm font-bold select-none active:bg-zinc-600 hover:bg-zinc-700 transition-colors ${className}`}
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
    (linearX: number, angularZ: number) => {
      if (!connected) return;
      publish("/cmd_vel", "geometry_msgs/Twist", {
        linear: { x: linearX, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: angularZ },
      });
    },
    [publish, connected]
  );

  const stop = useCallback(() => sendCmd(0, 0), [sendCmd]);

  const startDirection = useCallback(
    (dir: string) => {
      pressedRef.current.add(dir);
      const p = pressedRef.current;
      let lx = 0, az = 0;
      if (p.has("forward")) lx = speed;
      else if (p.has("backward")) lx = -speed;
      if (p.has("left")) { az = turnRate; if (lx === 0) lx = turnSpeed; }
      else if (p.has("right")) { az = -turnRate; if (lx === 0) lx = turnSpeed; }
      sendCmd(lx, az);
    },
    [speed, turnRate, turnSpeed, sendCmd]
  );

  const stopDirection = useCallback(
    (dir: string) => {
      pressedRef.current.delete(dir);
      if (pressedRef.current.size === 0) {
        stop();
      } else {
        startDirection(dir); // recalculate from remaining keys
        pressedRef.current.delete(dir); // undo the add from startDirection
        // Recalculate
        const p = pressedRef.current;
        let lx = 0, az = 0;
        if (p.has("forward")) lx = speed;
        else if (p.has("backward")) lx = -speed;
        if (p.has("left")) { az = turnRate; if (lx === 0) lx = turnSpeed; }
        else if (p.has("right")) { az = -turnRate; if (lx === 0) lx = turnSpeed; }
        sendCmd(lx, az);
      }
    },
    [speed, turnRate, turnSpeed, sendCmd, stop]
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">Drive Controls</h3>
        {connected && (
          <span className="text-xs text-zinc-500">WASD / Arrow keys active</span>
        )}
      </div>

      {/* D-Pad */}
      <div className="flex justify-center">
        <div className="grid grid-cols-3 gap-1 w-fit">
          <div />
          <DPadButton
            label="W"
            onStart={() => startDirection("forward")}
            onStop={() => stopDirection("forward")}
          />
          <div />
          <DPadButton
            label="A"
            onStart={() => startDirection("left")}
            onStop={() => stopDirection("left")}
          />
          <DPadButton
            label="S"
            onStart={() => startDirection("backward")}
            onStop={() => stopDirection("backward")}
          />
          <DPadButton
            label="D"
            onStart={() => startDirection("right")}
            onStop={() => stopDirection("right")}
          />
        </div>
      </div>

      {/* Emergency Stop */}
      <button
        onClick={stop}
        className="w-full py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white font-bold text-sm transition-colors"
      >
        EMERGENCY STOP
      </button>

      {/* Speed Sliders */}
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center justify-between gap-3 text-zinc-400">
          <span>Speed</span>
          <div className="flex items-center gap-2 flex-1">
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right text-zinc-300">{speed.toFixed(2)}</span>
          </div>
        </label>
        <label className="flex items-center justify-between gap-3 text-zinc-400">
          <span>Turn rate</span>
          <div className="flex items-center gap-2 flex-1">
            <input
              type="range"
              min="0.1"
              max="1.5"
              step="0.05"
              value={turnRate}
              onChange={(e) => setTurnRate(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right text-zinc-300">{turnRate.toFixed(2)}</span>
          </div>
        </label>
        <label className="flex items-center justify-between gap-3 text-zinc-400">
          <span>Turn speed</span>
          <div className="flex items-center gap-2 flex-1">
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={turnSpeed}
              onChange={(e) => setTurnSpeed(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right text-zinc-300">{turnSpeed.toFixed(2)}</span>
          </div>
        </label>
      </div>

      {!connected && (
        <p className="text-xs text-zinc-600 text-center">Connect to robot to enable controls</p>
      )}
    </div>
  );
}
