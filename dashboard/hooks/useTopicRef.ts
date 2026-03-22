"use client";

import { useEffect, useRef } from "react";
import type { Ros, Topic } from "roslib";

export function useTopicRef<T>(
  topicName: string,
  messageType: string,
  getRos: () => Ros | null,
  connected: boolean,
  onMessage?: (msg: T) => void,
): React.MutableRefObject<T | null> {
  const dataRef = useRef<T | null>(null);
  const listenerRef = useRef<Topic | null>(null);

  useEffect(() => {
    if (!connected) {
      dataRef.current = null;
      return;
    }

    const ros = getRos();
    if (!ros || !ros.isConnected) return;

    let cancelled = false;

    (async () => {
      const roslib = await import("roslib");
      if (cancelled) return;

      const listener = new roslib.Topic({
        ros,
        name: topicName,
        messageType,
      });

      listenerRef.current = listener;

      listener.subscribe((msg) => {
        if (cancelled) return;
        const typed = msg as unknown as T;
        dataRef.current = typed;
        onMessage?.(typed);
      });
    })();

    return () => {
      cancelled = true;
      if (listenerRef.current) {
        listenerRef.current.unsubscribe();
        listenerRef.current = null;
      }
    };
  }, [topicName, messageType, getRos, connected, onMessage]);

  return dataRef;
}
