# SLAM Map System

How the SLAM mapping system works end-to-end, from the Jetson robot to the browser dashboard.

## Architecture

```
Jetson Nano                          Browser Dashboard
┌─────────────────────┐              ┌──────────────────────────┐
│  RPLIDAR A1         │              │  MapViewer.tsx           │
│    ↓                │              │                          │
│  rplidarNode        │   rosbridge  │  /map → rebuildMapImage  │
│    ↓ /scan          │──websocket──→│  /scan → scanRef         │
│  gmapping           │   :9090      │  /odom → poseRef         │
│    ↓ /map           │              │                          │
│  /odom (jetracer)   │              │  Canvas render loop      │
└─────────────────────┘              └──────────────────────────┘
```

**Robot side:**
- `rplidarNode` publishes `/scan` (LaserScan) from RPLIDAR A1 on `/dev/ttyACM1`
- `gmapping` (slam_gmapping) consumes `/scan` + `/odom` and publishes `/map` (OccupancyGrid)
- The jetracer node publishes `/odom` (odometry from motor encoders)

**Dashboard side:**
- `MapViewer.tsx` subscribes to `/map`, `/scan`, and odometry via rosbridge WebSocket
- Map data is rendered to an offscreen canvas, then composited with live scan data in an animation loop

## OccupancyGrid Data Format

The `/map` topic publishes `nav_msgs/OccupancyGrid`:

```
info:
  resolution: float     # meters per cell (e.g., 0.03 = 3cm)
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
5. **Scan points** — live LIDAR dots in gold, projected from polar to world coordinates
6. **Robot marker** — brass-colored arrow showing position and heading
7. **Metadata overlay** — grid dimensions, resolution, exploration percentage
8. **Playback indicator** — shown during rosbag playback

### 3. Scan-Only View

When no `/map` data exists yet (before gmapping starts or when SLAM is off):

- Draws a polar grid centered on the robot (distance circles at 1m intervals)
- Renders live scan points using a direct polar-to-screen transform
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
| Scan points | Gold, 3px radius | `#daa520` |
| Robot marker | Brass with white halo, 18px arrow | `#b8952a` |
| Grid lines | Light gold | `rgba(180, 150, 80, 0.12)` |
| Trail | Dark burnt orange | Fading opacity segments |

## gmapping Parameters

Configured in `scripts/start_jetracer.sh`:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `map_update_interval` | 1.0s | How often gmapping publishes `/map` |
| `maxUrange` | 6.0m | Max usable range for map building |
| `maxRange` | 8.0m | Max sensor range |
| `particles` | 30 | Particle filter count |
| `linearUpdate` | 0.1m | Min linear movement to trigger map update |
| `angularUpdate` | 0.15rad | Min rotation to trigger map update |
| `delta` | 0.03m | Map resolution (3cm per cell) |
| `minimumScore` | 50 | Min scan matching score to accept |
| Grid size | -10 to +10m | 20m x 20m map area |

## Key Files

| File | Role |
|------|------|
| `dashboard/components/MapViewer.tsx` | Main map rendering component |
| `dashboard/hooks/usePose.ts` | Subscribes to robot odometry |
| `dashboard/hooks/useTopic.ts` | Generic ROS topic subscription |
| `dashboard/hooks/useTopicRef.ts` | Ref-based subscription (no re-renders) |
| `scripts/start_jetracer.sh` | Launches gmapping with parameters |
| `dashboard/app/api/robot/maps/route.ts` | Save/load/delete map API |
