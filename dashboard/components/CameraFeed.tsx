"use client";

import { useState, useEffect } from "react";

interface CameraFeedProps {
  robotIp: string | null;
  connected: boolean;
  cameraActive?: boolean;
  webVideoServerActive?: boolean;
}

export default function CameraFeed({ robotIp, connected, cameraActive, webVideoServerActive }: CameraFeedProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (connected && cameraActive && webVideoServerActive) setImgError(false);
  }, [connected, cameraActive, webVideoServerActive]);

  const streamUrl = `http://${robotIp}:8080/stream?topic=/csi_cam_0/image_raw`;
  const cameraDown = connected && cameraActive === false;
  const videoServerDown = connected && webVideoServerActive === false;
  const offline = !connected || cameraDown || videoServerDown || imgError;

  return (
    <div className="bg-panel border border-panel-border rounded overflow-hidden shadow-sm">
      <div className="bg-panel-header border-b border-panel-border uppercase tracking-widest text-xs text-panel-header-text px-4 py-2">
        CAMERA FEED
      </div>
      <div className="relative aspect-video bg-input-bg shadow-[inset_0_2px_8px_rgba(0,0,0,0.15)]">
        {offline ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {!connected ? (
              <span className="text-text-dim uppercase tracking-wider text-sm">NO SIGNAL</span>
            ) : (
              <>
                <div className="flex items-center gap-2 text-accent-red">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="uppercase tracking-wider text-sm font-medium">
                    {cameraDown ? "Camera Offline" : videoServerDown ? "Video Server Offline" : "Stream Error"}
                  </span>
                </div>
                {imgError && !cameraDown && !videoServerDown && (
                  <button onClick={() => setImgError(false)}
                    className="text-xs text-accent-amber hover:text-accent-amber/80 border border-accent-amber/30 rounded px-3 py-1 transition-colors">
                    Retry Stream
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <img src={streamUrl} alt="Camera feed"
            className="w-full h-full object-contain" onError={() => setImgError(true)} />
        )}
      </div>
    </div>
  );
}
