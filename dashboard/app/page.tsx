"use client";

import { useState, useCallback } from "react";
import { useRobot } from "@/hooks/useRobot";
import ConnectionBar from "@/components/ConnectionBar";
import RobotManager from "@/components/RobotManager";
import CameraFeed from "@/components/CameraFeed";
import MapViewer from "@/components/MapViewer";
import DriveControls from "@/components/DriveControls";

export default function Home() {
  const { status, ip, connect, disconnect, publish, getRos } = useRobot();
  const connected = status === "connected";
  const [lidarInfo, setLidarInfo] = useState<{ lidarDetected: boolean; lidarActive: boolean; slamActive: boolean } | null>(null);
  const handleSystemInfo = useCallback((info: { lidarDetected: boolean; lidarActive: boolean; slamActive: boolean } | null) => {
    setLidarInfo(info);
  }, []);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-accent-red uppercase tracking-widest">
            JETRACER // COMMAND CONSOLE
          </h1>
          <ConnectionBar status={status} ip={ip} />
        </div>

        {/* Robot Manager */}
        <RobotManager
          rosStatus={status}
          onConnect={connect}
          onDisconnect={disconnect}
          onSystemInfo={handleSystemInfo}
        />

        {/* Camera + Map side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CameraFeed robotIp={ip} connected={connected} />
          <MapViewer
            status={status}
            getRos={getRos}
            lidarDetected={lidarInfo?.lidarDetected}
            lidarActive={lidarInfo?.lidarActive}
            slamActive={lidarInfo?.slamActive}
          />
        </div>

        {/* Drive Controls — full-width horizontal bar */}
        <DriveControls publish={publish} status={status} />
      </div>
    </div>
  );
}
