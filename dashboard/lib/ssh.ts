import { NodeSSH } from "node-ssh";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_USER = "jetson";
const DEFAULT_PASS = "jetson";
const DEFAULT_IP = "192.168.7.107";
const SSH_TIMEOUT = 10000;

export interface SSHCredentials {
  username?: string;
  password?: string;
}

interface ConnectOpts {
  host: string;
  username: string;
  readyTimeout: number;
  privateKeyPath?: string;
  password?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function findPrivateKey(): string | null {
  const sshDir = join(homedir(), ".ssh");
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
    const keyPath = join(sshDir, name);
    if (existsSync(keyPath)) return keyPath;
  }
  return null;
}

function buildConnectOpts(ip?: string, creds?: SSHCredentials): ConnectOpts {
  const opts: ConnectOpts = {
    host: ip || DEFAULT_IP,
    username: creds?.username || DEFAULT_USER,
    readyTimeout: SSH_TIMEOUT,
  };

  const privateKey = findPrivateKey();
  if (privateKey) {
    opts.privateKeyPath = privateKey;
  } else {
    opts.password = creds?.password || DEFAULT_PASS;
  }

  return opts;
}

export async function executeCommand(ip: string, command: string, creds?: SSHCredentials): Promise<CommandResult> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildConnectOpts(ip, creds));
    const result = await ssh.execCommand(command, { execOptions: { pty: true } });
    ssh.dispose();
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code ?? 0,
    };
  } catch (error) {
    ssh.dispose();
    throw error;
  }
}

export async function getSSHConnection(ip: string, creds?: SSHCredentials): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  await ssh.connect(buildConnectOpts(ip, creds));
  return ssh;
}

/**
 * Get the sudo password for the given credentials.
 * Returns the SSH password (used with `sudo -S`).
 */
export function getSudoPassword(creds?: SSHCredentials): string {
  return creds?.password || DEFAULT_PASS;
}
