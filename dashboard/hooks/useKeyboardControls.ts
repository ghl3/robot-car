"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { PublishFn, RosStatus } from "@/hooks/useRobot";

const KEY_MAP: Record<string, string> = {
  w: "forward",
  arrowup: "forward",
  s: "backward",
  arrowdown: "backward",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
  " ": "stop",
};

export function useKeyboardControls(
  publish: PublishFn,
  status: RosStatus,
  speed = 0.5,
  turnRate = 0.6,
  turnSpeed = 0.35,
  velocityRef?: React.MutableRefObject<{ linear: number; steering: number }>,
) {
  const activeKeys = useRef(new Set<string>());
  const [activeKeysState, setActiveKeysState] = useState<Set<string>>(new Set());
  const publishIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncActiveKeys = useCallback(() => {
    setActiveKeysState(new Set(activeKeys.current));
  }, []);

  const sendCommand = useCallback(
    (linearX: number, steeringAngle: number) => {
      publish("/cmd_vel", "geometry_msgs/Twist", {
        linear: { x: linearX, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: steeringAngle },
      });
    },
    [publish]
  );

  const computeVelocity = useCallback(() => {
    const keys = activeKeys.current;
    let linearX = 0;
    let sa = 0;
    if (keys.has("forward")) linearX = speed;
    else if (keys.has("backward")) linearX = -speed;
    if (keys.has("left")) { sa = turnRate; if (linearX === 0) linearX = turnSpeed; }
    else if (keys.has("right")) { sa = -turnRate; if (linearX === 0) linearX = turnSpeed; }
    return { linearX, sa };
  }, [speed, turnRate, turnSpeed]);

  const startPublishing = useCallback(() => {
    if (publishIntervalRef.current) return;
    const { linearX, sa } = computeVelocity();
    if (velocityRef) velocityRef.current = { linear: linearX, steering: sa };
    sendCommand(linearX, sa);
    publishIntervalRef.current = setInterval(() => {
      const { linearX, sa } = computeVelocity();
      if (velocityRef) velocityRef.current = { linear: linearX, steering: sa };
      sendCommand(linearX, sa);
    }, 100);
  }, [computeVelocity, sendCommand, velocityRef]);

  const stopPublishing = useCallback(() => {
    if (publishIntervalRef.current) {
      clearInterval(publishIntervalRef.current);
      publishIntervalRef.current = null;
    }
    if (velocityRef) velocityRef.current = { linear: 0, steering: 0 };
    sendCommand(0, 0);
  }, [sendCommand, velocityRef]);

  useEffect(() => {
    if (status !== "connected") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;

      const action = KEY_MAP[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();

      if (action === "stop") {
        activeKeys.current.clear();
        syncActiveKeys();
        stopPublishing();
        return;
      }

      if (!activeKeys.current.has(action)) {
        activeKeys.current.add(action);
        syncActiveKeys();
        // Update velocity and start continuous publishing
        if (!publishIntervalRef.current) {
          startPublishing();
        } else {
          // Already publishing — just update the velocity on next tick
          const { linearX, sa } = computeVelocity();
          if (velocityRef) velocityRef.current = { linear: linearX, steering: sa };
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.key.toLowerCase()];
      if (!action || action === "stop") return;
      e.preventDefault();

      activeKeys.current.delete(action);
      syncActiveKeys();

      if (activeKeys.current.size === 0) {
        stopPublishing();
      } else {
        const { linearX, sa } = computeVelocity();
        if (velocityRef) velocityRef.current = { linear: linearX, steering: sa };
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      activeKeys.current.clear();
      syncActiveKeys();
      if (publishIntervalRef.current) {
        clearInterval(publishIntervalRef.current);
        publishIntervalRef.current = null;
      }
    };
  }, [status, computeVelocity, sendCommand, syncActiveKeys, startPublishing, stopPublishing, velocityRef]);

  return { activeKeys: activeKeysState };
}
