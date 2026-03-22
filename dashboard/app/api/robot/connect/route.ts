import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getSSHConnection, executeCommand, getSudoPassword } from "@/lib/ssh";
import type { SSHCredentials } from "@/lib/ssh";

// Fine-tune steering center after servo horn reinstall. Find the right value with:
//   rosrun dynamic_reconfigure dynparam set /jetracer servo_bias <value>
// then update this constant to persist it across restarts.
const SERVO_BIAS = 250;

const REQUIRED_PKGS = [
  "ros-melodic-rosbridge-suite",
  "ros-melodic-web-video-server",
  "ros-melodic-gmapping",
  "ros-melodic-map-server",
];

function getStartScript(): string {
  const raw = readFileSync(join(process.cwd(), "../scripts/start_jetracer.sh"), "utf-8");
  return raw.replace(/__SERVO_BIAS__/g, String(SERVO_BIAS));
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Run a command with sudo -S, piping the password via stdin */
function sudoCmd(command: string, sudoPass: string): string {
  const escaped = sudoPass.replace(/'/g, "'\\''");
  return `echo '${escaped}' | sudo -S ${command}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const ip = body.ip as string | undefined;
  const force = body.force === true;
  const creds: SSHCredentials = {
    username: body.username || undefined,
    password: body.password || undefined,
  };

  if (!ip) {
    return NextResponse.json(
      { success: false, message: "IP address is required" },
      { status: 400 }
    );
  }

  const sudoPass = getSudoPassword(creds);

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
        try {
          const check = await executeCommand(
            ip,
            "bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null",
            creds
          );
          if (check.exitCode === 0 && !force) {
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
          log(force ? "SSH connected. Force restart requested." : "SSH connected. Services not yet running.");
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
          log("SSH connected. Services not yet running.");
        }

        // Get a persistent SSH connection for setup steps
        log("Preparing startup environment...");
        ssh = await getSSHConnection(ip, creds);

        // Ensure passwordless sudo is configured (so nohup scripts can use sudo)
        log("Configuring sudo access...");
        const username = creds.username || "jetson";
        const sudoersLine = `${username} ALL=(ALL) NOPASSWD:ALL`;
        const checkSudoers = await ssh.execCommand(
          sudoCmd(`grep -qF '${sudoersLine}' /etc/sudoers.d/${username} 2>/dev/null && echo OK || echo MISSING`, sudoPass),
          { execOptions: { pty: true } }
        );
        if (!checkSudoers.stdout.includes("OK")) {
          log("Setting up passwordless sudo...");
          await ssh.execCommand(
            sudoCmd(`bash -c 'echo "${sudoersLine}" > /etc/sudoers.d/${username} && chmod 440 /etc/sudoers.d/${username}'`, sudoPass),
            { execOptions: { pty: true } }
          );
          // Verify it worked
          const verify = await ssh.execCommand("sudo -n true 2>&1");
          if (verify.code !== 0) {
            log("Warning: could not configure passwordless sudo. Package installation may fail.");
          } else {
            log("Passwordless sudo configured.");
          }
        } else {
          log("Sudo access OK.");
        }

        // Check and install missing ROS packages
        log("Checking required ROS packages...");
        const depCheck = await ssh.execCommand(
          `dpkg -s ${REQUIRED_PKGS.join(" ")} 2>&1`,
          { execOptions: { pty: true } }
        );
        const depOutput = depCheck.stdout + depCheck.stderr;
        const missingPkgs = REQUIRED_PKGS.filter(
          (pkg) => depOutput.includes(`'${pkg}' is not installed`)
        );
        if (missingPkgs.length > 0) {
          log(`Installing missing packages: ${missingPkgs.join(", ")}...`);
          // Refresh ROS GPG key (Melodic key often expires), then install
          log("Updating ROS repository key...");
          await ssh.execCommand(
            sudoCmd(`bash -c 'curl -fsSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.asc | apt-key add -'`, sudoPass),
            { execOptions: { pty: true } }
          );
          const installResult = await ssh.execCommand(
            sudoCmd(`bash -c 'apt-get update -qq && apt-get install -y ${missingPkgs.join(" ")}'`, sudoPass),
            { execOptions: { pty: true } }
          );
          if (installResult.code !== 0) {
            const errMsg = installResult.stderr || installResult.stdout;
            log(`Package install failed: ${errMsg.slice(0, 200)}`);
            send({
              type: "complete",
              success: false,
              message: "Failed to install required packages. Check credentials and network.",
            });
            ssh.dispose();
            controller.close();
            return;
          }
          log("Packages installed successfully.");
        } else {
          log("All required packages present.");
        }

        // Upload startup script
        log("Uploading startup script...");
        const remotePath = "/tmp/start_jetracer.sh";
        await ssh.execCommand(
          `cat > ${remotePath} << 'SCRIPT_EOF'\n${getStartScript()}\nSCRIPT_EOF`
        );
        await ssh.execCommand(`chmod +x ${remotePath}`);

        // Launch services (no PTY — PTY would kill the process when SSH disconnects)
        log("Launching JetRacer services...");
        await ssh.execCommand(
          `nohup bash ${remotePath} > /tmp/jetracer.log 2>&1 &`
        );
        ssh.dispose();
        ssh = null;

        // Poll for rosbridge
        let rosbridgeUp = false;
        const startTime = Date.now();
        const timeoutMs = 60000;
        let attempt = 0;
        const maxAttempts = Math.ceil(timeoutMs / 3000);

        while (Date.now() - startTime < timeoutMs) {
          await new Promise((r) => setTimeout(r, 3000));
          attempt++;
          log(`Waiting for rosbridge... (attempt ${attempt}/${maxAttempts})`);
          try {
            const result = await executeCommand(
              ip,
              "bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null",
              creds
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
          // Stream the startup log from the robot so user can see what happened
          try {
            const logResult = await executeCommand(ip, "cat /tmp/jetracer.log 2>/dev/null", creds);
            if (logResult.stdout.trim()) {
              for (const line of logResult.stdout.trim().split("\n")) {
                log(`[robot] ${line}`);
              }
            }
          } catch {}
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
            const logResult = await executeCommand(ip, "tail -20 /tmp/jetracer.log 2>/dev/null", creds);
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
