"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface SystemInfo {
  temps: Record<string, number>;
  memoryUsage: { totalMB: number; usedMB: number; percent: number } | null;
  diskUsage: { size: string; used: string; available: string; percent: string } | null;
  uptime: string;
  ip: string;
  lidarDetected: boolean;
  lidarActive: boolean;
  slamActive: boolean;
  recordingActive: boolean;
  playbackActive: boolean;
  cameraActive: boolean;
  webVideoServerActive: boolean;
  detectnetActive: boolean;
  depthnetActive: boolean;
  navActive: boolean;
  lastMapSave: number;
  powerVoltage: number;
  powerCurrent: number;
  powerWatts: number;
}

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
}

type LoadingState = "starting" | "stopping" | "rebooting" | "shutting-down" | null;

interface ApiResponse {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

interface StartupLog {
  timestamp: string;
  message: string;
  isError?: boolean;
}

interface Credentials {
  username: string;
  password: string;
}

interface UseRobotManagerOptions {
  onServicesStarted?: (ip: string) => void;
  onServicesStopped?: () => void;
  robotIp: string;
  credentials: Credentials;
}

export function useRobotManager({ onServicesStarted, onServicesStopped, robotIp, credentials }: UseRobotManagerOptions) {
  const [servicesRunning, setServicesRunning] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState<LoadingState>(null);
  const [error, setError] = useState<string | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([]);
  const [currentNetwork, setCurrentNetwork] = useState<string | null>(null);
  const [startupLogs, setStartupLogs] = useState<StartupLog[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ipRef = useRef(robotIp);
  const credsRef = useRef(credentials);
  const failCountRef = useRef(0);

  useEffect(() => {
    ipRef.current = robotIp;
  }, [robotIp]);

  useEffect(() => {
    credsRef.current = credentials;
  }, [credentials]);

  /** Build query params with credentials for GET requests */
  const credParams = useCallback((ip: string) => {
    const params = new URLSearchParams({ ip });
    if (credsRef.current.username) params.set("username", credsRef.current.username);
    if (credsRef.current.password) params.set("password", credsRef.current.password);
    return params.toString();
  }, []);

  /** Build body with credentials for POST requests */
  const credBody = useCallback((data: Record<string, unknown>) => {
    return {
      ...data,
      username: credsRef.current.username,
      password: credsRef.current.password,
    };
  }, []);

  const clearPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (ip: string) => {
    try {
      const res = await fetch(`/api/robot/status?${credParams(ip)}`);
      const data = await res.json();
      if (data.success) {
        failCountRef.current = 0;
        setSystemInfo({
          temps: (data.temps as Record<string, number>) || {},
          memoryUsage: data.memoryUsage,
          diskUsage: data.diskUsage,
          uptime: data.uptime,
          ip: data.ip,
          lidarDetected: data.lidarDetected ?? false,
          lidarActive: data.lidarActive ?? false,
          slamActive: data.slamActive ?? false,
          recordingActive: data.recordingActive ?? false,
          playbackActive: data.playbackActive ?? false,
          cameraActive: data.cameraActive ?? false,
          webVideoServerActive: data.webVideoServerActive ?? false,
          detectnetActive: data.detectnetActive ?? false,
          depthnetActive: data.depthnetActive ?? false,
          navActive: data.navActive ?? false,
          lastMapSave: data.lastMapSave ?? 0,
          powerVoltage: data.powerVoltage ?? 0,
          powerCurrent: data.powerCurrent ?? 0,
          powerWatts: data.powerWatts ?? 0,
        });
        setServicesRunning(data.rosRunning);
        setError(null);
        return data as ApiResponse;
      } else {
        // Keep last known state for a few failures before clearing
        failCountRef.current++;
        if (failCountRef.current >= 3) {
          setServicesRunning(false);
          setSystemInfo(null);
        }
        return null;
      }
    } catch {
      failCountRef.current++;
      if (failCountRef.current >= 3) {
        setServicesRunning(false);
        setSystemInfo(null);
      }
      return null;
    }
  }, [credParams]);

  const startPolling = useCallback(
    (ip: string) => {
      clearPolling();
      fetchStatus(ip);
      pollRef.current = setInterval(() => fetchStatus(ip), 5000);
    },
    [clearPolling, fetchStatus]
  );

  const stopPolling = useCallback(() => {
    clearPolling();
    setSystemInfo(null);
    setServicesRunning(false);
  }, [clearPolling]);

  // Cleanup on unmount
  useEffect(() => clearPolling, [clearPolling]);

  const clearStartupLogs = useCallback(() => {
    setStartupLogs([]);
  }, []);

  const appendLog = useCallback((message: string, isError = false) => {
    const now = new Date();
    const timestamp = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    setStartupLogs((prev) => [...prev, { timestamp, message, isError }]);
  }, []);

  const startServices = useCallback(
    async (ip: string, options?: { force?: boolean }): Promise<ApiResponse> => {
      setLoading("starting");
      setError(null);
      setStartupLogs([]);

      try {
        const res = await fetch("/api/robot/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credBody({ ip, force: options?.force })),
        });

        // Check if it's an SSE stream or a regular JSON response (e.g. 400 error)
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream")) {
          const data: ApiResponse = await res.json();
          if (!data.success) {
            appendLog(data.message ?? "Unknown error", true);
          }
          return data;
        }

        // Parse SSE stream
        const reader = res.body?.getReader();
        if (!reader) {
          const msg = "Failed to read response stream";
          appendLog(msg, true);
          return { success: false, message: msg };
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let result: ApiResponse = { success: false };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "log") {
                appendLog(data.message);
              } else if (data.type === "complete") {
                result = data as ApiResponse;
                if (data.success) {
                  appendLog(data.message || "Connected successfully.");
                  setServicesRunning(true);
                  startPolling(ip);
                  onServicesStarted?.(data.ip as string);
                } else {
                  appendLog(data.message ?? "Unknown error", true);
                }
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        return result;
      } catch (err) {
        const message = (err as Error).message;
        appendLog(message, true);
        return { success: false, message };
      } finally {
        setLoading(null);
      }
    },
    [onServicesStarted, startPolling, appendLog, credBody]
  );

  const stopServices = useCallback(
    async (ip: string): Promise<ApiResponse> => {
      setLoading("stopping");
      setError(null);
      try {
        onServicesStopped?.();
        const res = await fetch("/api/robot/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credBody({ ip })),
        });
        const data: ApiResponse = await res.json();
        if (data.success) {
          setServicesRunning(false);
          stopPolling();
        } else {
          setError(data.message ?? "Unknown error");
        }
        return data;
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        return { success: false, message };
      } finally {
        setLoading(null);
      }
    },
    [onServicesStopped, stopPolling, credBody]
  );

  const shutdown = useCallback(async (action: string, ip: string): Promise<ApiResponse> => {
    setLoading(action === "shutdown" ? "shutting-down" : "rebooting");
    setError(null);
    try {
      const res = await fetch("/api/robot/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ action, ip })),
      });
      const data: ApiResponse = await res.json();
      if (!data.success) setError(data.message ?? "Unknown error");
      return data;
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(null);
    }
  }, [credBody]);

  const getWifiNetworks = useCallback(async (ip: string): Promise<ApiResponse> => {
    try {
      const res = await fetch(`/api/robot/wifi?${credParams(ip)}`);
      const data = await res.json();
      if (data.success) {
        setWifiNetworks(data.networks || []);
        setCurrentNetwork(data.currentNetwork);
      }
      return data as ApiResponse;
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }, [credParams]);

  const connectWifi = useCallback(async (ssid: string, wifiPassword: string, ip: string): Promise<ApiResponse> => {
    try {
      const res = await fetch("/api/robot/wifi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ ssid, wifiPassword, ip })),
      });
      return await res.json() as ApiResponse;
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }, [credBody]);

  const restartComponent = useCallback(async (component: string): Promise<ApiResponse> => {
    try {
      const res = await fetch("/api/robot/restart-component", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credBody({ ip: ipRef.current, component })),
      });
      return await res.json() as ApiResponse;
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }, [credBody]);

  return {
    servicesRunning,
    systemInfo,
    loading,
    error,
    wifiNetworks,
    currentNetwork,
    startupLogs,
    isPolling: pollRef.current !== null,
    startServices,
    stopServices,
    shutdown,
    getWifiNetworks,
    connectWifi,
    fetchStatus,
    startPolling,
    stopPolling,
    clearStartupLogs,
    restartComponent,
  };
}
