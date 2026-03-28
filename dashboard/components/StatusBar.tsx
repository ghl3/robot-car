"use client";

import { useState, useEffect, useRef } from "react";
import { getStoredCredentials, setStoredCredentials, setStoredIp } from "@/lib/robot-config";
import { useRobotManager } from "@/hooks/useRobotManager";
import type { RosStatus } from "@/hooks/useRobot";

// --- Helpers ---

const ZONE_LABELS: Record<string, string> = {
  "CPU-therm": "CPU", "GPU-therm": "GPU", "AO-therm": "AO",
  "PLL-therm": "PLL", "thermal-fan-est": "Fan", "iwlwifi": "WiFi",
};

const STATUS_COLORS: Record<RosStatus, { dot: string; label: string }> = {
  disconnected: { dot: "bg-accent-red shadow-[0_0_6px_theme(--color-accent-red)]", label: "Disconnected" },
  connecting: { dot: "bg-accent-amber animate-pulse shadow-[0_0_6px_theme(--color-accent-amber)]", label: "Connecting..." },
  connected: { dot: "bg-accent-green shadow-[0_0_6px_theme(--color-accent-green)]", label: "Connected" },
  reconnecting: { dot: "bg-accent-amber animate-pulse shadow-[0_0_6px_theme(--color-accent-amber)]", label: "Reconnecting..." },
};

function ConfirmButton({ children, onConfirm, className, confirmText = "Confirm?" }: {
  children: React.ReactNode; onConfirm: () => void; className?: string; confirmText?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <button className={className}
      onClick={() => { if (confirming) { setConfirming(false); onConfirm(); } else setConfirming(true); }}>
      {confirming ? confirmText : children}
    </button>
  );
}

function UsageBar({ label, percent, detail }: { label: string; percent: number | string; detail?: string }) {
  const pct = typeof percent === "string" ? parseInt(percent, 10) : percent;
  const color = pct >= 90 ? "bg-accent-red" : pct >= 70 ? "bg-accent-amber" : "bg-accent-green";
  return (
    <div>
      <div className="flex justify-between text-xs text-text-dim mb-1">
        <span>{label}</span><span>{detail || `${pct}%`}</span>
      </div>
      <div className="h-2 bg-input-bg rounded-full overflow-hidden border border-panel-border/50">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusChip({ label, active, color }: { label: string; active: boolean; color?: string }) {
  const dotColor = active
    ? (color || "bg-accent-green")
    : "bg-accent-red animate-pulse";
  const borderColor = active
    ? (color ? "border-current/30" : "border-accent-green/30")
    : "border-accent-red/30";
  const textColor = active
    ? (color ? "" : "text-accent-green")
    : "text-accent-red";
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors ${borderColor} ${textColor} ${active ? "bg-current/5" : "bg-accent-red/5"}`}>
      <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
}

// --- Main Component ---

interface StatusBarProps {
  rosStatus: RosStatus;
  onConnect: (ip: string) => void;
  onDisconnect: () => void;
  onSystemInfo?: (info: {
    lidarDetected: boolean; lidarActive: boolean; slamActive: boolean;
    recordingActive: boolean; playbackActive: boolean;
    cameraActive: boolean; webVideoServerActive: boolean;
    detectnetActive: boolean; depthnetActive: boolean;
    navActive: boolean;
    lastMapSave: number;
  } | null) => void;
  onRestartRef?: React.MutableRefObject<((component: string) => Promise<unknown>) | undefined>;
}

export default function StatusBar({ rosStatus, onConnect, onDisconnect, onSystemInfo, onRestartRef }: StatusBarProps) {
  const [ip, setIp] = useState("");
  const [username, setUsername] = useState("jetson");
  const [password, setPassword] = useState("jetson");
  const [expanded, setExpanded] = useState(false);
  const [showWifi, setShowWifi] = useState(false);
  const [wifiPassword, setWifiPassword] = useState("");
  const [selectedSsid, setSelectedSsid] = useState("");
  const [restartingKey, setRestartingKey] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const userCollapsedRef = useRef(false);

  const {
    servicesRunning, systemInfo, loading, wifiNetworks, currentNetwork,
    startupLogs, isPolling, startServices, stopServices, shutdown,
    getWifiNetworks, connectWifi, startPolling, stopPolling,
    clearStartupLogs, restartComponent,
  } = useRobotManager({
    onServicesStarted: (connectedIp: string) => { setStoredIp(connectedIp); onConnect(connectedIp); },
    onServicesStopped: () => { onDisconnect(); stopPolling(); },
    robotIp: ip,
    credentials: { username, password },
  });

  // Init from stored credentials
  useEffect(() => {
    const c = getStoredCredentials();
    setIp(c.ip); setUsername(c.username); setPassword(c.password);
  }, []);

  // Expose restartComponent to parent
  useEffect(() => { if (onRestartRef) onRestartRef.current = restartComponent; }, [onRestartRef, restartComponent]);

  // Auto-start polling when bridge connects
  useEffect(() => {
    if ((rosStatus === "connected" || rosStatus === "reconnecting") && ip.trim() && !isPolling) startPolling(ip.trim());
  }, [rosStatus, ip, startPolling, isPolling]);

  // Propagate system info
  useEffect(() => {
    onSystemInfo?.(systemInfo ? {
      lidarDetected: systemInfo.lidarDetected, lidarActive: systemInfo.lidarActive,
      slamActive: systemInfo.slamActive, recordingActive: systemInfo.recordingActive,
      playbackActive: systemInfo.playbackActive, cameraActive: systemInfo.cameraActive,
      webVideoServerActive: systemInfo.webVideoServerActive,
      detectnetActive: systemInfo.detectnetActive, depthnetActive: systemInfo.depthnetActive,
      navActive: systemInfo.navActive,
      lastMapSave: systemInfo.lastMapSave,
    } : null);
  }, [systemInfo, onSystemInfo]);

  // Auto-scroll logs
  useEffect(() => { const el = logContainerRef.current; if (el) el.scrollTop = el.scrollHeight; }, [startupLogs]);

  // Auto-expand when connecting
  useEffect(() => {
    if (loading === "starting" && !userCollapsedRef.current) setExpanded(true);
  }, [loading]);

  const isConnected = rosStatus === "connected" || rosStatus === "reconnecting";
  const isBusy = loading !== null;
  const statusColor = STATUS_COLORS[rosStatus];

  // Handlers
  const handleConnect = async () => {
    const t = ip.trim(); if (!t) return;
    userCollapsedRef.current = false;
    setStoredCredentials({ ip: t, username, password });
    const r = await startServices(t);
    if (r?.success) startPolling(t);
  };
  const handleDisconnect = async () => { await stopServices(ip.trim()); };
  const handleRestartServices = async () => {
    const t = ip.trim(); if (!t) return;
    userCollapsedRef.current = false;
    await stopServices(t);
    setStoredCredentials({ ip: t, username, password });
    const r = await startServices(t, { force: true });
    if (r?.success) startPolling(t);
  };
  const handleRestartComponent = async (key: string) => {
    setRestartingKey(key); await restartComponent(key); setRestartingKey(null);
  };
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    userCollapsedRef.current = !next;
  };

  const components = systemInfo && servicesRunning ? [
    { key: "camera", label: "CAM", active: systemInfo.cameraActive },
    { key: "web_video_server", label: "VID", active: systemInfo.webVideoServerActive },
    { key: "lidar", label: "LIDAR", active: systemInfo.lidarActive },
    { key: "slam", label: "SLAM", active: systemInfo.slamActive },
    { key: "nav", label: "NAV", active: systemInfo.navActive },
    { key: "detectnet", label: "DET", active: systemInfo.detectnetActive },
    { key: "jetracer", label: "JETRACER", active: true },
  ] : null;

  const maxTemp = systemInfo ? Math.max(...Object.values(systemInfo.temps), 0) : 0;
  const memPct = systemInfo?.memoryUsage?.percent ?? 0;
  const pwrV = systemInfo?.powerVoltage ?? 0;

  return (
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      {/* === Collapsed Bar === */}
      <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
        {/* Overall status dot */}
        <div className={`h-3 w-3 rounded-full shrink-0 ${statusColor.dot}`} title={statusColor.label} />

        {/* IP input / display */}
        {!servicesRunning && !isConnected ? (
          <input
            type="text" value={ip} onChange={(e) => setIp(e.target.value)}
            placeholder="Robot IP" disabled={isBusy}
            onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
            className="rounded bg-input-bg border border-input-border px-3 py-1 text-sm text-foreground placeholder-text-dim w-40 disabled:opacity-50"
          />
        ) : (
          <span className="font-mono text-sm text-text-label">{ip}</span>
        )}

        {/* Action buttons */}
        {!servicesRunning && !isConnected ? (
          <button onClick={handleConnect} disabled={isBusy || !ip.trim()}
            className="rounded px-4 py-1 text-sm font-medium bg-accent-red hover:bg-accent-red-bright text-white disabled:opacity-50 transition-colors shadow-sm">
            {loading === "starting" ? "Connecting..." : "Connect"}
          </button>
        ) : (
          <>
            <button onClick={handleDisconnect} disabled={isBusy}
              className="rounded px-3 py-1 text-sm font-medium bg-input-bg border border-panel-border hover:bg-panel-border text-text-label disabled:opacity-50 transition-colors">
              {loading === "stopping" ? "Stopping..." : "Disconnect"}
            </button>
            <button onClick={handleRestartServices} disabled={isBusy}
              className="rounded px-3 py-1 text-sm font-medium border border-accent-amber/30 text-accent-amber hover:bg-accent-amber/10 disabled:opacity-50 transition-colors">
              {loading === "starting" && servicesRunning ? "Restarting..." : "Restart All"}
            </button>
          </>
        )}

        {/* Separator */}
        {components && <div className="w-px h-5 bg-panel-border/50 mx-1" />}

        {/* Component pills — unified chip style, click to restart if down */}
        {components?.map(c => (
          <button
            key={c.key}
            onClick={!c.active ? () => handleRestartComponent(c.key) : undefined}
            disabled={c.active || restartingKey !== null}
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors ${
              c.active
                ? "border-accent-green/30 text-accent-green bg-accent-green/5 cursor-default"
                : "border-accent-red/30 text-accent-red bg-accent-red/5 hover:bg-accent-red/10 cursor-pointer"
            }`}
          >
            <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${c.active ? "bg-accent-green" : "bg-accent-red animate-pulse"}`} />
            <span>{restartingKey === c.key ? "..." : c.label}</span>
          </button>
        ))}

        {/* Right-side connection indicators */}
        <div className="flex items-center gap-2 ml-auto">
          {systemInfo && (
            <>
              <StatusChip label="SSH" active={systemInfo !== null} />
              <StatusChip label="ROS" active={servicesRunning} />
              <StatusChip label="WS" active={isConnected} />
            </>
          )}

          {/* Expand chevron */}
          <button onClick={toggleExpanded}
            className="rounded p-1 text-text-dim hover:text-foreground hover:bg-input-bg transition-colors shrink-0">
            <svg className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* === Expanded Section === */}
      {expanded && (
        <div className="border-t border-panel-border px-4 py-3 space-y-4">
          {/* Grid: left = credentials + system, right = wifi + power */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left column */}
            <div className="space-y-3">
              {/* SSH Credentials */}
              <div>
                <div className="text-[10px] font-bold text-text-dim uppercase tracking-wider mb-1.5">SSH Credentials</div>
                <div className="flex items-center gap-2">
                  <input type="text" value={username}
                    onChange={(e) => { setUsername(e.target.value); setStoredCredentials({ username: e.target.value }); }}
                    placeholder="Username" disabled={isBusy}
                    className="rounded bg-input-bg border border-input-border px-2 py-1 text-xs text-foreground placeholder-text-dim w-28 disabled:opacity-50" />
                  <input type="password" value={password}
                    onChange={(e) => { setPassword(e.target.value); setStoredCredentials({ password: e.target.value }); }}
                    placeholder="Password" disabled={isBusy}
                    className="rounded bg-input-bg border border-input-border px-2 py-1 text-xs text-foreground placeholder-text-dim w-28 disabled:opacity-50" />
                  <span className="text-[10px] text-text-dim">Saved to browser</span>
                </div>
              </div>

              {/* System Details */}
              {systemInfo && (
                <div>
                  <div className="text-[10px] font-bold text-text-dim uppercase tracking-wider mb-1.5">System</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.keys(systemInfo.temps).length > 0 && (
                      <div className="bg-input-bg border border-panel-border rounded p-2 space-y-0.5">
                        <div className="text-[10px] text-text-dim mb-0.5">Temps</div>
                        {Object.entries(systemInfo.temps).map(([zone, temp]) => {
                          const color = temp >= 80 ? "text-accent-red" : temp >= 60 ? "text-accent-amber" : "text-accent-green";
                          return (
                            <div key={zone} className="flex justify-between items-center">
                              <span className="text-[10px] text-text-dim">{ZONE_LABELS[zone] || zone}</span>
                              <span className={`font-mono text-[10px] ${color}`}>{temp.toFixed(1)}&deg;C</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="space-y-2">
                      {systemInfo.memoryUsage && (
                        <div className="bg-input-bg border border-panel-border rounded p-2">
                          <UsageBar label="Memory" percent={systemInfo.memoryUsage.percent}
                            detail={`${systemInfo.memoryUsage.usedMB}/${systemInfo.memoryUsage.totalMB} MB`} />
                        </div>
                      )}
                      {systemInfo.diskUsage && (
                        <div className="bg-input-bg border border-panel-border rounded p-2">
                          <UsageBar label="Disk" percent={systemInfo.diskUsage.percent}
                            detail={`${systemInfo.diskUsage.used}/${systemInfo.diskUsage.size}`} />
                        </div>
                      )}
                      {pwrV > 0 && (() => {
                        // Map 5V rail voltage to battery estimate.
                        // The regulator maintains ~5V until the battery is nearly dead.
                        // Voltage sags under load as battery drains:
                        //   5.1V+ = full, 5.0V = good, 4.9V = low, <4.8V = critical
                        const level = pwrV >= 5100 ? "FULL" : pwrV >= 5000 ? "GOOD" : pwrV >= 4900 ? "LOW" : "CRITICAL";
                        const levelColor = pwrV >= 5000 ? "text-accent-green" : pwrV >= 4900 ? "text-accent-amber" : "text-accent-red";
                        return (
                          <div className="bg-input-bg border border-panel-border rounded p-2">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-text-dim">Battery</span>
                              <span className={`font-bold ${levelColor}`}>{level}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-text-dim font-mono">
                              <span>{(pwrV / 1000).toFixed(2)}V</span>
                              <span>{(systemInfo.powerCurrent / 1000).toFixed(2)}A</span>
                              <span>{(systemInfo.powerWatts / 1000).toFixed(1)}W</span>
                            </div>
                          </div>
                        );
                      })()}
                      <div className="bg-input-bg border border-panel-border rounded p-2">
                        <div className="text-[10px] text-text-dim">Uptime</div>
                        <span className="text-xs text-foreground">{systemInfo.uptime}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-3">
              {/* Power controls */}
              {systemInfo && (
                <div>
                  <div className="text-[10px] font-bold text-text-dim uppercase tracking-wider mb-1.5">Jetson Power</div>
                  <div className="flex items-center gap-2">
                    <ConfirmButton onConfirm={() => shutdown("reboot", ip.trim())} confirmText="Confirm?"
                      className="rounded px-3 py-1.5 text-xs font-medium border border-accent-amber/40 text-accent-amber hover:bg-accent-amber/10 transition-colors">
                      Reboot
                    </ConfirmButton>
                    <ConfirmButton
                      onConfirm={() => { onDisconnect(); stopPolling(); shutdown("shutdown", ip.trim()); }}
                      confirmText="Confirm?"
                      className="rounded px-3 py-1.5 text-xs font-medium border border-accent-red/40 text-accent-red hover:bg-accent-red/10 transition-colors">
                      Shutdown
                    </ConfirmButton>
                  </div>
                </div>
              )}

              {/* WiFi */}
              {systemInfo && (
                <div>
                  <div className="text-[10px] font-bold text-text-dim uppercase tracking-wider mb-1.5">WiFi</div>
                  {!showWifi ? (
                    <button
                      onClick={() => { setShowWifi(true); getWifiNetworks(ip.trim()); }}
                      className="rounded px-3 py-1.5 text-xs font-medium bg-input-bg border border-panel-border text-text-dim hover:text-foreground hover:bg-panel-border transition-colors">
                      Scan Networks
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        {currentNetwork && <span className="text-xs text-accent-green">Connected: {currentNetwork}</span>}
                        <button onClick={() => setShowWifi(false)} className="text-[10px] text-text-dim hover:text-foreground">Hide</button>
                      </div>
                      <div className="max-h-28 overflow-y-auto space-y-0.5 bg-input-bg border border-panel-border rounded p-2">
                        {wifiNetworks.length === 0 && <div className="text-xs text-text-dim">No networks found</div>}
                        {wifiNetworks.map((net) => (
                          <button key={net.ssid}
                            onClick={() => setSelectedSsid(net.ssid === selectedSsid ? "" : net.ssid)}
                            className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs transition-colors ${
                              selectedSsid === net.ssid ? "bg-panel-border/50 text-foreground" : "hover:bg-panel-border/30 text-text-dim"
                            }`}>
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
                          <input type="password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)}
                            placeholder="Password"
                            className="flex-1 rounded bg-input-bg border border-panel-border px-2 py-1 text-xs text-foreground placeholder-text-dim" />
                          <button onClick={async () => {
                            const r = await connectWifi(selectedSsid, wifiPassword, ip.trim());
                            if (r.success) { setSelectedSsid(""); setWifiPassword(""); getWifiNetworks(ip.trim()); }
                          }} className="rounded px-3 py-1 text-xs font-medium bg-accent-red hover:bg-accent-red-bright text-white transition-colors">
                            Connect
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Logs — full-width at bottom */}
          {(loading === "starting" || startupLogs.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider">System Log</span>
                <div className="flex items-center gap-2">
                  {loading === "starting" && <span className="text-accent-amber text-[10px] animate-pulse">Running...</span>}
                  {loading !== "starting" && startupLogs.length > 0 && (
                    <button onClick={clearStartupLogs} className="text-[10px] text-text-dim hover:text-foreground">Clear</button>
                  )}
                </div>
              </div>
              <div ref={logContainerRef}
                className="h-36 overflow-y-auto bg-input-bg border border-panel-border rounded p-2 font-mono text-xs">
                {startupLogs.map((log, i) => (
                  <div key={i} className={log.isError ? "text-accent-red" : "text-foreground"}>
                    <span className={log.isError ? "text-accent-red/70" : "text-accent-gold"}>[{log.timestamp}]</span> {log.message}
                  </div>
                ))}
                {loading === "starting" && <span className="text-accent-amber animate-pulse">_</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
