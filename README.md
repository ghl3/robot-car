# JetRacer Robot Car

Web-controlled Waveshare JetRacer robot car on Jetson Nano with SLAM mapping, live camera, and LIDAR visualization.

## Overview

A Next.js dashboard that manages, monitors, and drives a JetRacer robot car over WiFi. From the browser you can start/stop ROS services, monitor system health, drive with keyboard or on-screen controls, view a live camera feed, build SLAM maps with loop closure, and visualize LIDAR data -- all without SSH-ing into the robot.

## Architecture

```
Browser (Next.js)                          Jetson Nano (ROS Melodic)
┌────────────────────┐                     ┌──────────────────────────┐
│ Drive / Sensors    │◄──── WebSocket ────►│ rosbridge :9090          │
│ Camera feed        │◄──── HTTP GET ─────►│ web_video_server :8080   │
│ Management         │◄──── SSH ──────────►│ sshd :22                 │
└────────────────────┘                     │                          │
                                           │ jetracer (motor/odom)    │
                                           │ rplidarNode (LIDAR)      │
                                           │ laser_filters            │
                                           │ slam_toolbox (SLAM)      │
                                           │ gscam (camera)           │
                                           └──────────────────────────┘
```

## Quick Start

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000`, enter the robot's IP (`192.168.7.107` default), and click **Connect**. The dashboard installs any missing ROS packages and launches all services automatically.

For first-time setup of a new Jetson, see [docs/setup.md](docs/setup.md).

## Features

- **Drive controls** -- D-pad buttons, WASD/arrow keyboard controls, adjustable speed/steering sliders, emergency stop
- **Live camera** -- MJPEG stream from CSI camera
- **SLAM mapping** -- real-time occupancy grid with slam_toolbox (graph-based SLAM with loop closure)
- **LIDAR visualization** -- live scan points and polar grid view
- **System monitoring** -- temperatures, memory, disk, per-component process status
- **Component management** -- start/stop/restart individual ROS nodes
- **WiFi management** -- scan and connect to networks from the dashboard
- **Recording** -- rosbag record/playback for offline analysis

## Keyboard Controls

| Key | Action |
|-----|--------|
| `W` / `Up` | Forward |
| `S` / `Down` | Backward |
| `A` / `Left` | Left |
| `D` / `Right` | Right |
| `Space` | Stop |

## Project Structure

```
robot_car/
├── dashboard/                        # Next.js web application
│   ├── app/
│   │   ├── api/robot/                # API routes
│   │   │   ├── connect/              #   SSH connect + service launch (SSE)
│   │   │   ├── disconnect/           #   Stop all services
│   │   │   ├── status/               #   Health monitoring
│   │   │   ├── restart-component/    #   Per-node restart
│   │   │   ├── maps/                 #   Map save/load, rosbag record/play
│   │   │   ├── shutdown/             #   Reboot / shutdown
│   │   │   └── wifi/                 #   Network scan / connect
│   │   ├── page.tsx                  #   Main dashboard page
│   │   └── layout.tsx                #   Root layout
│   ├── components/
│   │   ├── StatusBar.tsx             # Connection, health, WiFi, power
│   │   ├── CameraFeed.tsx            # MJPEG camera stream
│   │   ├── MapViewer.tsx             # SLAM map + LIDAR visualization
│   │   └── DriveControls.tsx         # D-pad, sliders, E-STOP
│   ├── hooks/
│   │   ├── useRobot.ts              # ROS WebSocket connection + publish
│   │   ├── useRobotManager.ts       # API route integration
│   │   ├── useKeyboardControls.ts   # WASD / arrow key bindings
│   │   ├── useTopic.ts             # State-based ROS subscription
│   │   ├── useTopicRef.ts          # Ref-based subscription (no re-renders)
│   │   └── usePose.ts             # TF frame composition for robot pose
│   ├── lib/
│   │   ├── ssh.ts                   # SSH connection management
│   │   └── robot-config.ts         # Default config & localStorage
│   └── types/
│       └── roslib.d.ts             # TypeScript declarations for roslib
├── scripts/
│   ├── start_jetracer.sh            # Launch ROS services + watchdog
│   ├── slam_toolbox_params.yaml     # SLAM configuration
│   ├── laser_filter.yaml            # Laser scan filter config
│   ├── setup_jetson.sh              # First-time Jetson setup
│   ├── flash_sd_card.sh             # Flash OS image to SD card
│   ├── download_jetracer_image.sh   # Download pre-built Jetson image
│   ├── snapshot_sd_card.sh          # Backup SD card to .img.gz
│   ├── send_command.sh              # Send test rostopic commands
│   ├── shutdown_jetracer.sh         # Graceful robot shutdown
│   └── control_jetracer.py          # Python terminal control client
├── docs/                             # Documentation
│   ├── setup.md                     # Hardware, SD card, first-time setup
│   ├── connection.md                # SSH, rosbridge, communication protocols
│   ├── robot-software.md            # On-device ROS nodes and data flow
│   ├── mapping.md                   # SLAM algorithm, config, mapping tips
│   └── dashboard.md                 # UI components, rendering, API routes
└── images/                           # OS images and backups
```

## Documentation

| Doc | Covers |
|-----|--------|
| [Setup](docs/setup.md) | Hardware, SD card flashing, first-time Jetson setup, steering calibration |
| [Connection](docs/connection.md) | SSH, connect flow, rosbridge WebSocket, ROS topics, subscription hooks |
| [Robot Software](docs/robot-software.md) | On-device ROS nodes, startup sequence, watchdog, component management |
| [Mapping](docs/mapping.md) | SLAM algorithm, slam_toolbox parameters, laser filtering, mapping tips |
| [Dashboard](docs/dashboard.md) | UI components, map rendering, coordinate transforms, color scheme, API routes |
