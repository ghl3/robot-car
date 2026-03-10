"use client";

import type { RosStatus } from "@/hooks/useRobot";

interface ConnectionBarProps {
  status: RosStatus;
  ip: string | null;
}

const STATUS_CONFIG: Record<RosStatus, { color: string; glow: string; text: string }> = {
  disconnected: {
    color: "bg-accent-red",
    glow: "shadow-[0_0_6px_theme(--color-accent-red)]",
    text: "Disconnected",
  },
  connecting: {
    color: "bg-accent-amber animate-pulse",
    glow: "shadow-[0_0_6px_theme(--color-accent-amber)]",
    text: "Connecting...",
  },
  connected: {
    color: "bg-accent-green",
    glow: "shadow-[0_0_6px_theme(--color-accent-green)]",
    text: "Connected",
  },
  reconnecting: {
    color: "bg-accent-amber animate-pulse",
    glow: "shadow-[0_0_6px_theme(--color-accent-amber)]",
    text: "Reconnecting...",
  },
};

export default function ConnectionBar({ status, ip }: ConnectionBarProps) {
  const { color, glow, text } = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-3 bg-panel border border-panel-border rounded px-4 py-2 shadow-sm">
      {ip && <span className="text-sm text-text-dim font-mono">{ip}</span>}
      <div className="flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full ${color} ${glow}`} />
        <span className="text-sm text-text-label">{text}</span>
      </div>
    </div>
  );
}
