import { NextResponse } from "next/server";
import { executeCommand } from "@/lib/ssh";
import type { SSHCredentials } from "@/lib/ssh";

function getCreds(params: URLSearchParams | Record<string, unknown>): SSHCredentials {
  if (params instanceof URLSearchParams) {
    return {
      username: params.get("username") || undefined,
      password: params.get("password") || undefined,
    };
  }
  return {
    username: (params.username as string) || undefined,
    password: (params.password as string) || undefined,
  };
}

function getIp(params: URLSearchParams | Record<string, unknown>): string | null {
  if (params instanceof URLSearchParams) return params.get("ip");
  return (params.ip as string) || null;
}

/** Sanitize a name to prevent path traversal */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ip = getIp(searchParams);
    if (!ip) {
      return NextResponse.json({ success: false, message: "IP address is required" }, { status: 400 });
    }

    const creds = getCreds(searchParams);
    const type = searchParams.get("type") || "maps";

    if (type === "bags") {
      const result = await executeCommand(
        ip,
        "ls -1t ~/bags/*.bag 2>/dev/null | while read f; do echo \"$(basename \"$f\" .bag)|$(du -h \"$f\" | cut -f1)|$(stat -c %Y \"$f\" 2>/dev/null || stat -f %m \"$f\" 2>/dev/null)\"; done",
        creds
      );
      const bags = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, size, timestamp] = line.split("|");
          return { name, size: size?.trim(), timestamp: timestamp ? parseInt(timestamp, 10) * 1000 : 0 };
        });
      return NextResponse.json({ success: true, bags });
    }

    // Default: list maps
    const result = await executeCommand(
      ip,
      "ls -1t ~/maps/*.yaml 2>/dev/null | while read f; do echo \"$(basename \"$f\" .yaml)|$(stat -c %Y \"$f\" 2>/dev/null || stat -f %m \"$f\" 2>/dev/null)\"; done",
      creds
    );

    const maps = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, timestamp] = line.split("|");
        return { name, timestamp: timestamp ? parseInt(timestamp, 10) * 1000 : 0 };
      });

    return NextResponse.json({ success: true, maps });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip = getIp(body);
    if (!ip) {
      return NextResponse.json({ success: false, message: "IP address is required" }, { status: 400 });
    }

    const creds = getCreds(body);
    const action = body.action as string;

    switch (action) {
      // ── Map operations ──
      case "save": {
        // Check gmapping is running
        const slamCheck = await executeCommand(ip, "pgrep -f slam_toolbox", creds);
        if (slamCheck.exitCode !== 0) {
          return NextResponse.json({ success: false, message: "SLAM is not running — start mapping first" });
        }
        const name = sanitizeName(body.name || `map_${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`);
        await executeCommand(ip, "mkdir -p ~/maps", creds);
        const result = await executeCommand(
          ip,
          `bash -c 'source /opt/ros/melodic/setup.bash && rosrun map_server map_saver -f ~/maps/${name}'`,
          creds
        );
        if (result.exitCode !== 0) {
          return NextResponse.json({ success: false, message: result.stderr || "map_saver failed" });
        }
        return NextResponse.json({ success: true, name, message: `Map saved as ${name}` });
      }

      case "delete_map": {
        const name = sanitizeName(body.name);
        if (!name) return NextResponse.json({ success: false, message: "Name is required" });
        await executeCommand(ip, `rm -f ~/maps/${name}.pgm ~/maps/${name}.yaml`, creds);
        return NextResponse.json({ success: true, message: `Map ${name} deleted` });
      }

      // ── Rosbag operations ──
      case "start_recording": {
        const topics = (body.topics as string[]) || ["/scan", "/map", "/tf", "/odom", "/cmd_vel"];
        const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
        const bagName = `rec_${timestamp}`;
        await executeCommand(ip, "mkdir -p ~/bags", creds);
        await executeCommand(
          ip,
          `bash -c 'source /opt/ros/melodic/setup.bash && nohup rosbag record -O ~/bags/${bagName} ${topics.join(" ")} > /dev/null 2>&1 &'`,
          creds
        );
        return NextResponse.json({ success: true, name: bagName, message: "Recording started" });
      }

      case "stop_recording": {
        await executeCommand(ip, "pkill -INT -f 'rosbag record' 2>/dev/null", creds);
        return NextResponse.json({ success: true, message: "Recording stopped" });
      }

      case "play_bag": {
        const name = sanitizeName(body.name);
        if (!name) return NextResponse.json({ success: false, message: "Bag name is required" });
        // Stop any existing playback first
        await executeCommand(ip, "pkill -f 'rosbag play' 2>/dev/null", creds);
        await executeCommand(
          ip,
          `bash -c 'source /opt/ros/melodic/setup.bash && nohup rosbag play ~/bags/${name}.bag --clock > /dev/null 2>&1 &'`,
          creds
        );
        return NextResponse.json({ success: true, message: `Playing ${name}` });
      }

      case "stop_playback": {
        await executeCommand(ip, "pkill -f 'rosbag play' 2>/dev/null", creds);
        return NextResponse.json({ success: true, message: "Playback stopped" });
      }

      case "delete_bag": {
        const name = sanitizeName(body.name);
        if (!name) return NextResponse.json({ success: false, message: "Bag name is required" });
        await executeCommand(ip, `rm -f ~/bags/${name}.bag`, creds);
        return NextResponse.json({ success: true, message: `Bag ${name} deleted` });
      }

      default:
        return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
