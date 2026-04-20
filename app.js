require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 5889);
const API_TOKEN = process.env.API_TOKEN || '';

const PATHS = {
  xrayConfig: process.env.XRAY_CONFIG || '/etc/xray/config.json',
  domain: process.env.XRAY_DOMAIN_FILE || '/etc/xray/domain',
  isp: process.env.XRAY_ISP_FILE || '/etc/xray/isp',
  city: process.env.XRAY_CITY_FILE || '/etc/xray/city',
  dns: process.env.XRAY_DNS_FILE || '/etc/xray/dns',
  pubkey: process.env.SLOWDNS_PUBKEY_FILE || '/etc/slowdns/server.pub',
  sshDb: process.env.SSH_DB || '/etc/ssh/.ssh.db',
  sshIpDir: process.env.SSH_IP_DIR || '/etc/kyt/limit/ssh/ip',
  vmessDb: process.env.VMESS_DB || '/etc/vmess/.vmess.db',
  vmessQuotaDir: process.env.VMESS_QUOTA_DIR || '/etc/vmess',
  vmessIpDir: process.env.VMESS_IP_DIR || '/etc/kyt/limit/vmess/ip',
  vlessDb: process.env.VLESS_DB || '/etc/vless/.vless.db',
  vlessQuotaDir: process.env.VLESS_QUOTA_DIR || '/etc/vless',
  vlessIpDir: process.env.VLESS_IP_DIR || '/etc/kyt/limit/vless/ip',
  trojanDb: process.env.TROJAN_DB || '/etc/trojan/.trojan.db',
  trojanQuotaDir: process.env.TROJAN_QUOTA_DIR || '/etc/trojan',
  trojanIpDir: process.env.TROJAN_IP_DIR || '/etc/kyt/limit/trojan/ip'
};

const XRAY = {
  vmess: {
    db: PATHS.vmessDb,
    quotaDir: PATHS.vmessQuotaDir,
    ipDir: PATHS.vmessIpDir,
    linePrefix: '###',
    markerA: '#vmess',
    markerB: '#vmessgrpc',
    objectLine: (username, uuid) => `},{"id": "${uuid}","alterId": 0,"email": "${username}"}`,
    buildLinks: buildVmessLinks,
    path: { stn: '/vmess', multi: '/vmess', grpc: 'vmess-grpc', up: '/vmess' },
    port: { tls: '443', none: '80', any: '443' }
  },
  vless: {
    db: PATHS.vlessDb,
    quotaDir: PATHS.vlessQuotaDir,
    ipDir: PATHS.vlessIpDir,
    linePrefix: '#&',
    markerA: '#vless',
    markerB: '#vlessgrpc',
    objectLine: (username, uuid) => `},{"id": "${uuid}","email": "${username}"}`,
    buildLinks: buildVlessLinks,
    path: { stn: '/vless', multi: '/vless', grpc: 'vless-grpc', up: '/vless' },
    port: { tls: '443', none: '80', any: '443' }
  },
  trojan: {
    db: PATHS.trojanDb,
    quotaDir: PATHS.trojanQuotaDir,
    ipDir: PATHS.trojanIpDir,
    linePrefix: '#!',
    markerA: '#trojanws',
    markerB: '#trojangrpc',
    objectLine: (username, uuid) => `},{"password": "${uuid}","email": "${username}"}`,
    buildLinks: buildTrojanLinks,
    path: { stn: '/trojan-ws', multi: '/trojan-ws', grpc: 'trojan-grpc', up: '/trojan-ws' },
    port: { tls: '443', none: '80', any: '443' }
  }
};

function auth(req, res, next) {
  const token = (req.headers.authorization || '').trim();
  if (!API_TOKEN) {
    return res.status(500).json(errorResponse('API_TOKEN belum diatur.', 500));
  }
  if (token !== API_TOKEN) {
    return res.status(401).json(errorResponse('Unauthorized', 401));
  }
  next();
}

function okResponse(data, message = 'success', code = 200) {
  return { meta: { code, status: 'success', message }, data };
}

function errorResponse(message, code = 400, extra) {
  const body = { meta: { code, status: 'error', message }, message };
  if (extra) body.error = extra;
  return body;
}

function readFileSafe(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, input) {
  const res = spawnSync(command, args, {
    input,
    encoding: 'utf8'
  });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    const err = new Error((res.stderr || res.stdout || `${command} gagal`).trim());
    err.status = res.status;
    throw err;
  }
  return (res.stdout || '').trim();
}

function restartService(name) {
  try {
    spawnSync('systemctl', ['restart', name], { encoding: 'utf8' });
  } catch {
    return;
  }
}

function hostnameValue() {
  return readFileSafe(PATHS.domain, os.hostname());
}

function infoBase() {
  return {
    hostname: hostnameValue(),
    ISP: readFileSafe(PATHS.isp, '-'),
    CITY: readFileSafe(PATHS.city, '-'),
    pubkey: readFileSafe(PATHS.pubkey, '-'),
    dns: readFileSafe(PATHS.dns, '-')
  };
}

function validUsername(username) {
  return /^[a-zA-Z0-9_-]+$/.test(String(username || ''));
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function bytesFromQuotaGb(quotaGb) {
  const gb = toInt(quotaGb, 0);
  return gb > 0 ? gb * 1024 * 1024 * 1024 : 0;
}

function quotaDisplay(quotaGb) {
  return `${toInt(quotaGb, 0)} GB`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatHumanDate(date) {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).replace(/ /g, ' ');
}

function formatTime(date) {
  return date.toTimeString().slice(0, 5);
}

function addDays(baseDate, days) {
  const date = new Date(baseDate.getTime());
  date.setDate(date.getDate() + toInt(days, 0));
  return date;
}

function addHours(baseDate, hours) {
  const date = new Date(baseDate.getTime());
  date.setHours(date.getHours() + hours);
  return date;
}

function futureDateFromDays(days) {
  return addDays(new Date(), days);
}

function updateQuotaFile(dir, username, quotaGb) {
  ensureDir(dir);
  const file = path.join(dir, username);
  const bytes = bytesFromQuotaGb(quotaGb);
  if (bytes > 0) {
    fs.writeFileSync(file, String(bytes));
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function updateIpLimitFile(dir, username, limitIp) {
  ensureDir(dir);
  const file = path.join(dir, username);
  const limit = toInt(limitIp, 0);
  if (limit > 0) {
    fs.writeFileSync(file, String(limit));
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function readIpLimit(dir, username) {
  return readFileSafe(path.join(dir, username), '0') || '0';
}

function readQuotaGb(dir, username) {
  const raw = readFileSafe(path.join(dir, username), '0');
  const bytes = Number.parseInt(raw, 10);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0';
  return String(Math.round(bytes / (1024 * 1024 * 1024)));
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

function writeLines(file, lines) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '');
}

function upsertDbRecord(file, prefix, username, fields) {
  const lines = readLines(file);
  const start = `${prefix} ${username} `;
  const next = lines.filter((line) => !line.startsWith(start));
  next.push([prefix, username, ...fields].join(' '));
  writeLines(file, next);
}

function removeDbRecord(file, prefix, username) {
  const lines = readLines(file);
  const start = `${prefix} ${username} `;
  writeLines(file, lines.filter((line) => !line.startsWith(start)));
}

function getDbRecord(file, prefix, username) {
  const start = `${prefix} ${username} `;
  const line = readLines(file).find((item) => item.startsWith(start));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return { line, parts };
}

function readXrayConfig() {
  return fs.readFileSync(PATHS.xrayConfig, 'utf8');
}

function writeXrayConfig(text) {
  fs.writeFileSync(PATHS.xrayConfig, text);
}

function insertAfterMarker(text, marker, block) {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((line) => line.trim().endsWith(marker));
  if (idx === -1) {
    throw new Error(`Marker ${marker} tidak ditemukan di config Xray.`);
  }
  lines.splice(idx + 1, 0, ...block);
  return `${lines.join('\n')}\n`;
}

function removeXrayUser(protocol, username) {
  const cfg = XRAY[protocol];
  const lines = readXrayConfig().split(/\r?\n/);
  const commentStart = `${cfg.linePrefix} ${username} `;
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith(commentStart)) {
      const next = lines[i + 1] || '';
      if (next.includes(`"email": "${username}"`)) {
        i += 1;
      }
      continue;
    }
    kept.push(line);
  }
  writeXrayConfig(kept.join('\n'));
}

function addXrayUser(protocol, username, expYmd, uuid) {
  const cfg = XRAY[protocol];
  let text = readXrayConfig();
  text = insertAfterMarker(text, cfg.markerA, [
    `${cfg.linePrefix} ${username} ${expYmd}`,
    cfg.objectLine(username, uuid)
  ]);
  text = insertAfterMarker(text, cfg.markerB, [
    `${cfg.linePrefix} ${username} ${expYmd}`,
    cfg.objectLine(username, uuid)
  ]);
  writeXrayConfig(text);
}

function replaceExpiryInConfig(protocol, username, expYmd) {
  const cfg = XRAY[protocol];
  const lines = readXrayConfig().split(/\r?\n/).map((line) => {
    if (line.startsWith(`${cfg.linePrefix} ${username} `)) {
      return `${cfg.linePrefix} ${username} ${expYmd}`;
    }
    return line;
  });
  writeXrayConfig(lines.join('\n'));
}

function getXrayRecord(protocol, username) {
  const cfg = XRAY[protocol];
  const rec = getDbRecord(cfg.db, cfg.linePrefix, username);
  if (!rec) return null;
  const parts = rec.parts;
  return {
    username: parts[1],
    exp: parts[2] || '',
    uuid: parts[3] || crypto.randomUUID(),
    quota: parts[4] || readQuotaGb(cfg.quotaDir, username),
    iplimit: parts[5] || readIpLimit(cfg.ipDir, username)
  };
}

function buildVmessLinks(host, username, uuid) {
  const tlsObj = { v: '2', ps: username, add: host, port: '443', id: uuid, aid: '0', net: 'ws', path: '/vmess', type: 'none', host, tls: 'tls' };
  const ntlsObj = { v: '2', ps: username, add: host, port: '80', id: uuid, aid: '0', net: 'ws', path: '/vmess', type: 'none', host, tls: 'none' };
  const grpcObj = { v: '2', ps: username, add: host, port: '443', id: uuid, aid: '0', net: 'grpc', path: 'vmess-grpc', type: 'none', host, tls: 'tls' };
  const toLink = (obj) => `vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
  return {
    tls: toLink(tlsObj),
    none: toLink(ntlsObj),
    grpc: toLink(grpcObj),
    uptls: toLink(tlsObj),
    upntls: toLink(ntlsObj)
  };
}

function buildVlessLinks(host, username, uuid) {
  return {
    tls: `vless://${uuid}@${host}:443?path=/vless&security=tls&encryption=none&type=ws#${username}`,
    none: `vless://${uuid}@${host}:80?path=/vless&encryption=none&type=ws#${username}`,
    grpc: `vless://${uuid}@${host}:443?mode=gun&security=tls&encryption=none&type=grpc&serviceName=vless-grpc&sni=${host}#${username}`,
    uptls: `vless://${uuid}@${host}:443?path=/vless&security=tls&encryption=none&type=ws#${username}`,
    upntls: `vless://${uuid}@${host}:80?path=/vless&encryption=none&type=ws#${username}`
  };
}

function buildTrojanLinks(host, username, uuid) {
  return {
    tls: `trojan://${uuid}@${host}:443?path=%2Ftrojan-ws&security=tls&host=${host}&type=ws&sni=${host}#${username}`,
    grpc: `trojan://${uuid}@${host}:443?mode=gun&security=tls&type=grpc&serviceName=trojan-grpc&sni=${host}#${username}`,
    uptls: `trojan://${uuid}@${host}:443?path=%2Ftrojan-ws&security=tls&host=${host}&type=ws&sni=${host}#${username}`
  };
}

function xrayPayload(protocol, record) {
  const cfg = XRAY[protocol];
  const base = infoBase();
  const links = cfg.buildLinks(base.hostname, record.username, record.uuid);
  return {
    ...base,
    username: record.username,
    uuid: record.uuid,
    expired: record.exp,
    exp: record.exp,
    quota: quotaDisplay(record.quota),
    ip_limit: String(record.iplimit),
    path: cfg.path,
    port: cfg.port,
    link: links
  };
}

function sshExists(username) {
  const out = spawnSync('getent', ['passwd', username], { encoding: 'utf8' });
  return out.status === 0;
}

function getSshDbRecord(username) {
  const lines = readLines(PATHS.sshDb);
  const line = lines.find((item) => item.startsWith(`#ssh# ${username} `));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  let password = parts[2] || '-';
  let iplimit = '0';
  if (parts.length >= 6) {
    iplimit = parts[4] || '0';
  } else if (parts.length >= 5) {
    iplimit = parts[3] || '0';
  }
  return { line, parts, username, password, iplimit };
}

function upsertSshRecord(username, password, iplimit, expHuman) {
  const lines = readLines(PATHS.sshDb).filter((line) => !line.startsWith(`#ssh# ${username} `));
  lines.push(`#ssh# ${username} ${password} 0 ${iplimit} ${expHuman}`);
  writeLines(PATHS.sshDb, lines);
}

function getSshExpiry(username) {
  try {
    const out = run('chage', ['-l', username]);
    const line = out.split(/\r?\n/).find((item) => item.toLowerCase().startsWith('account expires'));
    if (!line) return null;
    const raw = line.split(':').slice(1).join(':').trim();
    if (!raw || raw.toLowerCase() === 'never') return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

function sshPayload(username) {
  const base = infoBase();
  const dbRec = getSshDbRecord(username);
  const expDate = getSshExpiry(username) || addDays(new Date(), 1);
  return {
    ...base,
    username,
    password: dbRec?.password || '-',
    exp: formatDate(expDate),
    time: formatTime(expDate),
    port: {
      tls: '443,8443',
      none: '80,8080,2086,8880',
      ovpntcp: '443,1194',
      ovpnudp: '2200',
      sshohp: '8181,8282,8383',
      udpcustom: '1-65535'
    }
  };
}

function createSshUser(username, password, expiredDays, limitIp) {
  if (sshExists(username)) throw new Error('Username SSH sudah ada.');
  const expDate = futureDateFromDays(expiredDays);
  run('useradd', ['-e', formatDate(expDate), '-s', '/bin/false', '-M', username]);
  run('chpasswd', [], `${username}:${password}\n`);
  updateIpLimitFile(PATHS.sshIpDir, username, limitIp);
  upsertSshRecord(username, password, String(limitIp), formatHumanDate(expDate));
  return sshPayload(username);
}

function renewSshUser(username, days) {
  if (!sshExists(username)) throw new Error('Username SSH tidak ditemukan.');
  const current = getSshExpiry(username) || new Date();
  const from = formatDate(current);
  const nextDate = addDays(current > new Date() ? current : new Date(), days);
  run('usermod', ['-e', formatDate(nextDate), username]);
  const dbRec = getSshDbRecord(username);
  upsertSshRecord(username, dbRec?.password || '-', dbRec?.iplimit || '0', formatHumanDate(nextDate));
  return { username, hostname: hostnameValue(), from, to: formatDate(nextDate), exp: formatDate(nextDate) };
}

function deleteSshUser(username) {
  if (!sshExists(username)) throw new Error('Username SSH tidak ditemukan.');
  spawnSync('pkill', ['-u', username], { encoding: 'utf8' });
  run('userdel', ['-f', username]);
  removeDbRecord(PATHS.sshDb, '#ssh#', username);
  const limitFile = path.join(PATHS.sshIpDir, username);
  if (fs.existsSync(limitFile)) fs.unlinkSync(limitFile);
  return { username };
}

function lockSshUser(username) {
  if (!sshExists(username)) throw new Error('Username SSH tidak ditemukan.');
  run('passwd', ['-l', username]);
  return { username };
}

function unlockSshUser(username) {
  if (!sshExists(username)) throw new Error('Username SSH tidak ditemukan.');
  spawnSync('passwd', ['-u', username], { encoding: 'utf8' });
  return { username };
}

function changeSshIpLimit(username, limitIp) {
  if (!sshExists(username)) throw new Error('Username SSH tidak ditemukan.');
  updateIpLimitFile(PATHS.sshIpDir, username, limitIp);
  const dbRec = getSshDbRecord(username);
  const expDate = getSshExpiry(username) || addDays(new Date(), 1);
  upsertSshRecord(username, dbRec?.password || '-', String(limitIp), formatHumanDate(expDate));
  return { username, message: `${limitIp} IP` };
}

function createTrialName(prefix) {
  return `${prefix}-${crypto.randomBytes(2).toString('hex')}`;
}

function createXrayUser(protocol, username, expiredDays, quotaGb, limitIp) {
  const cfg = XRAY[protocol];
  const existing = getXrayRecord(protocol, username);
  if (existing) throw new Error(`Username ${protocol.toUpperCase()} sudah ada.`);
  const expYmd = formatDate(futureDateFromDays(expiredDays));
  const uuid = crypto.randomUUID();
  addXrayUser(protocol, username, expYmd, uuid);
  updateQuotaFile(cfg.quotaDir, username, quotaGb);
  updateIpLimitFile(cfg.ipDir, username, limitIp);
  upsertDbRecord(cfg.db, cfg.linePrefix, username, [expYmd, uuid, String(toInt(quotaGb, 0)), String(toInt(limitIp, 0))]);
  restartService('xray');
  return xrayPayload(protocol, { username, exp: expYmd, uuid, quota: String(toInt(quotaGb, 0)), iplimit: String(toInt(limitIp, 0)) });
}

function renewXrayUser(protocol, username, days, quotaGb) {
  const record = getXrayRecord(protocol, username);
  if (!record) throw new Error(`Username ${protocol.toUpperCase()} tidak ditemukan.`);
  const current = new Date(record.exp);
  const fromBase = Number.isNaN(current.getTime()) ? new Date() : current;
  const from = formatDate(fromBase);
  const nextDate = addDays(fromBase > new Date() ? fromBase : new Date(), days);
  const expYmd = formatDate(nextDate);
  replaceExpiryInConfig(protocol, username, expYmd);
  const nextQuota = String(toInt(quotaGb, record.quota));
  const cfg = XRAY[protocol];
  updateQuotaFile(cfg.quotaDir, username, nextQuota);
  upsertDbRecord(cfg.db, cfg.linePrefix, username, [expYmd, record.uuid, nextQuota, String(record.iplimit)]);
  restartService('xray');
  return { username, hostname: hostnameValue(), from, to: expYmd, exp: expYmd, quota: quotaDisplay(nextQuota) };
}

function deleteXrayUser(protocol, username) {
  const cfg = XRAY[protocol];
  const record = getXrayRecord(protocol, username);
  if (!record) throw new Error(`Username ${protocol.toUpperCase()} tidak ditemukan.`);
  removeXrayUser(protocol, username);
  removeDbRecord(cfg.db, cfg.linePrefix, username);
  const quotaFile = path.join(cfg.quotaDir, username);
  const ipFile = path.join(cfg.ipDir, username);
  if (fs.existsSync(quotaFile)) fs.unlinkSync(quotaFile);
  if (fs.existsSync(ipFile)) fs.unlinkSync(ipFile);
  restartService('xray');
  return { username };
}

function lockXrayUser(protocol, username) {
  const record = getXrayRecord(protocol, username);
  if (!record) throw new Error(`Username ${protocol.toUpperCase()} tidak ditemukan.`);
  removeXrayUser(protocol, username);
  restartService('xray');
  return { username };
}

function unlockXrayUser(protocol, username) {
  const record = getXrayRecord(protocol, username);
  if (!record) throw new Error(`Username ${protocol.toUpperCase()} tidak ditemukan.`);
  removeXrayUser(protocol, username);
  addXrayUser(protocol, username, record.exp, record.uuid);
  restartService('xray');
  return { username };
}

function changeXrayIpLimit(protocol, username, limitIp) {
  const cfg = XRAY[protocol];
  const record = getXrayRecord(protocol, username);
  if (!record) throw new Error(`Username ${protocol.toUpperCase()} tidak ditemukan.`);
  updateIpLimitFile(cfg.ipDir, username, limitIp);
  upsertDbRecord(cfg.db, cfg.linePrefix, username, [record.exp, record.uuid, String(record.quota), String(toInt(limitIp, 0))]);
  return { username, message: `${limitIp} IP` };
}

function checkXrayConfig(protocol, username) {
  const record = getXrayRecord(protocol, username);
  if (!record) throw new Error(`Username ${protocol.toUpperCase()} tidak ditemukan.`);
  return xrayPayload(protocol, record);
}

app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'adapter', version: '1.0.0' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/vps', auth);

app.post('/vps/sshvpn', (req, res) => {
  try {
    const { username, password, expired, limitip } = req.body || {};
    if (!validUsername(username)) return res.status(400).json(errorResponse('Username tidak valid.'));
    if (!password) return res.status(400).json(errorResponse('Password wajib diisi.'));
    const data = createSshUser(username, String(password), toInt(expired, 1), toInt(limitip, 0));
    return res.json(okResponse(data, 'SSH account created'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.post('/vps/trialsshvpn', (_req, res) => {
  try {
    const username = createTrialName('trialssh');
    const password = crypto.randomBytes(4).toString('hex');
    const expAt = addHours(new Date(), 3);
    const data = createSshUser(username, password, 1, 1);
    data.exp = formatDate(expAt);
    data.time = formatTime(expAt);
    return res.json(okResponse(data, 'SSH trial created'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.patch('/vps/renewsshvpn/:username/:days', (req, res) => {
  try {
    const data = renewSshUser(req.params.username, toInt(req.params.days, 1));
    return res.json(okResponse(data, 'SSH renewed'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.delete('/vps/deletesshvpn/:username', (req, res) => {
  try {
    const data = deleteSshUser(req.params.username);
    return res.json(okResponse(data, 'SSH deleted'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.patch('/vps/locksshvpn/:username', (req, res) => {
  try {
    const data = lockSshUser(req.params.username);
    return res.json(okResponse(data, 'SSH locked'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.patch('/vps/unlocksshvpn/:username', (req, res) => {
  try {
    const data = unlockSshUser(req.params.username);
    return res.json(okResponse(data, 'SSH unlocked'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.get('/vps/checkconfigsshvpn/:username', (req, res) => {
  try {
    if (!sshExists(req.params.username)) throw new Error('Username SSH tidak ditemukan.');
    return res.json(okResponse(sshPayload(req.params.username), 'SSH config'));
  } catch (err) {
    return res.status(404).json(errorResponse(err.message, 404));
  }
});

app.post('/vps/changelimipsshvpn', (req, res) => {
  try {
    const { username, limitip } = req.body || {};
    const data = changeSshIpLimit(username, toInt(limitip, 0));
    return res.json(okResponse(data, 'SSH IP limit changed'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

function registerXrayRoutes(routeBase, protocol) {
  app.post(`/vps/${routeBase}`, (req, res) => {
    try {
      const { username, expired, kuota, limitip } = req.body || {};
      if (!validUsername(username)) return res.status(400).json(errorResponse('Username tidak valid.'));
      const data = createXrayUser(protocol, username, toInt(expired, 1), toInt(kuota, 0), toInt(limitip, 0));
      return res.json(okResponse(data, `${protocol} account created`));
    } catch (err) {
      return res.status(400).json(errorResponse(err.message));
    }
  });

  const routeSuffix = protocol;
  app.patch(`/vps/renew${routeSuffix}/:username/:days`, (req, res) => {
    try {
      const data = renewXrayUser(protocol, req.params.username, toInt(req.params.days, 1), toInt(req.body?.kuota, 0));
      return res.json(okResponse(data, `${protocol} renewed`));
    } catch (err) {
      return res.status(400).json(errorResponse(err.message));
    }
  });

  app.delete(`/vps/delete${routeSuffix}/:username`, (req, res) => {
    try {
      const data = deleteXrayUser(protocol, req.params.username);
      return res.json(okResponse(data, `${protocol} deleted`));
    } catch (err) {
      return res.status(400).json(errorResponse(err.message));
    }
  });

  app.patch(`/vps/lock${routeSuffix}/:username`, (req, res) => {
    try {
      const data = lockXrayUser(protocol, req.params.username);
      return res.json(okResponse(data, `${protocol} locked`));
    } catch (err) {
      return res.status(400).json(errorResponse(err.message));
    }
  });

  app.patch(`/vps/unlock${routeSuffix}/:username`, (req, res) => {
    try {
      const data = unlockXrayUser(protocol, req.params.username);
      return res.json(okResponse(data, `${protocol} unlocked`));
    } catch (err) {
      return res.status(400).json(errorResponse(err.message));
    }
  });

  app.get(`/vps/checkconfig${routeSuffix}/:username`, (req, res) => {
    try {
      const data = checkXrayConfig(protocol, req.params.username);
      return res.json(okResponse(data, `${protocol} config`));
    } catch (err) {
      return res.status(404).json(errorResponse(err.message, 404));
    }
  });

  app.post(`/vps/changelimip${routeSuffix}`, (req, res) => {
    try {
      const { username, limitip } = req.body || {};
      const data = changeXrayIpLimit(protocol, username, toInt(limitip, 0));
      return res.json(okResponse(data, `${protocol} IP limit changed`));
    } catch (err) {
      return res.status(400).json(errorResponse(err.message));
    }
  });
}

registerXrayRoutes('vmessall', 'vmess');
registerXrayRoutes('vlessall', 'vless');
registerXrayRoutes('trojanall', 'trojan');

app.post('/vps/trialvmessall', (_req, res) => {
  try {
    const data = createXrayUser('vmess', createTrialName('trialvm'), 1, 1, 1);
    data.expired = formatDate(addHours(new Date(), 3));
    data.exp = data.expired;
    return res.json(okResponse(data, 'VMESS trial created'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.post('/vps/trialvlessall', (_req, res) => {
  try {
    const data = createXrayUser('vless', createTrialName('trialvl'), 1, 1, 1);
    data.expired = formatDate(addHours(new Date(), 3));
    data.exp = data.expired;
    return res.json(okResponse(data, 'VLESS trial created'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.post('/vps/trialtrojanall', (_req, res) => {
  try {
    const data = createXrayUser('trojan', createTrialName('trialtr'), 1, 1, 1);
    data.expired = formatDate(addHours(new Date(), 3));
    data.exp = data.expired;
    return res.json(okResponse(data, 'TROJAN trial created'));
  } catch (err) {
    return res.status(400).json(errorResponse(err.message));
  }
});

app.use((err, _req, res, _next) => {
  return res.status(500).json(errorResponse(err.message || 'Internal server error', 500));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`adapter listening on ${PORT}`);
});
