import { NextResponse } from "next/server";
import { executeCommand } from "@/lib/ssh";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip = body.ip;
    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    // Kill all ROS-related processes
    const stopCommands = [
      "pkill -f rosbridge 2>/dev/null",
      "pkill -f web_video_server 2>/dev/null",
      "pkill -f 'roslaunch jetracer' 2>/dev/null",
      "pkill -f 'roslaunch.*csi_camera' 2>/dev/null",
      "pkill -f roscore 2>/dev/null",
      "pkill -f rosmaster 2>/dev/null",
      "pkill -f start_jetracer 2>/dev/null",
    ];

    await executeCommand(ip, stopCommands.join("; "));

    return NextResponse.json({
      success: true,
      message: "Services stopped",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
