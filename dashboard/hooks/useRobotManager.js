"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export function useRobotManager({ onServicesStarted, onServicesStopped, robotIp }) {
  const [servicesRunning, setServicesRunning] = useState(false);
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(null); // null | "starting" | "stopping" | "rebooting" | "shutting-down"
  const [error, setError] = useState(null);
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [currentNetwork, setCurrentNetwork] = useState(null);
  const pollRef = useRef(null);
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

  const fetchStatus = useCallback(async (ip) => {
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
        return data;
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
    (ip) => {
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

  const startServices = useCallback(
    async (ip) => {
      setLoading("starting");
      setError(null);
      try {
        const res = await fetch("/api/robot/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip }),
        });
        const data = await res.json();
        if (data.success) {
          setServicesRunning(true);
          startPolling(ip);
          onServicesStarted?.(data.ip);
        } else {
          setError(data.message);
        }
        return data;
      } catch (err) {
        setError(err.message);
        return { success: false, message: err.message };
      } finally {
        setLoading(null);
      }
    },
    [onServicesStarted, startPolling]
  );

  const stopServices = useCallback(
    async (ip) => {
      setLoading("stopping");
      setError(null);
      try {
        onServicesStopped?.();
        const res = await fetch("/api/robot/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip }),
        });
        const data = await res.json();
        if (data.success) {
          setServicesRunning(false);
          stopPolling();
        } else {
          setError(data.message);
        }
        return data;
      } catch (err) {
        setError(err.message);
        return { success: false, message: err.message };
      } finally {
        setLoading(null);
      }
    },
    [onServicesStopped, stopPolling]
  );

  const shutdown = useCallback(async (action, ip) => {
    setLoading(action === "shutdown" ? "shutting-down" : "rebooting");
    setError(null);
    try {
      const res = await fetch("/api/robot/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ip }),
      });
      const data = await res.json();
      if (!data.success) setError(data.message);
      return data;
    } catch (err) {
      setError(err.message);
      return { success: false, message: err.message };
    } finally {
      setLoading(null);
    }
  }, []);

  const getWifiNetworks = useCallback(async (ip) => {
    try {
      const params = ip ? `?ip=${encodeURIComponent(ip)}` : "";
      const res = await fetch(`/api/robot/wifi${params}`);
      const data = await res.json();
      if (data.success) {
        setWifiNetworks(data.networks || []);
        setCurrentNetwork(data.currentNetwork);
      }
      return data;
    } catch (err) {
      return { success: false, message: err.message };
    }
  }, []);

  const connectWifi = useCallback(async (ssid, password, ip) => {
    try {
      const res = await fetch("/api/robot/wifi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password, ip }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, message: err.message };
    }
  }, []);

  return {
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
    fetchStatus,
    startPolling,
    stopPolling,
  };
}
