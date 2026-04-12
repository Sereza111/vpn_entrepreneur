import crypto from "crypto";
import { Client as SshClient } from "ssh2";

function parseJsonEnv(s, fallback) {
  const t = String(s || "").trim();
  if (!t) return fallback;
  try {
    return JSON.parse(t);
  } catch {
    return fallback;
  }
}

export function parseProxyServers(envValue) {
  const arr = parseJsonEnv(envValue, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => ({
      id: String(s?.id || "").trim(),
      country: String(s?.country || "").trim(),
      /** Подпись в мини-аппе (если пусто — имя страны по коду через Intl на клиенте). */
      label: String(s?.label || s?.name || "").trim(),
      host: String(s?.host || "").trim(),
      socksPort: Number(s?.socksPort ?? 1080),
      httpPort: Number(s?.httpPort ?? 3128),
      ssh: {
        host: String(s?.ssh?.host || s?.host || "").trim(),
        port: Number(s?.ssh?.port ?? 22),
        user: String(s?.ssh?.user || "").trim(),
        privateKeyB64: String(s?.ssh?.privateKeyB64 || "").trim(),
      },
      containerName: String(s?.containerName || "3proxy").trim(),
      configPath: String(s?.configPath || "/opt/3proxy/3proxy.cfg").trim(),
    }))
    .filter((s) => s.id && s.host && s.ssh.host);
}

export function generateProxyCredentials(telegramId) {
  const base = `tg${String(telegramId)}`.replace(/\D/g, "") || `tg${crypto.randomBytes(3).toString("hex")}`;
  const username = `${base}_${crypto.randomBytes(3).toString("hex")}`;
  const password = crypto.randomBytes(8).toString("hex"); // safe charset
  return { username, password };
}

function sshExec({ host, port, user, privateKey }, command) {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let stdout = "";
          let stderr = "";
          stream
            .on("close", (code) => {
              conn.end();
              resolve({ code, stdout, stderr });
            })
            .on("data", (d) => {
              stdout += String(d);
            });
          stream.stderr.on("data", (d) => {
            stderr += String(d);
          });
        });
      })
      .on("error", reject)
      .connect({
        host,
        port,
        username: user,
        privateKey,
        readyTimeout: 10_000,
      });
  });
}

export async function ensureProxyUserOnServer({
  server,
  username,
  password,
}) {
  const pk = server.ssh.privateKeyB64
    ? Buffer.from(server.ssh.privateKeyB64, "base64").toString("utf8")
    : "";
  if (!server.ssh.user || !pk) {
    throw new Error("proxy_ssh_not_configured");
  }

  // Append a per-user "users ..." line if missing.
  // Using hex-only password keeps this safe without heavy escaping.
  const line = `users ${username}:CL:${password}`;
  const cmd =
    `set -e; ` +
    `sudo test -f "${server.configPath}" || exit 2; ` +
    `sudo grep -q "^users ${username}:" "${server.configPath}" || ` +
    `echo "${line}" | sudo tee -a "${server.configPath}" >/dev/null; ` +
    `sudo docker restart "${server.containerName}" >/dev/null`;

  const r = await sshExec(
    {
      host: server.ssh.host,
      port: server.ssh.port,
      user: server.ssh.user,
      privateKey: pk,
    },
    cmd,
  );
  if (r.code !== 0) {
    throw new Error(`proxy_ssh_failed: ${r.code} ${r.stderr || r.stdout}`.trim());
  }
  return { ok: true };
}

