"use client";

import { useEffect, useRef } from "react";
import type { Ros } from "roslib";

interface Transform {
  translation: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

interface TransformStamped {
  header: { frame_id: string };
  child_frame_id: string;
  transform: Transform;
}

interface TFMessage {
  transforms: TransformStamped[];
}

export interface Pose2D {
  x: number;
  y: number;
  theta: number;
}

function quaternionToYaw(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function composeTransforms(parent: Transform, child: Transform): Transform {
  // Compose translation: parent.translation + parent.rotation * child.translation
  const q = parent.rotation;
  const t = child.translation;

  // Rotate child translation by parent quaternion
  // v' = q * v * q^-1 (Hamilton product)
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const tx = t.x, ty = t.y, tz = t.z;

  // Optimized quaternion-vector rotation
  const ix = qw * tx + qy * tz - qz * ty;
  const iy = qw * ty + qz * tx - qx * tz;
  const iz = qw * tz + qx * ty - qy * tx;
  const iw = -qx * tx - qy * ty - qz * tz;

  const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

  const translation = {
    x: parent.translation.x + rx,
    y: parent.translation.y + ry,
    z: parent.translation.z + rz,
  };

  // Compose rotations: parent.rotation * child.rotation (Hamilton product)
  const cq = child.rotation;
  const rotation = {
    x: qw * cq.x + qx * cq.w + qy * cq.z - qz * cq.y,
    y: qw * cq.y - qx * cq.z + qy * cq.w + qz * cq.x,
    z: qw * cq.z + qx * cq.y - qy * cq.x + qz * cq.w,
    w: qw * cq.w - qx * cq.x - qy * cq.y - qz * cq.z,
  };

  return { translation, rotation };
}

/** Cache key for transform pairs we care about */
const FRAMES_OF_INTEREST = new Set([
  "map_odom",
  "odom_base_footprint",
  "odom_base_link",
]);

function frameKey(parent: string, child: string): string {
  return `${parent}_${child}`;
}

export function usePose(getRos: () => Ros | null, connected: boolean) {
  const poseRef = useRef<Pose2D>({ x: 0, y: 0, theta: 0 });
  const cacheRef = useRef<Record<string, Transform>>({});

  useEffect(() => {
    if (!connected) {
      poseRef.current = { x: 0, y: 0, theta: 0 };
      cacheRef.current = {};
      return;
    }

    const ros = getRos();
    if (!ros || !ros.isConnected) return;

    let cancelled = false;
    let listener: { unsubscribe: () => void } | null = null;

    (async () => {
      const roslib = await import("roslib");
      if (cancelled) return;

      const topic = new roslib.Topic({
        ros,
        name: "/tf",
        messageType: "tf2_msgs/TFMessage",
      });

      listener = topic;

      topic.subscribe((msg) => {
        if (cancelled) return;
        const tfMsg = msg as unknown as TFMessage;
        const cache = cacheRef.current;

        for (const ts of tfMsg.transforms) {
          const key = frameKey(ts.header.frame_id, ts.child_frame_id);
          if (FRAMES_OF_INTEREST.has(key)) {
            cache[key] = ts.transform;
          }
        }

        // Try to compose map → base_footprint (or base_link as fallback)
        const mapOdom = cache["map_odom"];
        const odomBase = cache["odom_base_footprint"] || cache["odom_base_link"];

        if (mapOdom && odomBase) {
          const composed = composeTransforms(mapOdom, odomBase);
          poseRef.current = {
            x: composed.translation.x,
            y: composed.translation.y,
            theta: quaternionToYaw(composed.rotation),
          };
        } else if (odomBase) {
          // No map frame yet (gmapping still initializing), use odom directly
          poseRef.current = {
            x: odomBase.translation.x,
            y: odomBase.translation.y,
            theta: quaternionToYaw(odomBase.rotation),
          };
        }
      });
    })();

    return () => {
      cancelled = true;
      if (listener) {
        listener.unsubscribe();
      }
    };
  }, [connected, getRos]);

  return poseRef;
}
