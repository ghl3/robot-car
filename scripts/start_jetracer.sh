#!/bin/bash

# Exit on any error
set -e

# Install rosbridge if not already installed
if ! dpkg -l | grep -q ros-melodic-rosbridge-suite; then
    sudo apt-get update
    sudo apt-get install -y ros-melodic-rosbridge-suite
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

# Start rosbridge
roslaunch rosbridge_server rosbridge_websocket.launch &
ROSBRIDGE_PID=$!

# Cleanup function
cleanup() {
    echo "Stopping JetRacer processes..."
    kill $ROSBRIDGE_PID
    kill $JETRACER_PID
    kill $ROSCORE_PID
    exit
}

# Set up trap
trap cleanup SIGINT SIGTERM

# Keep script running
echo "JetRacer running with rosbridge. Press Ctrl+C to stop."
while true; do
    sleep 1
done
