# Robot Software

What runs on the Jetson Nano, how it starts, and how data flows between nodes.

## ROS Nodes

```
┌─────────────────────────────────────────────────────────────┐
│  Jetson Nano (ROS Melodic)                                  │
│                                                             │
│  roscore ─── ROS master (message routing)                   │
│                                                             │
│  jetracer ─── Motor control + wheel encoder odometry        │
│    publishes: /odom, /tf (odom → base_footprint)            │
│    subscribes: /cmd_vel                                     │
│                                                             │
│  rplidarNode ─── LIDAR driver (auto-launched)               │
│    publishes: /scan                                         │
│                                                             │
│  scan_to_scan_filter_chain ─── Laser scan cleanup           │
│    subscribes: /scan                                        │
│    publishes: /scan_filtered                                │
│                                                             │
│  async_slam_toolbox_node ─── SLAM mapping                   │
│    subscribes: /scan_filtered, /odom                        │
│    publishes: /map, /tf (map → odom)                        │
│                                                             │
│  gscam ─── CSI camera driver                                │
│    publishes: /csi_cam_0/image_raw                          │
│                                                             │
│  web_video_server ─── MJPEG streaming on :8080              │
│    subscribes: /csi_cam_0/image_raw                         │
│                                                             │
│  rosbridge_websocket ─── WebSocket bridge on :9090          │
│    bridges all topics to/from the dashboard                 │
└─────────────────────────────────────────────────────────────┘
```

## Startup Sequence

The startup script (`scripts/start_jetracer.sh`) is uploaded to `/tmp/` on the Jetson and run via `nohup`. It launches services in this order:

1. **roscore** — ROS master (must be first)
2. **jetracer.launch** — motor control, encoder odometry, servo
3. **Servo bias** — applies steering calibration via `dynparam set /jetracer servo_bias`
4. **gscam** — CSI camera driver
5. **web_video_server** — MJPEG streaming
6. **rosbridge_websocket** — WebSocket bridge (port 9090)

After startup, the script enters a watchdog loop (every 5 seconds):

- **LIDAR watchdog** — if `/dev/ttyACM1` appears and no lidar is running, launches:
  1. `rplidarNode` (lidar driver)
  2. `scan_to_scan_filter_chain` (laser filters)
  3. `async_slam_toolbox_node` (SLAM)
- **Camera watchdog** — restarts `gscam` if it dies
- **Web video server watchdog** — restarts if it crashes

The script traps SIGINT/SIGTERM and kills all child processes on exit.

## Component Dependencies

```
rplidarNode → scan_to_scan_filter_chain → slam_toolbox
                                              ↑
jetracer (/odom) ─────────────────────────────┘
```

slam_toolbox requires both filtered LIDAR data and odometry. If the scan filter isn't running, slam_toolbox has no input and won't produce a map. The dashboard's "Reset Map" button restarts both the slam and scan_filter components.

## TF Frame Tree

```
map → odom → base_footprint
 │      │
 │      └── Published by jetracer (wheel encoder dead-reckoning)
 └── Published by slam_toolbox (corrects odom drift via scan matching)
```

The dashboard composes `map → odom → base_footprint` to get the robot's global pose. If the map frame isn't available yet (SLAM hasn't started), it falls back to `odom → base_footprint`.

## Component Restart

Individual nodes can be restarted from the dashboard via `POST /api/robot/restart-component`. Each component has a kill and start command:

| Component | Process | Notes |
|-----------|---------|-------|
| `camera` | gscam | CSI camera driver |
| `web_video_server` | web_video_server | MJPEG streaming |
| `rosbridge` | rosbridge | WebSocket bridge |
| `lidar` | rplidarNode | LIDAR driver |
| `scan_filter` | scan_to_scan_filter_chain | Loads params from `/tmp/laser_filter.yaml` |
| `slam` | async_slam_toolbox_node | Loads params from `/tmp/slam_toolbox_params.yaml` |
| `jetracer` | jetracer.launch | Motor control + encoders |

Kill uses `pkill` followed by `pkill -9` after 1 second. Start uses `nohup` without PTY so processes survive SSH disconnect.

## Health Monitoring

The status endpoint (`GET /api/robot/status`) polls the Jetson every few seconds:

| Metric | Source |
|--------|--------|
| Temperatures (CPU, GPU, AO, PLL, Fan, WiFi) | `/sys/devices/virtual/thermal/thermal_zone*` |
| Memory (total, used, %) | `free -m` |
| Disk (size, used, available, %) | `df -h` |
| Uptime | `uptime -p` |
| LIDAR hardware present | Test `/dev/ttyACM1` exists |
| Process status | `pgrep` for each node |

Temperature zones exclude PMIC-Die (always reads 100C, not meaningful).

## Recording & Playback

The maps API (`POST /api/robot/maps`) supports rosbag recording for offline analysis:

| Action | What it does |
|--------|-------------|
| `start_recording` | `rosbag record` for `/scan`, `/map`, `/tf`, `/odom`, `/cmd_vel` |
| `stop_recording` | `pkill -INT` the recorder (graceful stop) |
| `play_bag` | `rosbag play --clock` for simulated-time replay |
| `stop_playback` | Kill the player |
| `save` | Save current SLAM map via `map_saver` (.pgm + .yaml) |

Bags are stored in `~/bags/` and maps in `~/maps/` on the Jetson.

## Key Files

| File | Role |
|------|------|
| `scripts/start_jetracer.sh` | Startup script with watchdog loops |
| `scripts/laser_filter.yaml` | Laser scan filter configuration |
| `scripts/slam_toolbox_params.yaml` | slam_toolbox SLAM parameters |
| `dashboard/app/api/robot/restart-component/route.ts` | Per-component restart commands |
| `dashboard/app/api/robot/status/route.ts` | Health monitoring endpoint |
| `dashboard/app/api/robot/maps/route.ts` | Map save/load, rosbag record/playback |
