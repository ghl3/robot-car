# Mapping

How the robot builds a map of its environment using SLAM (Simultaneous Localization and Mapping).

## Overview

The robot uses **slam_toolbox** to build a 2D occupancy grid map from LIDAR scans and wheel encoder odometry. As it drives, it matches each new LIDAR scan against the existing map to determine its position, then adds the new scan data to the map. When it revisits an area, loop closure corrects accumulated drift.

```
RPLIDAR A1 → laser_filters → slam_toolbox → /map (OccupancyGrid)
                                  ↑
                          /odom (wheel encoders)
```

## SLAM Algorithm

slam_toolbox uses **graph-based SLAM** with pose graph optimization:

1. **Local scan matching** — each new LIDAR scan is correlated against recent scans to estimate the robot's motion. Uses a Ceres-based nonlinear optimizer.
2. **Pose graph** — each processed scan becomes a node in a graph. Edges represent the estimated motion between scans.
3. **Loop closure** — when the robot revisits a mapped area, slam_toolbox detects the overlap by correlating the current scan against older scans. This adds a new edge (constraint) to the graph.
4. **Graph optimization** — when a loop closure is found, the entire pose graph is optimized to minimize the error across all constraints, correcting drift throughout the trajectory.

### Why slam_toolbox (not gmapping)

The system previously used gmapping (particle filter SLAM). slam_toolbox was chosen because:

- **Loop closure** — gmapping has no loop closure. Its particle filter can only "close loops" implicitly if enough particles survive, which rarely happens with a budget LIDAR.
- **Save and resume** — slam_toolbox can serialize its full state to disk and resume mapping after a power cycle. gmapping loses everything on restart.
- **Localization mode** — a saved map can be loaded for localization without building a new map.
- **Comparable CPU** — ~70% single-core on Jetson Nano, similar to gmapping.

### Async mode

We use `async_slam_toolbox_node` (not sync). In async mode, if the CPU is busy with a loop closure optimization when a new scan arrives, it skips the scan rather than queuing it. This prevents the robot from falling behind real-time on the Jetson Nano's limited CPU.

## Laser Scan Filtering

A `laser_filters` chain preprocesses raw LIDAR data before it reaches slam_toolbox. It solves two problems:

### 1. RPLIDAR 360-degree scan count variability

The RPLIDAR A1 produces a variable number of readings per revolution (e.g., 1146 vs 1147) due to how it handles the 0/360 degree overlap. slam_toolbox's 360-degree special-case path expects a fixed count and crashes with:

```
LaserRangeScan contains 1147 range readings, expected 1146
```

An angular bounds filter trims the scan from 360 to ~350 degrees, avoiding this code path entirely.

### 2. Floor reflections on bumpy surfaces

On rugs, the robot bounces and the LIDAR physically tilts, hitting the floor and producing spurious short-range readings. A range filter drops anything under 0.2m.

### Filter chain

Configured in `scripts/laser_filter.yaml`:

| Order | Filter | Parameters | Purpose |
|-------|--------|------------|---------|
| 1 | LaserScanAngularBoundsFilter | -3.05 to +3.05 rad | Trim to ~350 degrees |
| 2 | LaserScanRangeFilter | 0.2m – 6.0m | Drop floor reflections and distant noise |

## Configuration

All slam_toolbox parameters are in `scripts/slam_toolbox_params.yaml`. Key settings:

### Map

| Parameter | Value | Notes |
|-----------|-------|-------|
| `resolution` | 0.05 | 5cm per cell |
| `max_laser_range` | 8.0m | RPLIDAR A1 usable range |
| `map_update_interval` | 2.0s | How often `/map` is published |

### Solver

| Parameter | Value | Notes |
|-----------|-------|-------|
| `ceres_loss_function` | HuberLoss | Robust to odometry drift (no IMU) |
| `correlation_search_space_dimension` | 0.5 | Search grid size. **Must divide cleanly by `resolution`** — the grid = 2N+1 must be odd, or slam_toolbox crashes with an assertion failure. |

### Scan processing

| Parameter | Value | Notes |
|-----------|-------|-------|
| `minimum_time_interval` | 0.0 | Process every scan (at 5.5Hz, can't skip any) |
| `minimum_travel_distance` | 0.3m | Min movement before new scan processed |
| `minimum_travel_heading` | 0.3rad | Min rotation before new scan processed |

### Loop closure

| Parameter | Value | Notes |
|-----------|-------|-------|
| `do_loop_closing` | true | Master enable |
| `loop_match_minimum_response_fine` | 0.45 | Increase if getting false closures |
| `loop_search_maximum_distance` | 3.0m | How far to search for revisited areas |

## OccupancyGrid Format

The `/map` topic publishes `nav_msgs/OccupancyGrid`:

| Cell value | Meaning |
|------------|---------|
| -1 | Unknown (unexplored) |
| 0 | Free (no obstacle) |
| 1-100 | Occupied (probability %, higher = more certain) |

Grid is row-major, bottom-to-top (ROS convention: row 0 is the bottom). Resolution is 5cm per cell.

## Map Persistence (future)

slam_toolbox exposes ROS services for saving and loading the full pose graph:

| Service | Purpose |
|---------|---------|
| `/slam_toolbox/serialize_map` | Save full state (for resuming mapping or localization) |
| `/slam_toolbox/deserialize_map` | Load a saved state to continue mapping |
| `/slam_toolbox/save_map` | Save as .pgm/.yaml image (for navigation stacks) |

Serialized files (`.posegraph` + `.data`) go to `~/.ros/` on the Jetson. Dashboard UI for save/load is not yet implemented.

## Tips for Better Maps

- **Drive slowly** — at lower speeds, wheel slip is smaller and the 5.5Hz LIDAR captures more overlapping scans. Aim for ~0.15 m/s.
- **Drive in loops** — revisit areas early and often. Loop closure corrects drift, but only if the drift is small enough for the scan matcher to find the overlap.
- **Turn gently** — sharp rotations are the hardest for encoder odometry. Slow, gradual turns give better results.
- **Map near features** — walls, furniture, and corners give the scan matcher distinctive geometry. Open rooms with distant walls are harder.
- **Avoid featureless corridors** — long hallways where every position looks the same to the LIDAR.

## Key Files

| File | Role |
|------|------|
| `scripts/slam_toolbox_params.yaml` | slam_toolbox configuration |
| `scripts/laser_filter.yaml` | Laser scan filter chain |
| `scripts/start_jetracer.sh` | Launches filter + slam_toolbox in watchdog loop |
