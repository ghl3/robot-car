import { NextResponse } from "next/server";
import { executeCommand } from "@/lib/ssh";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, ip } = body as { action?: string; ip?: string };

    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    if (action !== "shutdown" && action !== "reboot") {
      return NextResponse.json(
        { success: false, message: 'action must be "shutdown" or "reboot"' },
        { status: 400 }
      );
    }

    const command = action === "shutdown" ? "sudo shutdown now" : "sudo reboot";

    // Connection drop is expected during shutdown/reboot
    try {
      await executeCommand(ip, command);
    } catch {
      // Expected
    }

    return NextResponse.json({
      success: true,
      message: action === "shutdown" ? "Shutting down..." : "Rebooting...",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
