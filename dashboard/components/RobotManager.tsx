"use client";

import { useState, useEffect, useRef } from "react";
import { getStoredIp, setStoredIp, getStoredCredentials, setStoredCredentials } from "@/lib/robot-config";
import { useRobotManager } from "@/hooks/useRobotManager";
import type { RosStatus } from "@/hooks/useRobot";

interface TempBadgeProps {
  label: string;
  temp: number;
}

function TempBadge({ label, temp }: TempBadgeProps) {
  const color =
    temp >= 80
      ? "text-accent-red"
      : temp >= 60
        ? "text-accent-amber"
        : "text-accent-green";
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-text-dim">{label}</span>
      <span className={`font-mono ${color}`}>{temp.toFixed(1)}&deg;C</span>
    </div>
  );
}

// Friendly names for thermal zones
const ZONE_LABELS: Record<string, string> = {
  "CPU-therm": "CPU",
  "GPU-therm": "GPU",
  "AO-therm": "AO",
  "PLL-therm": "PLL",
  "thermal-fan-est": "Fan Est",
  "iwlwifi": "WiFi",
};

interface UsageBarProps {
  label: string;
  percent: number | string;
  detail?: string;
}

function UsageBar({ label, percent, detail }: UsageBarProps) {
  const pct = typeof percent === "string" ? parseInt(percent, 10) : percent;
  const color =
    pct >= 90
      ? "bg-accent-red"
      : pct >= 70
        ? "bg-accent-amber"
        : "bg-accent-green";
  return (
    <div>
      <div className="flex justify-between text-xs text-text-dim mb-1">
        <span>{label}</span>
        <span>{detail || `${pct}%`}</span>
      </div>
      <div className="h-2 bg-input-bg rounded-full overflow-hidden border border-panel-border/50">
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
  onSystemInfo?: (info: { lidarDetected: boolean; lidarActive: boolean; slamActive: boolean; recordingActive: boolean; playbackActive: boolean } | null) => void;
}

export default function RobotManager({ rosStatus, onConnect, onDisconnect, onSystemInfo }: RobotManagerProps) {
  const [ip, setIp] = useState("");
  const [username, setUsername] = useState("jetson");
  const [password, setPassword] = useState("jetson");
  const [showCredentials, setShowCredentials] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [wifiPassword, setWifiPassword] = useState("");
  const [selectedSsid, setSelectedSsid] = useState("");
  const [showWifi, setShowWifi] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const {
    servicesRunning,
    systemInfo,
    loading,
    wifiNetworks,
    currentNetwork,
    startupLogs,
    startServices,
    stopServices,
    shutdown,
    getWifiNetworks,
    connectWifi,
    startPolling,
    stopPolling,
    clearStartupLogs,
  } = useRobotManager({
    onServicesStarted: (connectedIp: string) => {
      console.log(`[RobotManager] onServicesStarted — calling onConnect(${connectedIp})`);
      setStoredIp(connectedIp);
      onConnect(connectedIp);
    },
    onServicesStopped: () => {
      onDisconnect();
      stopPolling();
    },
    robotIp: ip,
    credentials: { username, password },
  });

  useEffect(() => {
    const creds = getStoredCredentials();
    setIp(creds.ip);
    setUsername(creds.username);
    setPassword(creds.password);
  }, []);

  // Propagate lidar status to parent
  useEffect(() => {
    onSystemInfo?.(systemInfo ? { lidarDetected: systemInfo.lidarDetected, lidarActive: systemInfo.lidarActive, slamActive: systemInfo.slamActive, recordingActive: systemInfo.recordingActive, playbackActive: systemInfo.playbackActive } : null);
  }, [systemInfo, onSystemInfo]);

  // Auto-scroll log panel (scroll container only, not the page)
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [startupLogs]);

  const isConnected = rosStatus === "connected" || rosStatus === "reconnecting";
  const isBusy = loading !== null;

  const handlePowerOn = async () => {
    const trimmedIp = ip.trim();
    if (!trimmedIp) return;
    setStoredCredentials({ ip: trimmedIp, username, password });
    const result = await startServices(trimmedIp);
    if (result?.success) {
      startPolling(trimmedIp);
    }
  };

  const handlePowerOff = async () => {
    const trimmedIp = ip.trim();
    await stopServices(trimmedIp);
  };

  const handleRestart = async () => {
    const trimmedIp = ip.trim();
    if (!trimmedIp) return;
    await stopServices(trimmedIp);
    setStoredCredentials({ ip: trimmedIp, username, password });
    const result = await startServices(trimmedIp, { force: true });
    if (result?.success) {
      startPolling(trimmedIp);
    }
  };

  const handleCheckStatus = () => {
    const trimmedIp = ip.trim();
    if (!trimmedIp) return;
    startPolling(trimmedIp);
  };

  const statusDot = (active: boolean, label: string) => (
    <div className="flex items-center gap-2">
      <div
        className={`h-3 w-3 rounded-full ${
          active
            ? "bg-accent-green shadow-[0_0_6px_theme(--color-accent-green)]"
            : "bg-input-bg border border-panel-border"
        }`}
      />
      <span className="text-xs text-text-dim">{label}</span>
    </div>
  );

  const lidarDot = () => {
    const detected = systemInfo?.lidarDetected ?? false;
    const active = systemInfo?.lidarActive ?? false;
    let dotClass: string;
    if (active) {
      dotClass = "bg-accent-green shadow-[0_0_6px_theme(--color-accent-green)]";
    } else if (detected) {
      dotClass = "bg-accent-amber shadow-[0_0_6px_theme(--color-accent-amber)]";
    } else {
      dotClass = "bg-input-bg border border-panel-border";
    }
    return (
      <div className="flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full ${dotClass}`} />
        <span className="text-xs text-text-dim">LIDAR</span>
      </div>
    );
  };

  return (
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between bg-panel-header px-4 py-2 hover:brightness-110 transition-all"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-panel-header-text uppercase tracking-widest">Robot Manager</h2>
          <div className="flex items-center gap-3">
            {statusDot(systemInfo !== null, "SSH")}
            {statusDot(servicesRunning, "ROS")}
            {statusDot(isConnected, "Bridge")}
            {lidarDot()}
            {statusDot(systemInfo?.slamActive ?? false, "SLAM")}
            {statusDot(systemInfo?.recordingActive ?? false, "REC")}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-panel-header-text/70 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-panel-border">
          {/* Connection Section */}
          <div className="pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="Robot IP"
                disabled={isBusy}
                className="rounded bg-input-bg border border-input-border px-3 py-1.5 text-sm text-foreground placeholder-text-dim w-44 disabled:opacity-50"
              />
              <button
                onClick={handlePowerOn}
                disabled={isBusy || !ip.trim()}
                className="rounded px-4 py-1.5 text-sm font-medium bg-accent-red hover:bg-accent-red-bright text-white disabled:opacity-50 transition-colors shadow-sm"
              >
                {loading === "starting" ? "Connecting..." : "Connect"}
              </button>
              <button
                onClick={handlePowerOff}
                disabled={isBusy || (!servicesRunning && !isConnected)}
                className="rounded px-4 py-1.5 text-sm font-medium bg-input-bg border border-panel-border hover:bg-panel-border text-text-label disabled:opacity-50 transition-colors"
              >
                {loading === "stopping" ? "Disconnecting..." : "Disconnect"}
              </button>
              <button
                onClick={handleRestart}
                disabled={isBusy || (!servicesRunning && !isConnected)}
                className="rounded px-4 py-1.5 text-sm font-medium bg-accent-amber/20 text-accent-amber hover:bg-accent-amber/30 disabled:opacity-50 transition-colors"
                title="Stop and restart all services"
              >
                {loading === "starting" && servicesRunning ? "Restarting..." : "Restart"}
              </button>
              <button
                onClick={handleCheckStatus}
                disabled={isBusy || !ip.trim()}
                className="rounded px-3 py-1.5 text-sm text-text-dim hover:text-foreground hover:bg-input-bg transition-colors"
                title="Check status"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => setShowCredentials(!showCredentials)}
                className="rounded px-2 py-1.5 text-sm text-text-dim hover:text-foreground hover:bg-input-bg transition-colors ml-auto"
                title="SSH credentials"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>

            {/* SSH Credentials */}
            {showCredentials && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-dim">SSH:</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setStoredCredentials({ username: e.target.value });
                  }}
                  placeholder="Username"
                  disabled={isBusy}
                  className="rounded bg-input-bg border border-input-border px-2 py-1 text-xs text-foreground placeholder-text-dim w-24 disabled:opacity-50"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setStoredCredentials({ password: e.target.value });
                  }}
                  placeholder="Password"
                  disabled={isBusy}
                  className="rounded bg-input-bg border border-input-border px-2 py-1 text-xs text-foreground placeholder-text-dim w-28 disabled:opacity-50"
                />
                <span className="text-xs text-text-dim">Saved to browser</span>
              </div>
            )}
          </div>

          {/* Startup Log Panel */}
          {(loading === "starting" || startupLogs.length > 0) && (
            <div className="bg-input-bg border border-panel-border rounded overflow-hidden">
              <button
                onClick={() => setLogsExpanded(!logsExpanded)}
                className="w-full bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2 flex items-center justify-between hover:brightness-110 transition-all"
              >
                <span>SYSTEM LOG</span>
                <div className="flex items-center gap-2">
                  {loading !== "starting" && (
                    <span
                      onClick={(e) => { e.stopPropagation(); clearStartupLogs(); }}
                      className="text-panel-header-text/70 hover:text-panel-header-text normal-case tracking-normal"
                    >
                      Clear
                    </span>
                  )}
                  <svg
                    className={`w-3 h-3 text-panel-header-text/70 transition-transform ${logsExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {logsExpanded && (
                <div ref={logContainerRef} className="h-48 overflow-y-auto p-3 font-mono text-xs">
                  {startupLogs.map((log, i) => (
                    <div key={i} className={log.isError ? "text-accent-red" : "text-foreground"}>
                      <span className={log.isError ? "text-accent-red/70" : "text-accent-gold"}>[{log.timestamp}]</span> {log.message}
                    </div>
                  ))}
                  {loading === "starting" && (
                    <span className="text-accent-amber animate-pulse">_</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* System Info */}
          {systemInfo && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.keys(systemInfo.temps).length > 0 && (
                <div className="bg-input-bg border border-panel-border rounded p-3 space-y-1">
                  <div className="text-xs text-text-dim mb-1">Temperatures</div>
                  {Object.entries(systemInfo.temps).map(([zone, temp]) => (
                    <TempBadge key={zone} label={ZONE_LABELS[zone] || zone} temp={temp} />
                  ))}
                </div>
              )}
              {systemInfo.memoryUsage && (
                <div className="bg-input-bg border border-panel-border rounded p-3">
                  <div className="text-xs text-text-dim mb-1">Memory</div>
                  <UsageBar
                    label=""
                    percent={systemInfo.memoryUsage.percent}
                    detail={`${systemInfo.memoryUsage.usedMB}/${systemInfo.memoryUsage.totalMB} MB`}
                  />
                </div>
              )}
              {systemInfo.diskUsage && (
                <div className="bg-input-bg border border-panel-border rounded p-3">
                  <div className="text-xs text-text-dim mb-1">Disk</div>
                  <UsageBar
                    label=""
                    percent={systemInfo.diskUsage.percent}
                    detail={`${systemInfo.diskUsage.used}/${systemInfo.diskUsage.size}`}
                  />
                </div>
              )}
              <div className="bg-input-bg border border-panel-border rounded p-3">
                <div className="text-xs text-text-dim mb-1">Uptime</div>
                <span className="text-sm text-foreground">{systemInfo.uptime}</span>
              </div>
            </div>
          )}

          {/* System Controls & WiFi */}
          {systemInfo && (
            <div className="flex items-center gap-2 pt-1">
              <ConfirmButton
                onConfirm={() => shutdown("reboot", ip.trim())}
                confirmText="Confirm Reboot?"
                className="rounded px-3 py-1.5 text-xs font-medium bg-accent-amber/20 text-accent-amber hover:bg-accent-amber/30 transition-colors"
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
                className="rounded px-3 py-1.5 text-xs font-medium bg-accent-red/15 text-accent-red hover:bg-accent-red/25 transition-colors"
              >
                Shutdown
              </ConfirmButton>
              <button
                onClick={() => {
                  setShowWifi(!showWifi);
                  if (!showWifi) getWifiNetworks(ip.trim());
                }}
                className="rounded px-3 py-1.5 text-xs font-medium bg-input-bg border border-panel-border text-text-dim hover:text-foreground hover:bg-panel-border transition-colors ml-auto"
              >
                {showWifi ? "Hide WiFi" : "WiFi"}
              </button>
            </div>
          )}

          {/* WiFi Panel */}
          {showWifi && systemInfo && (
            <div className="bg-input-bg border border-panel-border rounded p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-label">WiFi Networks</span>
                {currentNetwork && (
                  <span className="text-xs text-accent-green">Connected: {currentNetwork}</span>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {wifiNetworks.length === 0 && (
                  <div className="text-xs text-text-dim">No networks found</div>
                )}
                {wifiNetworks.map((net) => (
                  <button
                    key={net.ssid}
                    onClick={() => setSelectedSsid(net.ssid === selectedSsid ? "" : net.ssid)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
                      selectedSsid === net.ssid
                        ? "bg-panel-border/50 text-foreground"
                        : "hover:bg-panel-border/30 text-text-dim"
                    }`}
                  >
                    <span>{net.ssid}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-text-dim">{net.security}</span>
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
                    className="flex-1 rounded bg-panel border border-panel-border px-2 py-1 text-xs text-foreground placeholder-text-dim"
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
                    className="rounded px-3 py-1 text-xs font-medium bg-accent-red hover:bg-accent-red-bright text-white transition-colors"
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
