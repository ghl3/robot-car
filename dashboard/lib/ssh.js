import { NodeSSH } from "node-ssh";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_USER = "jetson";
const DEFAULT_IP = "192.168.7.107";
const SSH_TIMEOUT = 10000;

function findPrivateKey() {
  const sshDir = join(homedir(), ".ssh");
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
    const keyPath = join(sshDir, name);
    if (existsSync(keyPath)) return keyPath;
  }
  return null;
}

function buildConnectOpts(ip) {
  const opts = {
    host: ip || DEFAULT_IP,
    username: DEFAULT_USER,
    readyTimeout: SSH_TIMEOUT,
  };

  const privateKey = findPrivateKey();
  if (privateKey) {
    opts.privateKeyPath = privateKey;
  } else {
    opts.password = DEFAULT_USER;
  }

  return opts;
}

export async function executeCommand(ip, command) {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(buildConnectOpts(ip));
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

export async function getSSHConnection(ip) {
  const ssh = new NodeSSH();
  await ssh.connect(buildConnectOpts(ip));
  return ssh;
}
