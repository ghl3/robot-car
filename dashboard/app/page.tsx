"use client";

import { useRobot } from "@/hooks/useRobot";
import ConnectionBar from "@/components/ConnectionBar";
import RobotManager from "@/components/RobotManager";
import CameraFeed from "@/components/CameraFeed";
import LidarViewer from "@/components/LidarViewer";
import DriveControls from "@/components/DriveControls";

export default function Home() {
  const { status, ip, connect, disconnect, publish, getRos } = useRobot();
  const connected = status === "connected";

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
        />

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Camera - spans 2 columns on large screens */}
          <div className="lg:col-span-2">
            <CameraFeed robotIp={ip} connected={connected} />
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            <DriveControls publish={publish} status={status} />
          </div>

          {/* LIDAR */}
          <div className="lg:col-span-2">
            <LidarViewer status={status} getRos={getRos} />
          </div>
        </div>
      </div>
    </div>
  );
}
