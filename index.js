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
console.log(
  "TOKEN detectado:",
  process.env.DISCORD_TOKEN
    ? "SI (primeros 10 chars: " + process.env.DISCORD_TOKEN.substring(0, 10) + ")"
    : "NO"
);

// ==================== VARIABLES BOT ====================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ==================== UNBELIEVABOAT API ====================
const UB_API_TOKEN = process.env.UB_API_TOKEN; // Token de la app NEXA bot en unbelievaboat.com
const UB_API_BASE  = "https://unbelievaboat.com/api/v1";

async function ubGetBalance(guildId, userId) {
  const res = await fetch(`${UB_API_BASE}/guilds/${guildId}/users/${userId}`, {
    headers: { Authorization: UB_API_TOKEN }
  });
  if (!res.ok) throw new Error("UB getBalance error: " + res.status);
  return res.json(); // { user_id, cash, bank, total }
}

async function ubSetBalance(guildId, userId, { cash, bank } = {}) {
  const body = {};
  if (cash  !== undefined) body.cash  = cash;
  if (bank  !== undefined) body.bank  = bank;
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
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ==================== HELPERS SUPABASE ====================

async function saveDNISupabase(userId, dniData) {
  const { error } = await supabase
    .from("dnis")
    .upsert({ user_id: userId, ...dniData, updated_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveDNI: " + error.message);
  return !error;
}

async function saveLogSupabase(type, message) {
  const { error } = await supabase
    .from("bot_logs")
    .insert({ type, message, created_at: new Date().toISOString() });
  if (error) console.error("Supabase log error: " + error.message);
}

async function saveTicketSupabase(data) {
  const { error } = await supabase
    .from("tickets")
    .upsert({ ...data, updated_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveTicket: " + error.message);
  return !error;
}

async function saveRatingSupabase(data) {
  const { error } = await supabase
    .from("ticket_ratings")
    .insert({ ...data, created_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveRating: " + error.message);
  return !error;
}

async function saveVerifiedUserSupabase(userId, email, guildId) {
  const { error } = await supabase
    .from("verified_users")
    .upsert({ user_id: userId, email, guild_id: guildId, verified_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveVerifiedUser: " + error.message);
  return !error;
}

async function saveBlacklistBanSupabase(userId, guildId, reason) {
  const { error } = await supabase
    .from("blacklist_bans")
    .insert({ user_id: userId, guild_id: guildId, reason, banned_at: new Date().toISOString() });
  if (error) addLog("error", "Supabase saveBlacklistBan: " + error.message);
}

// ==================== VARIABLES VERIFICACION ====================
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
};

// ==================== SENDGRID ====================
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ==================== LOGS ====================
const logs = [];
const MAX_LOGS = 100;

// LOGS PARA LILYGO (últimas 20 líneas limpias)
const lilygoLogs = [];
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
  console.log((emoji[type] || "📝") + " [" + timestamp + "] " + message);
  saveLogSupabase(type, message).catch(() => {});

  // AÑADIR LOG PARA LILYGO (solo timestamp corto + mensaje)
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

if (!UB_API_TOKEN) {
  console.warn("⚠️ UB_API_TOKEN no definido - Las funciones de economía UnbelievaBoat estarán desactivadas");
}

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
client.supabase = supabase; // ← necesario para kickinactive y otros comandos

// Exponer helpers de UB en el cliente para que los comandos los usen
client.ubGetBalance  = ubGetBalance;
client.ubSetBalance  = ubSetBalance;
client.ubAddBalance  = ubAddBalance;

global.maintenanceMode = false;
const MAINTENANCE_USER_ID = "1352652366330986526";

if (botEnabled) loadCommands(client);

// ==================== ANTI-DUPLICADOS ====================
const processedMessages = new Set();
const activeAIProcessing = new Map();
const processedWelcomes = new Set();

// ==================== ANTI-FLOOD ====================
const FLOOD_WINDOW_MS = 4000;
const FLOOD_COUNT = 8;
const FLOOD_COOLDOWN_MS = 5 * 60 * 1000;
const TRUSTED_IDS = new Set([]);
const floodBuckets = new Map();

function floodKey(gid, uid) { return gid + ":" + uid; }

async function handleBotFlood(message) {
  const guild = message.guild;
  const author = message.author;
  if (!guild || !author) return;
  if (TRUSTED_IDS.has(author.id)) return;
  const me = guild.members.me;
  if (!me) return;

  try {
    if (me.permissions.has(PermissionFlagsBits.BanMembers)) {
      await guild.members.ban(author.id, { reason: "Nexa Protection: bot flooding" });
      addLog("warning", "Bot flooder baneado: " + author.tag + " en " + guild.name);
    } else if (me.permissions.has(PermissionFlagsBits.KickMembers)) {
      await guild.members.kick(author.id, "Nexa Protection: bot flooding");
      addLog("warning", "Bot flooder kickeado: " + author.tag + " en " + guild.name);
    }
  } catch (e) {
    addLog("error", "Error sancionando bot flooder: " + e.message);
    return;
  }

  if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
  if (!me.permissions.has(PermissionFlagsBits.BanMembers)) return;

  try {
    const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 6 });
    const entry = auditLogs.entries.find((e) => {
      return Date.now() - e.createdTimestamp < 90000 && e.target?.id === author.id;
    });
    if (!entry?.executor) return;
    const executorId = entry.executor.id;
    if (executorId === guild.ownerId || TRUSTED_IDS.has(executorId)) return;
    await guild.members.ban(executorId, { reason: "Nexa Protection: añadio bot flooder" });
    addLog("warning", "Executor baneado por añadir bot flooder: " + executorId + " en " + guild.name);
  } catch (e) {
    addLog("error", "Error audit BotAdd: " + e.message);
  }
}

async function dmBanNotice(member, reason, until) {
  const untilText = until ? new Date(until).toLocaleString("es-ES") : "nunca";
  try {
    await member.send({ content: "Has sido baneado por Nexa Protection.\nMotivo: " + (reason || "Sin especificar") + "\nBan hasta: " + untilText });
  } catch { /* DMs cerrados */ }
}

// ==================== READLINE (COMANDOS TERMINAL) ====================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ''
});

rl.on('line', (line) => {
  const input = line.trim();

  if (input.toLowerCase().startsWith('/changestatus ')) {
    const texto = input.slice('/changestatus '.length).trim();

    if (!texto) {
      console.log('❌ Debes poner un texto para el estado.');
      return;
    }

    if (!client.user) {
      console.log('❌ El cliente aún no está listo.');
      return;
    }

    client.user.setPresence({
      activities: [{ name: texto, type: ActivityType.Playing }],
      status: 'online'
    });

    console.log(`✅ Estado cambiado a: Jugando a "${texto}"`);
  } else if (input) {
    console.log(`⚠️ Comando no reconocido: ${input}`);
  }
});

// ==================== READY ====================
client.once("ready", async () => {
  addLog("success", "Bot conectado: " + client.user.tag);
  addLog("info", "Servidores: " + client.guilds.cache.size);

  // ✅ FIX: Registrar comandos en Discord al arrancar
  try {
    await registerCommands(client);
    addLog("success", "Comandos registrados en Discord correctamente");
  } catch (e) {
    addLog("error", "Error registrando comandos: " + e.message);
  }
  TRUSTED_IDS.add(client.user.id);
  client.user.setPresence({ status: "online", activities: [{ name: "🛡️ NEXA PROTECTION v1.0", type: ActivityType.Playing }] });

  // ==================== SISTEMA DE BACKUP AUTOMATICO ====================
  const AUTO_BACKUP_CHECK_INTERVAL = 10 * 60 * 1000;
  
  setInterval(async () => {
    try {
      await checkAndRunAutoBackups(client, addLog);
    } catch (e) {
      addLog("error", "Error en intervalo de autobackup: " + e.message);
    }
  }, AUTO_BACKUP_CHECK_INTERVAL);

  setTimeout(async () => {
    try {
      addLog("info", "Verificando backups automáticos pendientes...");
      await checkAndRunAutoBackups(client, addLog);
    } catch (e) {
      addLog("error", "Error en primera verificación de autobackup: " + e.message);
    }
  }, 60000);

  addLog("success", "Sistema de backup automático inicializado");

  // ── MÚSICA: inicializar discord-player ───────────────
  try {
    const { setupPlayer } = require("./commands/musica");
    addLog("info", "Iniciando discord-player...");
    await setupPlayer(client);
    addLog("info", "musicPlayer asignado: " + !!client.musicPlayer);
  } catch (e) {
    addLog("error", "discord-player ERROR: " + e.message + " | " + e.stack);
  }
  addLog("success", "Sistema de protección anti-nuke inicializado");
  addLog("info", "Sistema de comandos terminal activado - Escribe /changestatus [TEXTO] para cambiar el estado");

  // ── JOB: KICK INACTIVOS ──────────────────────────────────
  const { runKickInactiveJob } = require("./commands/kickinactive");
  setInterval(() => runKickInactiveJob(client).catch(() => {}), 24 * 60 * 60 * 1000);
  setTimeout(() => runKickInactiveJob(client).catch(() => {}), 5000);
  addLog("success", "Job de kick inactivos iniciado");

  // ── UNBELIEVABOAT: verificar conexión ────────────────
  if (UB_API_TOKEN) {
    addLog("success", "UnbelievaBoat API configurada correctamente ✅");
  } else {
    addLog("warning", "UnbelievaBoat API no configurada - falta UB_API_TOKEN en .env");
  }

  // ==================== AUTO-PING CADA 15 MINUTOS ====================
  const PING_GUILD_ID = process.env.GUILD_ID;
  const PING_CHANNEL_ID = process.env.PING_CHANNEL_ID;

  if (!PING_GUILD_ID || !PING_CHANNEL_ID) {
    addLog("warning", "Auto-ping desactivado: falta GUILD_ID o PING_CHANNEL_ID en .env");
  } else {
  try {
    const guild = await client.guilds.fetch(PING_GUILD_ID);
    const channel = await guild.channels.fetch(PING_CHANNEL_ID);

    const doAutoPing = async () => {
      try {
        const sent = await channel.send({ content: "Pinging..." });
        const latency = Math.abs(sent.createdTimestamp - Date.now());
        await sent.edit(`🏓 Pong! Latencia: ${latency}ms`);
        await channel.setName(`🤖ultimo-ping-${latency}ms`);
        addLog("info", `[AUTO-PING] Latencia: ${latency}ms - Canal renombrado`);
      } catch (error) {
        addLog("error", "[AUTO-PING ERROR] " + error.message);
      }
    };

    await doAutoPing();
    setInterval(doAutoPing, 15 * 60 * 1000);
    addLog("success", "Sistema de auto-ping activado (cada 15 minutos)");
  } catch (error) {
    addLog("error", "Error inicializando auto-ping: " + error.message);
  }
  }
});

client.on("error", (error) => addLog("error", "Discord error: " + error.message));
client.on("warn", (info) => addLog("warning", "Discord warning: " + info));
client.on("guildCreate", async (guild) => {
  addLog("success", "Bot añadido a: " + guild.name);
  try {
    // Buscar el primer canal donde el bot pueda escribir
    const canal = guild.channels.cache
      .filter(c => c.type === 0 && c.permissionsFor(guild.members.me)?.has("SendMessages"))
      .sort((a, b) => a.position - b.position)
      .first();

    if (!canal) return;

    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

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
        "📋 **Encuestas** — Votaciones con múltiples opciones\n" +
        "💾 **Backup** — Copias de seguridad automáticas del servidor\n" +
        EMOJI.CORREO + " **Anuncios** — Sistema de anuncios con menciones\n" +
        "📈 **Logs** — Registro avanzado de eventos del servidor\n" +
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
      new ButtonBuilder()
        .setLabel("📖 Empezar con /setup")
        .setStyle(ButtonStyle.Primary)
        .setCustomId("noop_setup_hint")
        .setDisabled(true)
    );

    await canal.send({ embeds: [embed], components: [row] });
    addLog("success", "Mensaje de presentación enviado en: " + guild.name);
  } catch (e) {
    addLog("error", "Error mensaje presentación guildCreate: " + e.message);
  }
});
client.on("guildDelete", (guild) => addLog("warning", "Bot removido de: " + guild.name));

// ==================== BAN LOG CENTRAL ====================
const BAN_LOG_GUILD_ID = "1474052533415841823";
const BAN_LOG_BOT_CH   = "1476683870811455612"; // bots baneados
const BAN_LOG_USER_CH  = "1476267817870557184"; // usuarios baneados

// Anti-duplicados: evitar procesar el mismo ban dos veces
const processedBans = new Set();

client.on("guildBanAdd", async (ban) => {
  const banKey = ban.guild.id + ":" + ban.user.id;
  if (processedBans.has(banKey)) return;
  processedBans.add(banKey);
  setTimeout(() => processedBans.delete(banKey), 10000);

  try {
    // Obtener motivo desde audit log
    let motivo   = "Sin especificar";
    let ejecutor = null;
    try {
      await new Promise(r => setTimeout(r, 1200));
      const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 });
      const entry = auditLogs.entries.find(e => e.target?.id === ban.user.id && Date.now() - e.createdTimestamp < 15000);
      if (entry) { motivo = entry.reason || "Sin especificar"; ejecutor = entry.executor; }
    } catch {}

    // Log en servidor central
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
          .setFooter({ text: "NexaBot • Ban Log Central" })
          .setTimestamp();
        await canal.send({ embeds: [embed] });
      }
    }

  } catch (e) {
    addLog("error", "Error guildBanAdd log: " + e.message);
  }
});

// ==================== ANTI-NUKE: AUDIT LOG EVENTS ====================
client.on("guildAuditLogEntryCreate", async (auditLog, guild) => {
  const executorId = auditLog.executor?.id;
  if (!executorId || executorId === guild.ownerId || TRUSTED_IDS.has(executorId)) return;

  // BLACKLIST BOT ADD
  if (auditLog.action === AuditLogEvent.BotAdd) {
    const botId = auditLog.target?.id;
    if (!botId || TRUSTED_IDS.has(botId)) return;

    try {
      const entry = getEntry({ id: botId, bot: true });
      if (!entry) return;

      const me = guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return;

      await guild.members.ban(botId, { reason: "Nexa Protection blacklist: " + (entry.reason || "Sin motivo") });
      addLog("warning", "Bot blacklisted baneado: " + botId + " en " + guild.name);
      await saveBlacklistBanSupabase(botId, guild.id, entry.reason || "Sin motivo");

      if (executorId && executorId !== guild.ownerId && !TRUSTED_IDS.has(executorId)) {
        await guild.members.ban(executorId, { reason: "Nexa Protection: añadio bot blacklisted" });
        addLog("warning", "Executor baneado por añadir bot blacklisted: " + executorId);
      }
    } catch (e) {
      addLog("error", "Error blacklist BotAdd: " + e.message);
    }
    return;
  }

  // ANTI-NUKE: ROLE CREATE
  if (auditLog.action === AuditLogEvent.RoleCreate) {
    const result = await checkAntiNuke(guild, executorId, "roleCreate", addLog);
    if (result.shouldAct) {
      await punishNuker(guild, executorId, `Creación masiva de roles (${result.count}/${result.limit})`, addLog);
      await enableRaidMode(guild.id, 30, addLog);
    }
  }

  // ANTI-NUKE: ROLE DELETE
  if (auditLog.action === AuditLogEvent.RoleDelete) {
    const result = await checkAntiNuke(guild, executorId, "roleDelete", addLog);
    if (result.shouldAct) {
      await punishNuker(guild, executorId, `Eliminación masiva de roles (${result.count}/${result.limit})`, addLog);
      await enableRaidMode(guild.id, 30, addLog);
    }
  }

  // ANTI-NUKE: CHANNEL CREATE
  if (auditLog.action === AuditLogEvent.ChannelCreate) {
    const result = await checkAntiNuke(guild, executorId, "channelCreate", addLog);
    if (result.shouldAct) {
      await punishNuker(guild, executorId, `Creación masiva de canales (${result.count}/${result.limit})`, addLog);
      await enableRaidMode(guild.id, 30, addLog);
    }
  }

  // ANTI-NUKE: CHANNEL DELETE
  if (auditLog.action === AuditLogEvent.ChannelDelete) {
    const result = await checkAntiNuke(guild, executorId, "channelDelete", addLog);
    if (result.shouldAct) {
      await punishNuker(guild, executorId, `Eliminación masiva de canales (${result.count}/${result.limit})`, addLog);
      await enableRaidMode(guild.id, 30, addLog);
    }
  }

  // ANTI-NUKE: MEMBER BAN ADD
  if (auditLog.action === AuditLogEvent.MemberBanAdd) {
    const result = await checkAntiNuke(guild, executorId, "ban", addLog);
    if (result.shouldAct) {
      await punishNuker(guild, executorId, `Bans masivos (${result.count}/${result.limit})`, addLog);
      await enableRaidMode(guild.id, 30, addLog);
    }
  }

  // ANTI-NUKE: MEMBER KICK
  if (auditLog.action === AuditLogEvent.MemberKick) {
    const result = await checkAntiNuke(guild, executorId, "kick", addLog);
    if (result.shouldAct) {
      await punishNuker(guild, executorId, `Kicks masivos (${result.count}/${result.limit})`, addLog);
      await enableRaidMode(guild.id, 30, addLog);
    }
  }
});

// ==================== GUILD MEMBER ADD ====================
client.on("guildMemberAdd", async (member) => {
  try {
    // GLOBAL BAN CHECK
    const { data: globalBan } = await supabase
      .from("global_bans")
      .select("reason")
      .eq("user_id", member.id)
      .single();

    if (globalBan) {
      const me = member.guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await member.ban({ reason: `[GlobalBan] ${globalBan.reason}` });
        addLog("warning", "GlobalBan autoban: " + member.user.tag + " en " + member.guild.name);
      }
      return;
    }

    // BLACKLIST CHECK
    const entry = getEntry(member.user);
    if (entry) {
      const me = member.guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await dmBanNotice(member, entry.reason, entry.until);
        await member.guild.members.ban(member.id, { reason: "Nexa Protection blacklist: " + (entry.reason || "Sin motivo") });
        addLog("warning", "Blacklist autoban: " + member.user.tag + " en " + member.guild.name);
        await saveBlacklistBanSupabase(member.id, member.guild.id, entry.reason || "Sin motivo");
      }
      return;
    }

    // RAID MODE CHECK
    const isRaidMode = await checkRaidMode(member.guild, addLog);
    if (isRaidMode) {
      const config = await loadGuildConfig(member.guild.id);
      if (config?.protection?.raidMode?.autoKickNewJoins) {
        const me = member.guild.members.me;
        if (me?.permissions.has(PermissionFlagsBits.KickMembers)) {
          await member.kick("[Modo Raid] Servidor protegido");
          addLog("warning", "Raid Mode: kickeado " + member.user.tag);
          return;
        }
      }
    }
  } catch (e) {
    addLog("error", "Error guildMemberAdd protection: " + e.message);
  }

  if (processedWelcomes.has(member.id)) return;
  processedWelcomes.add(member.id);
  setTimeout(() => processedWelcomes.delete(member.id), 30000);

  try {
    const guildConfig = await loadGuildConfig(member.guild.id);
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
        { name: "Creado", value: "<t:" + Math.floor(member.user.createdTimestamp / 1000) + ":R>", inline: true }
      )
      .setFooter({ text: "Bienvenido al servidor" })
      .setTimestamp();

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
  console.log("Interaccion: " + (interaction.customId || interaction.commandName) + " en " + (interaction.guild?.name || "DM"));

  try {
    // COMANDOS SLASH
    if (interaction.isChatInputCommand()) {
      if (global.maintenanceMode && interaction.user.id !== MAINTENANCE_USER_ID) {
        return interaction.reply({ content: "El bot esta en mantenimiento.", flags: 64 });
      }
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        return interaction.reply({ content: EMOJI.CRUZ + " Comando no reconocido.", flags: 64 });
      }
      try {
        await command.execute(interaction);
        addLog("info", "/" + interaction.commandName + " por " + interaction.user.tag);
      } catch (err) {
        addLog("error", "Error /" + interaction.commandName + ": " + err.message);
        if (!interaction.replied && !interaction.deferred) {
          interaction.reply({ content: EMOJI.CRUZ + " Error ejecutando el comando", flags: 64 }).catch(() => {});
        }
      }
      return;
    }

    // ───────── SISTEMA DE APUESTAS: BOTONES ─────────
    if (interaction.isButton() && interaction.customId.startsWith("bet_event_")) {
      // Formato: bet_event_<eventId>_1 o _2
      const parts = interaction.customId.split("_");
      const eventId = parts[2];
      const option = parseInt(parts[3], 10); // 1 o 2

      if (!eventId || ![1, 2].includes(option)) {
        return interaction.reply({ content: EMOJI.CRUZ + " Botón de apuesta inválido.", flags: 64 });
      }

      // Crear modal para cantidad
      const modal = new ModalBuilder()
        .setCustomId(`bet_amount_${eventId}_${option}`)
        .setTitle("Cantidad a apostar");

      const amountInput = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("¿Cuánto quieres apostar? (cash)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ejemplo: 1000")
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(amountInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // ───────── SISTEMA DE APUESTAS: MODAL ─────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith("bet_amount_")) {
      const supabase = interaction.client.supabase;
      const ubGetBalance = interaction.client.ubGetBalance;

      if (!supabase || !ubGetBalance) {
        return interaction.reply({
          content: EMOJI.CRUZ + " Sistema de apuestas no está bien configurado (DB o UnbelievaBoat).",
          flags: 64,
        });
      }

      // customId: bet_amount_<eventId>_<option>
      const parts = interaction.customId.split("_");
      const eventId = parts[2];
      const option = parseInt(parts[3], 10); // 1 o 2

      const amountStr = interaction.fields.getTextInputValue("amount").trim();
      const amount = parseInt(amountStr, 10);

      if (!eventId || ![1, 2].includes(option)) {
        return interaction.reply({ content: EMOJI.CRUZ + " Datos de apuesta inválidos.", flags: 64 });
      }

      if (isNaN(amount) || amount <= 0) {
        return interaction.reply({
          content: EMOJI.CRUZ + " La cantidad debe ser un número mayor que 0.",
          flags: 64,
        });
      }

      await interaction.deferReply({ flags: 64 }); // respuesta solo para el usuario

      try {
        // 1) Verificar que el evento sigue abierto
        const { data: event, error: evError } = await supabase
          .from("bet_events")
          .select("*")
          .eq("id", eventId)
          .single();

        if (evError || !event) {
          return interaction.editReply({
            content: EMOJI.CRUZ + " No se ha encontrado el evento de apuestas.",
          });
        }

        if (event.status !== "open") {
          return interaction.editReply({
            content: EMOJI.CRUZ + " Este evento ya no acepta apuestas.",
          });
        }

        // 2) Comprobar saldo en UnbelievaBoat
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;

        const balance = await ubGetBalance(guildId, userId);
        if (!balance || typeof balance.cash !== "number") {
          return interaction.editReply({
            content: EMOJI.CRUZ + " No se pudo obtener tu saldo en UnbelievaBoat.",
          });
        }

        if (balance.cash < amount) {
          return interaction.editReply({
            content: EMOJI.CRUZ + " No tienes suficiente cash. Saldo: `" + balance.cash + "`",
          });
        }

        // 3) Evitar apuestas duplicadas en el mismo evento
        const { data: existing, error: exError } = await supabase
          .from("bets")
          .select("id, option, amount")
          .eq("event_id", eventId)
          .eq("user_id", userId)
          .maybeSingle();

        if (existing && !exError) {
          return interaction.editReply({
            content: EMOJI.CRUZ + " Ya has apostado en este evento.",
          });
        }

        // 4) Guardar apuesta en Supabase
        const { error: betError } = await supabase.from("bets").insert([
          {
            event_id: eventId,
            user_id: userId,
            username: interaction.user.tag,
            option,
            amount,
          },
        ]);

        if (betError) {
          console.error("Supabase bet insert error:", betError);
          return interaction.editReply({
            content: EMOJI.CRUZ + " Error guardando tu apuesta en la base de datos.",
          });
        }

        await interaction.editReply({
          content: EMOJI.CHECK + " Apuesta registrada: `" + amount + "` a la opción " + option + ".",
        });
      } catch (err) {
        console.error("Error procesando apuesta:", err);
        await interaction.editReply({
          content: EMOJI.CRUZ + " Ocurrió un error al procesar tu apuesta.",
        });
      }
      return;
    }

    // MODAL: SETUP TICKETS QUESTIONS
    if (interaction.isModalSubmit() && interaction.customId === 'setup_tickets_questions') {
      addLog("info", "Modal setup_tickets_questions recibido de " + interaction.user.tag);
      const setupCommand = client.commands.get('setup');
      if (!setupCommand) {
        addLog("error", "Comando 'setup' no encontrado en colección");
        return interaction.reply({ content: EMOJI.CRUZ + " Error: comando setup no cargado.", flags: 64 }).catch(() => {});
      }
      if (!setupCommand.handleModal) {
        addLog("error", "Método handleModal no existe en comando setup");
        return interaction.reply({ content: EMOJI.CRUZ + " Error: función handleModal no encontrada.", flags: 64 }).catch(() => {});
      }
      try {
        await setupCommand.handleModal(interaction);
        addLog("success", "Modal setup_tickets_questions procesado correctamente");
      } catch (err) {
        addLog("error", "Error en handleModal: " + err.message + " | Stack: " + err.stack);
        if (!interaction.replied && !interaction.deferred) {
          interaction.reply({ content: EMOJI.CRUZ + " Error: " + err.message, flags: 64 }).catch(() => {});
        }
      }
      return;
    }

    // (… resto de tu interactionCreate igual que en tu paste, sin cambios …)

    // BOTONES: BACKUP NOTIFY
    if (interaction.isButton() && interaction.customId.startsWith("backup_notify_yes_")) {
      const guildId = interaction.customId.split("backup_notify_yes_")[1];

      const exampleEmbed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle("<a:ADVERTENCIA:1477616948937490452> Información importante del servidor")
        .setDescription(
          "El servidor ha sido restaurado desde un backup reciente.\n\n" +
            "Es posible que notes cambios en canales, roles o permisos.\n" +
            "Si ves algo raro, abre un ticket o contacta con el staff.\n\n" +
            "Gracias por tu paciencia."
        );

      await interaction.reply({
        content:
          "Aquí tienes un mensaje de ejemplo. Copia este embed y publícalo en el canal de anuncios o donde prefieras:",
        embeds: [exampleEmbed],
        flags: 64
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("backup_notify_no_")) {
      await interaction.reply({
        content:
          "Perfecto, no se enviará ningún mensaje automático. Recuerda que, por privacidad, el bot no manda DMs masivos a los miembros.",
        flags: 64
      });
      return;
    }

  } catch (error) {
    if (error.code === 10062) { addLog("warning", "Interaccion expirada"); return; }
    addLog("error", "Error interaccion: " + error.message);
  }
});

// ==================== PANEL TRABAJOS ====================
// (… tu función actualizarPanelTrabajos igual que en el paste …)

// ==================== MENSAJES (ANTI-FLOOD + ANTI-LINKS + ANTI-MENTIONS + IA + VERIFICACION) ====================
// (… tu messageCreate igual que en el paste …)

console.log("Intentando login...");
console.log("botEnabled:", botEnabled);
console.log("TOKEN length:", TOKEN?.length);
console.log("CLIENT_ID:", CLIENT_ID);

// ==================== LOGIN ====================
if (botEnabled) {
  client.login(TOKEN)
    .then(() => console.log("✅ Bot autenticado correctamente"))
    .catch((err) => {
      console.error("❌ ERROR LOGIN:", err.message);
      console.error("Token usado (primeros 20):", TOKEN?.substring(0, 20));
      process.exit(1);
    });
} else {
  console.log("⚠️ Bot no iniciado - faltan variables de entorno");
}

// ==================== WEB SERVER ====================
const app = express();
app.use(express.static('public'));

app.get("/", (req, res) => {
  res.send("<h1>🛡️ NexaBot v1.0 - Protection Active</h1><p>Servidores: " + (client.guilds?.cache.size || 0) + "</p><p>Status: ✅ Online</p>");
});

// ENDPOINT PARA LILYGO: devuelve logs limpios en JSON
app.get("/lilygo/logs", (req, res) => {
  res.json({ logs: lilygoLogs });
});

app.listen(process.env.PORT || 10000, "0.0.0.0", () => {
  console.log("🌐 Servidor web en puerto " + (process.env.PORT || 10000));
});
