import { NextResponse } from "next/server";
import { executeCommand, getSudoPassword } from "@/lib/ssh";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, ip, username, password } = body as { action?: string; ip?: string; username?: string; password?: string };

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

    const creds = { username, password };
    const sudoPass = getSudoPassword(creds);
    const baseCmd = action === "shutdown" ? "shutdown now" : "reboot";
    const command = `echo '${sudoPass.replace(/'/g, "'\\''")}' | sudo -S ${baseCmd}`;

    // Connection drop is expected during shutdown/reboot
    try {
      await executeCommand(ip, command, creds);
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
