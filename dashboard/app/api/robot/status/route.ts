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

    // Run all health checks in parallel (keep to ≤10 to avoid SSH channel/listener limits)
    const [rosCheck, bridgeCheck, tempResult, memResult, diskResult, uptimeResult, ipResult, lidarDeviceResult, lidarTopicResult, processChecks] =
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
        // Batch process checks into one command to stay under channel limit
        // Use [r]osbag trick so grep/pgrep doesn't match itself
        ssh.execCommand("slam=$(pgrep -c -f '[s]lam_toolbox' 2>/dev/null || echo 0); rec=$(pgrep -c -f '[r]osbag record' 2>/dev/null || echo 0); play=$(pgrep -c -f '[r]osbag play' 2>/dev/null || echo 0); cam=$(pgrep -c -f '[g]scam' 2>/dev/null || echo 0); wvs=$(pgrep -c -f '[w]eb_video_server' 2>/dev/null || echo 0); det=$(pgrep -c -f '[d]etectnet' 2>/dev/null || echo 0); nav=$(pgrep -c -f '[m]ove_base' 2>/dev/null || echo 0); echo slam=$slam rec=$rec play=$play cam=$cam wvs=$wvs det=$det nav=$nav"),
      ]);

    // Parse batched process checks
    const pcStr = processChecks.stdout;
    const slamActive = /slam=([1-9])/.test(pcStr);
    const recordingActive = /rec=([1-9])/.test(pcStr);
    const playbackActive = /play=([1-9])/.test(pcStr);
    const cameraActive = /cam=([1-9])/.test(pcStr);
    const webVideoServerActive = /wvs=([1-9])/.test(pcStr);
    const detectnetActive = /det=([1-9])/.test(pcStr);
    const depthnetActive = false;
    const navActive = /nav=([1-9])/.test(pcStr);

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
      slamActive,
      recordingActive,
      playbackActive,
      cameraActive,
      webVideoServerActive,
      detectnetActive,
      depthnetActive,
      navActive,
    });
  } catch (error) {
    if (ssh) ssh.dispose();
    return NextResponse.json(
      { success: false, sshReachable: false, message: (error as Error).message },
      { status: 500 }
    );
  }
}
