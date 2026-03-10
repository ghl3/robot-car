import { NextResponse } from "next/server";
import { getSSHConnection } from "@/lib/ssh";

export async function GET(request) {
  let ssh;
  try {
    const { searchParams } = new URL(request.url);
    const ip = searchParams.get("ip");
    if (!ip) {
      return NextResponse.json(
        { success: false, message: "IP address is required" },
        { status: 400 }
      );
    }

    ssh = await getSSHConnection(ip);

    // Run all health checks in parallel
    const [rosCheck, bridgeCheck, tempResult, memResult, diskResult, uptimeResult, ipResult] =
      await Promise.all([
        ssh.execCommand("pgrep -f roscore"),
        ssh.execCommand("bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null"),
        ssh.execCommand("cat /sys/devices/virtual/thermal/thermal_zone*/temp 2>/dev/null"),
        ssh.execCommand("free -m"),
        ssh.execCommand("df -h /"),
        ssh.execCommand("uptime -p 2>/dev/null || uptime"),
        ssh.execCommand("hostname -I"),
      ]);

    ssh.dispose();

    // Parse CPU temperature (millidegrees to degrees)
    const temps = tempResult.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((t) => parseInt(t, 10) / 1000);
    const cpuTemp = temps.length > 0 ? Math.max(...temps) : null;

    // Parse memory
    let memoryUsage = null;
    const memLines = memResult.stdout.trim().split("\n");
    if (memLines.length >= 2) {
      const parts = memLines[1].split(/\s+/);
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      memoryUsage = { totalMB: total, usedMB: used, percent: Math.round((used / total) * 100) };
    }

    // Parse disk
    let diskUsage = null;
    const diskLines = diskResult.stdout.trim().split("\n");
    if (diskLines.length >= 2) {
      const parts = diskLines[1].split(/\s+/);
      diskUsage = { size: parts[1], used: parts[2], available: parts[3], percent: parts[4] };
    }

    return NextResponse.json({
      success: true,
      rosRunning: rosCheck.code === 0,
      rosbridgeUp: bridgeCheck.code === 0,
      cpuTemp,
      memoryUsage,
      diskUsage,
      uptime: uptimeResult.stdout.trim(),
      ip: ipResult.stdout.trim().split(" ")[0],
    });
  } catch (error) {
    if (ssh) ssh.dispose();
    return NextResponse.json(
      { success: false, sshReachable: false, message: error.message },
      { status: 500 }
    );
  }
}
