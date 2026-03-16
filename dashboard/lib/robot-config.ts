const IP_KEY = "robot-ip";
const USER_KEY = "robot-user";
const PASS_KEY = "robot-pass";

export interface RobotCredentials {
  ip: string;
  username: string;
  password: string;
}

export function getStoredIp(): string {
  if (typeof window === "undefined") return getDefaultIp();
  return localStorage.getItem(IP_KEY) || getDefaultIp();
}

export function setStoredIp(ip: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(IP_KEY, ip);
}

export function getStoredCredentials(): RobotCredentials {
  if (typeof window === "undefined") {
    return { ip: getDefaultIp(), username: "jetson", password: "jetson" };
  }
  return {
    ip: localStorage.getItem(IP_KEY) || getDefaultIp(),
    username: localStorage.getItem(USER_KEY) || "jetson",
    password: localStorage.getItem(PASS_KEY) || "jetson",
  };
}

export function setStoredCredentials(creds: Partial<RobotCredentials>): void {
  if (typeof window === "undefined") return;
  if (creds.ip !== undefined) localStorage.setItem(IP_KEY, creds.ip);
  if (creds.username !== undefined) localStorage.setItem(USER_KEY, creds.username);
  if (creds.password !== undefined) localStorage.setItem(PASS_KEY, creds.password);
}

function getDefaultIp(): string {
  return process.env.NEXT_PUBLIC_ROBOT_IP || "192.168.7.107";
}
