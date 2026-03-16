import { NextResponse } from "next/server";
import { executeCommand, getSudoPassword } from "@/lib/ssh";

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ip = searchParams.get("ip");
    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    const username = searchParams.get("username") || undefined;
    const password = searchParams.get("password") || undefined;
    const creds = { username, password };

    const result = await executeCommand(
      ip,
      "nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list --rescan yes 2>/dev/null",
      creds
    );

    const networks: WifiNetwork[] = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ssid, signal, security] = line.split(":");
        return { ssid, signal: parseInt(signal, 10) || 0, security: security || "Open" };
      })
      .filter((n) => n.ssid)
      .reduce<WifiNetwork[]>((acc, n) => {
        // Deduplicate by SSID, keeping strongest signal
        const existing = acc.find((e) => e.ssid === n.ssid);
        if (!existing) acc.push(n);
        else if (n.signal > existing.signal) {
          existing.signal = n.signal;
          existing.security = n.security;
        }
        return acc;
      }, [])
      .sort((a, b) => b.signal - a.signal);

    // Get current connection
    const currentResult = await executeCommand(
      ip,
      "nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | grep wlan",
      creds
    );
    const currentNetwork = currentResult.stdout.trim().split(":")[0] || null;

    return NextResponse.json({ success: true, networks, currentNetwork });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ssid, wifiPassword, ip, username, password } = body as {
      ssid?: string;
      wifiPassword?: string;
      ip?: string;
      username?: string;
      password?: string;
    };

    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    if (!ssid) {
      return NextResponse.json(
        { success: false, message: "SSID is required" },
        { status: 400 }
      );
    }

    const creds = { username, password };
    const sudoPass = getSudoPassword(creds);
    const escapedSsid = ssid.replace(/'/g, "'\\''");
    const baseCmd = wifiPassword
      ? `nmcli dev wifi connect '${escapedSsid}' password '${wifiPassword.replace(/'/g, "'\\''")}'`
      : `nmcli dev wifi connect '${escapedSsid}'`;
    const command = `echo '${sudoPass.replace(/'/g, "'\\''")}' | sudo -S ${baseCmd}`;

    const result = await executeCommand(ip, command, creds);

    if (result.exitCode !== 0) {
      return NextResponse.json(
        { success: false, message: result.stderr || result.stdout || "Failed to connect" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Connected to ${ssid}`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
