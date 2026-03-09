"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { setStoredIp } from "@/lib/robot-config";

let rosInstance = null;
let ROSLIB = null;

async function getRoslib() {
  if (!ROSLIB) {
    ROSLIB = (await import("roslib")).default;
  }
  return ROSLIB;
}

export function useRobot() {
  const [status, setStatus] = useState("disconnected"); // disconnected | connecting | connected | reconnecting
  const [ip, setIpState] = useState(null);
  const reconnectTimer = useRef(null);
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
    (targetIp) => {
      clearReconnect();
      const delay = Math.min(reconnectDelay.current, 30000);
      setStatus("reconnecting");
      reconnectTimer.current = setTimeout(async () => {
        reconnectDelay.current = Math.min(delay * 1.5, 30000);
        try {
          const roslib = await getRoslib();
          if (rosInstance) {
            try { rosInstance.close(); } catch {}
          }
          const ros = new roslib.Ros({ url: `ws://${targetIp}:9090` });

          ros.on("connection", () => {
            rosInstance = ros;
            reconnectDelay.current = 3000;
            setStatus("connected");
          });

          ros.on("error", () => {
            if (!intentionalDisconnect.current) {
              scheduleReconnect(targetIp);
            }
          });

          ros.on("close", () => {
            if (!intentionalDisconnect.current) {
              scheduleReconnect(targetIp);
            }
          });
        } catch {
          if (!intentionalDisconnect.current) {
            scheduleReconnect(targetIp);
          }
        }
      }, delay);
    },
    [clearReconnect]
  );

  const connect = useCallback(
    async (targetIp) => {
      intentionalDisconnect.current = false;
      clearReconnect();
      setStatus("connecting");
      setIpState(targetIp);

      try {
        const roslib = await getRoslib();
        if (rosInstance) {
          try { rosInstance.close(); } catch {}
        }

        const ros = new roslib.Ros({ url: `ws://${targetIp}:9090` });

        ros.on("connection", () => {
          rosInstance = ros;
          reconnectDelay.current = 3000;
          setStoredIp(targetIp);
          setStatus("connected");
        });

        ros.on("error", () => {
          if (!intentionalDisconnect.current && statusRef.current !== "disconnected") {
            scheduleReconnect(targetIp);
          }
        });

        ros.on("close", () => {
          if (!intentionalDisconnect.current && statusRef.current !== "disconnected") {
            scheduleReconnect(targetIp);
          }
        });
      } catch {
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

  const publish = useCallback(async (topicName, messageType, data) => {
    if (!rosInstance || !rosInstance.isConnected) return;
    const roslib = await getRoslib();
    const topic = new roslib.Topic({
      ros: rosInstance,
      name: topicName,
      messageType: messageType,
    });
    topic.publish(new roslib.Message(data));
  }, []);

  return { status, ip, connect, disconnect, publish, getRos: () => rosInstance };
}
