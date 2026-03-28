"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useRobot } from "@/hooks/useRobot";
import { getStoredCredentials } from "@/lib/robot-config";
import StatusBar from "@/components/StatusBar";
import CameraFeed from "@/components/CameraFeed";
import MapViewer from "@/components/MapViewer";
import DriveControls from "@/components/DriveControls";

interface SystemInfo {
  lidarDetected: boolean;
  lidarActive: boolean;
  slamActive: boolean;
  recordingActive: boolean;
  playbackActive: boolean;
  cameraActive: boolean;
  webVideoServerActive: boolean;
}

export default function Home() {
  const { status, ip, connect, disconnect, publish, getRos } = useRobot();
  const connected = status === "connected";
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const credentials = useMemo(() => {
    const stored = getStoredCredentials();
    return { username: stored.username, password: stored.password };
  }, []);
  const handleSystemInfo = useCallback((info: SystemInfo | null) => {
    setSystemInfo(info);
  }, []);
  const restartComponentRef = useRef<((component: string) => Promise<unknown>) | undefined>(undefined);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        {/* Header */}
        <h1 className="text-xl font-bold text-accent-red uppercase tracking-widest">
          JETRACER // COMMAND CONSOLE
        </h1>

        {/* Unified Status Bar */}
        <StatusBar
          rosStatus={status}
          onConnect={connect}
          onDisconnect={disconnect}
          onSystemInfo={handleSystemInfo}
          onRestartRef={restartComponentRef}
        />

        {/* Camera + Map side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CameraFeed
            robotIp={ip}
            connected={connected}
            cameraActive={systemInfo?.cameraActive}
            webVideoServerActive={systemInfo?.webVideoServerActive}
          />
          <MapViewer
            status={status}
            getRos={getRos}
            lidarDetected={systemInfo?.lidarDetected}
            lidarActive={systemInfo?.lidarActive}
            slamActive={systemInfo?.slamActive}
            robotIp={ip || undefined}
            credentials={credentials}
            onRestartComponent={async (c) => { await restartComponentRef.current?.(c); }}
          />
        </div>

        {/* Drive Controls */}
        <DriveControls publish={publish} status={status} />
      </div>
    </div>
  );
}
