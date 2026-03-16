"use client";

import { useState, useEffect } from "react";

interface CameraFeedProps {
  robotIp: string | null;
  connected: boolean;
}

export default function CameraFeed({ robotIp, connected }: CameraFeedProps) {
  const [error, setError] = useState(false);

  // Reset error when connection state changes
  useEffect(() => {
    if (connected) setError(false);
  }, [connected]);

  if (!connected) {
    return (
      <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
        <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2">
          CAMERA FEED
        </div>
        <div className="flex items-center justify-center aspect-video bg-input-bg shadow-[inset_0_2px_8px_rgba(0,0,0,0.15)]">
          <span className="text-text-dim uppercase tracking-wider">NO SIGNAL</span>
        </div>
      </div>
    );
  }

  const streamUrl = `http://${robotIp}:8080/stream?topic=/csi_cam_0/image_raw`;

  if (error) {
    return (
      <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
        <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2">
          CAMERA FEED
        </div>
        <div className="flex flex-col items-center justify-center gap-2 aspect-video bg-input-bg shadow-[inset_0_2px_8px_rgba(0,0,0,0.15)]">
          <span className="text-text-dim uppercase tracking-wider">NO SIGNAL</span>
          <button
            onClick={() => setError(false)}
            className="text-sm text-accent-red hover:text-accent-red-bright"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2">
        CAMERA FEED
      </div>
      <div className="relative aspect-video bg-input-bg shadow-[inset_0_2px_8px_rgba(0,0,0,0.15)]">
        <img
          src={streamUrl}
          alt="Camera feed"
          className="w-full h-full object-contain"
          onError={() => setError(true)}
        />
      </div>
    </div>
  );
}
