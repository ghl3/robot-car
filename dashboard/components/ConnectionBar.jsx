"use client";

const STATUS_CONFIG = {
  disconnected: { color: "bg-red-500", text: "Disconnected" },
  connecting: { color: "bg-yellow-500 animate-pulse", text: "Connecting..." },
  connected: { color: "bg-green-500", text: "Connected" },
  reconnecting: { color: "bg-yellow-500 animate-pulse", text: "Reconnecting..." },
};

export default function ConnectionBar({ status, ip }) {
  const { color, text } = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-2">
      {ip && <span className="text-sm text-zinc-400 font-mono">{ip}</span>}
      <div className="flex items-center gap-2">
        <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-sm text-zinc-400">{text}</span>
      </div>
    </div>
  );
}
