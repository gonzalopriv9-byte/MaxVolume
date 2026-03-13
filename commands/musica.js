// commands/musica.js
// Fuente: Deezer API (gratuita, sin autenticacion, MP3 directo 30s)
// Fix: URL de preview se obtiene justo antes de hacer stream para evitar expiración del token

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
const { spawn } = require("child_process");
const https = require("https");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
  LOADING:  "<a:Loading:1481763726972555324>",
};

// ── Busca en Deezer, guarda el ID del track (no la URL que expira) ──────────
function searchDeezer(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`;
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json  = JSON.parse(data);
          const track = json?.data?.[0];
          if (!track || !track.preview)
            return reject(new Error("No se encontró ningún resultado en Deezer."));
          resolve({
            title:     `${track.artist.name} - ${track.title}`,
            url:       track.link,
            trackId:   track.id,          // guardamos el ID, no la URL con token
            preview:   track.preview,     // URL fresca al buscar
            duration:  "0:30",
            thumbnail: track.album?.cover_medium || null,
          });
        } catch (e) {
          reject(new Error("Error parseando respuesta de Deezer."));
        }
      });
    }).on("error", reject);
  });
}

// ── Obtiene una URL de preview fresca justo antes de reproducir ──────────────
function getFreshPreviewUrl(trackId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.deezer.com/track/${trackId}`;
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (!json?.preview) return reject(new Error("Sin preview disponible"));
          resolve(json.preview);
        } catch (e) {
          reject(new Error("Error obteniendo preview fresco"));
        }
      });
    }).on("error", reject);
  });
}

// ── Stream ffmpeg con la URL fresca ─────────────────────────────────────────
function createFfmpegStream(mp3Url, volume = 80) {
  const ffmpeg = spawn("ffmpeg", [
    "-reconnect",       "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-user_agent",      "Mozilla/5.0",
    "-i",               mp3Url,
    "-f",               "s16le",
    "-ar",              "48000",
    "-ac",              "2",
    "-af",              `volume=${volume / 100}`,
    "-loglevel",        "error",
    "pipe:1",
  ]);

  ffmpeg.stderr.on("data", d => console.error("[ffmpeg]", d.toString().trim()));
  ffmpeg.on("error", e => console.error("[ffmpeg error]", e.message));

  return ffmpeg.stdout;
}

// ── Cola de reproducción ─────────────────────────────────────────────────────
const queues = new Map();

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || q.queue.length === 0) {
    q?.textChannel?.send({ content: "✅ Cola terminada. 👋" }).catch(() => {});
    q?.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  const track = q.queue.shift();
  q.current   = track;

  try {
    // Obtener URL fresca justo ahora (el token de Deezer expira rápido)
    console.log(`[Musica] Obteniendo URL fresca para: ${track.title}`);
    const freshUrl = await getFreshPreviewUrl(track.trackId).catch(() => track.preview);

    console.log(`[Musica] Iniciando stream: ${freshUrl.slice(0, 60)}...`);
    const audioStream = createFfmpegStream(freshUrl, q.volume || 80);

    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Raw,
    });

    q.player.play(resource);

    q.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#A238FF")
        .setTitle("🎵 Reproduciendo ahora")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: "Duración",   value: "0:30 (preview)", inline: true },
          { name: "Solicitado", value: track.requestedBy || "-",       inline: true },
        )
        .setFooter({ text: "NexaBot Music • Deezer" })
      ]
    }).catch(() => {});

  } catch (e) {
    console.error(`[Musica] Error stream: ${e.message}`);
    q?.textChannel?.send({ content: `${EMOJI.CRUZ} Error reproduciendo: ${e.message}` }).catch(() => {});
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
      selfDeaf:       false,
      selfMute:       false,
    });

    // Esperar a que la conexión esté lista antes de reproducir
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      console.log("[Musica] Conexión de voz lista");
    } catch (e) {
      console.error("[Musica] No se pudo conectar al canal de voz:", e.message);
      connection.destroy();
      throw new Error("No se pudo conectar al canal de voz.");
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      console.log("[Musica] Player idle, reproduciendo siguiente...");
      playNext(guildId);
    });

    player.on("error", err => {
      console.error("[Musica] Player error:", err.message);
      queues.get(guildId)?.textChannel?.send({ content: `${EMOJI.CRUZ} Error de audio: ${err.message}` }).catch(() => {});
      setTimeout(() => playNext(guildId), 1000);
    });

    player.on(AudioPlayerStatus.Playing, () => console.log("[Musica] Estado: Playing ✅"));
    player.on(AudioPlayerStatus.Buffering, () => console.log("[Musica] Estado: Buffering..."));

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

    q = { connection, player, queue: [track], current: null, textChannel, volume: 80 };
    queues.set(guildId, q);
    playNext(guildId);

  } else {
    q.queue.push(track);
    q.textChannel = textChannel;
    textChannel.send({
      embeds: [new EmbedBuilder()
        .setColor("#A238FF")
        .setTitle("➕ Añadido a la cola")
        .setDescription(`**${track.title}**`)
        .setFooter({ text: `Posición en cola: ${q.queue.length}` })
      ]
    }).catch(() => {});
  }
}

// ── Comando Slash ─────────────────────────────────────────────────────────────
module.exports = {
  setupPlayer: async () => {},

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("Sistema de musica (previews 30s via Deezer)")
    .addSubcommand(s => s
      .setName("play")
      .setDescription("Reproduce una cancion")
      .addStringOption(o => o
        .setName("busqueda")
        .setDescription("Nombre del artista y cancion")
        .setRequired(true)
      )
    )
    .addSubcommand(s => s.setName("pause").setDescription("Pausa la reproduccion"))
    .addSubcommand(s => s.setName("resume").setDescription("Reanuda la reproduccion"))
    .addSubcommand(s => s.setName("skip").setDescription("Salta a la siguiente cancion"))
    .addSubcommand(s => s.setName("stop").setDescription("Para la musica y vacia la cola"))
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

    // ── PLAY ──
    if (sub === "play") {
      const vc = interaction.member?.voice?.channel;
      if (!vc)
        return interaction.reply({ content: `${EMOJI.CRUZ} Debes estar en un canal de voz.`, flags: 64 });

      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        const trackInfo = await searchDeezer(busqueda);
        trackInfo.requestedBy = interaction.user.toString();

        console.log(`[Musica] Encontrado: ${trackInfo.title} | ID: ${trackInfo.trackId}`);
        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo);
        await interaction.editReply({
          content: `${EMOJI.CHECK} Añadiendo **${trackInfo.title}** a la cola...`
        });

      } catch (e) {
        console.error("[Musica] Error play:", e.message);
        await interaction.editReply({ content: `${EMOJI.CRUZ} Error: ${e.message}` });
      }
      return;
    }

    // ── Resto de subcomandos ──
    const q = queues.get(interaction.guildId);
    if (!q)
      return interaction.reply({ content: `${EMOJI.CRUZ} No hay música reproduciéndose.`, flags: 64 });

    if (sub === "pause") {
      q.player.pause();
      return interaction.reply({ content: "⏸️ Música pausada." });
    }
    if (sub === "resume") {
      q.player.unpause();
      return interaction.reply({ content: "▶️ Música reanudada." });
    }
    if (sub === "skip") {
      q.player.stop();
      return interaction.reply({ content: "⏭️ Canción saltada." });
    }
    if (sub === "stop") {
      q.queue = [];
      q.player.stop();
      q.connection.destroy();
      queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹️ Música detenida y cola vaciada." });
    }
    if (sub === "cola") {
      const lista = [
        q.current ? `▶️ **${q.current.title}** - 0:30 *(reproduciendo)*` : "(nada reproduciendo)",
        ...q.queue.slice(0, 9).map((t, i) => `${i + 1}. **${t.title}** - 0:30`)
      ].join("\n") || "La cola está vacía.";

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#A238FF")
          .setTitle("🎵 Cola de reproducción")
          .setDescription(lista)
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
