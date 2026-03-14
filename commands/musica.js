// commands/musica.js
// Spotify + YouTube (yt-dlp) + Edge TTS DJ + Autocola + Barra de progreso

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");
const playdl   = require("play-dl");
const { spawn } = require("child_process");
const https    = require("https");
const fs       = require("fs");
const path     = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
  LOADING:  "<a:Loading:1481763726972555324>",
};

const TMP_DIR = "/tmp/nexabot_tts";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// BARRA DE PROGRESO
// ─────────────────────────────────────────────────────────────────────────────
function buildProgressBar(elapsed, total, size = 20) {
  if (!total || total <= 0) return "▓".repeat(size);
  const pct    = Math.min(elapsed / total, 1);
  const filled = Math.round(pct * size);
  const bar    = "▓".repeat(filled) + "░".repeat(size - filled);
  return `\`[${bar}] ${Math.floor(pct * 100)}%\``;
}

function fmtTime(secs) {
  if (!secs || secs < 0) return "0:00";
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
}

function parseDuration(dur) {
  if (!dur) return 0;
  const parts = dur.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPOTIFY
// ─────────────────────────────────────────────────────────────────────────────
let spotifyToken    = null;
let spotifyTokenExp = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;
  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");
  return new Promise((resolve, reject) => {
    const body = "grant_type=client_credentials";
    const req  = https.request({
      hostname: "accounts.spotify.com",
      path:     "/api/token",
      method:   "POST",
      headers:  {
        "Authorization":  `Basic ${creds}`,
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const json      = JSON.parse(data);
          spotifyToken    = json.access_token;
          spotifyTokenExp = Date.now() + (json.expires_in - 60) * 1000;
          resolve(spotifyToken);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function searchSpotify(query) {
  const token = await getSpotifyToken();
  return new Promise((resolve, reject) => {
    https.get({
      hostname: "api.spotify.com",
      path:     `/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      headers:  { Authorization: `Bearer ${token}` },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const track = JSON.parse(data)?.tracks?.items?.[0];
          if (!track) return reject(new Error("No encontrado en Spotify."));
          resolve({
            searchQuery: `${track.artists[0].name} - ${track.name}`,
            title:       `${track.artists[0].name} - ${track.name}`,
            artist:      track.artists[0].name,
            spotifyUrl:  track.external_urls.spotify,
            spotifyId:   track.id,
            thumbnail:   track.album.images?.[0]?.url || null,
            duration:    msToTime(track.duration_ms),
            durationSec: Math.floor(track.duration_ms / 1000),
          });
        } catch (e) { reject(new Error("Error Spotify: " + e.message)); }
      });
    }).on("error", reject);
  });
}

function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL SUPABASE
// ─────────────────────────────────────────────────────────────────────────────
async function saveToHistory(guildId, userId, track) {
  try {
    await supabase.from("music_history").insert({
      guild_id:    guildId,
      user_id:     userId || null,
      title:       track.title,
      artist:      track.artist || null,
      spotify_url: track.spotifyUrl || null,
      spotify_id:  track.spotifyId || null,
      played_at:   new Date().toISOString(),
    });
  } catch (e) { console.error("[Musica] Error historial:", e.message); }
}

async function getRecentHistory(guildId, limit = 10) {
  try {
    const { data } = await supabase
      .from("music_history")
      .select("*")
      .eq("guild_id", guildId)
      .order("played_at", { ascending: false })
      .limit(limit);
    return data || [];
  } catch (e) { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// gTTS
// ─────────────────────────────────────────────────────────────────────────────
const DJ_PHRASES = [
  "Y como estamos de fiesta, ahora os dejo con un poco de {artist}",
  "Siguiente en la lista, {artist}! Que lo disfrutéis!",
  "Arriba el volumen, porque viene {artist}!",
  "Os traigo lo mejor de {artist}, a disfrutar!",
  "Y sin parar la música, aquí viene {artist}!",
  "Para los amantes del buen gusto, {artist}!",
];
const AUTOCOLA_PHRASES = [
  "Ya que no hay más peticiones, os sugiero algunas cosas basadas en vuestras últimas peticiones",
  "La cola se ha vaciado, pero yo sigo aquí! Os pongo algo basado en lo que habéis estado escuchando",
  "Sin peticiones nuevas, me encargo yo! Os traigo recomendaciones personalizadas",
];

const getDJPhrase      = a  => DJ_PHRASES[Math.floor(Math.random() * DJ_PHRASES.length)].replace("{artist}", a);
const getAutocolaPhrase = () => AUTOCOLA_PHRASES[Math.floor(Math.random() * AUTOCOLA_PHRASES.length)];

async function generateTTS(text) {
  const outFile  = path.join(TMP_DIR, `tts_${Date.now()}.mp3`);
  const safeText = text.replace(/"/g, "'").replace(/\n/g, " ");
  return new Promise((resolve, reject) => {
    const tts = spawn("edge-tts", [
      "--voice", "es-ES-AlvaroNeural",
      "--text",  safeText,
      "--write-media", outFile,
    ]);
    let err = "";
    tts.stderr.on("data", d => err += d.toString());
    tts.on("close", code => {
      if (code !== 0) return reject(new Error("edge-tts: " + err.trim().slice(0, 100)));
      resolve(outFile);
    });
  });
}

function createTTSResource(mp3File) {
  const ff = spawn("ffmpeg", [
    "-i", mp3File, "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", "pipe:1",
  ]);
  ff.stderr.on("data", d => console.error("[ffmpeg tts]", d.toString().trim()));
  return createAudioResource(ff.stdout, { inputType: StreamType.Raw });
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE STREAM (yt-dlp + ffmpeg)
// ─────────────────────────────────────────────────────────────────────────────
async function getYouTubeStream(searchQuery) {
  const results = await playdl.search(searchQuery, { source: { youtube: "video" }, limit: 1 });
  if (!results || results.length === 0) throw new Error("No encontrado en YouTube.");
  const video = results[0];
  console.log(`[Musica] YouTube: ${video.url}`);

  const ytUrl = await new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", ["--no-playlist", "-f", "bestaudio", "--get-url", video.url]);
    let out = "", err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => {
      const url = out.trim().split("\n")[0];
      if (code !== 0 || !url) return reject(new Error("yt-dlp: " + err.trim().slice(0, 100)));
      resolve(url);
    });
  });

  const ff = spawn("ffmpeg", [
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-i", ytUrl, "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", "pipe:1",
  ]);
  ff.stderr.on("data", d => {
    const msg = d.toString().trim();
    if (!msg.includes("Error in the pull function") && !msg.includes("Connection reset")) {
      console.error("[ffmpeg]", msg);
    }
  });
  ff.on("error", e => console.error("[ffmpeg error]", e.message));

  return {
    stream:      ff.stdout,
    ffmpegProc:  ff,
    title:       video.title,
    url:         video.url,
    duration:    video.durationRaw,
    durationSec: parseDuration(video.durationRaw),
    thumbnail:   video.thumbnails?.[0]?.url || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOCOLA — busca canciones del mismo artista en Spotify
// ─────────────────────────────────────────────────────────────────────────────
async function fillAutocola(guildId, queue) {
  console.log("[Autocola] Buscando recomendaciones para guild:", guildId);
  try {
    const history = await getRecentHistory(guildId, 10);
    console.log("[Autocola] Historial:", history.length, "entradas");
    if (history.length === 0) return false;

    const artists = [...new Set(history.filter(h => h.artist).map(h => h.artist))];
    console.log("[Autocola] Artistas:", artists);
    if (artists.length === 0) return false;

    const recentTitles = new Set(history.map(h => h.title.toLowerCase()));
    const recs = [];

    for (const artist of artists.slice(0, 3)) {
      try {
        const token  = await getSpotifyToken();
        const tracks = await new Promise((resolve) => {
          https.get({
            hostname: "api.spotify.com",
            path:     `/v1/search?q=artist:${encodeURIComponent(artist)}&type=track&limit=5`,
            headers:  { Authorization: `Bearer ${token}` },
          }, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
              try {
                const items = JSON.parse(data)?.tracks?.items || [];
                resolve(items.map(t => ({
                  searchQuery: `${t.artists[0].name} - ${t.name}`,
                  title:       `${t.artists[0].name} - ${t.name}`,
                  artist:      t.artists[0].name,
                  spotifyUrl:  t.external_urls.spotify,
                  spotifyId:   t.id,
                  thumbnail:   t.album.images?.[0]?.url || null,
                  duration:    msToTime(t.duration_ms),
                  durationSec: Math.floor(t.duration_ms / 1000),
                  isAutocola:  true,
                })));
              } catch { resolve([]); }
            });
          }).on("error", () => resolve([]));
        });
        recs.push(...tracks.filter(t => !recentTitles.has(t.title.toLowerCase())));
      } catch (e) { console.error("[Autocola] Error artista:", e.message); }
    }

    const shuffled = recs.sort(() => Math.random() - 0.5).slice(0, 5);
    console.log("[Autocola] Canciones añadidas:", shuffled.length);
    if (shuffled.length === 0) return false;
    queue.push(...shuffled);
    return true;
  } catch (e) {
    console.error("[Autocola] ERROR:", e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BARRA DE PROGRESO
// ─────────────────────────────────────────────────────────────────────────────
function startProgressBar(q, track, ytUrl) {
  stopProgressBar(q);
  const totalSec  = track.durationSec || 0;
  const startTime = Date.now();

  const buildEmbed = elapsed => new EmbedBuilder()
    .setColor(track.isAutocola ? "#8B5CF6" : "#1DB954")
    .setTitle("🎵 " + track.title)
    .setURL(track.spotifyUrl || ytUrl || null)
    .setThumbnail(track.thumbnail || null)
    .setDescription(
      buildProgressBar(elapsed, totalSec) + "\n" +
      `⏱️ \`${fmtTime(elapsed)}\` / \`${fmtTime(totalSec)}\``
    )
    .addFields(
      { name: "👤 Solicitado", value: track.isAutocola ? "🤖 Autocola" : (track.requestedBy || "-"), inline: true },
      { name: "🎬 Fuente",    value: ytUrl ? `[YouTube](${ytUrl})` : "-", inline: true },
    )
    .setFooter({ text: "NexaBot Music" });

  q.textChannel?.send({ embeds: [buildEmbed(0)] })
    .then(msg => {
      q.progressMsg = msg;
      q.progressInterval = setInterval(async () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        try { await msg.edit({ embeds: [buildEmbed(elapsed)] }); }
        catch { clearInterval(q.progressInterval); q.progressInterval = null; }
      }, 2000);
    })
    .catch(() => {});
}

function stopProgressBar(q) {
  if (q.progressInterval) { clearInterval(q.progressInterval); q.progressInterval = null; }
  if (q.progressMsg)      { q.progressMsg.delete().catch(() => {}); q.progressMsg = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLA DE REPRODUCCIÓN
// ─────────────────────────────────────────────────────────────────────────────
const queues = new Map();

async function playNext(guildId, client) {
  const q = queues.get(guildId);
  if (!q || q.playingTTS) return;

  console.log(`[Musica] playNext — cola: ${q.queue.length} canciones`);

  if (q.queue.length === 0) {
    const filled = await fillAutocola(guildId, q.queue);
    if (!filled || q.queue.length === 0) {
      stopProgressBar(q);
      q.textChannel?.send({ content: "✅ Cola terminada. 👋" }).catch(() => {});
      try { q.connection?.destroy(); } catch {}
      queues.delete(guildId);
      return;
    }
    await playTTSAndThen(q, getAutocolaPhrase(), guildId, client);
    return;
  }

  const next = q.queue[0];
  if (q.current && next.artist) {
    await playTTSAndThen(q, getDJPhrase(next.artist), guildId, client);
    return;
  }

  await startTrack(guildId, client);
}

async function playTTSAndThen(q, text, guildId, client) {
  console.log(`[DJ] TTS: "${text}"`);
  q.playingTTS = true;
  stopProgressBar(q);
  try {
    const ttsFile = await generateTTS(text);
    if (!ttsFile) { q.playingTTS = false; await startTrack(guildId, client); return; }

    const resource = createTTSResource(ttsFile);
    q.player.play(resource);

    q.player.once(AudioPlayerStatus.Idle, async () => {
      q.playingTTS = false;
      try { fs.unlinkSync(ttsFile); } catch {}
      await startTrack(guildId, client);
    });
  } catch (e) {
    console.error("[DJ] Error TTS:", e.message);
    q.playingTTS = false;
    await startTrack(guildId, client);
  }
}

async function startTrack(guildId, client) {
  const q = queues.get(guildId);
  if (!q || q.queue.length === 0) {
    if (q) { try { q.connection?.destroy(); } catch {} queues.delete(guildId); }
    return;
  }

  const track = q.queue.shift();
  q.current   = track;

  if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }

  try {
    const yt = await getYouTubeStream(track.searchQuery);
    if (!track.thumbnail)                         track.thumbnail  = yt.thumbnail;
    if (!track.duration   || track.duration   === "?") track.duration   = yt.duration;
    if (!track.durationSec || track.durationSec === 0)  track.durationSec = yt.durationSec;

    const resource = createAudioResource(yt.stream, { inputType: StreamType.Raw });
    q.player.play(resource);
    q.currentFfmpeg = yt.ffmpegProc;

    await saveToHistory(guildId, track.requestedById || null, track);
    startProgressBar(q, track, yt.url);

    if (track.durationSec > 0) {
      q.safetyTimeout = setTimeout(() => {
        console.log("[Musica] Safety timeout — forzando siguiente");
        const q2 = queues.get(guildId);
        if (q2 && !q2.playingTTS) { stopProgressBar(q2); playNext(guildId, client); }
      }, (track.durationSec + 20) * 1000);
    }

    console.log(`[Musica] ▶️ ${track.title}${track.isAutocola ? " (autocola)" : ""}`);

  } catch (e) {
    console.error(`[Musica] Error stream: ${e.message}`);
    q.textChannel?.send({ content: `${EMOJI.CRUZ} Error reproduciendo **${track.title}**: ${e.message}` }).catch(() => {});
    setTimeout(() => startTrack(guildId, client), 1500);
  }
}

async function addToQueue(guildId, voiceChannel, textChannel, track, client) {
  let q = queues.get(guildId);

  if (!q) {
    const connection = joinVoiceChannel({
      channelId:      voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:       false,
      selfMute:       false,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      console.log("[Musica] Conexión de voz lista ✅");
    } catch (e) {
      connection.destroy();
      throw new Error("No se pudo conectar al canal de voz: " + e.message);
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      const q2 = queues.get(guildId);
      if (!q2) return;
      if (q2.safetyTimeout) { clearTimeout(q2.safetyTimeout); q2.safetyTimeout = null; }
      if (!q2.playingTTS) { console.log("[Musica] Idle → playNext"); stopProgressBar(q2); playNext(guildId, client); }
    });

    player.on(AudioPlayerStatus.AutoPaused, () => {
      console.log("[Musica] AutoPaused → playNext");
      const q2 = queues.get(guildId);
      if (q2 && !q2.playingTTS) { stopProgressBar(q2); playNext(guildId, client); }
    });

    player.on(AudioPlayerStatus.Playing,   () => console.log("[Musica] ▶️ Playing"));
    player.on(AudioPlayerStatus.Buffering, () => console.log("[Musica] ⏳ Buffering..."));
    player.on("error", err => {
      console.error("[Musica] Player error:", err.message);
      const q2 = queues.get(guildId);
      if (q2) { q2.playingTTS = false; stopProgressBar(q2); if (q2.safetyTimeout) clearTimeout(q2.safetyTimeout); }
      setTimeout(() => startTrack(guildId, client), 1000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting,  5_000),
        ]);
      } catch {
        const q2 = queues.get(guildId);
        if (q2) { stopProgressBar(q2); if (q2.safetyTimeout) clearTimeout(q2.safetyTimeout); }
        connection.destroy();
        queues.delete(guildId);
      }
    });

    q = {
      connection, player,
      queue: [track], current: null,
      textChannel,
      playingTTS:       false,
      progressMsg:      null,
      progressInterval: null,
      safetyTimeout:    null,
      currentFfmpeg:    null,
    };
    queues.set(guildId, q);
    await startTrack(guildId, client);

  } else {
    q.queue.push(track);
    q.textChannel = textChannel;
    textChannel.send({
      embeds: [new EmbedBuilder()
        .setColor("#1DB954")
        .setTitle("➕ Añadido a la cola")
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: "⏱️ Duración", value: track.duration || "?", inline: true },
          { name: "📋 Posición", value: `#${q.queue.length}`,  inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
      ]
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO SLASH
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  setupPlayer: async () => {},

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("Sistema de música (Spotify + YouTube + Autocola + DJ)")
    .addSubcommand(s => s
      .setName("play")
      .setDescription("Reproduce una canción")
      .addStringOption(o => o.setName("busqueda").setDescription("Nombre del artista y canción").setRequired(true))
    )
    .addSubcommand(s => s.setName("pause").setDescription("Pausa la reproducción"))
    .addSubcommand(s => s.setName("resume").setDescription("Reanuda la reproducción"))
    .addSubcommand(s => s.setName("skip").setDescription("Salta la canción actual (solo quien la pidió)"))
    .addSubcommand(s => s.setName("stop").setDescription("Para la música y vacía la cola"))
    .addSubcommand(s => s.setName("cola").setDescription("Muestra la cola actual"))
    .addSubcommand(s => s.setName("historial").setDescription("Muestra las últimas canciones reproducidas"))
    .addSubcommand(s => s
      .setName("volumen")
      .setDescription("Cambia el volumen (1-100)")
      .addIntegerOption(o => o.setName("nivel").setDescription("Nivel de volumen").setRequired(true).setMinValue(1).setMaxValue(100))
    ),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const client = interaction.client;

    // ── PLAY ──
    if (sub === "play") {
      const vc = interaction.member?.voice?.channel;
      if (!vc) return interaction.reply({ content: `${EMOJI.CRUZ} Debes estar en un canal de voz.`, flags: 64 });

      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        let trackInfo;
        try {
          trackInfo = await searchSpotify(busqueda);
          console.log(`[Musica] Spotify: ${trackInfo.title}`);
        } catch (e) {
          console.warn("[Musica] Spotify falló:", e.message);
          trackInfo = {
            searchQuery: busqueda, title: busqueda,
            artist: busqueda.split("-")[0]?.trim() || busqueda,
            spotifyUrl: null, spotifyId: null, thumbnail: null,
            duration: "?", durationSec: 0,
          };
        }

        trackInfo.requestedBy   = interaction.user.toString();
        trackInfo.requestedById = interaction.user.id;

        const q = queues.get(interaction.guildId);

        // ── Evitar duplicados en cola
        if (q) {
          const titleNorm = trackInfo.title.toLowerCase();
          const yaEnCola  = q.queue.some(t => t.title.toLowerCase() === titleNorm);
          const esActual  = q.current?.title?.toLowerCase() === titleNorm;
          if (yaEnCola || esActual) {
            return interaction.editReply({
              content: `${EMOJI.ADVERTENCIA || "⚠️"} **${trackInfo.title}** ya está en la cola.`
            });
          }
        }

        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo, client);
        await interaction.editReply({ content: `${EMOJI.CHECK} Buscando **${trackInfo.title}** en YouTube...` });

      } catch (e) {
        console.error("[Musica] Error play:", e.message);
        await interaction.editReply({ content: `${EMOJI.CRUZ} Error: ${e.message}` });
      }
      return;
    }

    // ── HISTORIAL ──
    if (sub === "historial") {
      const history = await getRecentHistory(interaction.guildId, 10);
      if (history.length === 0) return interaction.reply({ content: "📭 No hay historial aún.", flags: 64 });
      const lista = history.map((h, i) =>
        `${i + 1}. **${h.title}** — <t:${Math.floor(new Date(h.played_at).getTime() / 1000)}:R>`
      ).join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#1DB954").setTitle("📜 Historial")
          .setDescription(lista)
          .setFooter({ text: "NexaBot Music • Últimas 10 canciones" })
        ]
      });
    }

    // ── Resto requiere cola activa ──
    const q = queues.get(interaction.guildId);
    if (!q) return interaction.reply({ content: `${EMOJI.CRUZ} No hay música reproduciéndose.`, flags: 64 });

    if (sub === "pause")  { q.player.pause();   return interaction.reply({ content: "⏸️ Música pausada." }); }
    if (sub === "resume") { q.player.unpause(); return interaction.reply({ content: "▶️ Música reanudada." }); }

    // ── SKIP — solo quien pidió la canción (o admin) ──
    if (sub === "skip") {
      const current = q.current;
      const isAdmin = interaction.member?.permissions?.has("Administrator");

      if (!current) {
        return interaction.reply({ content: `${EMOJI.CRUZ} No hay canción reproduciéndose.`, flags: 64 });
      }

      // Las canciones de autocola las puede saltar cualquiera
      if (!current.isAutocola && current.requestedById && current.requestedById !== interaction.user.id && !isAdmin) {
        return interaction.reply({
          content: `${EMOJI.CRUZ} Solo <@${current.requestedById}> o un administrador puede saltar esta canción.`,
          flags: 64,
        });
      }

      stopProgressBar(q);
      if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }
      q.player.stop();
      return interaction.reply({ content: `⏭️ Canción saltada por ${interaction.user}.` });
    }

    // ── STOP ──
    if (sub === "stop") {
      const isAdmin = interaction.member?.permissions?.has("Administrator");
      if (!isAdmin && q.current?.requestedById !== interaction.user.id) {
        return interaction.reply({ content: `${EMOJI.CRUZ} Solo un administrador puede parar la música.`, flags: 64 });
      }
      stopProgressBar(q);
      if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }
      q.queue = [];
      q.player.stop();
      try { q.connection.destroy(); } catch {}
      queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹️ Música detenida y cola vaciada." });
    }

    // ── COLA ──
    if (sub === "cola") {
      const autocolaCount = q.queue.filter(t => t.isAutocola).length;
      const lista = [
        q.current
          ? `▶️ **${q.current.title}** - ${q.current.duration || "?"} *(reproduciendo)* — ${q.current.isAutocola ? "🤖 Autocola" : (q.current.requestedBy || "-")}`
          : "(nada)",
        ...q.queue.slice(0, 9).map((t, i) =>
          `${i + 1}. **${t.title}** - ${t.duration || "?"}${t.isAutocola ? " 🤖" : ` — ${t.requestedBy || "-"}`}`
        )
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#1DB954").setTitle("🎵 Cola de reproducción")
          .setDescription(lista || "Vacía.")
          .addFields(
            { name: "📋 Total",    value: `${q.queue.length + (q.current ? 1 : 0)}`, inline: true },
            { name: "🤖 Autocola", value: `${autocolaCount}`, inline: true },
          )
          .setFooter({ text: "🤖 = sugerencia automática" })
        ]
      });
    }

    // ── VOLUMEN ──
    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      q.volume = nivel;
      return interaction.reply({ content: `🔊 Volumen: **${nivel}%** (próxima canción)` });
    }
  },
};
