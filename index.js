require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');
const { getGroup, updateGroup } = require('./store');

const PORT = Number(process.env.PORT || 8080);
const PREFIX = process.env.PREFIX || '.';
const BOT_NAME = process.env.BOT_NAME || 'EDI BOT';
const AUTH_DIR = process.env.AUTH_DIR || path.join(process.cwd(), 'auth');
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const PAIRING_SECRET = process.env.PAIRING_SECRET || '';
let sock = null;
let connecting = false;
let latestPairingCode = null;
let authRegistered = false;
const logger = pino({ level: 'silent' });

const app = express();
app.use(express.json({ limit: '20kb' }));
app.get('/', (_req, res) => res.json({ name: BOT_NAME, status: sock ? 'starting_or_connected' : 'offline', message: 'EDI BOT API' }));
app.get('/health', (_req, res) => res.json({ ok: true, bot: BOT_NAME, connected: Boolean(sock?.user) }));
app.post('/pair', async (req, res) => {
  if (!PAIRING_SECRET || req.get('x-api-key') !== PAIRING_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const phone = String(req.body?.phone || process.env.PAIRING_PHONE || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) return res.status(400).json({ error: 'Mete nimewo a nan fòma entènasyonal, chif sèlman.' });
  try {
    if (!sock) await startBot('');
    if (authRegistered) return res.status(409).json({ error: 'Bot la deja konekte ak yon kont WhatsApp.' });
    if (!latestPairingCode) {
      await new Promise(r => setTimeout(r, 1200));
      latestPairingCode = await sock.requestPairingCode(phone);
      console.log(`PAIRING CODE: ${latestPairingCode}`);
    }
    return res.json({ pairingCode: latestPairingCode, message: 'Antre kòd sa a nan WhatsApp > Aparèy konekte > Konekte ak nimewo telefòn.' });
  } catch (e) {
    console.error('Pair error:', e.message);
    return res.status(500).json({ error: 'Pa t kapab kreye kòd koneksyon an.' });
  }
});

app.listen(PORT, () => console.log(`${BOT_NAME} API listening on ${PORT}`));

async function startBot(phone = '') {
  if (connecting) return;
  connecting = true;
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    authRegistered = Boolean(state.creds.registered);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false,
      browser: ['EDI BOT', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        latestPairingCode = null;
        console.log(`${BOT_NAME} connected as ${sock.user?.id || 'WhatsApp user'}`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        sock = null;
        if (code !== DisconnectReason.loggedOut) {
          console.log('Connection closed. Reconnecting...');
          setTimeout(() => startBot(''), 4000);
        } else {
          console.log('Session logged out. Clear auth storage and pair again.');
        }
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        try { await handleMessage(m); }
        catch (e) { console.error('Message error:', e.message); }
      }
    });
  } finally {
    connecting = false;
  }
}

function getText(m) {
  const msg = m.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || '';
}
function getSender(m) { return jidNormalizedUser(m.key.participant || m.key.remoteJid || ''); }
function numberFromJid(jid) { return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, ''); }
async function isAdmin(groupJid, sender) {
  const meta = await sock.groupMetadata(groupJid);
  const p = meta.participants.find(x => jidNormalizedUser(x.id) === jidNormalizedUser(sender));
  return Boolean(p?.admin);
}
async function isBotAdmin(groupJid) {
  const meta = await sock.groupMetadata(groupJid);
  const me = jidNormalizedUser(sock.user.id);
  const p = meta.participants.find(x => jidNormalizedUser(x.id) === me);
  return Boolean(p?.admin);
}
async function reply(jid, text, quoted) { return sock.sendMessage(jid, { text }, { quoted }); }
async function handleMessage(m) {
  if (!m.message || m.key.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  const text = getText(m).trim();
  if (!text) return;
  const sender = getSender(m);
  const isGroup = jid.endsWith('@g.us');
  const cfg = isGroup ? getGroup(jid) : null;

  if (isGroup && cfg.antilink && /https?:\/\/|www\.|chat\.whatsapp\.com\//i.test(text)) {
    const admin = await isAdmin(jid, sender).catch(() => false);
    if (!admin && await isBotAdmin(jid).catch(() => false)) {
      await sock.sendMessage(jid, { delete: m.key });
      await reply(jid, '⚠️ Lyen pa otorize. Mesaj la retire.', m);
    }
  }
  if (isGroup && cfg.antispam) {
    const now = Date.now();
    const key = `${jid}:${sender}`;
    spamTracker.set(key, (spamTracker.get(key) || []).filter(t => now - t < 7000).concat(now));
    if (spamTracker.get(key).length >= 5) {
      await reply(jid, '⚠️ Tanpri evite voye twòp mesaj youn apre lòt.', m);
      spamTracker.set(key, []);
    }
  }
  if (!text.startsWith(PREFIX)) return;
  const [raw, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (raw || '').toLowerCase();
  const argText = args.join(' ');
  const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const quotedParticipant = m.message.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned[0] || quotedParticipant;
  const senderAdmin = isGroup ? await isAdmin(jid, sender).catch(() => false) : false;
  const botAdmin = isGroup ? await isBotAdmin(jid).catch(() => false) : false;
  const owner = OWNER_NUMBER && numberFromJid(sender) === OWNER_NUMBER;
  const needGroup = () => isGroup ? null : 'Kòmand sa a mache sèlman nan gwoup.';
  const needAdmin = () => senderAdmin || owner ? null : 'Se administratè gwoup la oswa pwopriyetè bot la ki ka fè sa.';

  switch (cmd) {
    case 'menu':
    case 'help':
      return reply(jid, `👑 ${BOT_NAME}\n━━━━━━━━━━━━━━\n${PREFIX}ping, ${PREFIX}botinfo\n${PREFIX}rules, ${PREFIX}admins\n${PREFIX}antilink on/off\n${PREFIX}antispam on/off\n${PREFIX}warn @manm\n${PREFIX}unwarn @manm\n${PREFIX}kick @manm\n${PREFIX}mute, ${PREFIX}unmute\n${PREFIX}tagall, ${PREFIX}hidetag\n${PREFIX}setrules tèks\n━━━━━━━━━━━━━━\nUN CLAN • UNE FAMILLE • UNE FORCE` , m);
    case 'ping': return reply(jid, '🏓 Pong! EDI BOT aktif.', m);
    case 'botinfo': return reply(jid, `🤖 ${BOT_NAME}\nPrefix: ${PREFIX}\nSistèm: Node.js + Baileys\nGwoup: ${isGroup ? 'Wi' : 'Non'}`, m);
    case 'rules': return reply(jid, isGroup ? `📜 RÈG CLAN AN\n${cfg.rules}` : 'Kòmand sa a mache nan gwoup.', m);
    case 'admins': {
      if (!isGroup) return reply(jid, needGroup(), m);
      const meta = await sock.groupMetadata(jid);
      const admins = meta.participants.filter(p => p.admin).map(p => `• @${numberFromJid(p.id)}`);
      return sock.sendMessage(jid, { text: `👑 ADMINISTRATÈ\n${admins.join('\n') || 'Pa gen admin.'}`, mentions: meta.participants.filter(p => p.admin).map(p => p.id) }, { quoted: m });
    }
    case 'antilink':
    case 'antispam': {
      if (needGroup()) return reply(jid, needGroup(), m);
      if (needAdmin()) return reply(jid, needAdmin(), m);
      const value = args[0]?.toLowerCase();
      if (!['on', 'off'].includes(value)) return reply(jid, `Itilizasyon: ${PREFIX}${cmd} on/off`, m);
      updateGroup(jid, { [cmd]: value === 'on' });
      return reply(jid, `✅ ${cmd} ${value === 'on' ? 'aktive' : 'dezaktive'}.`, m);
    }
    case 'setrules': {
      if (needGroup()) return reply(jid, needGroup(), m);
      if (needAdmin()) return reply(jid, needAdmin(), m);
      if (!argText) return reply(jid, `Itilizasyon: ${PREFIX}setrules nouvo règ yo`, m);
      updateGroup(jid, { rules: argText });
      return reply(jid, '✅ Règ gwoup la mete ajou.', m);
    }
    case 'warn':
    case 'unwarn': {
      if (needGroup()) return reply(jid, needGroup(), m);
      if (needAdmin()) return reply(jid, needAdmin(), m);
      if (!target) return reply(jid, `Mansyone manm nan oswa reponn mesaj li.`, m);
      const current = getGroup(jid);
      const warns = { ...(current.warns || {}) };
      const n = Math.max(0, (warns[target] || 0) + (cmd === 'warn' ? 1 : -1));
      warns[target] = n;
      updateGroup(jid, { warns });
      return sock.sendMessage(jid, { text: `⚠️ @${numberFromJid(target)} gen ${n} avètisman.`, mentions: [target] }, { quoted: m });
    }
    case 'kick': {
      if (needGroup()) return reply(jid, needGroup(), m);
      if (needAdmin()) return reply(jid, needAdmin(), m);
      if (!target) return reply(jid, 'Mansyone manm nan oswa reponn mesaj li.', m);
      if (!botAdmin) return reply(jid, 'Mwen bezwen dwa administratè pou retire manm.', m);
      if (jidNormalizedUser(target) === jidNormalizedUser(sock.user.id)) return reply(jid, 'Mwen pa ka retire tèt mwen.', m);
      await sock.groupParticipantsUpdate(jid, [target], 'remove');
      return reply(jid, '✅ Aksyon administrasyon an fini.', m);
    }
    case 'mute':
    case 'unmute': {
      if (needGroup()) return reply(jid, needGroup(), m);
      if (needAdmin()) return reply(jid, needAdmin(), m);
      if (!botAdmin) return reply(jid, 'Mwen bezwen dwa administratè pou chanje pèmisyon gwoup la.', m);
      await sock.groupSettingUpdate(jid, cmd === 'mute' ? 'announcement' : 'not_announcement');
      return reply(jid, cmd === 'mute' ? '🔒 Se admin sèlman ki ka voye mesaj.' : '🔓 Tout manm ka voye mesaj.', m);
    }
    case 'tagall':
    case 'hidetag': {
      if (needGroup()) return reply(jid, needGroup(), m);
      if (needAdmin()) return reply(jid, needAdmin(), m);
      const meta = await sock.groupMetadata(jid);
      const ids = meta.participants.map(p => p.id);
      const body = argText || '📢 Anons pou tout manm EDI HEADQUARTERS';
      return sock.sendMessage(jid, { text: body, mentions: ids }, { quoted: m });
    }
    default: return reply(jid, `Kòmand sa a pa egziste. Tape ${PREFIX}menu pou wè lis la.`, m);
  }
}
const spamTracker = new Map();

// Start automatically when an existing session is present. First-time pairing uses POST /pair.
startBot('').catch(e => console.error('Startup error:', e.message));
