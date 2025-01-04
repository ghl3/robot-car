#!/bin/bash

# Check if IP address is provided
if [ $# -ne 1 ]; then
    echo "Usage: $0 <robot_ip>"
    echo "Example: $0 192.168.1.100"
    exit 1
fi

ROBOT_IP=$1
ROBOT_USER="jetson"

echo "Shutting down JetRacer..."

# First stop ROS processes
ssh ${ROBOT_USER}@${ROBOT_IP} '
    echo "Stopping ROS processes..."
    pkill -f roscore
    pkill -f "jetracer.launch"
    pkill -f "roslaunch"
    sleep 2
'

# Then shutdown the system
echo "Initiating system shutdown..."
ssh ${ROBOT_USER}@${ROBOT_IP} 'sudo shutdown now'

echo "Shutdown command sent. The robot should power off shortly."