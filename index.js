import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PREFIX = process.env.PREFIX || '.';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'store');
const SETTINGS_FILE = path.join(DATA_DIR, 'groups.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let latestQR = null;
let connected = false;
let sockRef = null;
let reconnectTimer = null;

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
}
let groupSettings = loadSettings();
function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(groupSettings, null, 2));
}
function settingsFor(groupJid) {
  groupSettings[groupJid] ??= { welcome: false, antilink: false };
  return groupSettings[groupJid];
}
function jidNumber(jid = '') { return jid.split('@')[0].split(':')[0].replace(/\D/g, ''); }
function isOwner(jid) {
  return Boolean(OWNER_NUMBER) && jidNumber(jid) === OWNER_NUMBER;
}
function getText(message) {
  const m = message.message || {};
  return m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId || '';
}
function quotedMessage(message) {
  const m = message.message || {};
  return m.extendedTextMessage?.contextInfo?.quotedMessage || null;
}
function quotedParticipant(message) {
  return message.message?.extendedTextMessage?.contextInfo?.participant || null;
}
function senderJid(message) {
  return message.key.participant || message.key.remoteJid || '';
}
async function isGroupAdmin(groupJid, userJid) {
  try {
    const metadata = await sockRef.groupMetadata(groupJid);
    return metadata.participants.some(p => p.id === userJid && ['admin', 'superadmin'].includes(p.admin));
  } catch { return false; }
}
async function botIsAdmin(groupJid) {
  const metadata = await sockRef.groupMetadata(groupJid);
  const botJid = sockRef.user?.id?.split(':')[0] + '@s.whatsapp.net';
  return metadata.participants.some(p => p.id.split(':')[0] === botJid.split(':')[0] && ['admin', 'superadmin'].includes(p.admin));
}
async function reply(jid, text, quoted) {
  return sockRef.sendMessage(jid, { text }, quoted ? { quoted } : {});
}
const menuText = () => `╭━━━〔 ✦ MAJNU-MD ✦ 〕━━━╮
┃  ⚡ WhatsApp Multi-Device
┃  Prefix: ${PREFIX}
╰━━━━━━━━━━━━━━━━━━━━━━╯

┏━━〔 GENERAL 〕
┃ ${PREFIX}menu
┃ ${PREFIX}help
┃ ${PREFIX}ping
┃ ${PREFIX}alive
┃ ${PREFIX}owner
┃ ${PREFIX}groupinfo
┗━━━━━━━━━━━━━━━━━━━━

┏━━〔 MEDIA 〕
┃ ${PREFIX}sticker  (reply to image/video)
┗━━━━━━━━━━━━━━━━━━━━

┏━━〔 GROUP ADMIN 〕
┃ ${PREFIX}welcome on/off
┃ ${PREFIX}antilink on/off
┃ ${PREFIX}tagall [message]
┃ ${PREFIX}promote (reply/mention)
┃ ${PREFIX}demote (reply/mention)
┃ ${PREFIX}kick (reply/mention)
┃ ${PREFIX}lock
┃ ${PREFIX}unlock
┗━━━━━━━━━━━━━━━━━━━━

© POWERED BY MAJNU-MD`;
async function sendMenu(jid, quoted) {
  await reply(jid, menuText(), quoted);
}

async function handleMessage(m) {
  if (!m.message || m.key.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  const text = getText(m).trim();
  if (!text.startsWith(PREFIX)) {
    if (jid.endsWith('@g.us') && text) {
      const s = settingsFor(jid);
      if (s.antilink && /(https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(text)) {
        const sender = senderJid(m);
        if (!(await isGroupAdmin(jid, sender)) && !(await isOwner(sender))) {
          try {
            if (await botIsAdmin(jid)) {
              await sockRef.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: m.key.id, participant: sender } });
              await reply(jid, `⚠️ @${jidNumber(sender)}, links are not allowed here.`, m, { mentions: [sender] });
            } else {
              await reply(jid, '⚠️ Antilink is enabled, but MAJNU-MD needs group admin permission to delete links.', m);
            }
          } catch (e) { console.error('Antilink:', e.message); }
        }
      }
    }
    return;
  }

  const sender = senderJid(m);
  const isGroup = jid.endsWith('@g.us');
  const parts = text.slice(PREFIX.length).trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const args = parts;
  const quoted = m;
  const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const target = quotedParticipant(m) || mentioned[0] || null;

  try {
    switch (command) {
      case 'menu':
      case 'help':
        return sendMenu(jid, quoted);
      case 'ping':
        return reply(jid, '🏓 MAJNU-MD is online!', quoted);
      case 'alive':
        return reply(jid, `╭─〔 MAJNU-MD 〕─╮\n│ Status: ${connected ? 'Online ✅' : 'Connecting…'}\n│ Library: Baileys\n│ Prefix: ${PREFIX}\n╰────────────────╯`, quoted);
      case 'owner':
        return reply(jid, OWNER_NUMBER ? `👑 Owner: +${OWNER_NUMBER}` : '👑 Owner number is not configured. Set OWNER_NUMBER in environment variables.', quoted);
      case 'groupinfo': {
        if (!isGroup) return reply(jid, '❌ Ye command sirf group mein chalegi.', quoted);
        const md = await sockRef.groupMetadata(jid);
        return reply(jid, `╭─〔 GROUP INFO 〕─╮\nName: ${md.subject}\nMembers: ${md.participants.length}\nCreated: ${md.creation ? new Date(md.creation * 1000).toLocaleDateString() : 'N/A'}\nDescription: ${md.desc || 'No description'}\n╰─ MAJNU-MD ─╯`, quoted);
      }
      case 'sticker': {
        const msg = m.message;
        const context = msg.extendedTextMessage?.contextInfo;
        const q = context?.quotedMessage;
        const imageMsg = msg.imageMessage || q?.imageMessage;
        const videoMsg = msg.videoMessage || q?.videoMessage;
        if (!imageMsg && !videoMsg) return reply(jid, `Reply to an image or a short video with ${PREFIX}sticker.`, quoted);
        const mediaMessage = q ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: q } : m;
        const buffer = await downloadMediaMessage(mediaMessage, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sockRef.updateMediaMessage });
        const webp = await sharp(buffer, { animated: Boolean(videoMsg) }).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        return sockRef.sendMessage(jid, { sticker: webp }, { quoted: m });
      }
      case 'welcome':
      case 'antilink': {
        if (!isGroup) return reply(jid, '❌ Ye command sirf group mein chalegi.', quoted);
        if (!(await isGroupAdmin(jid, sender)) && !isOwner(sender)) return reply(jid, '❌ Sirf group admin ye setting badal sakta hai.', quoted);
        const value = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(value)) return reply(jid, `Usage: ${PREFIX}${command} on/off`, quoted);
        settingsFor(jid)[command] = value === 'on';
        saveSettings();
        return reply(jid, `✅ ${command} ${value.toUpperCase()} ho gaya.`, quoted);
      }
      case 'tagall': {
        if (!isGroup) return reply(jid, '❌ Ye command sirf group mein chalegi.', quoted);
        if (!(await isGroupAdmin(jid, sender)) && !isOwner(sender)) return reply(jid, '❌ Sirf group admin ye command chala sakta hai.', quoted);
        const md = await sockRef.groupMetadata(jid);
        const mentions = md.participants.map(p => p.id);
        const body = args.join(' ') || 'Everyone attention please!';
        return sockRef.sendMessage(jid, { text: `📢 ${body}\n\n${mentions.map(u => `• @${jidNumber(u)}`).join('\n')}`, mentions }, { quoted: m });
      }
      case 'promote':
      case 'demote':
      case 'kick': {
        if (!isGroup) return reply(jid, '❌ Ye command sirf group mein chalegi.', quoted);
        if (!(await isGroupAdmin(jid, sender)) && !isOwner(sender)) return reply(jid, '❌ Sirf group admin ye command chala sakta hai.', quoted);
        if (!(await botIsAdmin(jid))) return reply(jid, '❌ Pehle MAJNU-MD ko group admin banao.', quoted);
        if (!target) return reply(jid, `Reply to a member's message or mention them.\nExample: ${PREFIX}${command} @user`, quoted);
        if (command === 'promote') await sockRef.groupParticipantsUpdate(jid, [target], 'promote');
        if (command === 'demote') await sockRef.groupParticipantsUpdate(jid, [target], 'demote');
        if (command === 'kick') await sockRef.groupParticipantsUpdate(jid, [target], 'remove');
        return reply(jid, `✅ ${command} action requested for @${jidNumber(target)}.`, quoted);
      }
      case 'lock':
      case 'unlock': {
        if (!isGroup) return reply(jid, '❌ Ye command sirf group mein chalegi.', quoted);
        if (!(await isGroupAdmin(jid, sender)) && !isOwner(sender)) return reply(jid, '❌ Sirf group admin ye command chala sakta hai.', quoted);
        if (!(await botIsAdmin(jid))) return reply(jid, '❌ Pehle MAJNU-MD ko group admin banao.', quoted);
        await sockRef.groupSettingUpdate(jid, command === 'lock' ? 'announcement' : 'not_announcement');
        return reply(jid, command === 'lock' ? '🔒 Only admins can send messages now.' : '🔓 All members can send messages now.', quoted);
      }
      default:
        return;
    }
  } catch (err) {
    console.error(`Command ${command} failed:`, err?.stack || err);
    return reply(jid, `❌ ${command} command failed: ${err?.message || 'unknown error'}`, quoted).catch(() => {});
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  sockRef = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQR = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
      console.log('\n[MAJNU-MD] QR ready. Open the app URL + /qr in your browser to scan it.\n');
    }
    if (connection === 'open') {
      connected = true;
      latestQR = null;
      console.log('[MAJNU-MD] WhatsApp connected as', sock.user?.id);
    }
    if (connection === 'close') {
      connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('[MAJNU-MD] Connection closed. Status:', statusCode);
      if (statusCode !== DisconnectReason.loggedOut) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startBot().catch(console.error), 3000);
      } else {
        console.log('[MAJNU-MD] Logged out. Remove auth_info and redeploy/restart to scan a new QR.');
      }
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) await handleMessage(m);
  });
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    const s = settingsFor(id);
    if (action === 'add' && s.welcome) {
      for (const user of participants) await sock.sendMessage(id, { text: `╭─〔 WELCOME 〕─╮\nWelcome @${jidNumber(user)} to the group! 🌸\nPlease read the group rules.\n\n© POWERED BY MAJNU-MD`, mentions: [user] }).catch(() => {});
    }
    if (action === 'remove' && s.welcome) {
      for (const user of participants) await sock.sendMessage(id, { text: `Goodbye @${jidNumber(user)} 👋`, mentions: [user] }).catch(() => {});
    }
  });
}

const app = express();
app.get('/health', (_req, res) => res.status(200).json({ ok: true, bot: 'MAJNU-MD', connected }));
app.get('/api/status', (_req, res) => res.json({ bot: 'MAJNU-MD', connected, qrReady: Boolean(latestQR) }));
app.get('/api/qr', (_req, res) => {
  if (connected) return res.json({ connected: true, qr: null });
  res.json({ connected: false, qr: latestQR });
});
app.get('/qr', (_req, res) => res.type('html').send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAJNU-MD QR</title>
<style>body{background:#090909;color:#f5d58b;font-family:Arial;text-align:center;padding:24px}main{max-width:420px;margin:auto;border:1px solid #765b2c;border-radius:18px;padding:20px}img{width:min(320px,90%);background:white;padding:10px;border-radius:12px}.muted{color:#ddd;font-size:14px}</style></head>
<body><main><h1>MAJNU-MD</h1><p class="muted">WhatsApp Linked Devices → Link a device</p><div id="view">Waiting for QR…</div><p class="muted">Do not share this page or QR with anyone.</p><p>© POWERED BY MAJNU-MD</p></main>
<script>async function poll(){try{const r=await fetch('/api/qr');const d=await r.json();const v=document.getElementById('view');if(d.connected){v.innerHTML='<h2>Connected ✅</h2>'}else if(d.qr){v.innerHTML='<img alt="WhatsApp login QR" src="'+d.qr+'"><p>Scan this QR from your own WhatsApp.</p>'}else{v.textContent='QR is being generated. Refreshing automatically…'}}catch(e){document.getElementById('view').textContent='Waiting for service…'}setTimeout(poll,3000)}poll();</script></body></html>`));
app.get('/', (_req, res) => res.redirect('/qr'));
app.listen(PORT, '0.0.0.0', () => console.log(`[MAJNU-MD] Web server listening on ${PORT}`));
startBot().catch(err => { console.error('[MAJNU-MD] Startup error:', err); process.exitCode = 1; });