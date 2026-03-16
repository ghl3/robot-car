"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { setStoredIp } from "@/lib/robot-config";
import type { Ros } from "roslib";

export type RosStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export type PublishFn = (topicName: string, messageType: string, data: Record<string, unknown>) => void;

let rosInstance: Ros | null = null;
let roslibModule: typeof import("roslib") | null = null;

async function getRoslib() {
  if (!roslibModule) {
    roslibModule = await import("roslib");
  }
  return roslibModule;
}

export function useRobot() {
  const [status, setStatus] = useState<RosStatus>("disconnected");
  const [ip, setIpState] = useState<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(3000);
  const intentionalDisconnect = useRef(false);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Sync with existing connection on mount
  useEffect(() => {
    if (rosInstance && rosInstance.isConnected) {
      setStatus("connected");
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(
    (targetIp: string) => {
      clearReconnect();
      const delay = Math.min(reconnectDelay.current, 30000);
      console.log(`[useRobot] scheduling reconnect in ${delay}ms`);
      setStatus("reconnecting");
      reconnectTimer.current = setTimeout(async () => {
        reconnectDelay.current = Math.min(delay * 1.5, 30000);
        try {
          const roslib = await getRoslib();
          if (rosInstance) {
            try { rosInstance.close(); } catch {}
          }
          const wsUrl = `ws://${targetIp}:9090`;
          console.log(`[useRobot] reconnecting to ${wsUrl}`);
          const ros = new roslib.Ros({ url: wsUrl });

          ros.on("connection", () => {
            console.log(`[useRobot] reconnected to ${wsUrl}`);
            rosInstance = ros;
            reconnectDelay.current = 3000;
            setStatus("connected");
          });

          ros.on("error", (err: unknown) => {
            console.error("[useRobot] reconnect WebSocket error:", err);
            if (!intentionalDisconnect.current) {
              scheduleReconnect(targetIp);
            }
          });

          ros.on("close", () => {
            console.warn("[useRobot] reconnect WebSocket closed");
            if (!intentionalDisconnect.current) {
              scheduleReconnect(targetIp);
            }
          });
        } catch (err) {
          console.error("[useRobot] reconnect failed:", err);
          if (!intentionalDisconnect.current) {
            scheduleReconnect(targetIp);
          }
        }
      }, delay);
    },
    [clearReconnect]
  );

  const connect = useCallback(
    async (targetIp: string) => {
      intentionalDisconnect.current = false;
      clearReconnect();
      setStatus("connecting");
      setIpState(targetIp);

      const wsUrl = `ws://${targetIp}:9090`;
      console.log(`[useRobot] connect() called — opening ${wsUrl}`);

      try {
        const roslib = await getRoslib();
        console.log("[useRobot] roslib loaded, Ros:", typeof roslib.Ros);
        if (rosInstance) {
          try { rosInstance.close(); } catch {}
        }

        const ros = new roslib.Ros({ url: wsUrl });

        ros.on("connection", () => {
          console.log(`[useRobot] WebSocket connected to ${wsUrl}`);
          rosInstance = ros;
          reconnectDelay.current = 3000;
          setStoredIp(targetIp);
          setStatus("connected");
        });

        ros.on("error", (err: unknown) => {
          console.error("[useRobot] WebSocket error:", err);
          if (!intentionalDisconnect.current && statusRef.current !== "disconnected") {
            scheduleReconnect(targetIp);
          }
        });

        ros.on("close", () => {
          console.warn("[useRobot] WebSocket closed");
          if (!intentionalDisconnect.current && statusRef.current !== "disconnected") {
            scheduleReconnect(targetIp);
          }
        });
      } catch (err) {
        console.error("[useRobot] connect() failed:", err);
        setStatus("disconnected");
      }
    },
    [clearReconnect, scheduleReconnect]
  );

  const disconnect = useCallback(() => {
    intentionalDisconnect.current = true;
    clearReconnect();
    if (rosInstance) {
      try { rosInstance.close(); } catch {}
      rosInstance = null;
    }
    setStatus("disconnected");
  }, [clearReconnect]);

  const publish: PublishFn = useCallback(async (topicName, messageType, data) => {
    if (!rosInstance || !rosInstance.isConnected) return;
    const roslib = await getRoslib();
    const topic = new roslib.Topic({
      ros: rosInstance,
      name: topicName,
      messageType: messageType,
    });
    topic.publish(data);
  }, []);

  return { status, ip, connect, disconnect, publish, getRos: (): Ros | null => rosInstance };
}
