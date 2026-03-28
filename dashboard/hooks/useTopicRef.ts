"use client";

import { useEffect, useRef } from "react";
import type { Ros, Topic } from "roslib";

export interface TopicOptions {
  compression?: string;      // "none" | "png" | "cbor" | "cbor-raw"
  throttle_rate?: number;    // ms between messages (server-side throttle)
  queue_length?: number;     // max queued messages at bridge side
}

export function useTopicRef<T>(
  topicName: string,
  messageType: string,
  getRos: () => Ros | null,
  connected: boolean,
  onMessage?: (msg: T) => void,
  options?: TopicOptions,
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
        ...(options?.compression && { compression: options.compression }),
        ...(options?.throttle_rate && { throttle_rate: options.throttle_rate }),
        ...(options?.queue_length && { queue_length: options.queue_length }),
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
  }, [topicName, messageType, getRos, connected, onMessage, options]);

  return dataRef;
}
