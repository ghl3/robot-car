"use client";

import { useState } from "react";

export default function CameraFeed({ robotIp, connected }) {
  const [error, setError] = useState(false);

  if (!connected) {
    return (
      <div className="flex items-center justify-center aspect-video bg-zinc-900 rounded-lg border border-zinc-800">
        <span className="text-zinc-500">Camera — Not connected</span>
      </div>
    );
  }

  const streamUrl = `http://${robotIp}:8080/stream?topic=/csi_cam_0/image_raw`;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 aspect-video bg-zinc-900 rounded-lg border border-zinc-800">
        <span className="text-zinc-500">Camera feed unavailable</span>
        <button
          onClick={() => setError(false)}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative aspect-video bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      <img
        src={streamUrl}
        alt="Camera feed"
        className="w-full h-full object-contain"
        onError={() => setError(true)}
      />
    </div>
  );
}
