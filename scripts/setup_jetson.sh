#!/bin/bash
#
# One-time Jetson Nano setup. Run from your Mac:
#   ./scripts/setup_jetson.sh [ip]
#
# This script:
#   1. Copies your SSH key for passwordless login
#   2. Configures passwordless sudo for the jetson user
#   3. Installs required ROS packages
#   4. Verifies the catkin workspace and ROS environment
#   5. Builds jetson-inference and ros_deep_learning (vision/detection)
#
# After this, the dashboard's "Power On" button will work without any manual steps.
#

set -e

ROBOT_IP="${1:-192.168.7.107}"
ROBOT_USER="jetson"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

ok()      { echo -e "  ${GREEN}✓${RESET} $1"; }
skip()    { echo -e "  ${DIM}– $1${RESET}"; }
warn()    { echo -e "  ${YELLOW}! $1${RESET}"; }
fail()    { echo -e "  ${RED}✗ $1${RESET}"; }
step()    { echo -e "\n${BOLD}[$1/5] $2${RESET}"; }

ERRORS=0

echo -e "${BOLD}=== Jetson Nano Setup ===${RESET}"
echo -e "${DIM}Target: ${ROBOT_USER}@${ROBOT_IP}${RESET}"

# --- Step 1: SSH key ---
step 1 "SSH key"
if ssh -o ConnectTimeout=5 -o BatchMode=yes "${ROBOT_USER}@${ROBOT_IP}" true 2>/dev/null; then
    skip "Already authorized"
else
    echo -e "  Copying SSH key ${DIM}(you'll be prompted for the password)${RESET}"
    if ssh-copy-id "${ROBOT_USER}@${ROBOT_IP}"; then
        ok "Key copied"
    else
        fail "Failed to copy SSH key"
        echo -e "\n${RED}Cannot continue without SSH access.${RESET}"
        exit 1
    fi
fi

# Verify SSH works before continuing
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${ROBOT_USER}@${ROBOT_IP}" true 2>/dev/null; then
    fail "SSH key auth still not working"
    echo -e "\n${RED}Cannot continue without SSH access.${RESET}"
    exit 1
fi

# From here on, SSH should work without a password
SSH="ssh -o ConnectTimeout=10 ${ROBOT_USER}@${ROBOT_IP}"

# --- Step 2: Passwordless sudo ---
step 2 "Passwordless sudo"
if $SSH "sudo -n true" 2>/dev/null; then
    skip "Already configured"
else
    echo -e "  Configuring sudoers ${DIM}(you'll be prompted for the password)${RESET}"
    if ssh -t "${ROBOT_USER}@${ROBOT_IP}" \
        "echo '${ROBOT_USER} ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/${ROBOT_USER}-nopasswd > /dev/null && sudo chmod 440 /etc/sudoers.d/${ROBOT_USER}-nopasswd" 2>/dev/null; then
        ok "Passwordless sudo configured"
    else
        fail "Failed to configure sudoers"
        ERRORS=$((ERRORS + 1))
    fi
fi

# --- Step 3: ROS packages ---
step 3 "ROS packages"
PACKAGES=(
    ros-melodic-rosbridge-suite
    ros-melodic-web-video-server
    ros-melodic-vision-msgs
    ros-melodic-image-transport
    ros-melodic-navigation
    ros-melodic-teb-local-planner
)

MISSING=()
for pkg in "${PACKAGES[@]}"; do
    if $SSH "dpkg -s $pkg" >/dev/null 2>&1; then
        skip "$pkg"
    else
        warn "$pkg not installed"
        MISSING+=("$pkg")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    echo -e "  Installing ${#MISSING[@]} package(s)..."
    if $SSH "sudo apt-get update -qq && sudo apt-get install -y -qq ${MISSING[*]}" 2>&1 | while read -r line; do echo -e "  ${DIM}${line}${RESET}"; done; then
        ok "Packages installed"
    else
        fail "Package installation failed"
        ERRORS=$((ERRORS + 1))
    fi
else
    ok "All packages present"
fi

# --- Step 4: ROS environment ---
step 4 "ROS environment"

if $SSH "test -f /opt/ros/melodic/setup.bash"; then
    ok "ROS Melodic"
else
    fail "ROS Melodic not found at /opt/ros/melodic/setup.bash"
    ERRORS=$((ERRORS + 1))
fi

if $SSH "test -f ~/catkin_ws/devel/setup.bash"; then
    ok "Catkin workspace"
else
    fail "Catkin workspace not found at ~/catkin_ws/devel/setup.bash"
    ERRORS=$((ERRORS + 1))
fi

if $SSH "source /opt/ros/melodic/setup.bash && source ~/catkin_ws/devel/setup.bash && rospack find jetracer" >/dev/null 2>&1; then
    ok "jetracer package"
else
    warn "jetracer ROS package not found in catkin workspace"
fi

# --- Step 5: Vision (jetson-inference + ros_deep_learning) ---
step 5 "Vision libraries (jetson-inference + ros_deep_learning)"

# Check if jetson-inference is already installed
if $SSH "python3 -c 'import jetson_inference' 2>/dev/null"; then
    skip "jetson-inference already installed"
else
    echo -e "  Building jetson-inference from source ${DIM}(this takes 10-20 minutes)${RESET}"
    if $SSH "cd ~ && \
        [ ! -d jetson-inference ] && git clone --recursive --depth=1 https://github.com/dusty-nv/jetson-inference.git; \
        NPYMATH_DIR=\$(python3 -c 'import numpy; print(numpy.get_include() + \"/../lib\")') && \
        sudo ln -sf \$NPYMATH_DIR/libnpymath.a /usr/local/lib/libnpymath.a && \
        cd jetson-inference && mkdir -p build && cd build && \
        cmake .. -DCMAKE_BUILD_TYPE=Release 2>&1 | tail -3 && \
        make -j3 2>&1 | tail -5 && \
        sudo make install 2>&1 | tail -3 && \
        sudo ldconfig" 2>&1 | while read -r line; do echo -e "  ${DIM}${line}${RESET}"; done; then
        ok "jetson-inference built and installed"
    else
        fail "jetson-inference build failed"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check if ros_deep_learning is already built
if $SSH "source /opt/ros/melodic/setup.bash && source ~/catkin_ws/devel/setup.bash 2>/dev/null && rospack find ros_deep_learning" >/dev/null 2>&1; then
    skip "ros_deep_learning already built"
else
    echo -e "  Building ros_deep_learning in catkin workspace..."
    if $SSH "source /opt/ros/melodic/setup.bash && source ~/catkin_ws/devel/setup.bash 2>/dev/null; \
        cd ~/catkin_ws/src && [ ! -d ros_deep_learning ] && git clone https://github.com/dusty-nv/ros_deep_learning.git; \
        cd ~/catkin_ws && catkin_make 2>&1 | tail -5" 2>&1 | while read -r line; do echo -e "  ${DIM}${line}${RESET}"; done; then
        ok "ros_deep_learning built"
    else
        fail "ros_deep_learning build failed"
        ERRORS=$((ERRORS + 1))
    fi
fi

# --- System info ---
echo -e "\n${BOLD}=== Jetson Info ===${RESET}"
$SSH "cat /etc/nv_tegra_release 2>/dev/null" | while read -r line; do echo -e "  ${DIM}${line}${RESET}"; done
$SSH "echo \"Kernel:  \$(uname -r)\"
      echo \"Memory:  \$(free -m | awk '/Mem:/ {print \$2}') MB\"
      echo \"Disk:    \$(df -h / | awk 'NR==2 {print \$3\"/\"\$2\" used\"}')\"
      echo \"Uptime:  \$(uptime -p 2>/dev/null || uptime)\"" 2>/dev/null | while read -r line; do echo -e "  $line"; done

# --- Summary ---
echo ""
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}${BOLD}=== Setup complete! ===${RESET}"
    echo -e "Run ${BOLD}cd dashboard && npm run dev${RESET} and use Power On from the browser."
else
    echo -e "${RED}${BOLD}=== Setup finished with $ERRORS error(s) ===${RESET}"
    echo -e "Fix the errors above before using the dashboard."
    exit 1
fi
