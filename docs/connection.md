# Connection & Communication

How the dashboard connects to the robot and how data flows between them.

## Three Communication Paths

```
Browser (Next.js)                          Jetson Nano
┌────────────────────┐                     ┌─────────────────┐
│ Drive / Sensors    │◄──── WebSocket ────►│ rosbridge :9090  │
│ Camera feed        │◄──── HTTP GET ─────►│ web_video_server │
│ Management / SSH   │◄──── SSH ──────────►│ sshd :22         │
└────────────────────┘                     └─────────────────┘
```

1. **WebSocket (rosbridge)** — real-time ROS communication on port 9090 via roslib. Publishes drive commands (`/cmd_vel`), subscribes to sensor data (`/scan`, `/map`, `/tf`).
2. **HTTP (camera)** — MJPEG stream from `web_video_server` on port 8080. Rendered as a plain `<img>` tag.
3. **SSH (management)** — Next.js API routes SSH into the Jetson for service management, system health, WiFi config, and reboot/shutdown.

## SSH

### Authentication

The SSH library (`dashboard/lib/ssh.ts`) tries key-based auth first, then falls back to password:

1. Searches `~/.ssh/` for private keys: `id_ed25519`, `id_rsa`, `id_ecdsa`
2. If found, authenticates with the key (no password needed)
3. If no key, uses username/password (default `jetson`/`jetson`)

Connection timeout is 10 seconds.

### Two usage patterns

- **Ephemeral** (`executeCommand`) — opens a connection, runs one command, closes. Used by status polling, restart, shutdown.
- **Persistent** (`getSSHConnection`) — returns a long-lived `NodeSSH` instance. Caller must call `.dispose()`. Used by the connect flow which runs many commands in sequence.

### Sudo

Some operations require root (package install, device permissions). The connect flow configures passwordless sudo in `/etc/sudoers.d/`. When that's not set up yet, it pipes the SSH password: `echo '<pass>' | sudo -S <cmd>`.

## Connect Flow

When you click **Connect** in the dashboard, the endpoint `POST /api/robot/connect` runs this sequence over SSH, streaming progress to the browser via Server-Sent Events (SSE):

1. **Check if already running** — test if rosbridge port 9090 is reachable
2. **Establish SSH** — persistent connection for the session
3. **Configure sudo** — ensure passwordless sudo works
4. **Install packages** — check `dpkg -s` for 5 required packages, install any missing:
   - `ros-melodic-rosbridge-suite`
   - `ros-melodic-web-video-server`
   - `ros-melodic-slam-toolbox`
   - `ros-melodic-map-server`
   - `ros-melodic-laser-filters`
   - Also refreshes the ROS GPG key (Melodic's key often expires)
5. **Upload configs** — writes three files to `/tmp/` on the Jetson:
   - `start_jetracer.sh` (with servo bias injected)
   - `laser_filter.yaml`
   - `slam_toolbox_params.yaml`
6. **Launch services** — `nohup bash /tmp/start_jetracer.sh` (no PTY, so processes survive SSH disconnect)
7. **Poll for rosbridge** — check port 9090 every 3 seconds, up to 60 seconds
8. **Stream logs** — tail `/tmp/jetracer.log` and send to browser as SSE events
9. **Complete** — send success/failure status

## ROS WebSocket (roslib)

### Connection lifecycle (`useRobot.ts`)

roslib is loaded dynamically on first use. A single global `Ros` instance is shared across all components.

| State | Meaning |
|-------|---------|
| `disconnected` | No connection |
| `connecting` | WebSocket handshake in progress |
| `connected` | Active connection to `ws://{ip}:9090` |
| `reconnecting` | Connection lost, retrying |

**Auto-reconnect:** If the connection drops (and it wasn't an intentional disconnect), reconnection starts with 3-second delay, growing by 1.5x each attempt, capped at 30 seconds.

### Publishing

`publish()` caches a `Topic` object per `{topicName}:{messageType}` key and reuses it. Topics must be reused -- creating a new `Topic` per call causes rosbridge to receive repeated `advertise` ops that break subsequent publishes. The cache is cleared on disconnect.

### Subscribing

Three subscription patterns, each a React hook:

| Hook | Returns | Re-renders? | Use for |
|------|---------|-------------|---------|
| `useTopic` | Latest message as state | Yes | Small/infrequent data (`/scan`) |
| `useTopicRef` | Ref to latest message | No | Large/frequent data (`/map`) |
| `usePose` | Composed pose ref | No | TF frame composition |

### Critical: `getRos` must be stable

`getRos` is passed to all subscription hooks and appears in `useEffect` dependency arrays. It **must** be memoized with `useCallback`. An inline arrow function creates a new reference every render, triggering all subscriptions to teardown and re-subscribe, flooding rosbridge with churn that can crash it.

### roslib v2.1.0 behaviors

- `Topic.publish()` auto-advertises on first call
- `callOnConnection` queues messages until connected
- `reconnect_on_close` defaults to `true` on Topics

## ROS Topics

| Topic | Type | Direction | Description |
|-------|------|-----------|-------------|
| `/cmd_vel` | `geometry_msgs/Twist` | Publish | Drive commands: `linear.x` = speed, `angular.z` = steering |
| `/scan` | `sensor_msgs/LaserScan` | Subscribe | Raw LIDAR point cloud |
| `/scan_filtered` | `sensor_msgs/LaserScan` | Internal | Filtered LIDAR (consumed by slam_toolbox, not sent to dashboard) |
| `/map` | `nav_msgs/OccupancyGrid` | Subscribe | SLAM occupancy grid (CBOR-compressed) |
| `/tf` | `tf2_msgs/TFMessage` | Subscribe | Transform frames (map→odom→base_footprint) |
| `/odom` | `nav_msgs/Odometry` | Internal | Wheel encoder odometry |
| `/csi_cam_0/image_raw` | — | HTTP stream | Camera feed (via web_video_server, not roslib) |

## Key Files

| File | Role |
|------|------|
| `dashboard/lib/ssh.ts` | SSH connection management (key/password auth) |
| `dashboard/app/api/robot/connect/route.ts` | Connect flow with SSE streaming |
| `dashboard/hooks/useRobot.ts` | ROS WebSocket connection lifecycle |
| `dashboard/hooks/useTopic.ts` | State-based topic subscription |
| `dashboard/hooks/useTopicRef.ts` | Ref-based topic subscription (no re-renders) |
| `dashboard/hooks/usePose.ts` | TF frame composition (`map → odom → base_footprint`) |
