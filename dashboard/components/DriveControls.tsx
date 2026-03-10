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
      className={`flex items-center justify-center w-16 h-16 rounded bg-panel border-2 border-panel-border text-text-label font-mono text-sm font-bold select-none hover:bg-input-bg hover:border-accent-gold active:bg-input-bg active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] transition-colors ${className}`}
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
        startDirection(dir);
        pressedRef.current.delete(dir);
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
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2 flex items-center justify-between">
        <span>DRIVE CONTROLS</span>
        {connected && (
          <span className="text-panel-header-text/70 normal-case tracking-normal">WASD / Arrow keys</span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* D-Pad */}
        <div className="flex justify-center">
          <div className="grid grid-cols-3 gap-1 w-fit">
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
        </div>

        {/* Emergency Stop */}
        <button
          onClick={stop}
          className="w-full py-3 rounded bg-accent-red hover:bg-accent-red-bright text-white font-bold text-sm transition-colors shadow-md active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
        >
          EMERGENCY STOP
        </button>

        {/* Speed Sliders */}
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center justify-between gap-3 text-text-label">
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
              <span className="w-12 text-right text-foreground">{speed.toFixed(2)}</span>
            </div>
          </label>
          <label className="flex items-center justify-between gap-3 text-text-label">
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
              <span className="w-12 text-right text-foreground">{turnRate.toFixed(2)}</span>
            </div>
          </label>
          <label className="flex items-center justify-between gap-3 text-text-label">
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
              <span className="w-12 text-right text-foreground">{turnSpeed.toFixed(2)}</span>
            </div>
          </label>
        </div>

        {!connected && (
          <p className="text-xs text-text-dim text-center">Connect to robot to enable controls</p>
        )}
      </div>
    </div>
  );
}
