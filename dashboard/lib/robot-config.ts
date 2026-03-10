const STORAGE_KEY = "robot-ip";

export function getStoredIp(): string {
  if (typeof window === "undefined") return getDefaultIp();
  return localStorage.getItem(STORAGE_KEY) || getDefaultIp();
}

export function setStoredIp(ip: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, ip);
}

function getDefaultIp(): string {
  return process.env.NEXT_PUBLIC_ROBOT_IP || "192.168.7.107";
}
