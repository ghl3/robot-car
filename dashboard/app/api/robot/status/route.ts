import { NextResponse } from "next/server";
import { getSSHConnection } from "@/lib/ssh";
import type { NodeSSH } from "node-ssh";

export async function GET(request: Request) {
  let ssh: NodeSSH | undefined;
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

    ssh = await getSSHConnection(ip, { username, password });

    // Run all health checks in parallel
    const [rosCheck, bridgeCheck, tempResult, memResult, diskResult, uptimeResult, ipResult, lidarDeviceResult, lidarTopicResult, slamResult] =
      await Promise.all([
        ssh.execCommand("pgrep -f roscore"),
        ssh.execCommand("bash -c 'echo > /dev/tcp/localhost/9090' 2>/dev/null"),
        ssh.execCommand("for z in /sys/devices/virtual/thermal/thermal_zone*; do echo \"$(cat $z/type):$(cat $z/temp)\"; done 2>/dev/null"),
        ssh.execCommand("free -m"),
        ssh.execCommand("df -h /"),
        ssh.execCommand("uptime -p 2>/dev/null || uptime"),
        ssh.execCommand("hostname -I"),
        ssh.execCommand("test -e /dev/ttyACM1 && echo yes || echo"),
        ssh.execCommand("pgrep -f rplidarNode"),
        ssh.execCommand("pgrep -f slam_gmapping"),
      ]);

    ssh.dispose();

    // Parse temperatures by zone name (millidegrees to degrees), skip PMIC-Die (always reads 100°C)
    const temps: Record<string, number> = {};
    for (const line of tempResult.stdout.trim().split("\n").filter(Boolean)) {
      const [name, val] = line.split(":");
      if (name && val && name !== "PMIC-Die") {
        temps[name] = parseInt(val, 10) / 1000;
      }
    }

    // Parse memory
    let memoryUsage: { totalMB: number; usedMB: number; percent: number } | null = null;
    const memLines = memResult.stdout.trim().split("\n");
    if (memLines.length >= 2) {
      const parts = memLines[1].split(/\s+/);
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      memoryUsage = { totalMB: total, usedMB: used, percent: Math.round((used / total) * 100) };
    }

    // Parse disk
    let diskUsage: { size: string; used: string; available: string; percent: string } | null = null;
    const diskLines = diskResult.stdout.trim().split("\n");
    if (diskLines.length >= 2) {
      const parts = diskLines[1].split(/\s+/);
      diskUsage = { size: parts[1], used: parts[2], available: parts[3], percent: parts[4] };
    }

    return NextResponse.json({
      success: true,
      rosRunning: rosCheck.code === 0,
      rosbridgeUp: bridgeCheck.code === 0,
      temps,
      memoryUsage,
      diskUsage,
      uptime: uptimeResult.stdout.trim(),
      ip: ipResult.stdout.trim().split(" ")[0],
      lidarDetected: lidarDeviceResult.stdout.trim() !== "",
      lidarActive: lidarTopicResult.code === 0,
      slamActive: slamResult.code === 0,
    });
  } catch (error) {
    if (ssh) ssh.dispose();
    return NextResponse.json(
      { success: false, sshReachable: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
