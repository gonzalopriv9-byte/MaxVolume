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
   TICKET: "<a:Ticket:1472541437470965942>",  
  CRUZ: "<a:Cruz:1472540885102235689>",
  CHECK: "<a:Check:1472540340584972509>",
  CORREO: "<a:correo:1472550293152596000>",
   NUKE: "<a:NUKE:1477617312679858318>",
 NEXALOGO: "<a:NEXALOGO:1477286399345561682>"
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

// ==================== CLIENTE DISCORD ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

client.commands = new Collection();
client.supabase = supabase; // ← necesario para kickinactive y otros comandos
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
  addLog("success", "Sistema de protección anti-nuke inicializado");
  addLog("info", "Sistema de comandos terminal activado - Escribe /changestatus [TEXTO] para cambiar el estado");

  // ── JOB: KICK INACTIVOS ──────────────────────────────────
  const { runKickInactiveJob } = require("./commands/kickinactive");
  setInterval(() => runKickInactiveJob(client).catch(() => {}), 24 * 60 * 60 * 1000);
  setTimeout(() => runKickInactiveJob(client).catch(() => {}), 5000);
  addLog("success", "Job de kick inactivos iniciado");

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

    // SELECT MENU: ELEGIR CATEGORIA DE TICKET
    if (interaction.isStringSelectMenu() && interaction.customId === "open_ticket_select") {
      const categoryId = interaction.values[0];
      const guildConfig = await loadGuildConfig(interaction.guild.id);
      
      if (!guildConfig?.tickets?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Sistema de tickets no configurado.", flags: 64 });
      }

      const categories = guildConfig.tickets.categories || [];
      const category = categories.find(c => c.id === categoryId);

      if (!category) {
        return interaction.reply({ content: EMOJI.CRUZ + " Categoría no encontrada.", flags: 64 });
      }

      // Crear modal dinámico con las preguntas de la categoría
      const modal = new ModalBuilder()
        .setCustomId("ticket_category_modal_" + categoryId)
        .setTitle(category.nombre);

      const preguntas = category.preguntas || [
        { id: 'field_1', label: 'Usuario de Roblox', placeholder: 'Tu usuario de Roblox', required: true },
        { id: 'field_2', label: 'Motivo del ticket', placeholder: 'Describe tu problema', required: true }
      ];

      for (const pregunta of preguntas.slice(0, 5)) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(pregunta.id)
              .setLabel(pregunta.label)
              .setStyle(pregunta.label.length > 30 ? TextInputStyle.Paragraph : TextInputStyle.Short)
              .setPlaceholder(pregunta.placeholder || "Escribe tu respuesta...")
              .setRequired(pregunta.required !== false)
          )
        );
      }

      await interaction.showModal(modal);
      return;
    }

    // BOTON: ABRIR TICKET (MODO SIMPLE)
    if (interaction.isButton() && interaction.customId === "open_ticket") {
      const guildConfig = await loadGuildConfig(interaction.guild.id);
      
      if (!guildConfig?.tickets?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Sistema de tickets no configurado.", flags: 64 });
      }

      // Usar preguntas por defecto de la config o las clásicas
      const questions = guildConfig.tickets.defaultQuestions || [
        { id: 'field_1', label: 'Usuario de Roblox', placeholder: 'Tu usuario de Roblox', required: true },
        { id: 'field_2', label: 'Motivo del ticket', placeholder: 'Describe tu problema', required: true }
      ];

      const modal = new ModalBuilder().setCustomId("ticket_modal_general").setTitle("Crear Ticket");
      
      for (const q of questions.slice(0, 5)) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(q.id)
              .setLabel(q.label)
              .setStyle(q.label.length > 30 ? TextInputStyle.Paragraph : TextInputStyle.Short)
              .setPlaceholder(q.placeholder || "Escribe tu respuesta...")
              .setRequired(q.required !== false)
          )
        );
      }

      await interaction.showModal(modal);
      return;
    }

    // MODAL: CREAR TICKET (CATEGORIA O GENERAL)
    if (interaction.isModalSubmit() && (interaction.customId.startsWith("ticket_category_modal_") || interaction.customId === "ticket_modal_general")) {
      await interaction.deferReply({ flags: 64 });

      const categoryId = interaction.customId.replace("ticket_category_modal_", "");
      const isGeneral = interaction.customId === "ticket_modal_general";

      try {
        const guild = interaction.guild;
        const guildConfig = await loadGuildConfig(guild.id);

        if (!guildConfig?.tickets?.enabled) {
          return interaction.editReply({ content: EMOJI.CRUZ + " El sistema de tickets no esta configurado." });
        }

        let ticketData = {};
        let category = null;

        if (!isGeneral) {
          const categories = guildConfig.tickets.categories || [];
          category = categories.find(c => c.id === categoryId);
          if (category) {
            const preguntas = category.preguntas || [];
            for (const pregunta of preguntas) {
              try {
                const valor = interaction.fields.getTextInputValue(pregunta.id);
                ticketData[pregunta.label] = valor;
              } catch { /* campo no encontrado */ }
            }
          }
        } else {
          // Usar preguntas configuradas
          const questions = guildConfig.tickets.defaultQuestions || [
            { id: 'field_1', label: 'Usuario de Roblox' },
            { id: 'field_2', label: 'Motivo del ticket' }
          ];
          
          for (const q of questions) {
            try {
              const valor = interaction.fields.getTextInputValue(q.id);
              ticketData[q.label] = valor;
            } catch { /* campo no encontrado */ }
          }
        }

        const ticketChannel = await guild.channels.create({
          name: (category ? category.emoji + "-" : "") + "ticket-" + interaction.user.username,
          type: ChannelType.GuildText,
          parent: guildConfig.tickets.categoryId,
          topic: interaction.user.id,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ...guildConfig.tickets.staffRoles.map((r) => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
          ]
        });

        await saveTicketSupabase({
          channel_id: ticketChannel.id,
          guild_id: guild.id,
          user_id: interaction.user.id,
          username: interaction.user.tag,
          category: category ? category.nombre : "General",
          ticket_data: JSON.stringify(ticketData),
          status: "open",
          created_at: new Date().toISOString()
        });

        const descripcion = Object.entries(ticketData)
          .map(([k, v]) => `**${k}:** ${v}`)
          .join("\n");

        const embed = new EmbedBuilder()
          .setColor("#00BFFF")
          .setTitle((category ? category.emoji + " " : "") + EMOJI.TICKET + " Nuevo Ticket")
          .setDescription(descripcion)
          .setFooter({ text: "Por " + interaction.user.tag })
          .setTimestamp();

        await ticketChannel.send({
          content: "<@" + interaction.user.id + "> | " + guildConfig.tickets.staffRoles.map((r) => "<@&" + r + ">").join(" "),
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("claim_ticket").setLabel("✅ Reclamar").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("close_ticket").setLabel("❌ Cerrar").setStyle(ButtonStyle.Danger)
          )],
          allowedMentions: { users: [interaction.user.id], roles: guildConfig.tickets.staffRoles }
        });

        await interaction.editReply({ content: EMOJI.CHECK + " Ticket creado: <#" + ticketChannel.id + ">" });
        addLog("success", "Ticket creado por " + interaction.user.tag + (category ? " (" + category.nombre + ")" : ""));
      } catch (error) {
        addLog("error", "Error ticket: " + error.message);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error al crear el ticket." });
      }
      return;
    }

    // MODAL: CREAR DNI
    if (interaction.isModalSubmit() && interaction.customId === "dni_modal") {
      await interaction.deferReply({ flags: 64 });

      try {
        const nombreCompleto = interaction.fields.getTextInputValue("nombre_completo");
        const fechaNacimiento = interaction.fields.getTextInputValue("fecha_nacimiento");
        const nacionalidad = interaction.fields.getTextInputValue("nacionalidad");
        const direccion = interaction.fields.getTextInputValue("direccion");
        const telefono = interaction.fields.getTextInputValue("telefono");

        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fechaNacimiento)) {
          return interaction.editReply({ content: EMOJI.CRUZ + " Formato de fecha invalido. Usa DD/MM/AAAA" });
        }
        if (!/^\d{9,15}$/.test(telefono.replace(/\s/g, ""))) {
          return interaction.editReply({ content: EMOJI.CRUZ + " Telefono invalido. Solo numeros (9-15 digitos)." });
        }

        const numeroDNI = generateDNINumber();
        const dniData = { numero_dni: numeroDNI, nombre_completo: nombreCompleto, fecha_nacimiento: fechaNacimiento, nacionalidad, direccion, telefono, username: interaction.user.username };

        const successLocal = saveDNI(interaction.user.id, { numeroDNI, nombreCompleto, fechaNacimiento, nacionalidad, direccion, telefono, userId: interaction.user.id, username: interaction.user.username });
        const successSupa = await saveDNISupabase(interaction.user.id, dniData);

        if (successLocal || successSupa) {
          const embed = new EmbedBuilder()
            .setColor("#00FF00").setTitle(EMOJI.CHECK + " DNI Creado Exitosamente")
            .setDescription("Tu DNI ha sido registrado.")
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 128 }))
            .addFields(
              { name: "Numero DNI", value: "`" + numeroDNI + "`", inline: true },
              { name: "Nombre", value: nombreCompleto, inline: true },
              { name: "Fecha Nacimiento", value: fechaNacimiento, inline: true },
              { name: "Nacionalidad", value: nacionalidad, inline: true },
              { name: "Telefono", value: telefono, inline: true }
            )
            .setFooter({ text: "Usa /verdni para ver tu DNI completo" }).setTimestamp();
          await interaction.editReply({ embeds: [embed] });
          addLog("success", "DNI creado para " + interaction.user.tag + ": " + numeroDNI);
        } else {
          await interaction.editReply({ content: EMOJI.CRUZ + " Error al guardar el DNI." });
        }
      } catch (error) {
        addLog("error", "Error DNI: " + error.message);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error procesando tu DNI." });
      }
      return;
    }

    // BOTON: RECLAMAR TICKET
    if (interaction.isButton() && interaction.customId === "claim_ticket") {
      const guildConfig = await loadGuildConfig(interaction.guild.id);
      if (!guildConfig?.tickets?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Tickets no configurado.", flags: 64 });
      }
      const STAFF_ROLES = guildConfig.tickets.staffRoles;
      if (!STAFF_ROLES.some((r) => interaction.member.roles.cache.has(r))) {
        return interaction.reply({ content: EMOJI.CRUZ + " Solo el staff puede reclamar.", flags: 64 });
      }

      await interaction.reply({ content: EMOJI.CHECK + " <@" + interaction.user.id + "> ha reclamado este ticket.", allowedMentions: { users: [] } });
      await supabase.from("tickets").update({ status: "claimed", claimed_by: interaction.user.id, updated_at: new Date().toISOString() }).eq("channel_id", interaction.channel.id);

      try {
        const channel = interaction.channel;
        const ticketOwner = channel.permissionOverwrites.cache.find(
          (p) => p.type === 1 && p.id !== interaction.user.id && !STAFF_ROLES.includes(p.id)
        );
        const newPerms = [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ];
        if (ticketOwner) newPerms.push({ id: ticketOwner.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        STAFF_ROLES.forEach((r) => newPerms.push({ id: r, deny: [PermissionFlagsBits.ViewChannel] }));
        await channel.edit({ permissionOverwrites: newPerms });
        await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("close_ticket").setLabel("❌ Cerrar").setStyle(ButtonStyle.Danger))] });
        addLog("info", "Ticket reclamado por " + interaction.user.tag);
      } catch (error) {
        addLog("error", "Error reclamando: " + error.message);
      }
      return;
    }

    // BOTON: CERRAR TICKET
    if (interaction.isButton() && interaction.customId === "close_ticket") {
      const guildConfig = await loadGuildConfig(interaction.guild.id);
      if (!guildConfig?.tickets?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Tickets no configurado.", flags: 64 });
      }
      const STAFF_ROLES = guildConfig.tickets.staffRoles;
      const channel = interaction.channel;
      const ticketOwnerId = channel.topic;
      const hasStaff = STAFF_ROLES.some((r) => interaction.member.roles.cache.has(r));
      if (interaction.user.id !== ticketOwnerId && !hasStaff) {
        return interaction.reply({ content: EMOJI.CRUZ + " Solo el creador o el staff puede cerrar el ticket.", flags: 64 });
      }

      const modal = new ModalBuilder().setCustomId("ticket_rating_modal").setTitle("Valoracion del Ticket");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("rating_stars").setLabel("Estrellas (1-5)")
            .setStyle(TextInputStyle.Short).setPlaceholder("1-5").setRequired(true).setMinLength(1).setMaxLength(1)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("rating_reason").setLabel("Comentario sobre la atencion")
            .setStyle(TextInputStyle.Paragraph).setPlaceholder("Escribe tu experiencia...")
            .setRequired(true).setMinLength(10).setMaxLength(1000)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    // MODAL: VALORACION
    if (interaction.isModalSubmit() && interaction.customId === "ticket_rating_modal") {
      const stars = interaction.fields.getTextInputValue("rating_stars");
      const reason = interaction.fields.getTextInputValue("rating_reason");

      if (!/^[1-5]$/.test(stars)) {
        return interaction.reply({ content: EMOJI.CRUZ + " Estrellas debe ser 1-5.", flags: 64 });
      }

      const channel = interaction.channel;
      const guildConfig = await loadGuildConfig(interaction.guild.id);
      if (!guildConfig?.tickets?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Tickets no configurado.", flags: 64 });
      }

      const STAFF_ROLES = guildConfig.tickets.staffRoles;
      const RATINGS_CHANNEL_ID = guildConfig.tickets.ratingsChannelId;

      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        let staffMember = null;
        for (const msg of messages.values()) {
          if (msg.author.bot) continue;
          if (msg.member && STAFF_ROLES.some((r) => msg.member.roles.cache.has(r))) { staffMember = msg.author; break; }
        }
        const staffName = staffMember ? staffMember.tag : "No asignado";

        await saveRatingSupabase({
          channel_id: channel.id, guild_id: interaction.guild.id,
          user_id: interaction.user.id, username: interaction.user.tag,
          staff_name: staffName, staff_id: staffMember?.id || null,
          stars: parseInt(stars), comment: reason, ticket_name: channel.name
        });

        await supabase.from("tickets").update({ status: "closed", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("channel_id", channel.id);

        const ratingEmbed = new EmbedBuilder()
          .setColor(stars >= 4 ? "#00FF00" : stars >= 3 ? "#FFA500" : "#FF0000")
          .setTitle("⭐ Valoracion del Ticket")
          .addFields(
            { name: "Usuario", value: "<@" + interaction.user.id + ">", inline: true },
            { name: "Staff", value: staffName, inline: true },
            { name: "Estrellas", value: "⭐".repeat(parseInt(stars)), inline: false },
            { name: "Comentario", value: reason, inline: false },
            { name: "Ticket", value: channel.name, inline: true },
            { name: "Fecha", value: "<t:" + Math.floor(Date.now() / 1000) + ":F>", inline: true }
          ).setTimestamp();

        if (RATINGS_CHANNEL_ID) {
          const ratingsChannel = interaction.guild.channels.cache.get(RATINGS_CHANNEL_ID);
          if (ratingsChannel) await ratingsChannel.send({ embeds: [ratingEmbed] });
        }

        await interaction.reply({ content: EMOJI.CHECK + " Gracias por tu valoracion! El ticket se cerrara en 5 segundos...", embeds: [ratingEmbed] });
        addLog("info", "Ticket valorado: " + stars + " estrellas por " + interaction.user.tag);

        setTimeout(async () => {
          try {
            const allMessages = await channel.messages.fetch({ limit: 100 });
            const transcript = Array.from(allMessages.values()).reverse()
              .map((m) => "[" + m.createdAt.toLocaleString("es-ES") + "] " + m.author.tag + ": " + m.content)
              .join("\n");

            await supabase.from("ticket_transcripts").insert({ channel_id: channel.id, guild_id: interaction.guild.id, transcript, saved_at: new Date().toISOString() });

            try {
              await interaction.user.send({
                content: "Transcript del ticket " + channel.name,
                files: [{ attachment: Buffer.from(transcript, "utf-8"), name: "ticket-" + channel.name + "-" + Date.now() + ".txt" }]
              });
            } catch { addLog("warning", "No se pudo enviar transcript por DM"); }

            await channel.delete("Ticket cerrado por " + interaction.user.tag);
          } catch (error) {
            addLog("error", "Error cerrando ticket: " + error.message);
          }
        }, 5000);
      } catch (error) {
        addLog("error", "Error valoracion: " + error.message);
        await interaction.reply({ content: EMOJI.CRUZ + " Error al procesar la valoracion.", flags: 64 });
      }
      return;
    }

    // SISTEMA DE TRABAJOS
    if (interaction.isButton() && interaction.customId.startsWith("trabajo_")) {
      const trabajoSeleccionado = interaction.customId.replace("trabajo_", "");
      const guildConfig = await loadGuildConfig(interaction.guild.id);

      if (!guildConfig?.trabajos?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Trabajos no configurado. Usa `/config trabajos`.", flags: 64 });
      }

      const TRABAJOS = guildConfig.trabajos.roles;

      if (trabajoSeleccionado === "quitar") {
        let actual = null;
        for (const [key, t] of Object.entries(TRABAJOS)) {
          if (interaction.member.roles.cache.has(t.roleId)) {
            actual = t;
            await interaction.member.roles.remove(t.roleId);
            break;
          }
        }
        await interaction.reply({ content: actual ? EMOJI.CHECK + " Renunciaste a **" + actual.nombre + "**." : EMOJI.CRUZ + " No tienes ningun trabajo.", flags: 64 });
        await actualizarPanelTrabajos(interaction, guildConfig);
        return;
      }

      const trabajo = TRABAJOS[trabajoSeleccionado];
      if (!trabajo) return;

      try {
        for (const [key, t] of Object.entries(TRABAJOS)) {
          if (key !== trabajoSeleccionado && interaction.member.roles.cache.has(t.roleId)) {
            await interaction.member.roles.remove(t.roleId);
          }
        }
        if (interaction.member.roles.cache.has(trabajo.roleId)) {
          return interaction.reply({ content: "Ya eres **" + trabajo.nombre + "**.", flags: 64 });
        }
        await interaction.member.roles.add(trabajo.roleId);
        await interaction.reply({ content: EMOJI.CHECK + " " + trabajo.emoji + " Ahora eres **" + trabajo.nombre + "**.", flags: 64 });
        addLog("info", interaction.user.tag + " ahora es " + trabajo.nombre);
        await actualizarPanelTrabajos(interaction, guildConfig);
      } catch (error) {
        await interaction.reply({ content: EMOJI.CRUZ + " Error asignando trabajo.", flags: 64 });
      }
      return;
    }

    // BOTON: VERIFICACION
    if (interaction.isButton() && interaction.customId === "verify_start") {
      const guildConfig = await loadGuildConfig(interaction.guild.id);

      if (!guildConfig?.verification?.enabled) {
        return interaction.reply({ content: EMOJI.CRUZ + " Verificacion no configurada. Usa `/config verificacion`.", flags: 64 });
      }

      if (interaction.member.roles.cache.has(guildConfig.verification.roleId)) {
        return interaction.reply({ content: EMOJI.CHECK + " Ya estas verificado.", flags: 64 });
      }

      try {
        await interaction.reply({ content: EMOJI.CHECK + " Te he enviado un MD.", flags: 64 });
        await interaction.user.send({
          embeds: [new EmbedBuilder().setColor("#5865F2").setTitle("✅ Verificacion de Email")
            .setDescription("**Paso 1:** Envia tu correo electronico aqui.\n\nEjemplo: `micorreo@gmail.com`\n\nTienes 5 minutos.").setTimestamp()]
        });
        verificationCodes.set(interaction.user.id, { step: "waiting_email", guildId: interaction.guild.id, timestamp: Date.now() });
        addLog("info", "Verificacion iniciada: " + interaction.user.tag);
      } catch (error) {
        addLog("error", "Error MD verificacion: " + error.message);
        interaction.editReply({ content: EMOJI.CRUZ + " No puedo enviarte mensajes directos." }).catch(() => {});
      }
      return;
    }

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
async function actualizarPanelTrabajos(interaction, guildConfig) {
  try {
    const TRABAJOS = guildConfig.trabajos.roles;
    const contadores = {};
    for (const [key, t] of Object.entries(TRABAJOS)) {
      const role = interaction.guild.roles.cache.get(t.roleId);
      contadores[key] = role ? role.members.size : 0;
    }

    const trabajosList = Object.entries(TRABAJOS)
      .map(([k, t]) => t.emoji + " **" + t.nombre + ":** `" + contadores[k] + "` personas")
      .join("\n");

    const embed = new EmbedBuilder().setColor("#00BFFF").setTitle("💼 CENTRO DE EMPLEO")
      .setDescription("Selecciona tu trabajo:\n\n**Personal actual:**\n" + trabajosList + "\n\n• Solo puedes tener un trabajo\n• Al elegir uno nuevo pierdes el anterior")
      .setFooter({ text: "Sistema de empleos" }).setTimestamp();

    const rows = [];
    const arr = Object.entries(TRABAJOS);
    for (let i = 0; i < arr.length; i += 2) {
      const row = new ActionRowBuilder();
      for (let j = i; j < Math.min(i + 2, arr.length); j++) {
        const [key, t] = arr[j];
        row.addComponents(new ButtonBuilder().setCustomId("trabajo_" + key).setLabel(t.emoji + " " + t.nombre + " (" + contadores[key] + ")")
          .setStyle([ButtonStyle.Primary, ButtonStyle.Danger, ButtonStyle.Secondary, ButtonStyle.Success][j % 4]));
      }
      rows.push(row);
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("trabajo_quitar").setLabel("❌ Renunciar a mi trabajo").setStyle(ButtonStyle.Danger)));
    await interaction.message.edit({ embeds: [embed], components: rows });
  } catch (error) {
    console.error("Error actualizando panel:", error);
  }
}

// ==================== MENSAJES (ANTI-FLOOD + ANTI-LINKS + ANTI-MENTIONS + IA + VERIFICACION) ====================
client.on("messageCreate", async (message) => {
  try {
    // ANTI-FLOOD
    if (message.guild && message.author) {
      const key = floodKey(message.guild.id, message.author.id);
      const now = Date.now();
      const b = floodBuckets.get(key) ?? { ts: [], lastActionAt: 0 };
      b.ts.push(now);
      b.ts = b.ts.filter((t) => now - t <= FLOOD_WINDOW_MS);
      if (!(b.lastActionAt && now - b.lastActionAt < FLOOD_COOLDOWN_MS) && b.ts.length >= FLOOD_COUNT) {
        b.lastActionAt = now;
        floodBuckets.set(key, b);
        if (message.author.bot) { await handleBotFlood(message); return; }
      } else {
        floodBuckets.set(key, b);
      }
    }

    if (message.author.bot) return;
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 30000);

    // ANTI-LINKS
    if (message.guild) {
      const antiLinksResult = await checkAntiLinks(message, addLog);
      if (antiLinksResult.shouldAct) {
        const config = await loadGuildConfig(message.guild.id);
        await punishAntiLinks(message, config, addLog);
        return;
      }
    }

    // ANTI-MENTIONS
    if (message.guild) {
      const antiMentionsResult = await checkAntiMentions(message, addLog);
      if (antiMentionsResult.shouldAct) {
        const config = await loadGuildConfig(message.guild.id);
        await punishAntiMentions(message, config, addLog);
        return;
      }
    }

    // IA (SOLO MENCIONES DIRECTAS, NO @everyone)
    if (message.guild && message.mentions.users.has(client.user.id)) {
      if (activeAIProcessing.has(message.id)) return;
      activeAIProcessing.set(message.id, true);

      try {
        const prompt = message.content.replace(/<@!?\d+>/g, "").trim();
        if (!prompt) { activeAIProcessing.delete(message.id); return message.reply("Menciónami con una pregunta."); }

        await message.channel.sendTyping();

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.GROQ_API_KEY },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: "Eres NexaBot, un asistente de seguridad y moderación de servidores Discord desarrollado por gonzalo_priv. Tu personalidad es profesional pero amigable. Ayudas a administradores y usuarios con funciones de protección anti-nuke, tickets, verificación por email, DNI virtuales, blacklist global y backup automático. Respondes de forma clara, concisa y útil. Cuando te pregunten sobre tus funcionalidades, menciona: sistema anti-nuke, tickets personalizables, verificación por correo, DNI virtuales, sistema de trabajos con roles, blacklist automática, protección anti-flood/spam/links y backups automáticos. Eres eficiente, confiable y siempre dispuesto a ayudar." },
              { role: "user", content: prompt }
            ],
            max_tokens: 1024,
            temperature: 0.7
          })
        });

        if (!response.ok) throw new Error("API error: " + response.status);
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        if (aiResponse.length <= 2000) {
          await message.reply(aiResponse);
        } else {
          const chunks = aiResponse.match(/[\s\S]{1,2000}/g) || [];
          for (const chunk of chunks) await message.channel.send(chunk);
        }
        addLog("success", "IA respondio a " + message.author.tag);
      } catch (error) {
        addLog("error", "Error IA: " + error.message);
        await message.reply(EMOJI.CRUZ + " Error procesando tu pregunta.").catch(() => {});
      } finally {
        setTimeout(() => activeAIProcessing.delete(message.id), 5000);
      }
      return;
    }

    // VERIFICACION DM
    if (!message.guild) {
      const userData = verificationCodes.get(message.author.id);
      if (!userData) return;
      if (Date.now() - userData.timestamp > 5 * 60 * 1000) {
        verificationCodes.delete(message.author.id);
        return message.reply(EMOJI.CRUZ + " Tiempo expirado. Intenta de nuevo.");
      }

      try {
        if (userData.step === "waiting_email") {
          const email = message.content.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return message.reply(EMOJI.CRUZ + " Email invalido.");

          const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

          await sgMail.send({
            to: email,
            from: process.env.SENDGRID_FROM_EMAIL,
            subject: "Codigo de Verificacion - Discord",
            html: "<div style='font-family:Arial'><h2>✅ Verificacion Discord</h2><p>Hola <b>" + message.author.username + "</b></p><p>Tu codigo:</p><div style='background:#f0f0f0;padding:20px;text-align:center;font-size:32px;font-weight:bold'>" + verificationCode + "</div><p>Expira en 5 minutos.</p></div>"
          });

          verificationCodes.set(message.author.id, { step: "waiting_code", code: verificationCode, email, guildId: userData.guildId, timestamp: Date.now() });
          await message.reply({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle(EMOJI.CHECK + " Codigo Enviado").setDescription("Codigo enviado a **" + email + "**. Revisa spam.\n\nEnvia el codigo de 6 digitos.").setTimestamp()] });
          addLog("success", "Codigo de verificacion enviado a " + email);

        } else if (userData.step === "waiting_code") {
          const inputCode = message.content.trim();
          if (!/^\d{6}$/.test(inputCode)) return message.reply(EMOJI.CRUZ + " Codigo invalido. 6 digitos.");

          if (inputCode === userData.code) {
            const guild = client.guilds.cache.get(userData.guildId);
            if (!guild) { verificationCodes.delete(message.author.id); return message.reply(EMOJI.CRUZ + " Servidor no encontrado."); }

            const guildConfig = await loadGuildConfig(guild.id);
            if (!guildConfig?.verification?.enabled) { verificationCodes.delete(message.author.id); return message.reply(EMOJI.CRUZ + " Verificacion no configurada."); }

            const member = await guild.members.fetch(message.author.id);
            const role = guild.roles.cache.get(guildConfig.verification.roleId);
            if (!role) { verificationCodes.delete(message.author.id); return message.reply(EMOJI.CRUZ + " Rol no encontrado."); }

            await member.roles.add(role);
            await saveVerifiedUserSupabase(message.author.id, userData.email, guild.id);
            verificationCodes.delete(message.author.id);

            await message.reply({ embeds: [new EmbedBuilder().setColor("#00FF00").setTitle(EMOJI.CHECK + " Verificacion Completada").setDescription("Felicidades **" + message.author.username + "**! Verificado exitosamente.").setFooter({ text: guild.name }).setTimestamp()] });
            addLog("success", "Usuario verificado: " + message.author.tag + " en " + guild.name);
          } else {
            await message.reply(EMOJI.CRUZ + " Codigo incorrecto.");
          }
        }
      } catch (error) {
        addLog("error", "Error verificacion: " + error.message);
        verificationCodes.delete(message.author.id);
        await message.reply(EMOJI.CRUZ + " Error. Intenta de nuevo.").catch(() => {});
      }
    }
  } catch (e) {
    addLog("error", "Error messageCreate: " + e.message);
  }
});

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
