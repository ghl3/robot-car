"use client";

import { useState, useEffect } from "react";
import { getStoredIp, setStoredIp } from "@/lib/robot-config";
import { useRobotManager } from "@/hooks/useRobotManager";
import type { RosStatus } from "@/hooks/useRobot";

interface TempBadgeProps {
  temp: number | null;
}

function TempBadge({ temp }: TempBadgeProps) {
  if (temp === null || temp === undefined) return null;
  const color =
    temp >= 80 ? "text-red-400" : temp >= 60 ? "text-yellow-400" : "text-green-400";
  return <span className={`font-mono ${color}`}>{temp.toFixed(1)}&deg;C</span>;
}

interface UsageBarProps {
  label: string;
  percent: number | string;
  detail?: string;
}

function UsageBar({ label, percent, detail }: UsageBarProps) {
  const pct = typeof percent === "string" ? parseInt(percent, 10) : percent;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-blue-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-400 mb-1">
        <span>{label}</span>
        <span>{detail || `${pct}%`}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface ConfirmButtonProps {
  children: React.ReactNode;
  onConfirm: () => void;
  className?: string;
  confirmText?: string;
}

function ConfirmButton({ children, onConfirm, className, confirmText = "Confirm?" }: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <button
      className={className}
      onClick={() => {
        if (confirming) {
          setConfirming(false);
          onConfirm();
        } else {
          setConfirming(true);
        }
      }}
    >
      {confirming ? confirmText : children}
    </button>
  );
}

interface RobotManagerProps {
  rosStatus: RosStatus;
  onConnect: (ip: string) => void;
  onDisconnect: () => void;
}

export default function RobotManager({ rosStatus, onConnect, onDisconnect }: RobotManagerProps) {
  const [ip, setIp] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [wifiPassword, setWifiPassword] = useState("");
  const [selectedSsid, setSelectedSsid] = useState("");
  const [showWifi, setShowWifi] = useState(false);

  const {
    servicesRunning,
    systemInfo,
    loading,
    error,
    wifiNetworks,
    currentNetwork,
    startServices,
    stopServices,
    shutdown,
    getWifiNetworks,
    connectWifi,
    startPolling,
    stopPolling,
  } = useRobotManager({
    onServicesStarted: (connectedIp: string) => {
      setStoredIp(connectedIp);
      onConnect(connectedIp);
    },
    onServicesStopped: () => {
      onDisconnect();
      stopPolling();
    },
    robotIp: ip,
  });

  useEffect(() => {
    setIp(getStoredIp());
  }, []);

  const isConnected = rosStatus === "connected" || rosStatus === "reconnecting";
  const isBusy = loading !== null;

  const handlePowerOn = async () => {
    const trimmedIp = ip.trim();
    if (!trimmedIp) return;
    setStoredIp(trimmedIp);
    const result = await startServices(trimmedIp);
    if (result?.success) {
      startPolling(trimmedIp);
    }
  };

  const handlePowerOff = async () => {
    const trimmedIp = ip.trim();
    await stopServices(trimmedIp);
  };

  const handleCheckStatus = () => {
    const trimmedIp = ip.trim();
    if (!trimmedIp) return;
    startPolling(trimmedIp);
  };

  const statusDot = (active: boolean, label: string) => (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 rounded-full ${active ? "bg-green-500" : "bg-zinc-600"}`} />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  );

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">Robot Manager</h2>
          <div className="flex items-center gap-3">
            {statusDot(systemInfo !== null, "SSH")}
            {statusDot(servicesRunning, "ROS")}
            {statusDot(isConnected, "Bridge")}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
          {/* Connection Section */}
          <div className="pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="Robot IP"
                disabled={isBusy}
                className="rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-white placeholder-zinc-500 w-44 disabled:opacity-50"
              />
              <button
                onClick={handlePowerOn}
                disabled={isBusy || !ip.trim()}
                className="rounded px-4 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-colors"
              >
                {loading === "starting" ? "Starting..." : "Power On"}
              </button>
              <button
                onClick={handlePowerOff}
                disabled={isBusy || (!servicesRunning && !isConnected)}
                className="rounded px-4 py-1.5 text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-50 transition-colors"
              >
                {loading === "stopping" ? "Stopping..." : "Power Off"}
              </button>
              <button
                onClick={handleCheckStatus}
                disabled={isBusy || !ip.trim()}
                className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                title="Check status"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/50 border border-red-900/50 rounded px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* System Info */}
          {systemInfo && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-zinc-800/50 rounded p-3">
                <div className="text-xs text-zinc-500 mb-1">CPU Temp</div>
                <TempBadge temp={systemInfo.cpuTemp} />
              </div>
              {systemInfo.memoryUsage && (
                <div className="bg-zinc-800/50 rounded p-3">
                  <div className="text-xs text-zinc-500 mb-1">Memory</div>
                  <UsageBar
                    label=""
                    percent={systemInfo.memoryUsage.percent}
                    detail={`${systemInfo.memoryUsage.usedMB}/${systemInfo.memoryUsage.totalMB} MB`}
                  />
                </div>
              )}
              {systemInfo.diskUsage && (
                <div className="bg-zinc-800/50 rounded p-3">
                  <div className="text-xs text-zinc-500 mb-1">Disk</div>
                  <UsageBar
                    label=""
                    percent={systemInfo.diskUsage.percent}
                    detail={`${systemInfo.diskUsage.used}/${systemInfo.diskUsage.size}`}
                  />
                </div>
              )}
              <div className="bg-zinc-800/50 rounded p-3">
                <div className="text-xs text-zinc-500 mb-1">Uptime</div>
                <span className="text-sm text-zinc-300">{systemInfo.uptime}</span>
              </div>
            </div>
          )}

          {/* System Controls & WiFi */}
          {systemInfo && (
            <div className="flex items-center gap-2 pt-1">
              <ConfirmButton
                onConfirm={() => shutdown("reboot", ip.trim())}
                confirmText="Confirm Reboot?"
                className="rounded px-3 py-1.5 text-xs font-medium bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 transition-colors"
              >
                Reboot
              </ConfirmButton>
              <ConfirmButton
                onConfirm={() => {
                  onDisconnect();
                  stopPolling();
                  shutdown("shutdown", ip.trim());
                }}
                confirmText="Confirm Shutdown?"
                className="rounded px-3 py-1.5 text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
                Shutdown
              </ConfirmButton>
              <button
                onClick={() => {
                  setShowWifi(!showWifi);
                  if (!showWifi) getWifiNetworks(ip.trim());
                }}
                className="rounded px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors ml-auto"
              >
                {showWifi ? "Hide WiFi" : "WiFi"}
              </button>
            </div>
          )}

          {/* WiFi Panel */}
          {showWifi && systemInfo && (
            <div className="bg-zinc-800/30 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">WiFi Networks</span>
                {currentNetwork && (
                  <span className="text-xs text-green-400">Connected: {currentNetwork}</span>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {wifiNetworks.length === 0 && (
                  <div className="text-xs text-zinc-500">No networks found</div>
                )}
                {wifiNetworks.map((net) => (
                  <button
                    key={net.ssid}
                    onClick={() => setSelectedSsid(net.ssid === selectedSsid ? "" : net.ssid)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
                      selectedSsid === net.ssid
                        ? "bg-zinc-700 text-white"
                        : "hover:bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    <span>{net.ssid}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-zinc-500">{net.security}</span>
                      <span>{net.signal}%</span>
                    </span>
                  </button>
                ))}
              </div>
              {selectedSsid && (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    placeholder="Password (if needed)"
                    className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-white placeholder-zinc-500"
                  />
                  <button
                    onClick={async () => {
                      const result = await connectWifi(selectedSsid, wifiPassword, ip.trim());
                      if (result.success) {
                        setSelectedSsid("");
                        setWifiPassword("");
                        getWifiNetworks(ip.trim());
                      }
                    }}
                    className="rounded px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    Connect to {selectedSsid}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
