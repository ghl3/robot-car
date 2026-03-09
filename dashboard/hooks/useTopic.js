"use client";

import { useEffect, useRef, useState } from "react";

export function useTopic(topicName, messageType, getRos, connected) {
  const [message, setMessage] = useState(null);
  const listenerRef = useRef(null);

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
      const ROSLIB = (await import("roslib")).default;
      if (cancelled) return;

      const listener = new ROSLIB.Topic({
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
