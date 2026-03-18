import { NextResponse } from "next/server";
import { executeCommand } from "@/lib/ssh";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ip, username, password } = body as { ip?: string; username?: string; password?: string };
    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    // Kill the startup script first, then all ROS processes.
    const stopScript = [
      "pkill -f start_jetracer 2>/dev/null",
      "sleep 1",
      "pkill -f roslaunch 2>/dev/null",
      "pkill -f slam_gmapping 2>/dev/null",
      "pkill -f rplidarNode 2>/dev/null",
      "pkill -f web_video_server 2>/dev/null",
      "pkill -f rosbridge 2>/dev/null",
      "sleep 1",
      "pkill -f roscore 2>/dev/null",
      "pkill -f rosmaster 2>/dev/null",
      "sleep 1",
      // Force-kill any stragglers
      "pkill -9 -f start_jetracer 2>/dev/null",
      "pkill -9 -f roslaunch 2>/dev/null",
      "pkill -9 -f slam_gmapping 2>/dev/null",
      "pkill -9 -f rplidarNode 2>/dev/null",
      "pkill -9 -f roscore 2>/dev/null",
      "pkill -9 -f rosmaster 2>/dev/null",
      // Wait until rosbridge port is actually closed
      "for i in $(seq 1 10); do bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null || break; sleep 1; done",
      "true",
    ];

    await executeCommand(ip, stopScript.join("; "), { username, password });

    return NextResponse.json({
      success: true,
      message: "Services stopped",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
