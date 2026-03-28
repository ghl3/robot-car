# SLAM Map System

How the SLAM mapping system works end-to-end, from the Jetson robot to the browser dashboard.

## Architecture

```
Jetson Nano                                Browser Dashboard
┌──────────────────────────────┐           ┌──────────────────────────┐
│  RPLIDAR A1 (/dev/ttyACM1)  │           │  MapViewer.tsx           │
│    ↓                         │           │                          │
│  rplidarNode                 │           │  /map → rebuildMapImage  │
│    ↓ /scan                   │ rosbridge │  /scan → scanRef         │
│  laser_filters               │ websocket │  /tf → usePose           │
│    ↓ /scan_filtered          │──:9090───→│                          │
│  slam_toolbox (async)        │           │  Canvas render loop      │
│    ↓ /map, /tf               │           │                          │
│                              │           │                          │
│  jetracer node               │           │                          │
│    ↓ /odom, /tf              │           │                          │
└──────────────────────────────┘           └──────────────────────────┘
```

**Robot side:**
- `rplidarNode` publishes raw `/scan` (LaserScan) from RPLIDAR A1 on `/dev/ttyACM1`
- `laser_filters` (scan_to_scan_filter_chain) subscribes to `/scan` and publishes `/scan_filtered` after applying angular bounds and range filters (see [Laser Scan Filtering](#laser-scan-filtering))
- `slam_toolbox` (async_slam_toolbox_node) consumes `/scan_filtered` + `/odom` and publishes `/map` (OccupancyGrid) and the `map → odom` TF transform. Uses graph-based SLAM with loop closure.
- The jetracer node publishes `/odom` (odometry from motor encoders) and the `odom → base_footprint` TF transform

**Dashboard side:**
- `MapViewer.tsx` subscribes to `/map` (CBOR-compressed, ~50-90% smaller than JSON), `/scan`, and `/tf` via rosbridge WebSocket
- Pose is tracked via TF composition: `map → odom → base_footprint` (see `usePose.ts`)
- Map data is rendered to an offscreen canvas, then composited with the robot marker and trail in an animation loop

## Why slam_toolbox (not gmapping)

The system previously used gmapping (Rao-Blackwellized particle filter SLAM). slam_toolbox was chosen because:

- **Loop closure** — when the robot revisits an area, slam_toolbox detects this and optimizes the entire pose graph, correcting accumulated drift. gmapping has no loop closure.
- **Save and resume** — slam_toolbox can serialize its full state (pose graph + scan data) to disk and resume mapping later. gmapping loses all state on restart.
- **Localization mode** — a saved map can be loaded for pure localization without building a new map. gmapping has no localization mode (requires a separate AMCL node).
- **Comparable CPU** — ~70% single-core on Jetson Nano, similar to gmapping's ~52-68%.

## OccupancyGrid Data Format

The `/map` topic publishes `nav_msgs/OccupancyGrid`:

```
info:
  resolution: float     # meters per cell (e.g., 0.05 = 5cm)
  width: int            # grid columns
  height: int           # grid rows
  origin:
    position: {x, y, z} # world position of cell (0,0) — bottom-left in ROS
    orientation: quaternion
data: int8[]            # 1D array, row-major, bottom-to-top
```

**Cell values:**
| Value | Meaning |
|-------|---------|
| -1 | Unknown (unexplored) |
| 0 | Free (no obstacle) |
| 1-100 | Occupied (probability %, higher = more certain) |

**Array layout:** `data[i]` maps to column `i % width`, row `floor(i / width)`. Row 0 is the **bottom** of the map (ROS convention: Y-up).

## Laser Scan Filtering

A `laser_filters` chain sits between the raw `/scan` topic and slam_toolbox's input (`/scan_filtered`). It solves two problems:

1. **360-degree scan count variability** — the RPLIDAR A1 produces a variable number of readings per scan (e.g., 1146 vs 1147) due to how it handles the 0/360 degree overlap. slam_toolbox's 360-degree special-case path expects a fixed count and crashes with `"LaserRangeScan contains X range readings, expected Y"`. Trimming to ~350 degrees avoids this code path.

2. **Floor reflections on bumpy surfaces** — on rugs, the lidar physically tilts and hits the floor, producing spurious short-range readings.

**Filter chain** (configured in `scripts/laser_filter.yaml`):

| Order | Filter | Type | Parameters | Purpose |
|-------|--------|------|------------|---------|
| 1 | Angular bounds | LaserScanAngularBoundsFilter | -3.05 to +3.05 rad | Trims scan from 360 to ~350 degrees, fixing variable scan count |
| 2 | Range | LaserScanRangeFilter | 0.2m – 6.0m | Drops floor/chassis reflections (< 0.2m) and distant noise (> 6.0m) |

The filter config YAML is uploaded to `/tmp/laser_filter.yaml` on the Jetson during the connect flow, and loaded into the ROS parameter server before the filter node starts.

The dashboard still subscribes to raw `/scan` for the lidar visualization overlay — scan dots are not shown in map view (they're redundant with the map itself), only in the scan-only view before SLAM starts.

## slam_toolbox Parameters

Configured in `scripts/slam_toolbox_params.yaml` (uploaded to `/tmp/slam_toolbox_params.yaml` on the Jetson). The restart endpoint in `dashboard/app/api/robot/restart-component/route.ts` loads the same YAML before starting the node.

### Core settings

| Parameter | Value | Description |
|-----------|-------|-------------|
| `resolution` | 0.05 | Map resolution (5cm per cell) |
| `max_laser_range` | 8.0m | Max sensor range for map building |
| `map_update_interval` | 2.0s | How often slam_toolbox publishes `/map` |
| `transform_publish_period` | 0.05s | Map→odom TF publish rate (20Hz) |
| `mode` | mapping | SLAM mode (`mapping` or `localization`) |

### Solver

| Parameter | Value | Description |
|-----------|-------|-------------|
| `solver_plugin` | CeresSolver | Ceres-based nonlinear optimizer |
| `ceres_loss_function` | HuberLoss | Robust loss function — tolerates odometry drift without IMU |
| `correlation_search_space_dimension` | 0.5 | Scan correlation search grid size in meters. `dimension / resolution` must be a clean integer (grid = 2N+1 must be odd) |

### Scan processing

| Parameter | Value | Description |
|-----------|-------|-------------|
| `minimum_time_interval` | 0.0 | Process every scan (at 5.5Hz we can't afford to skip any) |
| `minimum_travel_distance` | 0.3m | Min linear movement before processing a scan |
| `minimum_travel_heading` | 0.3rad | Min rotation before processing a scan |
| `throttle_scans` | 1 | Process every Nth scan (1 = all) |

### Loop closure

slam_toolbox performs explicit loop closure — when the robot revisits a mapped area, it detects the overlap, adds a constraint to the pose graph, and optimizes the full trajectory.

| Parameter | Value | Description |
|-----------|-------|-------------|
| `do_loop_closing` | true | Enable loop closure detection |
| `loop_match_minimum_chain_size` | 10 | Min scan chain length to consider for closure |
| `loop_match_minimum_response_coarse` | 0.35 | Coarse match quality threshold |
| `loop_match_minimum_response_fine` | 0.45 | Fine match quality threshold (increase if getting false closures) |
| `loop_search_maximum_distance` | 3.0m | Max distance to search for loop candidates |

### Map persistence (future)

slam_toolbox exposes ROS services for saving and loading the full pose graph:

| Service | Purpose |
|---------|---------|
| `/slam_toolbox/serialize_map` | Save pose graph + scan data (for resuming or localization) |
| `/slam_toolbox/deserialize_map` | Load a saved pose graph to continue mapping |
| `/slam_toolbox/save_map` | Save as .pgm/.yaml image (for nav stack / AMCL) |

Serialized files (`.posegraph` + `.data`) are saved to `~/.ros/` on the Jetson. Dashboard UI for save/load is not yet implemented.

## Rendering Pipeline

### 1. Map Image Building (`rebuildMapImage`)

When a new `/map` message arrives via `useTopicRef`:

1. Create/reuse an offscreen `<canvas>` matching grid dimensions (width x height pixels)
2. For each cell in the grid data:
   - Compute canvas pixel position with **Y-axis flip**: `row = height - 1 - floor(i / width)` (converts ROS bottom-up to canvas top-down)
   - Assign color based on cell value:
     - **Unknown (-1):** Transparent (alpha=0) — background shows through
     - **Free (0):** White `(255, 255, 255)`
     - **Occupied (1-100):** Gradient from warm tan `(220, 160, 120)` to dark red `(196, 48, 32)` based on probability
3. Store the canvas in `mapImageRef` for use by the render loop

### 2. Render Loop (`drawFrame`)

Runs via `requestAnimationFrame`, compositing layers in order:

1. **Background** — fill with `#ece7e0` (warm beige)
2. **Grid lines** — 1-meter spacing in world coordinates, light gold
3. **Map image** — draw the offscreen canvas scaled to screen (unknown areas are transparent, so grid lines show through)
4. **Odometry trail** — breadcrumb path showing where robot has been (fading opacity segments)
5. **Robot marker** — brass-colored arrow showing position and heading
6. **Metadata overlay** — grid dimensions, resolution, exploration percentage
7. **Playback indicator** — shown during rosbag playback

Scan dots are **not** drawn in map view — the map is built from LIDAR scans so overlaying them is redundant and visually noisy.

### 3. Scan-Only View

When no `/map` data exists yet (before SLAM starts or when SLAM is off):

- Draws a polar grid centered on the robot (distance circles at 1m intervals)
- Renders live scan points as gold dots using a direct polar-to-screen transform
- Shows "NO LIDAR DETECTED" or "LIDAR OFF" overlays as needed

## Coordinate Transforms

Three coordinate systems are in play:

```
World (ROS)          Grid (cells)          Screen (pixels)
  Y↑                   row 0 = top          Y↓
  |                     row N = bottom       |
  +→ X                  col 0 = left         +→ X
```

**World → Grid:**
```
col = (worldX - origin.x) / resolution
row = height - (worldY - origin.y) / resolution     # Y-flip
```

**Grid → Screen:**
```
screenX = mapScreenX + col * pxPerCell
screenY = mapScreenY + row * pxPerCell
```

Where `mapScreenX/Y` positions the map so the robot appears at the screen center (or at the pan offset).

**World → Screen** (combined, used by `worldToScreen` helper):
```
screenX = robotScreenX + (worldX - pose.x) * scale
screenY = robotScreenY - (worldY - pose.y) * scale  # note the minus (Y-flip)
```

## Camera Controls

| Action | Effect |
|--------|--------|
| Scroll wheel | Zoom in/out (0.2x to 20x) |
| Click + drag | Pan the view (disables auto-tracking) |
| Double-click | Reset: re-center on robot, zoom to 1x, re-enable auto-tracking |

**Auto-tracking:** By default, the robot stays centered on screen. Panning disables this. Double-click restores it.

## Color Scheme

| Element | Color | Hex/RGB |
|---------|-------|---------|
| Background | Warm beige | `#ece7e0` |
| Free space | White | `(255, 255, 255)` |
| Low occupancy | Warm tan | `(220, 160, 120)` |
| High occupancy | Dark red | `(196, 48, 32)` |
| Unknown | Transparent | Shows background |
| Scan points | Gold, 2.5px radius | `#daa520` |
| Robot marker | Brass with white halo, arrow | `#b8952a` |
| Grid lines | Light gold | `rgba(180, 150, 80, 0.12)` |
| Trail | Dark burnt orange | Fading opacity segments |

## Key Files

| File | Role |
|------|------|
| `dashboard/components/MapViewer.tsx` | Main map rendering component |
| `dashboard/hooks/usePose.ts` | TF-based robot pose tracking (`map → odom → base_footprint`) |
| `dashboard/hooks/useTopic.ts` | Generic ROS topic subscription |
| `dashboard/hooks/useTopicRef.ts` | Ref-based subscription (no re-renders) |
| `scripts/start_jetracer.sh` | Launches lidar, scan filter, and slam_toolbox |
| `scripts/slam_toolbox_params.yaml` | slam_toolbox configuration (uploaded to Jetson) |
| `scripts/laser_filter.yaml` | Laser scan filter chain configuration |
| `dashboard/app/api/robot/restart-component/route.ts` | Per-component restart (slam, scan_filter, lidar, etc.) |
| `dashboard/app/api/robot/connect/route.ts` | SSH connect flow: installs packages, uploads configs, launches services |
| `dashboard/app/api/robot/maps/route.ts` | Save/load/delete maps, rosbag record/playback |
