// commands/musica.js
// Búsqueda via Spotify API → reproducción via YouTube (ytdl-core)
// play-dl solo se usa para buscar, ytdl-core para el stream

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
const playdl = require("play-dl");
const ytdl   = require("ytdl-core");
const https  = require("https");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
  LOADING:  "<a:Loading:1481763726972555324>",
};

// ── Spotify: obtener token ───────────────────────────────────────────────────
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

// ── Spotify: buscar canción ──────────────────────────────────────────────────
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
            spotifyUrl:  track.external_urls.spotify,
            thumbnail:   track.album.images?.[0]?.url || null,
            duration:    msToTime(track.duration_ms),
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

// ── YouTube: buscar con play-dl, stream con ytdl-core ───────────────────────
async function getYouTubeStream(searchQuery) {
  const results = await playdl.search(searchQuery, { source: { youtube: "video" }, limit: 1 });
  if (!results || results.length === 0) throw new Error("No se encontró en YouTube.");

  const video  = results[0];
  console.log(`[Musica] YouTube URL: ${video.url}`);

  const stream = ytdl(video.url, {
    filter:         "audioonly",
    quality:        "highestaudio",
    highWaterMark:  1 << 25,
  });

  return {
    stream,
    title:     video.title,
    url:       video.url,
    duration:  video.durationRaw,
    thumbnail: video.thumbnails?.[0]?.url || null,
  };
}

// ── Cola de reproducción ─────────────────────────────────────────────────────
const queues = new Map();

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || q.queue.length === 0) {
    q?.textChannel?.send({ content: "✅ Cola terminada. 👋" }).catch(() => {});
    try { q?.connection?.destroy(); } catch {}
    queues.delete(guildId);
    return;
  }

  const track = q.queue.shift();
  q.current   = track;

  try {
    console.log(`[Musica] Buscando en YouTube: ${track.searchQuery}`);
    const yt = await getYouTubeStream(track.searchQuery);

    const resource = createAudioResource(yt.stream, {
      inputType: StreamType.Arbitrary,
    });

    q.player.play(resource);

    if (!track.thumbnail) track.thumbnail = yt.thumbnail;
    if (!track.duration || track.duration === "?") track.duration = yt.duration;

    q.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#1DB954")
        .setTitle("🎵 Reproduciendo ahora")
        .setDescription(`**[${track.title}](${track.spotifyUrl || yt.url})**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: "⏱️ Duración",   value: track.duration || yt.duration || "?", inline: true },
          { name: "👤 Solicitado", value: track.requestedBy || "-",              inline: true },
          { name: "🎬 Fuente",     value: `[YouTube](${yt.url})`,                inline: true },
        )
        .setFooter({ text: "NexaBot Music • Spotify + YouTube" })
      ]
    }).catch(() => {});

    console.log(`[Musica] ▶️ Reproduciendo: ${track.title}`);

  } catch (e) {
    console.error(`[Musica] Error stream: ${e.message}`);
    q?.textChannel?.send({ content: `${EMOJI.CRUZ} Error reproduciendo **${track.title}**: ${e.message}` }).catch(() => {});
    setTimeout(() => playNext(guildId), 1000);
  }
}

async function addToQueue(guildId, voiceChannel, textChannel, track) {
  let q = queues.get(guildId);

  if (!q) {
    const connection = joinVoiceChannel({
      channelId:      voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:       false,  // NO ensordecerse
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

    player.on(AudioPlayerStatus.Idle,      () => playNext(guildId));
    player.on(AudioPlayerStatus.Playing,   () => console.log("[Musica] ▶️ Playing"));
    player.on(AudioPlayerStatus.Buffering, () => console.log("[Musica] ⏳ Buffering..."));
    player.on("error", err => {
      console.error("[Musica] Player error:", err.message);
      queues.get(guildId)?.textChannel?.send({ content: `${EMOJI.CRUZ} Error de audio: ${err.message}` }).catch(() => {});
      setTimeout(() => playNext(guildId), 1000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting,  5_000),
        ]);
      } catch {
        connection.destroy();
        queues.delete(guildId);
      }
    });

    q = { connection, player, queue: [track], current: null, textChannel, volume: 100 };
    queues.set(guildId, q);
    playNext(guildId);

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

// ── Comando Slash ─────────────────────────────────────────────────────────────
module.exports = {
  setupPlayer: async () => {},

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("Sistema de música (Spotify + YouTube)")
    .addSubcommand(s => s
      .setName("play")
      .setDescription("Reproduce una canción")
      .addStringOption(o => o
        .setName("busqueda")
        .setDescription("Nombre del artista y canción")
        .setRequired(true)
      )
    )
    .addSubcommand(s => s.setName("pause").setDescription("Pausa la reproducción"))
    .addSubcommand(s => s.setName("resume").setDescription("Reanuda la reproducción"))
    .addSubcommand(s => s.setName("skip").setDescription("Salta a la siguiente canción"))
    .addSubcommand(s => s.setName("stop").setDescription("Para la música y vacía la cola"))
    .addSubcommand(s => s.setName("cola").setDescription("Muestra la cola actual"))
    .addSubcommand(s => s
      .setName("volumen")
      .setDescription("Cambia el volumen (1-100)")
      .addIntegerOption(o => o
        .setName("nivel")
        .setDescription("Nivel de volumen")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
      )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "play") {
      const vc = interaction.member?.voice?.channel;
      if (!vc)
        return interaction.reply({ content: `${EMOJI.CRUZ} Debes estar en un canal de voz.`, flags: 64 });

      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        let trackInfo;
        try {
          trackInfo = await searchSpotify(busqueda);
          console.log(`[Musica] Spotify: ${trackInfo.title}`);
        } catch (e) {
          console.warn("[Musica] Spotify falló, búsqueda directa:", e.message);
          trackInfo = {
            searchQuery: busqueda,
            title:       busqueda,
            spotifyUrl:  null,
            thumbnail:   null,
            duration:    "?",
          };
        }

        trackInfo.requestedBy = interaction.user.toString();
        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo);
        await interaction.editReply({
          content: `${EMOJI.CHECK} Buscando **${trackInfo.title}** en YouTube...`
        });

      } catch (e) {
        console.error("[Musica] Error play:", e.message);
        await interaction.editReply({ content: `${EMOJI.CRUZ} Error: ${e.message}` });
      }
      return;
    }

    const q = queues.get(interaction.guildId);
    if (!q)
      return interaction.reply({ content: `${EMOJI.CRUZ} No hay música reproduciéndose.`, flags: 64 });

    if (sub === "pause")  { q.player.pause();   return interaction.reply({ content: "⏸️ Música pausada." }); }
    if (sub === "resume") { q.player.unpause(); return interaction.reply({ content: "▶️ Música reanudada." }); }
    if (sub === "skip")   { q.player.stop();    return interaction.reply({ content: "⏭️ Canción saltada." }); }

    if (sub === "stop") {
      q.queue = [];
      q.player.stop();
      try { q.connection.destroy(); } catch {}
      queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹️ Música detenida y cola vaciada." });
    }

    if (sub === "cola") {
      const lista = [
        q.current
          ? `▶️ **${q.current.title}** - ${q.current.duration || "?"} *(reproduciendo)*`
          : "(nada reproduciendo)",
        ...q.queue.slice(0, 9).map((t, i) => `${i + 1}. **${t.title}** - ${t.duration || "?"}`)
      ].join("\n");

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#1DB954")
          .setTitle("🎵 Cola de reproducción")
          .setDescription(lista || "La cola está vacía.")
          .setFooter({ text: `${q.queue.length + (q.current ? 1 : 0)} canciones en total` })
        ]
      });
    }

    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      q.volume = nivel;
      return interaction.reply({ content: `🔊 Volumen: **${nivel}%** (se aplica en la siguiente canción)` });
    }
  },
};
