"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface SystemInfo {
  cpuTemp: number | null;
  memoryUsage: { totalMB: number; usedMB: number; percent: number } | null;
  diskUsage: { size: string; used: string; available: string; percent: string } | null;
  uptime: string;
  ip: string;
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

interface UseRobotManagerOptions {
  onServicesStarted?: (ip: string) => void;
  onServicesStopped?: () => void;
  robotIp: string;
}

export function useRobotManager({ onServicesStarted, onServicesStopped, robotIp }: UseRobotManagerOptions) {
  const [servicesRunning, setServicesRunning] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState<LoadingState>(null);
  const [error, setError] = useState<string | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([]);
  const [currentNetwork, setCurrentNetwork] = useState<string | null>(null);
  const [startupLogs, setStartupLogs] = useState<StartupLog[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ipRef = useRef(robotIp);

  useEffect(() => {
    ipRef.current = robotIp;
  }, [robotIp]);

  const clearPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (ip: string) => {
    try {
      const params = ip ? `?ip=${encodeURIComponent(ip)}` : "";
      const res = await fetch(`/api/robot/status${params}`);
      const data = await res.json();
      if (data.success) {
        setSystemInfo({
          cpuTemp: data.cpuTemp,
          memoryUsage: data.memoryUsage,
          diskUsage: data.diskUsage,
          uptime: data.uptime,
          ip: data.ip,
        });
        setServicesRunning(data.rosRunning);
        setError(null);
        return data as ApiResponse;
      } else {
        setServicesRunning(false);
        setSystemInfo(null);
        return null;
      }
    } catch {
      setServicesRunning(false);
      setSystemInfo(null);
      return null;
    }
  }, []);

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
    async (ip: string): Promise<ApiResponse> => {
      setLoading("starting");
      setError(null);
      setStartupLogs([]);

      try {
        const res = await fetch("/api/robot/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip }),
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
    [onServicesStarted, startPolling, appendLog]
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
          body: JSON.stringify({ ip }),
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
    [onServicesStopped, stopPolling]
  );

  const shutdown = useCallback(async (action: string, ip: string): Promise<ApiResponse> => {
    setLoading(action === "shutdown" ? "shutting-down" : "rebooting");
    setError(null);
    try {
      const res = await fetch("/api/robot/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ip }),
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
  }, []);

  const getWifiNetworks = useCallback(async (ip: string): Promise<ApiResponse> => {
    try {
      const params = ip ? `?ip=${encodeURIComponent(ip)}` : "";
      const res = await fetch(`/api/robot/wifi${params}`);
      const data = await res.json();
      if (data.success) {
        setWifiNetworks(data.networks || []);
        setCurrentNetwork(data.currentNetwork);
      }
      return data as ApiResponse;
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }, []);

  const connectWifi = useCallback(async (ssid: string, password: string, ip: string): Promise<ApiResponse> => {
    try {
      const res = await fetch("/api/robot/wifi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password, ip }),
      });
      return await res.json() as ApiResponse;
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }, []);

  return {
    servicesRunning,
    systemInfo,
    loading,
    error,
    wifiNetworks,
    currentNetwork,
    startupLogs,
    startServices,
    stopServices,
    shutdown,
    getWifiNetworks,
    connectWifi,
    fetchStatus,
    startPolling,
    stopPolling,
    clearStartupLogs,
  };
}
