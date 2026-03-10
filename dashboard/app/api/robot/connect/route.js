import { NextResponse } from "next/server";
import { getSSHConnection, executeCommand } from "@/lib/ssh";

// The startup script runs on the Jetson. Written to /tmp/ and executed via nohup.
// The heredoc delimiter is single-quoted ('SCRIPT_EOF') so $ is not expanded by the remote shell.
// In JS template literals, $ without { is literal, so $VAR passes through as-is.
const START_SCRIPT = [
  "#!/bin/bash",
  "",
  "source /opt/ros/melodic/setup.bash",
  "source ~/catkin_ws/devel/setup.bash",
  "",
  "roscore &",
  "ROSCORE_PID=$!",
  "sleep 5",
  "",
  "roslaunch jetracer jetracer.launch &",
  "JETRACER_PID=$!",
  "",
  "roslaunch jetracer csi_camera.launch &",
  "CAMERA_PID=$!",
  "",
  "rosrun web_video_server web_video_server &",
  "WEB_SERVER_PID=$!",
  "",
  "roslaunch rosbridge_server rosbridge_websocket.launch &",
  "ROSBRIDGE_PID=$!",
  "",
  "cleanup() {",
  '    echo "Stopping JetRacer processes..."',
  "    kill $WEB_SERVER_PID 2>/dev/null",
  "    kill $ROSBRIDGE_PID 2>/dev/null",
  "    kill $CAMERA_PID 2>/dev/null",
  "    kill $JETRACER_PID 2>/dev/null",
  "    kill $ROSCORE_PID 2>/dev/null",
  "    wait 2>/dev/null",
  "    exit",
  "}",
  "trap cleanup SIGINT SIGTERM",
  "",
  "# Wait for rosbridge to be ready",
  "for i in $(seq 1 30); do",
  "    if bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null; then",
  '        echo "rosbridge is ready"',
  "        break",
  "    fi",
  "    sleep 1",
  "done",
  "",
  'echo "JetRacer running. PID $$"',
  "",
  "while true; do",
  "    sleep 1",
  "done",
].join("\n");

export async function POST(request) {
  let ssh;
  try {
    const body = await request.json().catch(() => ({}));
    const ip = body.ip;
    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    // First check if services are already running
    try {
      const check = await executeCommand(
        ip,
        "bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null"
      );
      if (check.exitCode === 0) {
        return NextResponse.json({
          success: true,
          ip,
          rosbridgeUp: true,
          message: "Services are already running",
        });
      }
    } catch {
      // Not running, proceed to start
    }

    // Check that required packages are installed before trying to start
    const depCheck = await executeCommand(
      ip,
      "dpkg -s ros-melodic-rosbridge-suite ros-melodic-web-video-server 2>&1"
    );
    if (depCheck.exitCode !== 0) {
      const missing = depCheck.stderr || depCheck.stdout;
      return NextResponse.json(
        {
          success: false,
          message: `Missing ROS packages on Jetson. SSH in and run:\nsudo apt-get install -y ros-melodic-rosbridge-suite ros-melodic-web-video-server\n\n${missing}`,
        },
        { status: 500 }
      );
    }

    ssh = await getSSHConnection(ip);

    // Upload start script
    const remotePath = "/tmp/start_jetracer.sh";
    await ssh.execCommand(
      `cat > ${remotePath} << 'SCRIPT_EOF'\n${START_SCRIPT}\nSCRIPT_EOF`
    );
    await ssh.execCommand(`chmod +x ${remotePath}`);

    // Run with nohup + disown so it persists after SSH disconnects
    await ssh.execCommand(
      `nohup bash ${remotePath} > /tmp/jetracer.log 2>&1 & disown`,
      { execOptions: { pty: true } }
    );
    ssh.dispose();
    ssh = null;

    // Poll for rosbridge to come up (max 45s — roscore needs ~5s, then services start)
    let rosbridgeUp = false;
    const startTime = Date.now();

    while (Date.now() - startTime < 45000) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const result = await executeCommand(
          ip,
          "bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null"
        );
        if (result.exitCode === 0) {
          rosbridgeUp = true;
          break;
        }
      } catch {
        // Jetson may be busy starting up, keep trying
      }
    }

    // If not up, grab the log for debugging
    let logTail = "";
    if (!rosbridgeUp) {
      try {
        const log = await executeCommand(ip, "tail -20 /tmp/jetracer.log 2>/dev/null");
        logTail = log.stdout;
      } catch {}
    }

    return NextResponse.json({
      success: rosbridgeUp,
      ip,
      rosbridgeUp,
      message: rosbridgeUp
        ? "Services started and rosbridge is ready"
        : `Services may not have started correctly. Log:\n${logTail}`,
    });
  } catch (error) {
    if (ssh) ssh.dispose();
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
