#!/bin/bash

# Check if IP address is provided
if [ $# -ne 1 ]; then
    echo "Usage: $0 <robot_ip>"
    echo "Example: $0 192.168.1.100"
    exit 1
fi

ROBOT_IP=$1
ROBOT_USER="jetson"

# Function to send movement command
send_command() {
    local linear_x=$1
    local angular_z=$2
    
    ssh ${ROBOT_USER}@${ROBOT_IP} "source /opt/ros/melodic/setup.bash && \
        source ~/catkin_ws/devel/setup.bash && \
        rostopic pub -1 /cmd_vel geometry_msgs/Twist \
        '{linear: {x: $linear_x, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: $angular_z}}'"
}

# Test command - move forward 0.5 m/s
echo "Moving forward at 0.5 m/s..."
send_command 0.5 0.0