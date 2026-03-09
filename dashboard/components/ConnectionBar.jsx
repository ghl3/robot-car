"use client";

import { useState, useEffect } from "react";
import { getStoredIp } from "@/lib/robot-config";

const STATUS_CONFIG = {
  disconnected: { color: "bg-red-500", text: "Disconnected" },
  connecting: { color: "bg-yellow-500 animate-pulse", text: "Connecting..." },
  connected: { color: "bg-green-500", text: "Connected" },
  reconnecting: { color: "bg-yellow-500 animate-pulse", text: "Reconnecting..." },
};

export default function ConnectionBar({ status, onConnect, onDisconnect }) {
  const [ip, setIp] = useState("");

  useEffect(() => {
    setIp(getStoredIp());
  }, []);

  const isConnected = status === "connected" || status === "reconnecting";
  const { color, text } = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isConnected) {
      onDisconnect();
    } else {
      onConnect(ip.trim());
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-3"
    >
      <input
        type="text"
        value={ip}
        onChange={(e) => setIp(e.target.value)}
        placeholder="Robot IP"
        disabled={isConnected}
        className="rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-white placeholder-zinc-500 w-44 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={status === "connecting"}
        className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
          isConnected
            ? "bg-zinc-700 hover:bg-zinc-600 text-white"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        } disabled:opacity-50`}
      >
        {isConnected ? "Disconnect" : "Connect"}
      </button>
      <div className="flex items-center gap-2 ml-2">
        <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-sm text-zinc-400">{text}</span>
      </div>
    </form>
  );
}
