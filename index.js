require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  AuditLogEvent,
  ActivityType
} = require("discord.js");

const express = require("express");
const { loadCommands, registerCommands } = require("./handlers/commandHandler");
const sgMail = require("@sendgrid/mail");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
const readline = require("readline");

const { saveDNI, generateDNINumber } = require("./utils/database");
const { loadGuildConfig } = require("./utils/configManager");
const { getEntry } = require("./utils/blacklist");
const { checkAndRunAutoBackups } = require("./utils/autoBackupScheduler");
const { checkAntiNuke, punishNuker, checkRaidMode, enableRaidMode } = require("./utils/protectionManager");
const { checkAntiLinks, checkAntiMentions, punishAntiLinks, punishAntiMentions } = require("./utils/messageProtection");

// ==================== DEBUGGING ====================
console.log("TOKEN detectado:", process.env.DISCORD_TOKEN ? "SI" : "NO");

// ==================== VARIABLES BOT ====================
const TOKEN    = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ==================== UNBELIEVABOAT API ====================
const UB_API_TOKEN = process.env.UB_API_TOKEN;
const UB_API_BASE  = "https://unbelievaboat.com/api/v1";

async function ubGetBalance(guildId, userId) {
  const res = await fetch(`${UB_API_BASE}/guilds/${guildId}/users/${userId}`, {
    headers: { Authorization: UB_API_TOKEN }
  });
  if (!res.ok) throw new Error("UB getBalance error: " + res.status);
  return res.json();
}

async function ubSetBalance(guildId, userId, { cash, bank } = {}) {
  const body = {};
  if (cash !== undefined) body.cash = cash;
  if (bank !== undefined) body.bank = bank;
  const res = await fetch(`${UB_API_BASE}/guilds/${guildId}/users/${userId}`, {
    method: "PATCH",
    headers: { Authorization: UB_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("UB setBalance error: " + res.status);
  return res.json();
}

async function ubAddBalance(guildId, userId, { cash = 0, bank = 0 } = {}) {
  const res = await fetch(`${UB_API_BASE}/guilds/${guildId}/users/${userId}`, {
    method: "PUT",
    headers: { Authorization: UB_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ cash, bank })
  });
  if (!res.ok) throw new Error("UB addBalance error: " + res.status);
  return res.json();
}

// ==================== SUPABASE ====================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ==================== HELPERS SUPABASE ====================
async function saveDNISupabase(userId, dniData) {
  const { error } = await supabase.from("dnis").upsert({ user_id: userId, ...dniData, updated_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveDNI: " + error.message);
  return !error;
}

async function saveLogSupabase(type, message) {
  const { error } = await supabase.from("bot_logs").insert({ type, message, created_at: new Date().toISOString() });
  if (error) console.error("Supabase log error: " + error.message);
}

async function saveTicketSupabase(data) {
  const { error } = await supabase.from("tickets").upsert({ ...data, updated_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveTicket: " + error.message);
  return !error;
}

async function saveRatingSupabase(data) {
  const { error } = await supabase.from("ticket_ratings").insert({ ...data, created_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveRating: " + error.message);
  return !error;
}

async function saveVerifiedUserSupabase(userId, email, guildId) {
  const { error } = await supabase.from("verified_users").upsert({ user_id: userId, email, guild_id: guildId, verified_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveVerifiedUser: " + error.message);
  return !error;
}

async function saveBlacklistBanSupabase(userId, guildId, reason) {
  const { error } = await supabase.from("blacklist_bans").insert({ user_id: userId, guild_id: guildId, reason, banned_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveBlacklistBan: " + error.message);
}

// ==================== VERIFICACION ====================
const verificationCodes = new Map();

// ==================== EMOJIS ====================
const EMOJI = {
  TICKET:      "<a:Ticket:1472541437470965942>",
  CRUZ:        "<a:CruzRoja:1480947488960806943>",
  CHECK:       "<a:Tick:1480638398816456848>",
  CORREO:      "<a:correo:1472550293152596000>",
  NUKE:        "<a:NUKE:1477617312679858318>",
  ADVERTENCIA: "<a:ADVERTENCIA:1477616948937490452>",
  NEXALOGO:    "<a:NEXALOGO:1477286399345561682>",
  LOADING:     "<a:Loading:1481763726972555324>",
};

// ==================== SENDGRID ====================
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ==================== LOGS ====================
const logs     = [];
const MAX_LOGS = 500; // Aumentado para el dashboard

const lilygoLogs     = [];
const MAX_LILYGO_LOGS = 20;

function addLog(type, message) {
  const timestamp = new Date().toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  logs.push({ timestamp, type, message });
  if (logs.length > MAX_LOGS) logs.shift();
  const emoji = { info: "📋", success: "✅", error: "❌", warning: "⚠️" };
  console.log((emoji[type] || "🔔") + " [" + timestamp + "] " + message);
  saveLogSupabase(type, message).catch(() => {});

  const shortTime = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const emojiSimple = { info: "i", success: "✓", error: "X", warning: "!" }[type] || "·";
  lilygoLogs.push("[" + shortTime + "] " + emojiSimple + " " + message);
  if (lilygoLogs.length > MAX_LILYGO_LOGS) lilygoLogs.shift();
}

// ==================== VALIDAR VARIABLES ====================
let botEnabled = true;
if (!TOKEN || !CLIENT_ID) {
  console.warn("Faltan DISCORD_TOKEN o CLIENT_ID - Bot desactivado");
  botEnabled = false;
}
if (!UB_API_TOKEN) console.warn("⚠️ UB_API_TOKEN no definido");

// ==================== CLIENTE DISCORD ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.commands = new Collection();
client.supabase  = supabase;
client.ubGetBalance = ubGetBalance;
client.ubSetBalance = ubSetBalance;
client.ubAddBalance = ubAddBalance;

global.maintenanceMode = false;
const MAINTENANCE_USER_ID = "1352652366330986526";

if (botEnabled) loadCommands(client);

// ==================== ANTI-DUPLICADOS ====================
const processedMessages = new Set();
const activeAIProcessing = new Map();
const processedWelcomes  = new Set();

// ==================== ANTI-FLOOD ====================
const FLOOD_WINDOW_MS   = 4000;
const FLOOD_COUNT       = 8;
const FLOOD_COOLDOWN_MS = 5 * 60 * 1000;
const TRUSTED_IDS       = new Set([]);
const floodBuckets      = new Map();

function floodKey(gid, uid) { return gid + ":" + uid; }

async function handleBotFlood(message) {
  const guild = message.guild; const author = message.author;
  if (!guild || !author || TRUSTED_IDS.has(author.id)) return;
  const me = guild.members.me; if (!me) return;
  try {
    if (me.permissions.has(PermissionFlagsBits.BanMembers)) {
      await guild.members.ban(author.id, { reason: "Nexa Protection: bot flooding" });
      addLog("warning", "Bot flooder baneado: " + author.tag);
    } else if (me.permissions.has(PermissionFlagsBits.KickMembers)) {
      await guild.members.kick(author.id, "Nexa Protection: bot flooding");
    }
  } catch (e) { addLog("error", "Error sancionando bot flooder: " + e.message); return; }
  if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog) || !me.permissions.has(PermissionFlagsBits.BanMembers)) return;
  try {
    const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 6 });
    const entry = auditLogs.entries.find(e => Date.now() - e.createdTimestamp < 90000 && e.target?.id === author.id);
    if (!entry?.executor) return;
    const executorId = entry.executor.id;
    if (executorId === guild.ownerId || TRUSTED_IDS.has(executorId)) return;
    await guild.members.ban(executorId, { reason: "Nexa Protection: añadio bot flooder" });
    addLog("warning", "Executor baneado por añadir bot flooder: " + executorId);
  } catch (e) { addLog("error", "Error audit BotAdd: " + e.message); }
}

async function dmBanNotice(member, reason, until) {
  const untilText = until ? new Date(until).toLocaleString("es-ES") : "nunca";
  try { await member.send({ content: "Has sido baneado por Nexa Protection.\nMotivo: " + (reason || "Sin especificar") + "\nBan hasta: " + untilText }); } catch {}
}

// ==================== READLINE ====================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "" });
rl.on("line", (line) => {
  const input = line.trim();
  if (input.toLowerCase().startsWith("/changestatus ")) {
    const texto = input.slice("/changestatus ".length).trim();
    if (!texto) { console.log("❌ Debes poner texto."); return; }
    if (!client.user) { console.log("❌ Bot no listo."); return; }
    client.user.setPresence({ activities: [{ name: texto, type: ActivityType.Playing }], status: "online" });
    console.log(`✅ Estado: "${texto}"`);
  } else if (input) {
    console.log(`⚠️ Comando no reconocido: ${input}`);
  }
});

// ==================== CACHE DE CONFIGS (PERFORMANCE) ====================
const configCache = new Map(); // guildId -> { data, ts }
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minuto

async function loadGuildConfigCached(guildId) {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.ts < CONFIG_CACHE_TTL) return cached.data;
  const data = await loadGuildConfig(guildId);
  configCache.set(guildId, { data, ts: Date.now() });
  return data;
}

// ==================== READY ====================
client.once("ready", async () => {
  addLog("success", `Bot conectado: ${client.user.tag}`);
  addLog("info", `Servidores: ${client.guilds.cache.size}`);

  try {
    await registerCommands(client);
    addLog("success", "Comandos registrados en Discord correctamente");
  } catch (e) {
    addLog("error", `Error registrando comandos: ${e.message}`);
  }

  TRUSTED_IDS.add(client.user.id);
  client.user.setPresence({ status: "online", activities: [{ name: "🛡️ NEXA PROTECTION v1.0", type: ActivityType.Playing }] });

  // ── Realtime: Cerrar apuestas automáticamente
  const sportsChannel = supabase.channel("sports");
  sportsChannel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "sports_events", filter: "status=eq.closed" },
    async (payload) => {
      if (payload.new.bet_event_id) {
        await supabase.from("bet_events").update({ status: "closed" }).eq("id", payload.new.bet_event_id);
        addLog("info", `[AUTO] Apuesta ${payload.new.bet_event_id} cerrada automáticamente`);
      }
    }
  ).subscribe();

  // ── Auto-sync deportes cada 5 min
  setInterval(async () => {
    const apiKey = process.env.SPORTSDB_API_KEY;
    if (!apiKey) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res  = await fetch(`https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsday.php?d=${today}`);
      const data = await res.json();
      if (data.events) {
        const events = data.events.map(e => ({
          event_id: e.idEvent,
          titulo: e.strEvent,
          fecha_utc: new Date(`${e.dateEvent} ${e.strTime}`).toISOString(),
          league: e.strLeague
        }));
        await supabase.from("sports_events").upsert(events, { onConflict: "event_id" });
        addLog("info", `[SPORTS] Auto-sync: ${events.length} eventos`);
      }
    } catch (e) { addLog("error", `[SPORTS] Error auto-sync: ${e.message}`); }
  }, 300000);

  addLog("success", "Sistema Sports Realtime + Auto-sync inicializado");

  // ── Backup automático
  const AUTO_BACKUP_INTERVAL = 10 * 60 * 1000;
  setInterval(async () => {
    try { await checkAndRunAutoBackups(client, addLog); } catch (e) { addLog("error", "Error autobackup: " + e.message); }
  }, AUTO_BACKUP_INTERVAL);
  setTimeout(async () => {
    try { await checkAndRunAutoBackups(client, addLog); } catch (e) { addLog("error", "Error primera verificación backup: " + e.message); }
  }, 60000);
  addLog("success", "Sistema de backup automático inicializado");

  // ── Discord Player
  try {
    const { setupPlayer } = require("./commands/musica");
    addLog("info", "Iniciando discord-player...");
    await setupPlayer(client);
    addLog("info", "musicPlayer asignado: " + !!client.musicPlayer);
  } catch (e) {
    addLog("error", "discord-player ERROR: " + e.message);
  }

  addLog("success", "Sistema de protección anti-nuke inicializado");
  addLog("info", "Sistema de comandos terminal activado - /changestatus [TEXTO]");

  // ── Kick inactivos
  const { runKickInactiveJob } = require("./commands/kickinactive");
  setInterval(() => runKickInactiveJob(client).catch(() => {}), 24 * 60 * 60 * 1000);
  setTimeout(() => runKickInactiveJob(client).catch(() => {}), 5000);
  addLog("success", "Job de kick inactivos iniciado");

  if (UB_API_TOKEN) addLog("success", "UnbelievaBoat API configurada ✅");
  else addLog("warning", "UnbelievaBoat API no configurada");

  // ── Auto-ping
  const PING_GUILD_ID   = process.env.GUILD_ID;
  const PING_CHANNEL_ID = process.env.PING_CHANNEL_ID;
  if (!PING_GUILD_ID || !PING_CHANNEL_ID) {
    addLog("warning", "Auto-ping desactivado: falta GUILD_ID o PING_CHANNEL_ID");
  } else {
    try {
      const guild   = await client.guilds.fetch(PING_GUILD_ID);
      const channel = await guild.channels.fetch(PING_CHANNEL_ID);
      const doAutoPing = async () => {
        try {
          const sent    = await channel.send({ content: "Pinging..." });
          const latency = Math.abs(sent.createdTimestamp - Date.now());
          await sent.edit(`🔍 Pong! Latencia: ${latency}ms`);
          await channel.setName(`🤖ultimo-ping-${latency}ms`);
          addLog("info", `[AUTO-PING] ${latency}ms`);
        } catch (error) { addLog("error", "[AUTO-PING] " + error.message); }
      };
      await doAutoPing();
      setInterval(doAutoPing, 15 * 60 * 1000);
      addLog("success", "Auto-ping activado");
    } catch (error) { addLog("error", "Error auto-ping: " + error.message); }
  }
});

client.on("error",       (e)     => addLog("error",   "Discord error: "   + e.message));
client.on("warn",        (info)  => addLog("warning", "Discord warning: " + info));
client.on("guildCreate", async (guild) => {
  addLog("success", "Bot añadido a: " + guild.name);
  try {
    const canal = guild.channels.cache
      .filter(c => c.type === 0 && c.permissionsFor(guild.members.me)?.has("SendMessages"))
      .sort((a, b) => a.position - b.position).first();
    if (!canal) return;

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle(EMOJI.NEXALOGO + " ¡Hola! Soy **NexaBot** — Tu bot de protección y gestión")
      .setDescription(
        EMOJI.NUKE + " **Anti-Nuke** — Protección contra nukes, raids y bots maliciosos\n" +
        EMOJI.CHECK + " **Verificación** — Sistema de verificación por correo electrónico\n" +
        EMOJI.TICKET + " **Tickets** — Sistema de tickets con categorías y valoraciones\n" +
        "🛡️ **Moderación** — Warns, bans globales, blacklist automática\n" +
        "💼 **Trabajos** — Sistema de roles por trabajo con panel interactivo\n" +
        "📊 **Niveles** — Sistema de experiencia y subida de rango\n" +
        "🎉 **Sorteos** — Crea y gestiona sorteos con un comando\n" +
        "💾 **Backup** — Copias de seguridad automáticas del servidor\n" +
        "🤖 **IA integrada** — Menciónami para hacerme preguntas\n\n" +
        "Usa **/setup** para configurar todo en minutos."
      )
      .setThumbnail(guild.client.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "📌 Servidor", value: guild.name, inline: true },
        { name: "👥 Miembros", value: guild.memberCount.toString(), inline: true },
        { name: "⚡ Comandos", value: "/setup, /help y más", inline: true }
      )
      .setFooter({ text: "NexaBot • Protección y gestión avanzada" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("📖 Empezar con /setup").setStyle(ButtonStyle.Primary).setCustomId("noop_setup_hint").setDisabled(true)
    );
    await canal.send({ embeds: [embed], components: [row] });
  } catch (e) { addLog("error", "Error guildCreate embed: " + e.message); }
});
client.on("guildDelete", (guild) => addLog("warning", "Bot removido de: " + guild.name));

// ==================== BAN LOG CENTRAL ====================
const BAN_LOG_GUILD_ID = "1474052533415841823";
const BAN_LOG_BOT_CH   = "1476683870811455612";
const BAN_LOG_USER_CH  = "1476267817870557184";
const processedBans    = new Set();

client.on("guildBanAdd", async (ban) => {
  const banKey = ban.guild.id + ":" + ban.user.id;
  if (processedBans.has(banKey)) return;
  processedBans.add(banKey);
  setTimeout(() => processedBans.delete(banKey), 10000);
  try {
    let motivo = "Sin especificar", ejecutor = null;
    try {
      await new Promise(r => setTimeout(r, 1200));
      const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 });
      const entry = auditLogs.entries.find(e => e.target?.id === ban.user.id && Date.now() - e.createdTimestamp < 15000);
      if (entry) { motivo = entry.reason || "Sin especificar"; ejecutor = entry.executor; }
    } catch {}
    const logGuild = client.guilds.cache.get(BAN_LOG_GUILD_ID);
    if (logGuild) {
      const canalId = ban.user.bot ? BAN_LOG_BOT_CH : BAN_LOG_USER_CH;
      const canal   = logGuild.channels.cache.get(canalId);
      if (canal) {
        const embed = new EmbedBuilder()
          .setColor(ban.user.bot ? "#f59e0b" : "#ef4444")
          .setTitle(ban.user.bot ? "🤖 Bot baneado" : "🔨 Usuario baneado")
          .setThumbnail(ban.user.displayAvatarURL({ size: 128 }))
          .addFields(
            { name: "👤 Usuario",     value: ban.user.tag + " (`" + ban.user.id + "`)",                           inline: false },
            { name: "🌐 Servidor",    value: ban.guild.name + " (`" + ban.guild.id + "`)",                         inline: false },
            { name: "👮 Baneado por", value: ejecutor ? ejecutor.tag + " (`" + ejecutor.id + "`)" : "Desconocido", inline: false },
            { name: "📝 Motivo",      value: motivo,                                                                inline: false },
            { name: "📅 Fecha",       value: "<t:" + Math.floor(Date.now() / 1000) + ":F>",                        inline: false },
          )
          .setFooter({ text: "NexaBot • Ban Log Central" }).setTimestamp();
        await canal.send({ embeds: [embed] });
      }
    }
  } catch (e) { addLog("error", "Error guildBanAdd log: " + e.message); }
});

// ==================== ANTI-NUKE ====================
client.on("guildAuditLogEntryCreate", async (auditLog, guild) => {
  const executorId = auditLog.executor?.id;
  if (!executorId || executorId === guild.ownerId || TRUSTED_IDS.has(executorId)) return;

  if (auditLog.action === AuditLogEvent.BotAdd) {
    const botId = auditLog.target?.id;
    if (!botId || TRUSTED_IDS.has(botId)) return;
    try {
      const entry = getEntry({ id: botId, bot: true });
      if (!entry) return;
      const me = guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return;
      await guild.members.ban(botId, { reason: "Nexa Protection blacklist: " + (entry.reason || "Sin motivo") });
      addLog("warning", "Bot blacklisted baneado: " + botId);
      await saveBlacklistBanSupabase(botId, guild.id, entry.reason || "Sin motivo");
      if (executorId && executorId !== guild.ownerId && !TRUSTED_IDS.has(executorId)) {
        await guild.members.ban(executorId, { reason: "Nexa Protection: añadio bot blacklisted" });
      }
    } catch (e) { addLog("error", "Error blacklist BotAdd: " + e.message); }
    return;
  }

  const nukeChecks = [
    { action: AuditLogEvent.RoleCreate,   type: "roleCreate",    msg: "Creación masiva de roles" },
    { action: AuditLogEvent.RoleDelete,   type: "roleDelete",    msg: "Eliminación masiva de roles" },
    { action: AuditLogEvent.ChannelCreate, type: "channelCreate", msg: "Creación masiva de canales" },
    { action: AuditLogEvent.ChannelDelete, type: "channelDelete", msg: "Eliminación masiva de canales" },
    { action: AuditLogEvent.MemberBanAdd, type: "ban",            msg: "Bans masivos" },
    { action: AuditLogEvent.MemberKick,   type: "kick",           msg: "Kicks masivos" },
  ];

  for (const check of nukeChecks) {
    if (auditLog.action === check.action) {
      const result = await checkAntiNuke(guild, executorId, check.type, addLog);
      if (result.shouldAct) {
        await punishNuker(guild, executorId, `${check.msg} (${result.count}/${result.limit})`, addLog);
        await enableRaidMode(guild.id, 30, addLog);
      }
      break;
    }
  }
});

// ==================== GUILD MEMBER ADD ====================
client.on("guildMemberAdd", async (member) => {
  try {
    const { data: globalBan } = await supabase.from("global_bans").select("reason").eq("user_id", member.id).single();
    if (globalBan) {
      const me = member.guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await member.ban({ reason: `[GlobalBan] ${globalBan.reason}` });
        addLog("warning", "GlobalBan autoban: " + member.user.tag);
      }
      return;
    }
    const entry = getEntry(member.user);
    if (entry) {
      const me = member.guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await dmBanNotice(member, entry.reason, entry.until);
        await member.guild.members.ban(member.id, { reason: "Nexa Protection blacklist: " + (entry.reason || "Sin motivo") });
        addLog("warning", "Blacklist autoban: " + member.user.tag);
        await saveBlacklistBanSupabase(member.id, member.guild.id, entry.reason || "Sin motivo");
      }
      return;
    }
    const isRaidMode = await checkRaidMode(member.guild, addLog);
    if (isRaidMode) {
      const config = await loadGuildConfigCached(member.guild.id);
      if (config?.protection?.raidMode?.autoKickNewJoins) {
        const me = member.guild.members.me;
        if (me?.permissions.has(PermissionFlagsBits.KickMembers)) {
          await member.kick("[Modo Raid] Servidor protegido");
          addLog("warning", "Raid Mode: kickeado " + member.user.tag);
          return;
        }
      }
    }
  } catch (e) { addLog("error", "Error guildMemberAdd protection: " + e.message); }

  if (processedWelcomes.has(member.id)) return;
  processedWelcomes.add(member.id);
  setTimeout(() => processedWelcomes.delete(member.id), 30000);

  try {
    const guildConfig = await loadGuildConfigCached(member.guild.id);
    if (!guildConfig?.welcome?.enabled) return;
    const channel = member.guild.channels.cache.get(guildConfig.welcome.channelId);
    if (!channel) return;
    const imageUrl = guildConfig.welcome.imageUrl ||
      "https://raw.githubusercontent.com/gonzalopriv9-byte/EspanoletesBOT.1/main/assets/ChatGPT_Image_13_feb_2026_19_27_59.webp";
    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle(EMOJI.NEXALOGO + " BIENVENIDO!")
      .setDescription("**" + member.user.username + "** se unio al servidor")
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: "Usuario", value: "<@" + member.id + ">", inline: true },
        { name: "Miembro", value: "#" + member.guild.memberCount, inline: true },
        { name: "Creado",  value: "<t:" + Math.floor(member.user.createdTimestamp / 1000) + ":R>", inline: true }
      )
      .setFooter({ text: "Bienvenido al servidor" }).setTimestamp();
    await channel.send({
      content: EMOJI.NEXALOGO + " **Bienvenido <@" + member.id + ">!** " + EMOJI.NEXALOGO,
      embeds: [embed],
      files: [{ attachment: imageUrl, name: "bienvenida.webp" }],
      allowedMentions: { users: [member.id] }
    });
    addLog("success", "Bienvenida enviada: " + member.user.tag);
  } catch (error) {
    addLog("error", "Error bienvenida: " + error.message);
    processedWelcomes.delete(member.id);
  }
});

// ==================== INTERACTION CREATE ====================
client.on("interactionCreate", async (interaction) => {
  try {

    // ── COMANDOS SLASH
    if (interaction.isChatInputCommand()) {
      if (global.maintenanceMode && interaction.user.id !== MAINTENANCE_USER_ID)
        return interaction.reply({ content: "El bot está en mantenimiento.", flags: 64 });

      const command = client.commands.get(interaction.commandName);
      if (!command)
        return interaction.reply({ content: EMOJI.CRUZ + " Comando no reconocido.", flags: 64 });

      try {
        await command.execute(interaction);
        addLog("info", "/" + interaction.commandName + " por " + interaction.user.tag);
      } catch (err) {
        addLog("error", "Error /" + interaction.commandName + ": " + err.message);
        if (!interaction.replied && !interaction.deferred)
          interaction.reply({ content: EMOJI.CRUZ + " Error ejecutando el comando", flags: 64 }).catch(() => {});
      }
      return;
    }

    // ─────── APOSTAR: MODAL OPCIONES ───────
    if (interaction.isModalSubmit() && interaction.customId.startsWith("apostar_opciones_")) {
      const numOpciones = parseInt(interaction.customId.split("_")[2], 10);
      const apostarCmd  = client.commands.get("apostar");
      const meta        = apostarCmd?.titulosPendientes?.get(interaction.user.id) || {};
      const titulo      = meta.titulo || "Sin título";
      const minApuesta  = meta.minApuesta || 1;
      const maxApuesta  = meta.maxApuesta || null;
      apostarCmd?.titulosPendientes?.delete(interaction.user.id);

      const opciones = [];
      for (let i = 1; i <= numOpciones; i++)
        opciones.push(interaction.fields.getTextInputValue(`opcion${i}`));

      await interaction.deferReply({ flags: 64 });

      try {
        const insertData = {
          guild_id:   interaction.guild.id,
          channel_id: interaction.channel.id,
          message_id: "pending",
          titulo,
          opcion1: opciones[0],
          opcion2: opciones[1],
          status: "open",
          min_bet: minApuesta,
          max_bet: maxApuesta,
        };
        if (opciones[2]) insertData.opcion3 = opciones[2];
        if (opciones[3]) insertData.opcion4 = opciones[3];

        const { data, error } = await supabase.from("bet_events").insert([insertData]).select().single();
        if (error || !data) {
          console.error("Supabase bet_events insert error:", error);
          return interaction.editReply({ content: `${EMOJI.CRUZ} Error guardando el evento en la base de datos.` });
        }

        const eventId = data.id;
        const embed   = await apostarCmd.buildEventEmbed(supabase, data);
        const rows    = apostarCmd.buildBetButtons(data, false);

        const msg = await interaction.channel.send({ embeds: [embed], components: rows });
        await supabase.from("bet_events").update({ message_id: msg.id }).eq("id", eventId);

        await interaction.editReply({
          content:
            `${EMOJI.CHECK} **Evento de apuestas creado!**\n\n` +
            `> 🆔 **ID:** \`${eventId}\`\n` +
            `> ${EMOJI.ADVERTENCIA} Guarda el ID para resolver con \`/resolverapuesta resultado\`\n` +
            `> 🔒 Cierra apuestas: \`/resolverapuesta cerrar id:${eventId}\`\n` +
            `> ❌ Cancelar (devuelve dinero): \`/resolverapuesta cancelar id:${eventId}\``,
        });
        addLog("success", "[APUESTAS] Evento creado: " + titulo + " (ID: " + eventId + ")");
      } catch (err) {
        console.error("Error creando apuesta:", err);
        await interaction.editReply({ content: `${EMOJI.CRUZ} Error creando el evento.` });
      }
      return;
    }

    // ─────── APUESTAS: BOTÓN ───────
    if (interaction.isButton() && interaction.customId.startsWith("bet_event_")) {
      const parts   = interaction.customId.split("_");
      const eventId = parts[2];
      const option  = parseInt(parts[3], 10);
      if (!eventId || isNaN(option))
        return interaction.reply({ content: EMOJI.CRUZ + " Botón inválido.", flags: 64 });

      // Mostrar modal de cantidad
      const modal = new ModalBuilder()
        .setCustomId(`bet_amount_${eventId}_${option}`)
        .setTitle("¿Cuánto quieres apostar?");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("amount")
            .setLabel("Cantidad de cash a apostar")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ej: 5000")
            .setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // ─────── APUESTAS: MODAL CANTIDAD ───────
    if (interaction.isModalSubmit() && interaction.customId.startsWith("bet_amount_")) {
      const parts   = interaction.customId.split("_");
      const eventId = parts[2];
      const option  = parseInt(parts[3], 10);
      const amount  = parseInt(interaction.fields.getTextInputValue("amount").trim(), 10);

      if (isNaN(amount) || amount <= 0)
        return interaction.reply({ content: EMOJI.CRUZ + " Cantidad inválida (debe ser mayor que 0).", flags: 64 });

      await interaction.deferReply({ flags: 64 });

      try {
        const { data: event } = await supabase.from("bet_events").select("*").eq("id", eventId).single();
        if (!event)
          return interaction.editReply({ content: EMOJI.CRUZ + " Evento no encontrado." });
        if (event.status !== "open")
          return interaction.editReply({ content: EMOJI.CRUZ + " Este evento ya no acepta apuestas (estado: `" + event.status + "`)." });
        if (event.min_bet && amount < event.min_bet)
          return interaction.editReply({ content: EMOJI.CRUZ + " La apuesta mínima es `" + event.min_bet + "` 💵." });
        if (event.max_bet && amount > event.max_bet)
          return interaction.editReply({ content: EMOJI.CRUZ + " La apuesta máxima es `" + event.max_bet + "` 💵." });

        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        // ── Verificar saldo UB
        const balance = await ubGetBalance(guildId, userId);
        if (!balance || typeof balance.cash !== "number")
          return interaction.editReply({ content: EMOJI.CRUZ + " No se pudo obtener tu saldo UnbelievaBoat." });
        if (balance.cash < amount)
          return interaction.editReply({ content: EMOJI.CRUZ + " Saldo insuficiente. Tienes `" + balance.cash.toLocaleString() + "` y quieres apostar `" + amount.toLocaleString() + "`." });

        // ── Verificar si ya apostó
        const { data: existing } = await supabase.from("bets")
          .select("id, option, amount").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
        if (existing)
          return interaction.editReply({ content: EMOJI.CRUZ + " Ya apostaste `" + existing.amount.toLocaleString() + "` a la opción " + existing.option + " en este evento." });

        // ── Insertar apuesta y descontar saldo
        const { error: betError } = await supabase.from("bets").insert([{
          event_id: eventId, user_id: userId,
          username: interaction.user.tag, option, amount,
        }]);
        if (betError) return interaction.editReply({ content: EMOJI.CRUZ + " Error guardando apuesta." });

        await ubAddBalance(guildId, userId, { cash: -amount });

        // ── Actualizar embed del evento en el canal
        try {
          const guild   = await client.guilds.fetch(event.guild_id);
          const channel = await guild.channels.fetch(event.channel_id);
          const msg     = await channel.messages.fetch(event.message_id);
          const apostarCmd = client.commands.get("apostar");
          if (apostarCmd?.buildEventEmbed && apostarCmd?.buildBetButtons) {
            const updatedEmbed = await apostarCmd.buildEventEmbed(supabase, event);
            const rows         = apostarCmd.buildBetButtons(event, false);
            await msg.edit({ embeds: [updatedEmbed], components: rows });
          }
        } catch (_) {}

        const opcionLabel = event[`opcion${option}`] || `Opción ${option}`;
        await interaction.editReply({
          content:
            `${EMOJI.CHECK} **Apuesta registrada!**\n` +
            `> 🎯 Opción: **${opcionLabel}**\n` +
            `> 💵 Apostado: \`${amount.toLocaleString()}\` cash\n` +
            `> 💰 Saldo restante: \`${(balance.cash - amount).toLocaleString()}\``,
        });
        addLog("success", `[APUESTAS] ${interaction.user.tag} apostó ${amount} a opción ${option} (evento ${eventId})`);
      } catch (err) {
        console.error("Error procesando apuesta:", err);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error procesando tu apuesta." });
      }
      return;
    }

    // ─────── APUESTAS: RESOLVER SELECT MENU ───────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("resolve_event_")) {
      const eventId       = interaction.customId.replace("resolve_event_", "");
      const opcionGanadora = parseInt(interaction.values[0], 10);

      await interaction.deferUpdate();

      try {
        const { data: evento } = await supabase.from("bet_events").select("*").eq("id", eventId).single();
        if (!evento || evento.status === "resolved")
          return interaction.editReply({ content: EMOJI.CRUZ + " Evento no encontrado o ya resuelto.", components: [] });

        const { data: todasLasApuestas } = await supabase.from("bets").select("*").eq("event_id", eventId);

        if (!todasLasApuestas || todasLasApuestas.length === 0) {
          await supabase.from("bet_events").update({ status: "resolved", resultado: opcionGanadora }).eq("id", eventId);
          const embed = new EmbedBuilder().setColor("#FF0000")
            .setTitle(`${EMOJI.NEXALOGO} Apuesta resuelta — Sin apostantes`)
            .setDescription(`**${evento.titulo}**\n\nGanador: **Opción ${opcionGanadora}** (${evento[`opcion${opcionGanadora}`]})\n\nNo había apuestas.`)
            .setTimestamp();
          return interaction.editReply({ embeds: [embed], components: [] });
        }

        const ganadores       = todasLasApuestas.filter(b => b.option === opcionGanadora);
        const perdedores      = todasLasApuestas.filter(b => b.option !== opcionGanadora);
        const totalPerdedores  = perdedores.reduce((acc, b) => acc + b.amount, 0);
        const totalGanadores   = ganadores.reduce((acc, b) => acc + b.amount, 0);
        const premioExtra      = Math.floor(totalPerdedores * 0.95);

        for (const g of ganadores) {
          const proporcion = totalGanadores > 0 ? g.amount / totalGanadores : 0;
          const premio     = g.amount + Math.floor(premioExtra * proporcion);
          try { await ubAddBalance(interaction.guild.id, g.user_id, { cash: premio }); }
          catch (e) { addLog("error", `[APUESTAS] Error sumando a ${g.username}: ${e.message}`); }
        }

        await supabase.from("bet_events").update({ status: "resolved", resultado: opcionGanadora }).eq("id", eventId);

        const nombreGanador  = evento[`opcion${opcionGanadora}`] || `Opción ${opcionGanadora}`;
        const listaGanadores = ganadores.length > 0
          ? ganadores.map(g => {
              const proporcion = g.amount / totalGanadores;
              const premio     = g.amount + Math.floor(premioExtra * proporcion);
              return `<@${g.user_id}> apostó \`${g.amount.toLocaleString()}\` → recibe \`${premio.toLocaleString()}\``;
            }).join("\n")
          : "Nadie apostó por el ganador.";

        const resultEmbed = new EmbedBuilder()
          .setColor("#00FF88")
          .setTitle(`${EMOJI.NEXALOGO} ¡Apuesta Resuelta!`)
          .setDescription(`**${evento.titulo}**`)
          .addFields(
            { name: "🏆 Ganador",    value: `Opción ${opcionGanadora}: **${nombreGanador}**`, inline: false },
            { name: "💰 Pozo total", value: `${(totalPerdedores + totalGanadores).toLocaleString()} 💵`, inline: true },
            { name: "👥 Ganadores",  value: `${ganadores.length} de ${todasLasApuestas.length}`, inline: true },
            { name: "📋 Detalle",    value: listaGanadores.slice(0, 1000), inline: false },
          )
          .setFooter({ text: "NexaBot Apuestas • 5% comisión de casa" }).setTimestamp();

        // Actualizar mensaje del canal
        try {
          const guild   = await client.guilds.fetch(evento.guild_id);
          const channel = await guild.channels.fetch(evento.channel_id);
          const msg     = await channel.messages.fetch(evento.message_id);
          const apostarCmd = client.commands.get("apostar");
          if (apostarCmd?.buildEventEmbed && apostarCmd?.buildBetButtons) {
            const updatedEvent = { ...evento, status: "resolved" };
            const embed = await apostarCmd.buildEventEmbed(supabase, updatedEvent);
            const rows  = apostarCmd.buildBetButtons(updatedEvent, true);
            await msg.edit({ embeds: [embed], components: rows });
          }
        } catch (_) {}

        await interaction.editReply({ embeds: [resultEmbed], components: [] });
        addLog("success", `[APUESTAS] Evento ${eventId} resuelto. Ganadores: ${ganadores.length}`);

      } catch (err) {
        console.error("Error resolviendo apuesta:", err);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error resolviendo la apuesta.", components: [] });
      }
      return;
    }

    // ── MODAL: SETUP TICKETS
    if (interaction.isModalSubmit() && interaction.customId === "setup_tickets_questions") {
      const setupCommand = client.commands.get("setup");
      if (!setupCommand?.handleModal)
        return interaction.reply({ content: EMOJI.CRUZ + " Error: setup no cargado.", flags: 64 }).catch(() => {});
      try {
        await setupCommand.handleModal(interaction);
      } catch (err) {
        addLog("error", "Error en handleModal: " + err.message);
        if (!interaction.replied && !interaction.deferred)
          interaction.reply({ content: EMOJI.CRUZ + " Error: " + err.message, flags: 64 }).catch(() => {});
      }
      return;
    }

    // ── BOTONES: BACKUP NOTIFY
    if (interaction.isButton() && interaction.customId.startsWith("backup_notify_yes_")) {
      const exampleEmbed = new EmbedBuilder().setColor("#2b2d31")
        .setTitle(EMOJI.ADVERTENCIA + " Información importante del servidor")
        .setDescription(
          "El servidor ha sido restaurado desde un backup reciente.\n\n" +
          "Es posible que notes cambios en canales, roles o permisos.\n" +
          "Si ves algo raro, abre un ticket o contacta con el staff.\n\n" +
          "Gracias por tu paciencia."
        );
      await interaction.reply({ content: "Aquí tienes el embed de ejemplo:", embeds: [exampleEmbed], flags: 64 });
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("backup_notify_no_")) {
      await interaction.reply({ content: "Perfecto, no se enviará ningún mensaje automático.", flags: 64 });
      return;
    }

  } catch (error) {
    if (error.code === 10062) { addLog("warning", "Interaccion expirada"); return; }
    addLog("error", "Error interaccion: " + error.message);
  }
});

// ==================== GROQ IA ====================
let groqClient = null;
try {
  const Groq = require("groq-sdk");
  if (process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log("✅ Groq IA inicializada");
  }
} catch (e) {
  console.warn("⚠️ groq-sdk no disponible:", e.message);
}

// Historial de conversación por usuario (máx 10 turnos)
const aiConversations = new Map();
const MAX_AI_HISTORY  = 10;

async function askGroq(userId, userMessage, guildName) {
  if (!groqClient) return null;

  if (!aiConversations.has(userId)) aiConversations.set(userId, []);
  const history = aiConversations.get(userId);

  history.push({ role: "user", content: userMessage });
  if (history.length > MAX_AI_HISTORY * 2) history.splice(0, 2);

  const messages = [
    {
      role: "system",
      content:
        `Eres NexaBot, un asistente de Discord amigable, conciso y útil del servidor "${guildName}". ` +
        `Respondes en español, de forma natural y directa. Máximo 3-4 frases salvo que te pidan algo largo. ` +
        `No uses listas largas innecesarias. Puedes hacer bromas ligeras.`
    },
    ...history
  ];

  try {
    const completion = await groqClient.chat.completions.create({
      model:       "llama3-8b-8192",
      messages,
      max_tokens:  512,
      temperature: 0.7,
    });
    const reply = completion.choices[0]?.message?.content?.trim() || null;
    if (reply) history.push({ role: "assistant", content: reply });
    return reply;
  } catch (e) {
    addLog("error", "[IA] Error Groq: " + e.message);
    return null;
  }
}

// ==================== MENSAJES (ANTI-FLOOD + ANTI-LINKS + ANTI-MENTIONS + IA + VERIFICACION) ====================
client.on("messageCreate", async (message) => {
  // Ignorar bots y mensajes sin guild
  if (!message.guild || message.author.bot) return;

  // ─── ANTI-DUPLICADOS
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 30000);

  const author  = message.author;
  const guild   = message.guild;
  const content = message.content;

  // ─── ANTI-FLOOD
  if (!TRUSTED_IDS.has(author.id)) {
    const key    = floodKey(guild.id, author.id);
    const now    = Date.now();
    const bucket = floodBuckets.get(key) || { msgs: [], warned: false };

    // Limpiar mensajes fuera de la ventana
    bucket.msgs = bucket.msgs.filter(t => now - t < FLOOD_WINDOW_MS);
    bucket.msgs.push(now);
    floodBuckets.set(key, bucket);

    if (bucket.msgs.length >= FLOOD_COUNT) {
      // Si es bot, manejo especial
      if (author.bot) {
        await handleBotFlood(message);
        return;
      }
      // Usuario normal: timeout
      if (!bucket.warned) {
        bucket.warned = true;
        setTimeout(() => { bucket.warned = false; bucket.msgs = []; }, FLOOD_COOLDOWN_MS);
        try {
          const me = guild.members.me;
          if (me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await message.member?.timeout(FLOOD_COOLDOWN_MS, "Nexa Protection: flood de mensajes");
            addLog("warning", `Anti-Flood: timeout a ${author.tag} en ${guild.name}`);
          }
          await message.channel.send({
            content: `${EMOJI.ADVERTENCIA} <@${author.id}> Estás enviando mensajes demasiado rápido. Calma.`,
            allowedMentions: { users: [author.id] }
          }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
        } catch (e) { addLog("error", "Anti-Flood acción: " + e.message); }
      }
      return;
    }
  }

  // ─── ANTI-LINKS
  try {
    const linksResult = await checkAntiLinks(message, addLog);
    if (linksResult.shouldAct) {
      const config = await loadGuildConfigCached(guild.id);
      await punishAntiLinks(message, config, addLog);
      return;
    }
  } catch (e) { addLog("error", "Error anti-links: " + e.message); }

  // ─── ANTI-MENTIONS
  try {
    const mentionsResult = await checkAntiMentions(message, addLog);
    if (mentionsResult.shouldAct) {
      const config = await loadGuildConfigCached(guild.id);
      await punishAntiMentions(message, config, addLog);
      return;
    }
  } catch (e) { addLog("error", "Error anti-mentions: " + e.message); }

  // ─── VERIFICACION: código por DM
  if (message.channel.type === 1) { // DM
    const pending = verificationCodes.get(author.id);
    if (pending) {
      const code = content.trim().toUpperCase();
      if (code === pending.code) {
        verificationCodes.delete(author.id);
        try {
          const targetGuild  = client.guilds.cache.get(pending.guildId);
          const targetMember = await targetGuild?.members.fetch(author.id);
          if (targetMember && pending.roleId) {
            await targetMember.roles.add(pending.roleId);
            await saveVerifiedUserSupabase(author.id, pending.email, pending.guildId);
            await message.reply(`${EMOJI.CHECK} **¡Verificado correctamente!** Ya tienes acceso al servidor.`);
            addLog("success", `Verificación completada: ${author.tag}`);
          }
        } catch (e) {
          addLog("error", "Error dando rol verificado: " + e.message);
          await message.reply(`${EMOJI.CRUZ} Hubo un error dando el rol. Contacta con el staff.`);
        }
      } else {
        await message.reply(`${EMOJI.CRUZ} Código incorrecto. Inténtalo de nuevo o usa \`/setup verificacion\` para obtener uno nuevo.`);
      }
    }
    return;
  }

  // ─── IA: responde cuando se menciona al bot
  if (!message.mentions.has(client.user)) return;
  if (activeAIProcessing.has(author.id)) return; // evitar doble procesado

  // Limpiar la mención del mensaje
  const cleanMsg = content.replace(/<@!?[0-9]+>/g, "").trim();
  if (!cleanMsg) {
    await message.reply(`${EMOJI.NEXALOGO} ¡Hola! ¿En qué puedo ayudarte? Menciónname con tu pregunta.`);
    return;
  }

  // Marcar como procesando
  activeAIProcessing.set(author.id, true);

  // Indicador de escritura + emoji de carga
  let thinkingMsg = null;
  try {
    thinkingMsg = await message.reply({
      content: `${EMOJI.LOADING} Pensando...`,
      allowedMentions: { repliedUser: false }
    });
  } catch {}

  try {
    const reply = await askGroq(author.id, cleanMsg, guild.name);

    if (thinkingMsg) {
      if (reply) {
        await thinkingMsg.edit({ content: reply });
      } else {
        await thinkingMsg.edit({ content: `${EMOJI.CRUZ} No pude obtener respuesta. Inténtalo de nuevo.` });
      }
    } else if (reply) {
      await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
    }

    if (reply) addLog("info", `[IA] ${author.tag}: "${cleanMsg.slice(0, 60)}"`);
  } catch (e) {
    addLog("error", "[IA] Error messageCreate: " + e.message);
    if (thinkingMsg) await thinkingMsg.edit({ content: `${EMOJI.CRUZ} Error procesando tu mensaje.` }).catch(() => {});
  } finally {
    activeAIProcessing.delete(author.id);
  }
});

console.log("Intentando login... botEnabled:", botEnabled);

// ==================== LOGIN ====================
if (botEnabled) {
  client.login(TOKEN)
    .then(() => console.log("✅ Bot autenticado"))
    .catch((err) => { console.error("❌ ERROR LOGIN:", err.message); process.exit(1); });
} else {
  console.log("⚠️ Bot no iniciado - faltan variables de entorno");
}

// ==================== WEB SERVER ====================
const app = express();
app.use(express.json());
app.use(express.static("public"));

// ── API: Stats para el dashboard
app.get("/api/stats", (req, res) => {
  const guilds = client.guilds?.cache;
  const totalMembers = guilds ? guilds.reduce((a, g) => a + g.memberCount, 0) : 0;
  res.json({
    guilds:       guilds?.size || 0,
    totalMembers,
    uptime:       Math.floor(process.uptime()),
    ping:         client.ws.ping,
    status:       client.isReady() ? "online" : "offline",
    maintenance:  global.maintenanceMode,
  });
});

// ── API: Logs completos para el dashboard
app.get("/api/logs", (req, res) => {
  const type  = req.query.type;
  const limit = parseInt(req.query.limit) || 100;
  const filtered = type ? logs.filter(l => l.type === type) : logs;
  res.json({ logs: filtered.slice(-limit).reverse() });
});

// ── API: Apuestas activas
app.get("/api/bets", async (req, res) => {
  try {
    const { data } = await supabase.from("bet_events").select("*").order("created_at", { ascending: false }).limit(20);
    res.json({ bets: data || [] });
  } catch (e) { res.json({ bets: [], error: e.message }); }
});

// ── API: Cambiar estado del bot
app.post("/api/status", (req, res) => {
  const { text } = req.body;
  if (!text || !client.user) return res.json({ ok: false, error: "Bot no listo o texto vacío" });
  client.user.setPresence({ activities: [{ name: text, type: ActivityType.Playing }], status: "online" });
  addLog("info", "[WEB] Estado cambiado a: " + text);
  res.json({ ok: true });
});

// ── API: Toggle mantenimiento
app.post("/api/maintenance", (req, res) => {
  const { enabled } = req.body;
  global.maintenanceMode = !!enabled;
  addLog("info", "[WEB] Mantenimiento: " + (global.maintenanceMode ? "ACTIVADO" : "DESACTIVADO"));
  res.json({ ok: true, maintenance: global.maintenanceMode });
});

// ── API: Anuncio en canal
app.post("/api/announce", async (req, res) => {
  const { guildId, channelId, message } = req.body;
  try {
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    await channel.send({ content: message });
    addLog("success", "[WEB] Anuncio enviado en " + guild.name);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── API: Lista de guilds
app.get("/api/guilds", (req, res) => {
  const guilds = client.guilds?.cache.map(g => ({
    id: g.id, name: g.name, members: g.memberCount,
    icon: g.iconURL({ size: 64 }) || null,
  })) || [];
  res.json({ guilds });
});

// ── Ruta legacy
app.get("/lilygo/logs", (req, res) => res.json({ logs: lilygoLogs }));

// ── Ruta raíz (redirige al dashboard)
app.get("/", (req, res) => {
  res.redirect("/dashboard.html");
});

app.listen(process.env.PORT || 10000, "0.0.0.0", () => {
  console.log("🌐 Servidor web en puerto " + (process.env.PORT || 10000));
});
