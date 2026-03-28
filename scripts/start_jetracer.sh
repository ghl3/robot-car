#!/bin/bash
#
# JetRacer startup script — uploaded to /tmp/ on the Jetson and run via nohup.
# Also runnable directly on the Jetson for manual testing.
#
# Placeholders replaced by the dashboard at upload time:
#   __SERVO_BIAS__  — steering center correction value (0 = none)
#
# When run directly (not via dashboard), __SERVO_BIAS__ won't be replaced,
# so the -ne test will fail and servo bias is simply skipped.

source /opt/ros/melodic/setup.bash
source ~/catkin_ws/devel/setup.bash

roscore &
ROSCORE_PID=$!
sleep 5

roslaunch jetracer jetracer.launch &
JETRACER_PID=$!
sleep 3

# Set servo bias to correct steering center (0 = no correction)
# Run in background with timeout so it doesn't block startup if jetracer is slow to init
SERVO_BIAS="__SERVO_BIAS__"
if [ "$SERVO_BIAS" -ne 0 ] 2>/dev/null; then
    (timeout 30 rosrun dynamic_reconfigure dynparam set /jetracer servo_bias "$SERVO_BIAS" \
        && echo "Servo bias set to $SERVO_BIAS" \
        || echo "Warning: failed to set servo bias") &
fi

roslaunch jetracer csi_camera.launch &
CAMERA_PID=$!
sleep 2

rosrun web_video_server web_video_server &
WEB_SERVER_PID=$!

roslaunch rosbridge_server rosbridge_websocket.launch &
ROSBRIDGE_PID=$!

cleanup() {
    echo "Stopping JetRacer processes..."
    [ -n "$GMAPPING_PID" ] && kill $GMAPPING_PID 2>/dev/null
    [ -n "$LIDAR_PID" ] && kill $LIDAR_PID 2>/dev/null
    kill $WEB_SERVER_PID 2>/dev/null
    kill $ROSBRIDGE_PID 2>/dev/null
    kill $CAMERA_PID 2>/dev/null
    kill $JETRACER_PID 2>/dev/null
    kill $ROSCORE_PID 2>/dev/null
    wait 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

# Wait for rosbridge to be ready
for i in $(seq 1 30); do
    if bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null; then
        echo "rosbridge is ready"
        break
    fi
    sleep 1
done

echo "JetRacer running. PID $$"

# Watchdog loop: auto-launch LIDAR when device appears
while true; do
    if [ -z "$LIDAR_PID" ] || ! kill -0 $LIDAR_PID 2>/dev/null; then
        LIDAR_PID=
        if [ -e /dev/ttyACM1 ]; then
            chmod 666 /dev/ttyACM1 2>/dev/null || sudo -n chmod 666 /dev/ttyACM1 2>/dev/null
            roslaunch jetracer lidar.launch &
            LIDAR_PID=$!
            echo "RPLIDAR launched via jetracer lidar.launch (PID $LIDAR_PID)"
            sleep 3
            rosrun gmapping slam_gmapping \
                _base_frame:=base_footprint \
                _odom_frame:=odom \
                _map_update_interval:=1.0 \
                _maxUrange:=6.0 \
                _maxRange:=8.0 \
                _particles:=80 \
                _linearUpdate:=0.15 \
                _angularUpdate:=0.25 \
                _temporalUpdate:=3.0 \
                _delta:=0.05 \
                _xmin:=-15.0 \
                _xmax:=15.0 \
                _ymin:=-15.0 \
                _ymax:=15.0 \
                _minimumScore:=200 \
                _srr:=0.1 \
                _srt:=0.2 \
                _str:=0.1 \
                _stt:=0.2 \
                _iterations:=5 \
                _lstep:=0.05 \
                _astep:=0.05 &
            GMAPPING_PID=$!
            echo "gmapping SLAM started (PID $GMAPPING_PID)"
        fi
    fi

    # Camera watchdog
    if ! kill -0 $CAMERA_PID 2>/dev/null; then
        echo "Camera (gscam) died, restarting..."
        roslaunch jetracer csi_camera.launch &
        CAMERA_PID=$!
        echo "Camera restarted (PID $CAMERA_PID)"
    fi

    # Web video server watchdog
    if ! kill -0 $WEB_SERVER_PID 2>/dev/null; then
        echo "web_video_server died, restarting..."
        rosrun web_video_server web_video_server &
        WEB_SERVER_PID=$!
        echo "web_video_server restarted (PID $WEB_SERVER_PID)"
    fi

    sleep 5
done
