# Initial Setup

How to set up a JetRacer robot car from scratch, whether for a new build or after an OS reset.

## Hardware

| Component | Model | Connection |
|-----------|-------|------------|
| Computer | Jetson Nano 4GB | — |
| Chassis | Waveshare JetRacer | — |
| Camera | CSI camera module | CSI ribbon cable |
| LIDAR | RPLIDAR A1 (optional) | USB → `/dev/ttyACM1` |
| Motor | DC drive motor with encoder | JetRacer motor board |
| Steering | Servo | JetRacer servo header |

The RPLIDAR A1 is auto-detected: if `/dev/ttyACM1` appears, the startup script launches the lidar driver and SLAM automatically.

## SD Card

### Flash a pre-built image

```bash
# Download the Waveshare JetRacer image (~6GB)
./scripts/download_jetracer_image.sh

# Flash to SD card (auto-detects the external disk)
./scripts/flash_sd_card.sh -i images/waveshare-jetracer-ros.img
```

### Back up an existing card

```bash
./scripts/snapshot_sd_card.sh
# Creates images/jetson-snapshot-YYYYMMDD-HHMMSS.img.gz
```

## First-Time Jetson Setup

After flashing and booting, run the setup script from your Mac:

```bash
./scripts/setup_jetson.sh [robot-ip]
```

This does four things:

1. **SSH key** — copies your public key to the Jetson for passwordless login
2. **Passwordless sudo** — adds the jetson user to sudoers (required for the startup script to manage services)
3. **ROS packages** — installs `ros-melodic-rosbridge-suite` and `ros-melodic-web-video-server`
4. **Workspace verification** — checks that ROS Melodic and the catkin workspace (`~/catkin_ws`) exist

Additional packages (`ros-melodic-slam-toolbox`, `ros-melodic-map-server`, `ros-melodic-laser-filters`) are installed automatically by the dashboard on first connect.

## Network

The Jetson connects via:
- **USB Ethernet** — direct cable between Mac and Jetson (default IP `192.168.7.107`)
- **WiFi** — the dashboard can scan and connect to WiFi networks via the UI

## Steering Calibration

After reinstalling the servo horn, the wheels may not center properly. To fix:

1. Connect to the robot and start services
2. Find the right bias value interactively:
   ```bash
   rosrun dynamic_reconfigure dynparam set /jetracer servo_bias <value>
   ```
3. Test until wheels are straight at rest
4. Update the constant in `dashboard/app/api/robot/connect/route.ts`:
   ```typescript
   const SERVO_BIAS = 250;  // adjust this value
   ```

The bias is injected into the startup script via a `__SERVO_BIAS__` placeholder and applied on every service start.

## Dashboard Setup

On your development machine:

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000`, enter the robot's IP, and click **Connect**. The dashboard handles everything else: installing missing packages, uploading configs, and launching services.

## Default Credentials

| Field | Default |
|-------|---------|
| IP | `192.168.7.107` |
| Username | `jetson` |
| Password | `jetson` |

Credentials are saved in the browser's localStorage. The IP can also be set via the `NEXT_PUBLIC_ROBOT_IP` environment variable.
