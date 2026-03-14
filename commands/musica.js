// commands/musica.js — NexaBot Music Pro
// Spotify search → YouTube stream (yt-dlp 320kbps opus)
// Edge TTS DJ + Fade transitions + Autocola + Progress bar + Control buttons

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType,
} = require("@discordjs/voice");
const playdl    = require("play-dl");
const { spawn } = require("child_process");
const https     = require("https");
const fs        = require("fs");
const path      = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const EDGE_TTS = "/home/pi/.local/bin/edge-tts";
const TMP_DIR  = "/tmp/nexabot_music";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const EMOJI = {
  CHECK: "<a:Tick:1480638398816456848>",
  CRUZ:  "<a:CruzRoja:1480947488960806943>",
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtTime(secs) {
  if (!secs || secs < 0) return "0:00";
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
}

function parseDuration(dur) {
  if (!dur) return 0;
  const p = dur.split(":").map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return 0;
}

function buildBar(elapsed, total, size = 22) {
  if (!total || total <= 0) return `\`[${"▓".repeat(size)}] ---%\``;
  const pct    = Math.min(elapsed / total, 1);
  const filled = Math.round(pct * size);
  return `\`[${"▓".repeat(filled)}${"░".repeat(size - filled)}] ${Math.floor(pct * 100)}%\``;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPOTIFY
// ─────────────────────────────────────────────────────────────────────────────
let spToken = null, spExp = 0;

async function spToken_get() {
  if (spToken && Date.now() < spExp) return spToken;
  const creds = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  return new Promise((resolve, reject) => {
    const body = "grant_type=client_credentials";
    const req  = https.request({
      hostname: "accounts.spotify.com", path: "/api/token", method: "POST",
      headers: {
        "Authorization":  `Basic ${creds}`,
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(d);
          spToken = j.access_token;
          spExp   = Date.now() + (j.expires_in - 60) * 1000;
          resolve(spToken);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

async function spSearch(query) {
  const token = await spToken_get();
  return new Promise((resolve, reject) => {
    https.get({
      hostname: "api.spotify.com",
      path:     `/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      headers:  { Authorization: `Bearer ${token}` },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const t = JSON.parse(d)?.tracks?.items?.[0];
          if (!t) return reject(new Error("No encontrado en Spotify."));
          resolve({
            searchQuery: `${t.artists[0].name} - ${t.name}`,
            title:       `${t.artists[0].name} - ${t.name}`,
            artist:      t.artists[0].name,
            spotifyUrl:  t.external_urls.spotify,
            spotifyId:   t.id,
            thumbnail:   t.album.images?.[0]?.url || null,
            duration:    msToTime(t.duration_ms),
            durationSec: Math.floor(t.duration_ms / 1000),
          });
        } catch (e) { reject(new Error("Error Spotify: " + e.message)); }
      });
    }).on("error", reject);
  });
}

async function spArtistTracks(artist, exclude = new Set()) {
  const token = await spToken_get();
  return new Promise(resolve => {
    https.get({
      hostname: "api.spotify.com",
      path:     `/v1/search?q=artist:${encodeURIComponent(artist)}&type=track&limit=10`,
      headers:  { Authorization: `Bearer ${token}` },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const items = JSON.parse(d)?.tracks?.items || [];
          resolve(items
            .filter(t => !exclude.has(`${t.artists[0].name} - ${t.name}`.toLowerCase()))
            .map(t => ({
              searchQuery: `${t.artists[0].name} - ${t.name}`,
              title:       `${t.artists[0].name} - ${t.name}`,
              artist:      t.artists[0].name,
              spotifyUrl:  t.external_urls.spotify,
              spotifyId:   t.id,
              thumbnail:   t.album.images?.[0]?.url || null,
              duration:    msToTime(t.duration_ms),
              durationSec: Math.floor(t.duration_ms / 1000),
              isAutocola:  true,
            }))
          );
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL
// ─────────────────────────────────────────────────────────────────────────────
async function saveHistory(guildId, userId, track) {
  try {
    await supabase.from("music_history").insert({
      guild_id: guildId, user_id: userId || null,
      title: track.title, artist: track.artist || null,
      spotify_url: track.spotifyUrl || null, spotify_id: track.spotifyId || null,
      played_at: new Date().toISOString(),
    });
  } catch {}
}

async function getHistory(guildId, limit = 10) {
  try {
    const { data } = await supabase.from("music_history").select("*")
      .eq("guild_id", guildId).order("played_at", { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE TTS
// ─────────────────────────────────────────────────────────────────────────────
const DJ_PHRASES = [
  "Y como estamos de fiesta, ahora os dejo con un poco de {artist}",
  "Siguiente en la lista, {artist}! Que lo disfrutéis!",
  "Arriba el volumen, porque viene {artist}!",
  "Os traigo lo mejor de {artist}, a disfrutar!",
  "Sin parar la música, aquí viene {artist}!",
  "Para los amantes del buen gusto, {artist}!",
  "El público ha pedido {artist}, y aquí está!",
  "Preparaos porque viene {artist} con todo!",
];
const AUTOCOLA_PHRASES = [
  "Ya que no hay más peticiones, os sugiero algo basado en vuestro historial",
  "La cola se ha vaciado, pero yo sigo aquí! Os pongo recomendaciones personalizadas",
  "Sin peticiones nuevas, me encargo yo con algo que os va a gustar",
];

const djPhrase      = a  => DJ_PHRASES[Math.floor(Math.random() * DJ_PHRASES.length)].replace("{artist}", a);
const autocolaPhrase = () => AUTOCOLA_PHRASES[Math.floor(Math.random() * AUTOCOLA_PHRASES.length)];

async function generateTTS(text) {
  const out  = path.join(TMP_DIR, `tts_${Date.now()}.mp3`);
  const safe = text.replace(/"/g, "'").replace(/\n/g, " ");
  return new Promise((resolve, reject) => {
    const p = spawn(EDGE_TTS, ["--voice", "es-ES-AlvaroNeural", "--text", safe, "--write-media", out]);
    let err = "";
    p.stderr.on("data", d => err += d.toString());
    p.on("error", e => reject(new Error("edge-tts spawn: " + e.message)));
    p.on("close", code => {
      if (code !== 0) return reject(new Error("edge-tts: " + err.trim().slice(0, 100)));
      resolve(out);
    });
  });
}

function ttsToResource(mp3) {
  const ff = spawn("ffmpeg", [
    "-i", mp3,
    "-af", "volume=1.5",       // TTS un poco más fuerte
    "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", "pipe:1",
  ]);
  return createAudioResource(ff.stdout, { inputType: StreamType.Raw });
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE STREAM — 320kbps opus
// ─────────────────────────────────────────────────────────────────────────────
async function getStream(searchQuery) {
  const results = await playdl.search(searchQuery, { source: { youtube: "video" }, limit: 1 });
  if (!results?.length) throw new Error("No encontrado en YouTube.");
  const video = results[0];
  console.log(`[Music] YouTube: ${video.url}`);

  // yt-dlp: preferir audio opus/webm de alta calidad
  const ytUrl = await new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", [
      "--no-playlist",
      "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
      "--get-url",
      video.url,
    ]);
    let out = "", err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => {
      const url = out.trim().split("\n")[0];
      if (code !== 0 || !url) return reject(new Error("yt-dlp: " + err.trim().slice(0, 100)));
      resolve(url);
    });
  });

  // ffmpeg: decodificar a PCM s16le 48kHz estéreo, calidad máxima
  const ff = spawn("ffmpeg", [
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-i",    ytUrl,
    "-af",   "loudnorm=I=-14:TP=-1:LRA=11",  // normalización loudness
    "-f",    "s16le",
    "-ar",   "48000",
    "-ac",   "2",
    "-b:a",  "320k",
    "-loglevel", "error",
    "pipe:1",
  ]);

  ff.stderr.on("data", d => {
    const msg = d.toString().trim();
    if (!msg.includes("pull function") && !msg.includes("Connection reset")) {
      console.error("[ffmpeg]", msg);
    }
  });
  ff.on("error", e => console.error("[ffmpeg error]", e.message));

  return {
    stream:      ff.stdout,
    ffmpegProc:  ff,
    url:         video.url,
    title:       video.title,
    duration:    video.durationRaw,
    durationSec: parseDuration(video.durationRaw),
    thumbnail:   video.thumbnails?.[0]?.url || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FADE OUT — bajar volumen gradualmente al final de la canción
// ─────────────────────────────────────────────────────────────────────────────
function getFadeOutStream(ytUrl, startSec, durationSec, fadeSec = 4) {
  const fadeStart = Math.max(0, durationSec - fadeSec);
  const ff = spawn("ffmpeg", [
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-ss",   String(startSec),
    "-i",    ytUrl,
    "-t",    String(durationSec - startSec),
    "-af",   `loudnorm=I=-14:TP=-1:LRA=11,afade=t=out:st=${fadeStart}:d=${fadeSec}`,
    "-f",    "s16le", "-ar", "48000", "-ac", "2", "-b:a", "320k",
    "-loglevel", "error",
    "pipe:1",
  ]);
  ff.stderr.on("data", d => {
    const msg = d.toString().trim();
    if (!msg.includes("pull function") && !msg.includes("Connection reset")) console.error("[ffmpeg fade]", msg);
  });
  return ff;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOTONES DE CONTROL
// ─────────────────────────────────────────────────────────────────────────────
function controlRow(paused = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music_skip")    .setLabel("⏭️")                             .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_pause")   .setLabel(paused ? "▶️" : "⏸️")             .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music_stop")    .setLabel("⏹️")                             .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("music_vol_down").setLabel("🔉")                             .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_vol_up")  .setLabel("🔊")                             .setStyle(ButtonStyle.Secondary),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS BAR EMBED (actualiza cada 1s)
// ─────────────────────────────────────────────────────────────────────────────
function startProgress(q, track, ytUrl) {
  stopProgress(q);
  const total = track.durationSec || 0;
  const t0    = Date.now();

  const mkEmbed = (elapsed, paused) => new EmbedBuilder()
    .setColor(track.isAutocola ? "#8B5CF6" : "#1DB954")
    .setTitle((paused ? "⏸️" : "🎵") + "  " + track.title)
    .setURL(track.spotifyUrl || ytUrl || null)
    .setThumbnail(track.thumbnail || null)
    .setDescription(
      buildBar(elapsed, total) + `\n⏱️  \`${fmtTime(elapsed)}\`  /  \`${fmtTime(total)}\``
    )
    .addFields(
      { name: "👤 Pedido por",  value: track.isAutocola ? "🤖 Autocola" : (track.requestedBy || "-"), inline: true },
      { name: "🔊 Volumen",     value: `${q.volume || 100}%`,                                          inline: true },
      { name: "📋 En cola",     value: `${q.queue.length} canciones`,                                  inline: true },
    )
    .setFooter({ text: "NexaBot Music Pro  •  🎚️ 320kbps  •  ⬇️ Skip  ⏸️ Pausa  ⏹️ Stop  🔉🔊 Vol" });

  q.textChannel?.send({ embeds: [mkEmbed(0, false)], components: [controlRow(false)] })
    .then(msg => {
      q.progressMsg = msg;
      q.progressInterval = setInterval(async () => {
        if (!q.progressMsg) return;
        const elapsed = q.progressPaused
          ? (q.pausedAt || 0)
          : Math.floor((Date.now() - t0) / 1000);
        try {
          await msg.edit({
            embeds:     [mkEmbed(elapsed, q.progressPaused)],
            components: [controlRow(q.progressPaused)],
          });
        } catch { clearInterval(q.progressInterval); q.progressInterval = null; }
      }, 1000);
    }).catch(() => {});
}

function stopProgress(q) {
  if (q.progressInterval) { clearInterval(q.progressInterval); q.progressInterval = null; }
  if (q.progressMsg)      { q.progressMsg.delete().catch(() => {}); q.progressMsg = null; }
  q.progressPaused = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOCOLA — 1 canción cada vez
// ─────────────────────────────────────────────────────────────────────────────
async function fillAutocola(guildId, queue) {
  console.log("[Autocola] Buscando siguiente canción...");
  try {
    const history = await getHistory(guildId, 10);
    if (!history.length) return false;

    const artists = [...new Set(history.filter(h => h.artist).map(h => h.artist))];
    if (!artists.length) return false;

    const exclude = new Set(history.map(h => h.title?.toLowerCase()));
    for (const t of queue) exclude.add(t.title?.toLowerCase());

    const artist = artists[Math.floor(Math.random() * Math.min(artists.length, 5))];
    console.log("[Autocola] Artista seleccionado:", artist);

    const tracks = await spArtistTracks(artist, exclude);
    if (!tracks.length) return false;

    const pick = tracks[Math.floor(Math.random() * tracks.length)];
    console.log("[Autocola] Añadiendo:", pick.title);
    queue.push(pick);
    return true;
  } catch (e) {
    console.error("[Autocola] ERROR:", e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLA
// ─────────────────────────────────────────────────────────────────────────────
const queues = new Map();

async function playNext(guildId, client) {
  const q = queues.get(guildId);
  if (!q || q.playingTTS) return;

  console.log(`[Music] playNext — cola: ${q.queue.length}`);

  if (q.queue.length === 0) {
    const filled = await fillAutocola(guildId, q.queue);
    if (!filled || !q.queue.length) {
      stopProgress(q);
      q.textChannel?.send({ content: "✅ Cola terminada. 👋" }).catch(() => {});
      try { q.connection?.destroy(); } catch {}
      queues.delete(guildId);
      return;
    }
    await doTTSAndPlay(q, autocolaPhrase(), guildId, client);
    return;
  }

  const next = q.queue[0];
  if (q.current && next.artist) {
    await doTTSAndPlay(q, djPhrase(next.artist), guildId, client);
    return;
  }

  await playTrack(guildId, client);
}

async function doTTSAndPlay(q, text, guildId, client) {
  console.log(`[DJ] "${text}"`);
  q.playingTTS = true;
  stopProgress(q);

  // Silenciar canal
  const guild    = client.guilds.cache.get(guildId);
  const vcId     = q.connection.joinConfig.channelId;
  const vc       = guild?.channels.cache.get(vcId);
  const muted    = [];
  if (vc && guild?.members.me?.permissions.has("MuteMembers")) {
    for (const [, m] of vc.members) {
      if (m.user.bot || m.voice.serverMute) continue;
      try { await m.voice.setMute(true, "DJ"); muted.push(m.id); } catch {}
    }
  }

  const unmuteAll = async () => {
    for (const id of muted) {
      try {
        const m = guild?.members.cache.get(id);
        if (m?.voice?.channelId) await m.voice.setMute(false, "DJ terminó");
      } catch {}
    }
  };

  try {
    const ttsFile = await generateTTS(text);
    if (!ttsFile) { await unmuteAll(); q.playingTTS = false; await playTrack(guildId, client); return; }

    const resource = ttsToResource(ttsFile);
    q.player.play(resource);

    q.player.once(AudioPlayerStatus.Idle, async () => {
      q.playingTTS = false;
      try { fs.unlinkSync(ttsFile); } catch {}
      await unmuteAll();
      await playTrack(guildId, client);
    });
  } catch (e) {
    console.error("[DJ] Error:", e.message);
    await unmuteAll();
    q.playingTTS = false;
    await playTrack(guildId, client);
  }
}

async function playTrack(guildId, client) {
  const q = queues.get(guildId);
  if (!q || !q.queue.length) {
    if (q) { try { q.connection?.destroy(); } catch {} queues.delete(guildId); }
    return;
  }

  const track = q.queue.shift();
  q.current   = track;
  track._guildId = guildId;

  if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }

  try {
    const yt = await getStream(track.searchQuery);
    if (!track.thumbnail)   track.thumbnail   = yt.thumbnail;
    if (!track.duration || track.duration === "?") track.duration = yt.duration;
    if (!track.durationSec || track.durationSec === 0) track.durationSec = yt.durationSec;

    q.currentYtUrl   = yt.url;
    q.currentFfmpeg  = yt.ffmpegProc;
    q.trackStartTime = Date.now();

    const resource = createAudioResource(yt.stream, { inputType: StreamType.Raw });
    q.player.play(resource);

    await saveHistory(guildId, track.requestedById || null, track);
    startProgress(q, track, yt.url);

    // Safety timeout
    if (track.durationSec > 0) {
      q.safetyTimeout = setTimeout(() => {
        const q2 = queues.get(guildId);
        if (q2 && !q2.playingTTS) {
          console.log("[Music] Safety timeout");
          stopProgress(q2);
          playNext(guildId, client);
        }
      }, (track.durationSec + 25) * 1000);
    }

    console.log(`[Music] ▶️ ${track.title}${track.isAutocola ? " 🤖" : ""}`);

  } catch (e) {
    console.error(`[Music] Error stream: ${e.message}`);
    q.textChannel?.send({ content: `❌ Error con **${track.title}**: ${e.message}` }).catch(() => {});
    setTimeout(() => playTrack(guildId, client), 1500);
  }
}

async function enqueue(guildId, voiceChannel, textChannel, track, client) {
  let q = queues.get(guildId);

  if (!q) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id, guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false, selfMute: false,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      console.log("[Music] Conexión de voz lista ✅");
    } catch (e) {
      connection.destroy();
      throw new Error("No se pudo conectar: " + e.message);
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      const q2 = queues.get(guildId);
      if (!q2) return;
      if (q2.safetyTimeout) { clearTimeout(q2.safetyTimeout); q2.safetyTimeout = null; }
      if (!q2.playingTTS) { stopProgress(q2); playNext(guildId, client); }
    });

    player.on(AudioPlayerStatus.AutoPaused, () => console.log("[Music] AutoPaused — ignorado"));
    player.on(AudioPlayerStatus.Playing,    () => console.log("[Music] ▶️ Playing"));
    player.on(AudioPlayerStatus.Buffering,  () => console.log("[Music] ⏳ Buffering..."));

    player.on("error", err => {
      console.error("[Music] Player error:", err.message);
      const q2 = queues.get(guildId);
      if (q2) { q2.playingTTS = false; stopProgress(q2); if (q2.safetyTimeout) clearTimeout(q2.safetyTimeout); }
      setTimeout(() => playTrack(guildId, client), 1000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting,  5_000),
        ]);
      } catch {
        const q2 = queues.get(guildId);
        if (q2) { stopProgress(q2); if (q2.safetyTimeout) clearTimeout(q2.safetyTimeout); }
        connection.destroy();
        queues.delete(guildId);
      }
    });

    q = {
      connection, player,
      queue: [track], current: null, textChannel,
      playingTTS: false, progressMsg: null, progressInterval: null,
      progressPaused: false, pausedAt: 0,
      safetyTimeout: null, currentFfmpeg: null, currentYtUrl: null,
      volume: 100, trackStartTime: 0,
    };
    queues.set(guildId, q);
    await playTrack(guildId, client);

  } else {
    // Canciones manuales van antes de autocola
    if (!track.isAutocola) {
      const fi = q.queue.findIndex(t => t.isAutocola);
      fi !== -1 ? q.queue.splice(fi, 0, track) : q.queue.push(track);
    } else {
      q.queue.push(track);
    }
    q.textChannel = textChannel;
    const pos = q.queue.indexOf(track) + 1;
    textChannel.send({
      embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle("➕ Añadido a la cola")
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: "⏱️ Duración", value: track.duration || "?", inline: true },
          { name: "📋 Posición", value: `#${pos}`,              inline: true },
        )
        .setFooter({ text: "NexaBot Music Pro" })
      ]
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER DE BOTONES
// ─────────────────────────────────────────────────────────────────────────────
async function handleMusicButton(interaction) {
  const q       = queues.get(interaction.guildId);
  if (!q) return interaction.reply({ content: "❌ No hay música reproduciéndose.", flags: 64 });

  const id      = interaction.customId;
  const isAdmin = interaction.member?.permissions?.has("Administrator");

  if (id === "music_skip") {
    const cur = q.current;
    if (!cur) return interaction.reply({ content: "❌ No hay canción activa.", flags: 64 });
    if (!cur.isAutocola && cur.requestedById && cur.requestedById !== interaction.user.id && !isAdmin)
      return interaction.reply({ content: `❌ Solo <@${cur.requestedById}> o un admin puede saltar esta canción.`, flags: 64 });
    stopProgress(q);
    if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }
    q.player.stop();
    return interaction.reply({ content: `⏭️ Saltada por ${interaction.user}.`, flags: 64 });
  }

  if (id === "music_pause") {
    if (q.progressPaused) {
      q.player.unpause(); q.progressPaused = false;
      return interaction.reply({ content: "▶️ Reanudada.", flags: 64 });
    } else {
      q.player.pause(); q.progressPaused = true;
      q.pausedAt = Math.floor((Date.now() - q.trackStartTime) / 1000);
      return interaction.reply({ content: "⏸️ Pausada.", flags: 64 });
    }
  }

  if (id === "music_stop") {
    if (!isAdmin && q.current?.requestedById !== interaction.user.id)
      return interaction.reply({ content: "❌ Solo un admin puede parar la música.", flags: 64 });
    stopProgress(q);
    if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }
    q.queue = []; q.player.stop();
    try { q.connection.destroy(); } catch {}
    queues.delete(interaction.guildId);
    return interaction.reply({ content: "⏹️ Música detenida.", flags: 64 });
  }

  if (id === "music_vol_up") {
    q.volume = Math.min((q.volume || 100) + 10, 200);
    return interaction.reply({ content: `🔊 Volumen: **${q.volume}%**`, flags: 64 });
  }

  if (id === "music_vol_down") {
    q.volume = Math.max((q.volume || 100) - 10, 10);
    return interaction.reply({ content: `🔉 Volumen: **${q.volume}%**`, flags: 64 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO SLASH
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  setupPlayer: async () => {},
  handleMusicButton,

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("🎵 NexaBot Music Pro")
    .addSubcommand(s => s
      .setName("play").setDescription("Reproduce una canción")
      .addStringOption(o => o.setName("busqueda").setDescription("Artista o canción").setRequired(true))
    )
    .addSubcommand(s => s.setName("pause")   .setDescription("Pausa la reproducción"))
    .addSubcommand(s => s.setName("resume")  .setDescription("Reanuda la reproducción"))
    .addSubcommand(s => s.setName("skip")    .setDescription("Salta la canción actual"))
    .addSubcommand(s => s.setName("stop")    .setDescription("Para la música y vacía la cola"))
    .addSubcommand(s => s.setName("cola")    .setDescription("Muestra la cola actual"))
    .addSubcommand(s => s.setName("historial").setDescription("Últimas canciones reproducidas"))
    .addSubcommand(s => s
      .setName("volumen").setDescription("Cambia el volumen (10-200)")
      .addIntegerOption(o => o.setName("nivel").setDescription("Volumen").setRequired(true).setMinValue(10).setMaxValue(200))
    ),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const client = interaction.client;

    if (sub === "play") {
      const vc = interaction.member?.voice?.channel;
      if (!vc) return interaction.reply({ content: "❌ Debes estar en un canal de voz.", flags: 64 });
      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        let track;
        try {
          track = await spSearch(busqueda);
        } catch {
          track = {
            searchQuery: busqueda, title: busqueda,
            artist: busqueda.split("-")[0]?.trim() || busqueda,
            spotifyUrl: null, spotifyId: null, thumbnail: null,
            duration: "?", durationSec: 0,
          };
        }
        track.requestedBy   = interaction.user.toString();
        track.requestedById = interaction.user.id;

        // Evitar duplicados
        const q = queues.get(interaction.guildId);
        if (q) {
          const norm = track.title.toLowerCase();
          if (q.queue.some(t => t.title.toLowerCase() === norm) || q.current?.title?.toLowerCase() === norm)
            return interaction.editReply({ content: `⚠️ **${track.title}** ya está en la cola.` });
        }

        await enqueue(interaction.guildId, vc, interaction.channel, track, client);
        await interaction.editReply({ content: `${EMOJI.CHECK} Buscando **${track.title}**...` });

      } catch (e) {
        console.error("[Music] Error play:", e.message);
        await interaction.editReply({ content: `❌ Error: ${e.message}` });
      }
      return;
    }

    if (sub === "historial") {
      const hist = await getHistory(interaction.guildId, 10);
      if (!hist.length) return interaction.reply({ content: "📭 No hay historial aún.", flags: 64 });
      const lista = hist.map((h, i) =>
        `${i + 1}. **${h.title}** — <t:${Math.floor(new Date(h.played_at).getTime() / 1000)}:R>`
      ).join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor("#1DB954").setTitle("📜 Historial").setDescription(lista)
          .setFooter({ text: "NexaBot Music Pro • Últimas 10" })]
      });
    }

    const q = queues.get(interaction.guildId);
    if (!q) return interaction.reply({ content: "❌ No hay música reproduciéndose.", flags: 64 });

    if (sub === "pause")  { q.player.pause();   q.progressPaused = true;  return interaction.reply({ content: "⏸️ Pausada." }); }
    if (sub === "resume") { q.player.unpause(); q.progressPaused = false; return interaction.reply({ content: "▶️ Reanudada." }); }

    if (sub === "skip") {
      const isAdmin = interaction.member?.permissions?.has("Administrator");
      const cur     = q.current;
      if (!cur) return interaction.reply({ content: "❌ No hay canción activa.", flags: 64 });
      if (!cur.isAutocola && cur.requestedById && cur.requestedById !== interaction.user.id && !isAdmin)
        return interaction.reply({ content: `❌ Solo <@${cur.requestedById}> puede saltar esta canción.`, flags: 64 });
      stopProgress(q);
      if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }
      q.player.stop();
      return interaction.reply({ content: "⏭️ Canción saltada." });
    }

    if (sub === "stop") {
      const isAdmin = interaction.member?.permissions?.has("Administrator");
      if (!isAdmin && q.current?.requestedById !== interaction.user.id)
        return interaction.reply({ content: "❌ Solo un admin puede parar la música.", flags: 64 });
      stopProgress(q);
      if (q.safetyTimeout) { clearTimeout(q.safetyTimeout); q.safetyTimeout = null; }
      q.queue = []; q.player.stop();
      try { q.connection.destroy(); } catch {}
      queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹️ Música detenida." });
    }

    if (sub === "cola") {
      const acCount = q.queue.filter(t => t.isAutocola).length;
      const lista = [
        q.current
          ? `▶️ **${q.current.title}** \`${q.current.duration || "?"}\` — ${q.current.isAutocola ? "🤖" : (q.current.requestedBy || "-")}`
          : "(ninguna reproduciéndose)",
        ...q.queue.slice(0, 10).map((t, i) =>
          `${i + 1}. **${t.title}** \`${t.duration || "?"}\`${t.isAutocola ? " 🤖" : ` — ${t.requestedBy || "-"}`}`
        )
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#1DB954").setTitle("🎵 Cola de reproducción").setDescription(lista || "Vacía.")
          .addFields(
            { name: "📋 Total",    value: `${q.queue.length + (q.current ? 1 : 0)}`, inline: true },
            { name: "🤖 Autocola", value: `${acCount}`,                               inline: true },
            { name: "🔊 Volumen",  value: `${q.volume || 100}%`,                      inline: true },
          )
          .setFooter({ text: "🤖 = autocola  •  NexaBot Music Pro" })
        ]
      });
    }

    if (sub === "volumen") {
      q.volume = interaction.options.getInteger("nivel");
      return interaction.reply({ content: `🔊 Volumen: **${q.volume}%** (próxima canción)` });
    }
  },
};
