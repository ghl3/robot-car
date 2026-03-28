# Dashboard

The browser-based control panel for the JetRacer robot car.

## Stack

- **Next.js 14** (App Router) with React and TypeScript
- **Tailwind CSS** for styling
- **roslib** for ROS WebSocket communication
- **node-ssh** for server-side SSH to the Jetson

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  JETRACER // COMMAND CONSOLE                                │
├─────────────────────────────────────────────────────────────┤
│  StatusBar: IP, Connect/Disconnect, component pills,        │
│             system health, WiFi, power controls              │
├───────────────────────────┬─────────────────────────────────┤
│  CameraFeed               │  MapViewer                      │
│  (MJPEG stream)           │  (SLAM map / LIDAR scan)        │
├───────────────────────────┴─────────────────────────────────┤
│  DriveControls: D-pad, speed/steering/turn sliders, E-STOP  │
└─────────────────────────────────────────────────────────────┘
```

Two-column on desktop, stacked on mobile.

## Components

### StatusBar (`components/StatusBar.tsx`)

**Collapsed bar:**
- Connection status dot (colored + animated glow)
- IP address (editable when disconnected)
- Connect / Disconnect / Restart All buttons
- Component pills: CAM, VID, LIDAR, SLAM, JETRACER — green when running, click to restart if down
- Micro-stats: SSH/ROS/WS status dots, max temperature, memory %

**Expanded section:**
- SSH credentials (username/password, saved to localStorage)
- Temperature readouts by zone (CPU, GPU, AO, PLL, Fan, WiFi)
- Memory and disk usage bars
- Uptime
- Reboot / Shutdown (3-second confirmation hold)
- WiFi scanner (SSID, security, signal strength, connect with password)
- System log (scrolling, timestamped, color-coded)

### CameraFeed (`components/CameraFeed.tsx`)

Renders the MJPEG stream from `web_video_server` as an `<img>` tag:
```
http://{robotIp}:8080/stream?topic=/csi_cam_0/image_raw
```

Shows contextual offline messages: "NO SIGNAL", "Camera Offline", "Video Server Offline", or "Stream Error" with a retry button.

### MapViewer (`components/MapViewer.tsx`)

Two modes:
- **LIDAR view** — polar grid with live scan dots (before SLAM starts)
- **SLAM view** — occupancy grid map with robot marker and odometry trail

#### Map rendering pipeline

1. **`rebuildMapImage`** — when a new `/map` message arrives, render the occupancy grid to an offscreen canvas:
   - Unknown (-1): transparent
   - Free (0): white
   - Occupied (1-100): gradient from warm tan to dark red

2. **`drawFrame`** — `requestAnimationFrame` loop compositing layers:
   1. Background (`#ece7e0`)
   2. Grid lines (1m spacing, light gold)
   3. Map image (offscreen canvas, unknown areas transparent)
   4. Odometry trail (fading opacity breadcrumbs)
   5. Robot marker (brass arrow showing heading)
   6. Metadata overlay (dimensions, resolution, exploration %)
   7. Playback indicator (during rosbag replay)

Scan dots are **not** drawn in map view — they're redundant with the map and update at different rates.

#### Coordinate transforms

```
World (ROS)  →  Grid (cells)  →  Screen (pixels)
  Y-up             Y-down            Y-down
```

World → Grid: `col = (x - origin.x) / resolution`, `row = height - (y - origin.y) / resolution`

World → Screen (combined): `screenX = robotScreenX + (worldX - pose.x) * scale`, `screenY = robotScreenY - (worldY - pose.y) * scale`

#### Map controls

| Action | Effect |
|--------|--------|
| Scroll wheel | Zoom (0.2x to 20x) |
| Click + drag | Pan (disables auto-tracking) |
| Double-click | Reset: re-center, zoom 1x, re-enable tracking |
| Reset Trail | Clear odometry breadcrumbs |
| Reset Map | Kill + restart SLAM and scan filter |

### DriveControls (`components/DriveControls.tsx`)

- **D-pad** — Forward, Reverse, Left, Right buttons (mouse + touch)
- **E-STOP** — kills all motion
- **Drive mode selector** — M (manual), A, S, D modes
- **Sliders** — Speed (0.1-1.0), Steering (0.1-0.6), Turn Drive (0.1-1.0)

Commands publish to `/cmd_vel` as `geometry_msgs/Twist`, rate-limited to one per 100ms.

**Keyboard controls:**

| Key | Action |
|-----|--------|
| `W` / `Up` | Forward |
| `S` / `Down` | Backward |
| `A` / `Left` | Left |
| `D` / `Right` | Right |
| `Space` | Stop |

Arrow keys always control movement — sliders blur on release to prevent capturing keyboard focus.

## Color Scheme

Bold red 60s sci-fi aesthetic with brass accents and Share Tech Mono font.

| Element | Color |
|---------|-------|
| Background | Warm beige `#ece7e0` |
| Free space | White |
| Low occupancy | Warm tan `(220, 160, 120)` |
| High occupancy | Dark red `(196, 48, 32)` |
| Scan points | Gold `#daa520` |
| Robot marker | Brass `#b8952a` |
| Grid lines | Light gold `rgba(180, 150, 80, 0.12)` |
| Trail | Dark burnt orange, fading opacity |

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/robot/connect` | Start services (SSE streaming response) |
| POST | `/api/robot/disconnect` | Stop all services |
| GET | `/api/robot/status` | Health metrics (temps, memory, disk, processes) |
| POST | `/api/robot/shutdown` | Reboot or shutdown |
| POST | `/api/robot/restart-component` | Restart individual node |
| GET | `/api/robot/wifi` | List WiFi networks |
| POST | `/api/robot/wifi` | Connect to WiFi |
| GET | `/api/robot/maps` | List saved maps or bags |
| POST | `/api/robot/maps` | Save/delete maps, record/play/stop bags |

All routes accept `ip`, `username`, `password` (POST in body, GET as query params).

## Project Structure

```
dashboard/
├── app/
│   ├── api/robot/          # API routes (connect, status, restart, wifi, maps, etc.)
│   ├── page.tsx            # Main page — composes StatusBar, CameraFeed, MapViewer, DriveControls
│   └── layout.tsx          # Root layout (fonts, metadata)
├── components/
│   ├── StatusBar.tsx        # Connection, system health, WiFi, power
│   ├── CameraFeed.tsx       # MJPEG camera stream
│   ├── MapViewer.tsx        # SLAM map + LIDAR visualization
│   └── DriveControls.tsx    # D-pad, sliders, keyboard driving
├── hooks/
│   ├── useRobot.ts          # ROS WebSocket connection + publish
│   ├── useRobotManager.ts   # API route integration (connect, status, restart)
│   ├── useKeyboardControls.ts # WASD/arrow key bindings
│   ├── useTopic.ts          # State-based ROS topic subscription
│   ├── useTopicRef.ts       # Ref-based subscription (no re-renders)
│   └── usePose.ts           # TF frame composition for robot pose
├── lib/
│   ├── ssh.ts               # SSH connection management
│   └── robot-config.ts      # Default config & localStorage helpers
└── types/
    └── roslib.d.ts          # TypeScript declarations for roslib
```
