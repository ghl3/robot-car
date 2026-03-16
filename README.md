# JetRacer Dashboard

Web-based control panel for a Waveshare JetRacer robot car on Jetson Nano.

## Overview

A Next.js dashboard that manages, monitors, and drives a JetRacer robot car over WiFi. The UI uses a vintage red-and-white aesthetic with brass accents and the Share Tech Mono font. From the browser you can start/stop ROS services, monitor system health, drive the car with keyboard or on-screen controls, view a live camera feed, and visualize LIDAR data — all without SSH-ing into the robot.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js React app)                                │
│                                                             │
│  Drive / LIDAR ──► WebSocket (roslib) ──► rosbridge :9090   │
│                                             │               │
│  Camera ──────► <img> tag ──► web_video_server :8080        │
│                                             │               │
│  Management ──► Next.js API routes ──► SSH ─┘               │
└─────────────────────────────────────────────────────────────┘
                                              │
                                   ┌──────────▼──────────┐
                                   │  Jetson Nano         │
                                   │  ROS Melodic         │
                                   │  jetracer package    │
                                   │  CSI camera          │
                                   │  LIDAR (optional)    │
                                   └─────────────────────┘
```

**Three communication paths:**

1. **WebSocket** — Browser connects to rosbridge on port 9090 via roslib. Publishes drive commands (`/cmd_vel`) and subscribes to sensor data (`/scan`).
2. **HTTP streaming** — Camera feed served by `web_video_server` on port 8080. The browser renders it as a plain `<img>` tag pointing at the stream URL.
3. **SSH via API routes** — Management operations (start/stop services, system status, WiFi config, reboot/shutdown) go through Next.js API routes that SSH into the Jetson.

## Prerequisites

- **Jetson Nano** with ROS Melodic and a catkin workspace containing the `jetracer` package
- **Node.js 18+** on your development machine
- Network connectivity between your machine and the Jetson (USB ethernet or WiFi)

## Getting Started

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000`, enter the robot's IP address, and click **Start Services**. The dashboard streams startup logs as it installs any missing ROS packages and launches the jetracer stack.

**Default credentials:**

| Field    | Default         |
|----------|-----------------|
| IP       | `192.168.7.107` |
| Username | `jetson`        |
| Password | `jetson`        |

The IP can also be set via the `NEXT_PUBLIC_ROBOT_IP` environment variable.

## SD Card Setup

For a fresh Jetson Nano:

1. Download the pre-built image:
   ```bash
   ./scripts/download_jetracer_image.sh
   ```
2. Flash to SD card:
   ```bash
   ./scripts/flash_sd_card.sh -i images/waveshare-jetracer-ros.img
   ```
3. Boot the Jetson and run first-time setup:
   ```bash
   ./scripts/setup_jetson.sh [robot-ip]
   ```
   This copies your SSH key, configures passwordless sudo, installs ROS packages, and verifies the catkin workspace.

## Dashboard Features

### Robot Manager

- **Start / Stop** ROS services with live streaming logs
- **System health** — CPU, GPU, AO, PLL, fan, and WiFi temperatures; memory and disk usage with color-coded thresholds (green < 60°C/70%, amber < 80°C/90%, red above)
- **Reboot / Shutdown** with confirmation prompts
- **WiFi management** — scan networks, view signal strength, connect to a new network

### Drive Controls

- **D-pad buttons** — Forward, Reverse, Left, Right (mouse and touch)
- **Emergency Stop** — kills all motion immediately
- **Speed slider** — 0.1–1.0 (default 0.5), controls forward/backward velocity
- **Steering slider** — 0.1–0.6 (default 0.6), controls turn angle
- **Turn Drive slider** — 0.1–1.0 (default 0.35), velocity when turning in place
- Commands are rate-limited to one every 100ms

### Camera Feed

Live MJPEG stream from the CSI camera via `web_video_server`. Shows "NO SIGNAL" when disconnected with a manual retry button.

### LIDAR Viewer

Real-time point cloud visualization rendered on a canvas using `requestAnimationFrame`. Subscribes to the `/scan` topic.

## Keyboard Controls

| Key           | Action   |
|---------------|----------|
| `W` / `↑`    | Forward  |
| `S` / `↓`    | Backward |
| `A` / `←`    | Left     |
| `D` / `→`    | Right    |
| `Space`       | Stop     |

Keyboard controls are only active when the ROS connection is established.

## ROS Topics

| Topic | Type | Direction | Description |
|-------|------|-----------|-------------|
| `/cmd_vel` | `geometry_msgs/Twist` | Publish | `linear.x` = speed, `angular.z` = steering angle |
| `/scan` | `sensor_msgs/LaserScan` | Subscribe | LIDAR point cloud |
| `/csi_cam_0/image_raw` | — | Stream | Camera feed (via web_video_server, not roslib) |

## Direct Robot Commands

Useful for manual testing over SSH:

```bash
# Drive forward at 0.5 m/s
rostopic pub -1 /cmd_vel geometry_msgs/Twist \
  '{linear: {x: 0.5, y: 0, z: 0}, angular: {x: 0, y: 0, z: 0}}'

# Turn left
rostopic pub -1 /cmd_vel geometry_msgs/Twist \
  '{linear: {x: 0, y: 0, z: 0}, angular: {x: 0, y: 0, z: 0.5}}'

# Stop
rostopic pub -1 /cmd_vel geometry_msgs/Twist \
  '{linear: {x: 0, y: 0, z: 0}, angular: {x: 0, y: 0, z: 0}}'
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/robot/connect` | Start ROS services (SSE streaming response) |
| POST | `/api/robot/disconnect` | Stop all ROS services |
| GET  | `/api/robot/status` | System health (temps, memory, disk, uptime) |
| POST | `/api/robot/shutdown` | Reboot or shutdown (`action`: `"reboot"` or `"shutdown"`) |
| GET  | `/api/robot/wifi` | List available WiFi networks |
| POST | `/api/robot/wifi` | Connect to a WiFi network |

All routes accept `ip`, `username`, and `password` parameters (POST in body, GET as query params). Credentials default to `jetson`/`jetson`.

## Configuration

**Browser-side** — credentials are cached in `localStorage`:

| Key | Purpose |
|-----|---------|
| `robot-ip` | Robot IP address |
| `robot-user` | SSH username |
| `robot-pass` | SSH password |

**Environment variable:**

- `NEXT_PUBLIC_ROBOT_IP` — sets the default IP when no localStorage value exists

## Steering Calibration

After reinstalling the servo horn, the wheels may not center properly. The `SERVO_BIAS` constant in `dashboard/app/api/robot/connect/route.ts` corrects this.

1. Start services and find the right bias interactively:
   ```bash
   rosrun dynamic_reconfigure dynparam set /jetracer servo_bias <value>
   ```
2. Test different values until the wheels are straight at rest.
3. Update the constant to persist across restarts:
   ```typescript
   // dashboard/app/api/robot/connect/route.ts
   const SERVO_BIAS = 250;  // adjust this value
   ```

A value of `0` disables the correction.

## Project Structure

```
robot_car/
├── dashboard/                     # Next.js web application
│   ├── app/
│   │   ├── api/robot/             # API routes (connect, disconnect, status, shutdown, wifi)
│   │   ├── page.tsx               # Main dashboard page
│   │   └── layout.tsx             # Root layout
│   ├── components/
│   │   ├── ConnectionBar.tsx      # Connection status display
│   │   ├── CameraFeed.tsx         # Live camera stream
│   │   ├── DriveControls.tsx      # D-pad, sliders, emergency stop
│   │   ├── LidarViewer.tsx        # LIDAR point cloud canvas
│   │   └── RobotManager.tsx       # Service management & system health
│   ├── hooks/
│   │   ├── useRobot.ts            # ROS WebSocket connection
│   │   ├── useRobotManager.ts     # API route integration
│   │   ├── useKeyboardControls.ts # WASD / arrow key handling
│   │   └── useTopic.ts            # ROS topic pub/sub
│   ├── lib/
│   │   ├── robot-config.ts        # Default config & localStorage helpers
│   │   └── ssh.ts                 # SSH connection utilities
│   └── types/
│       └── roslib.d.ts            # TypeScript declarations for roslib
├── scripts/
│   ├── setup_jetson.sh            # First-time Jetson setup
│   ├── start_jetracer.sh          # Launch ROS services
│   ├── flash_sd_card.sh           # Flash OS image to SD card
│   ├── download_jetracer_image.sh # Download pre-built Jetson image
│   ├── snapshot_sd_card.sh        # Backup SD card to .img.gz
│   ├── send_command.sh            # Send test rostopic commands
│   ├── shutdown_jetracer.sh       # Graceful robot shutdown
│   └── control_jetracer.py        # Python terminal control client
└── images/                        # OS images and backups
```

## Scripts

| Script | Description |
|--------|-------------|
| `setup_jetson.sh [ip]` | Copy SSH key, configure sudo, install ROS packages, verify catkin workspace |
| `start_jetracer.sh` | Install missing packages and launch roscore, jetracer, and web_video_server |
| `flash_sd_card.sh -i <image>` | Write an OS image to an auto-detected external disk |
| `download_jetracer_image.sh` | Download the pre-built Waveshare JetRacer image from Google Drive |
| `snapshot_sd_card.sh` | Back up an SD card to a timestamped compressed image |
| `send_command.sh <ip>` | Publish a test `/cmd_vel` message over SSH |
| `shutdown_jetracer.sh <ip>` | Kill ROS processes and shut down the Jetson |
| `control_jetracer.py` | Interactive Python client — connect to rosbridge and drive with the keyboard |
