#!/bin/bash

# Check if IP address is provided
if [ $# -ne 1 ]; then
    echo "Usage: $0 <robot_ip>"
    echo "Example: $0 192.168.1.100"
    exit 1
fi

ROBOT_IP=$1
ROBOT_USER="jetson"

echo "Setting up and starting JetRacer on ${ROBOT_IP}..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Copy the startup script to the robot
scp "${SCRIPT_DIR}/start_jetracer.sh" ${ROBOT_USER}@${ROBOT_IP}:~

# Make it executable and run it
ssh -tt ${ROBOT_USER}@${ROBOT_IP} "chmod +x ~/start_jetracer.sh && ./start_jetracer.sh"