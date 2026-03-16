"use client";

import { useEffect, useRef, useState } from "react";
import type { Ros, Topic } from "roslib";

export function useTopic(topicName: string, messageType: string, getRos: () => Ros | null, connected: boolean) {
  const [message, setMessage] = useState<Record<string, unknown> | null>(null);
  const listenerRef = useRef<Topic | null>(null);

  useEffect(() => {
    if (!connected) {
      setMessage(null);
      return;
    }

    const ros = getRos();
    if (!ros || !ros.isConnected) {
      setMessage(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const roslib = await import("roslib");
      if (cancelled) return;

      const listener = new roslib.Topic({
        ros: ros,
        name: topicName,
        messageType: messageType,
      });

      listenerRef.current = listener;

      listener.subscribe((msg) => {
        if (!cancelled) setMessage(msg);
      });
    })();

    return () => {
      cancelled = true;
      if (listenerRef.current) {
        listenerRef.current.unsubscribe();
        listenerRef.current = null;
      }
    };
  }, [topicName, messageType, getRos, connected]);

  return message;
}
