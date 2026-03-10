import { NextResponse } from "next/server";
import { getSSHConnection, executeCommand } from "@/lib/ssh";

// The startup script runs on the Jetson. Written to /tmp/ and executed via nohup.
// The heredoc delimiter is single-quoted ('SCRIPT_EOF') so $ is not expanded by the remote shell.
// In JS template literals, $ without { is literal, so $VAR passes through as-is.
const START_SCRIPT = [
  "#!/bin/bash",
  "",
  "# Auto-install missing ROS packages",
  "if ! dpkg -l | grep -q ros-melodic-rosbridge-suite; then",
  "    sudo apt-get update",
  "    sudo apt-get install -y ros-melodic-rosbridge-suite",
  "fi",
  "if ! dpkg -l | grep -q ros-melodic-web-video-server; then",
  "    sudo apt-get update",
  "    sudo apt-get install -y ros-melodic-web-video-server",
  "fi",
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

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const ip = body.ip as string | undefined;

  if (!ip) {
    return NextResponse.json(
      { success: false, message: "IP address is required" },
      { status: 400 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(sseEvent(data)));
      };
      const log = (message: string) => send({ type: "log", message });

      let ssh: Awaited<ReturnType<typeof getSSHConnection>> | null = null;

      try {
        // Check if services are already running (also verifies SSH connectivity)
        log("Connecting to robot via SSH...");
        let sshReachable = false;
        try {
          const check = await executeCommand(
            ip,
            "bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null"
          );
          sshReachable = true;
          if (check.exitCode === 0) {
            log("Services are already running!");
            send({
              type: "complete",
              success: true,
              ip,
              rosbridgeUp: true,
              message: "Services are already running",
            });
            controller.close();
            return;
          }
          log("SSH connected. Services not yet running.");
        } catch (err) {
          // If SSH itself failed, robot is unreachable
          const msg = (err as Error).message || String(err);
          if (msg.includes("Timed out") || msg.includes("ECONNREFUSED") || msg.includes("EHOSTUNREACH") || msg.includes("ENOTFOUND")) {
            log(`Cannot reach robot: ${msg}`);
            send({
              type: "complete",
              success: false,
              message: `Cannot connect to robot at ${ip} — ${msg}`,
            });
            controller.close();
            return;
          }
          // SSH connected but the port-check command itself failed — that's fine, services aren't running
          sshReachable = true;
          log("SSH connected. Services not yet running.");
        }

        // Connect via SSH (reuse connection for script upload)
        log("Preparing startup script...");
        ssh = await getSSHConnection(ip);

        // Upload startup script
        log("Uploading startup script...");
        const remotePath = "/tmp/start_jetracer.sh";
        await ssh.execCommand(
          `cat > ${remotePath} << 'SCRIPT_EOF'\n${START_SCRIPT}\nSCRIPT_EOF`
        );
        await ssh.execCommand(`chmod +x ${remotePath}`);

        // Launch services (script auto-installs missing packages, which can take a while)
        log("Launching JetRacer services (installing missing packages if needed)...");
        await ssh.execCommand(
          `nohup bash ${remotePath} > /tmp/jetracer.log 2>&1 & disown`,
          { execOptions: { pty: true } }
        );
        ssh.dispose();
        ssh = null;

        // Poll for rosbridge (90s timeout — apt-get install can take a while on first run)
        let rosbridgeUp = false;
        const startTime = Date.now();
        const timeoutMs = 90000;
        let attempt = 0;
        const maxAttempts = Math.ceil(timeoutMs / 3000);

        while (Date.now() - startTime < timeoutMs) {
          await new Promise((r) => setTimeout(r, 3000));
          attempt++;
          log(`Waiting for rosbridge... (attempt ${attempt}/${maxAttempts})`);
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

        if (rosbridgeUp) {
          log("Rosbridge is ready!");
          send({
            type: "complete",
            success: true,
            ip,
            rosbridgeUp: true,
            message: "Services started and rosbridge is ready",
          });
        } else {
          let logTail = "";
          try {
            const logResult = await executeCommand(ip, "tail -20 /tmp/jetracer.log 2>/dev/null");
            logTail = logResult.stdout;
          } catch {}
          log("Rosbridge did not come up in time.");
          send({
            type: "complete",
            success: false,
            ip,
            rosbridgeUp: false,
            message: `Services may not have started correctly. Log:\n${logTail}`,
          });
        }
      } catch (error) {
        if (ssh) ssh.dispose();
        send({
          type: "complete",
          success: false,
          message: (error as Error).message,
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
