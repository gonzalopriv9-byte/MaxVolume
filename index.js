require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const express  = require("express");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");
const { loadCommands, registerCommands } = require("./handlers/commandHandler");

// ==================== SUPABASE ====================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ==================== LOGS ====================
const logs     = [];
const MAX_LOGS = 200;

function addLog(type, message) {
  const timestamp = new Date().toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  logs.push({ timestamp, type, message });
  if (logs.length > MAX_LOGS) logs.shift();
  const emoji = { info: "📋", success: "✅", error: "❌", warning: "⚠️" }[type] || "🔔";
  console.log(`${emoji} [${timestamp}] ${message}`);
  supabase.from("bot_logs").insert({ type, message, created_at: new Date().toISOString() }).catch(() => {});
}

// ==================== VARIABLES ====================
const TOKEN    = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
let botEnabled  = !!(TOKEN && CLIENT_ID);
if (!botEnabled) console.warn("⚠️ Faltan DISCORD_TOKEN o CLIENT_ID");

global.maintenanceMode = false;

// ==================== CLIENTE DISCORD ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

client.commands  = new Collection();
client.supabase  = supabase;
client.addLog    = addLog;

if (botEnabled) loadCommands(client);

// ==================== GROQ IA ====================
let groqClient = null;
try {
  const Groq = require("groq-sdk");
  if (process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log("✅ Groq IA inicializada");
  }
} catch (e) { console.warn("⚠️ groq-sdk no disponible:", e.message); }

const aiConversations  = new Map();
const activeAIProcessing = new Map();
const MAX_AI_HISTORY   = 10;

async function askGroq(userId, userMessage, guildName) {
  if (!groqClient) return null;
  if (!aiConversations.has(userId)) aiConversations.set(userId, []);
  const history = aiConversations.get(userId);
  history.push({ role: "user", content: userMessage });
  if (history.length > MAX_AI_HISTORY * 2) history.splice(0, 2);
  const messages = [
    {
      role: "system",
      content: global.botPersonality ||
        `Eres NexaBot, un bot de música de Discord para el servidor "${guildName}". ` +
        `Respondes en español, de forma natural y directa. Máximo 3-4 frases. Puedes hacer bromas ligeras.`
    },
    ...history
  ];
  try {
    const completion = await groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile", messages, max_tokens: 512, temperature: 0.7,
    });
    const reply = completion.choices[0]?.message?.content?.trim() || null;
    if (reply) history.push({ role: "assistant", content: reply });
    return reply;
  } catch (e) {
    addLog("error", "[IA] Error Groq: " + e.message);
    return null;
  }
}

// ==================== READY ====================
client.once("ready", async () => {
  addLog("success", `Bot conectado: ${client.user.tag}`);
  addLog("info",    `Servidores: ${client.guilds.cache.size}`);

  try {
    await registerCommands(client);
    addLog("success", "Comandos registrados correctamente");
  } catch (e) {
    addLog("error", `Error registrando comandos: ${e.message}`);
  }

  client.user.setPresence({
    status: "online",
    activities: [{ name: "🎵 Música 24/7", type: ActivityType.Playing }]
  });
});

client.on("error",   e    => addLog("error",   "Discord error: "   + e.message));
client.on("warn",    info => addLog("warning", "Discord warning: " + info));

// ==================== INTERACTION CREATE ====================
client.on("interactionCreate", async (interaction) => {
  try {

    // ── SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command)
        return interaction.reply({ content: "❌ Comando no reconocido.", flags: 64 });
      try {
        await command.execute(interaction);
        addLog("info", `/${interaction.commandName} por ${interaction.user.tag}`);
      } catch (err) {
        addLog("error", `Error /${interaction.commandName}: ${err.message}`);
        if (!interaction.replied && !interaction.deferred)
          interaction.reply({ content: "❌ Error ejecutando el comando.", flags: 64 }).catch(() => {});
      }
      return;
    }

    // ── BOTONES DE MÚSICA
    if (interaction.isButton() && interaction.customId.startsWith("music_")) {
      const musicaCmd = client.commands.get("musica");
      if (musicaCmd?.handleMusicButton) {
        try { await musicaCmd.handleMusicButton(interaction); }
        catch (e) { addLog("error", "Error botón música: " + e.message); }
      }
      return;
    }

  } catch (error) {
    if (error.code === 10062) { addLog("warning", "Interacción expirada"); return; }
    addLog("error", "Error interacción: " + error.message);
  }
});

// ==================== MENSAJES (IA) ====================
const processedMessages = new Set();

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 30000);

  if (!message.mentions.has(client.user)) return;
  if (activeAIProcessing.has(message.author.id)) return;

  const cleanMsg = message.content.replace(/<@!?[0-9]+>/g, "").trim();
  if (!cleanMsg) {
    await message.reply("🎵 ¡Hola! Soy tu bot de música. Usa `/musica play` para empezar.");
    return;
  }

  activeAIProcessing.set(message.author.id, true);
  let thinkingMsg = null;
  try {
    thinkingMsg = await message.reply({ content: "<a:Loading:1481763726972555324> Pensando...", allowedMentions: { repliedUser: false } });
  } catch {}

  try {
    const reply = await askGroq(message.author.id, cleanMsg, message.guild.name);
    if (thinkingMsg) {
      await thinkingMsg.edit({ content: reply || "❌ No pude responder. Inténtalo de nuevo." });
    }
    if (reply) addLog("info", `[IA] ${message.author.tag}: "${cleanMsg.slice(0, 60)}"`);
  } catch (e) {
    addLog("error", "[IA] Error: " + e.message);
    if (thinkingMsg) await thinkingMsg.edit({ content: "❌ Error procesando tu mensaje." }).catch(() => {});
  } finally {
    activeAIProcessing.delete(message.author.id);
  }
});

// ==================== READLINE (terminal) ====================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", line => {
  const input = line.trim();
  if (input.toLowerCase().startsWith("/changestatus ")) {
    const texto = input.slice(14).trim();
    if (!texto || !client.user) { console.log("❌ Error."); return; }
    client.user.setPresence({ activities: [{ name: texto, type: ActivityType.Playing }], status: "online" });
    console.log(`✅ Estado: "${texto}"`);
  } else if (input.toLowerCase().startsWith("/setpersonality ")) {
    const personality = input.slice(16).trim();
    if (!personality) { console.log("❌ Debes escribir la personalidad."); return; }
    global.botPersonality = personality;
    console.log(`✅ Personalidad: "${personality}"`);
  } else if (input) {
    console.log(`⚠️ Comando no reconocido: ${input}`);
  }
});

// ==================== LOGIN ====================
console.log("Iniciando NexaBot Music...");
if (botEnabled) {
  client.login(TOKEN)
    .then(() => console.log("✅ Bot autenticado"))
    .catch(err => { console.error("❌ ERROR LOGIN:", err.message); process.exit(1); });
} else {
  console.log("⚠️ Bot no iniciado - faltan variables de entorno");
}

// ==================== WEB SERVER ====================
const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => res.send(`
  <h1>🎵 NexaBot Music</h1>
  <p>Status: ${client.isReady() ? "✅ Online" : "❌ Offline"}</p>
  <p>Servidores: ${client.guilds?.cache.size || 0}</p>
  <p>Ping: ${client.ws.ping}ms</p>
`));

app.get("/api/stats", (req, res) => {
  res.json({
    guilds:      client.guilds?.cache.size || 0,
    totalMembers: client.guilds?.cache.reduce((a, g) => a + g.memberCount, 0) || 0,
    uptime:      Math.floor(process.uptime()),
    ping:        client.ws.ping,
    status:      client.isReady() ? "online" : "offline",
  });
});

app.get("/api/logs", (req, res) => {
  const type  = req.query.type;
  const limit = parseInt(req.query.limit) || 100;
  const filtered = type ? logs.filter(l => l.type === type) : logs;
  res.json({ logs: filtered.slice(-limit).reverse() });
});

app.post("/api/status", (req, res) => {
  const { text } = req.body;
  if (!text || !client.user) return res.json({ ok: false });
  client.user.setPresence({ activities: [{ name: text, type: ActivityType.Playing }], status: "online" });
  res.json({ ok: true });
});

app.listen(process.env.PORT || 10000, "0.0.0.0", () => {
  console.log("🌐 Web en puerto " + (process.env.PORT || 10000));
});
