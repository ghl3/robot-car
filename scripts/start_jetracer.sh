#!/bin/bash

# Exit on any error
set -e

# Install rosbridge if not already installed
if ! dpkg -l | grep -q ros-melodic-rosbridge-suite; then
    sudo apt-get update
    sudo apt-get install -y ros-melodic-rosbridge-suite
fi

# Install web video server if not already installed
if ! dpkg -l | grep -q ros-melodic-web-video-server; then
    sudo apt-get update
    sudo apt-get install -y ros-melodic-web-video-server
fi

# Load ROS environment
source /opt/ros/melodic/setup.bash
source ~/catkin_ws/devel/setup.bash

# Start roscore
roscore &
ROSCORE_PID=$!

# Wait for roscore to start
sleep 5

# Start jetracer
roslaunch jetracer jetracer.launch &
JETRACER_PID=$!

# Start CSI camera
roslaunch jetracer csi_camera.launch &
CAMERA_PID=$!

# Start web video server for browser viewing
rosrun web_video_server web_video_server &
WEB_SERVER_PID=$!

# Start rosbridge
roslaunch rosbridge_server rosbridge_websocket.launch &
ROSBRIDGE_PID=$!

# Cleanup function
cleanup() {
    echo "Stopping JetRacer processes..."
    kill $WEB_SERVER_PID
    kill $ROSBRIDGE_PID
    kill $CAMERA_PID
    kill $JETRACER_PID
    kill $ROSCORE_PID
    exit
}

# Set up trap
trap cleanup SIGINT SIGTERM

# Display access information
echo "JetRacer running with camera and rosbridge. Press Ctrl+C to stop."
echo "Access camera stream at: http://$(hostname -I | cut -d' ' -f1):8080/stream?topic=/csi_cam_0/image_raw"

# Keep script running
while true; do
    sleep 1
done
