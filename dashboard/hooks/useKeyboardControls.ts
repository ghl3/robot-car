"use client";

import { useEffect, useRef, useCallback } from "react";
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

export function useKeyboardControls(publish: PublishFn, status: RosStatus, speed = 0.5, turnRate = 0.6, turnSpeed = 0.35) {
  const activeKeys = useRef(new Set<string>());
  const lastPublish = useRef(0);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendCommand = useCallback(
    (linearX: number, steeringAngle: number) => {
      publish("/cmd_vel", "geometry_msgs/Twist", {
        linear: { x: linearX, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: steeringAngle },
      });
    },
    [publish]
  );

  const computeAndSend = useCallback(() => {
    const keys = activeKeys.current;
    let linearX = 0;
    let sa = 0;

    if (keys.has("forward")) linearX = speed;
    else if (keys.has("backward")) linearX = -speed;

    if (keys.has("left")) {
      sa = turnRate;
      if (linearX === 0) linearX = turnSpeed;
    } else if (keys.has("right")) {
      sa = -turnRate;
      if (linearX === 0) linearX = turnSpeed;
    }

    const now = Date.now();
    if (now - lastPublish.current >= 100) {
      lastPublish.current = now;
      sendCommand(linearX, sa);
    } else if (!publishTimer.current) {
      publishTimer.current = setTimeout(() => {
        publishTimer.current = null;
        lastPublish.current = Date.now();
        // Recompute from current active keys
        const k = activeKeys.current;
        let lx = 0, sa = 0;
        if (k.has("forward")) lx = speed;
        else if (k.has("backward")) lx = -speed;
        if (k.has("left")) { sa = turnRate; if (lx === 0) lx = turnSpeed; }
        else if (k.has("right")) { sa = -turnRate; if (lx === 0) lx = turnSpeed; }
        sendCommand(lx, sa);
      }, 100 - (now - lastPublish.current));
    }
  }, [speed, turnRate, turnSpeed, sendCommand]);

  useEffect(() => {
    if (status !== "connected") return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in inputs
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;

      const action = KEY_MAP[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();

      if (action === "stop") {
        activeKeys.current.clear();
        sendCommand(0, 0);
        return;
      }

      if (!activeKeys.current.has(action)) {
        activeKeys.current.add(action);
        computeAndSend();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.key.toLowerCase()];
      if (!action || action === "stop") return;
      e.preventDefault();

      activeKeys.current.delete(action);
      computeAndSend();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      activeKeys.current.clear();
      if (publishTimer.current) {
        clearTimeout(publishTimer.current);
        publishTimer.current = null;
      }
    };
  }, [status, computeAndSend, sendCommand]);

  return { activeKeys: activeKeys.current };
}
