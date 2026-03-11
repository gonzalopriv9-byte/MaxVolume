// commands/musica.js
// Fuente: Deezer API (gratuita, sin autenticacion, MP3 directo)
// Stream via ffmpeg -> PCM s16le -> @discordjs/voice
// NOTA: previews de 30 segundos por cancion

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
};

// Busca en Deezer y devuelve info del primer resultado
function searchDeezer(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`;
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const track = json?.data?.[0];
          if (!track || !track.preview) return reject(new Error("No se encontro ningun resultado en Deezer."));
          resolve({
            title:     `${track.artist.name} - ${track.title}`,
            url:       track.link,
            preview:   track.preview,
            duration:  "0:30",
            thumbnail: track.album.cover_medium || null,
          });
        } catch (e) {
          reject(new Error("Error parseando respuesta de Deezer."));
        }
      });
    }).on("error", reject);
  });
}

// Crea stream PCM s16le desde URL MP3 de Deezer via ffmpeg
function createFfmpegStream(mp3Url, volume = 80) {
  const ffmpeg = spawn("ffmpeg", [
    "-i", mp3Url,
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "-af", `volume=${volume / 100}`,
    "-loglevel", "error",
    "pipe:1",
  ]);

  ffmpeg.stderr.on("data", d => console.error("[ffmpeg]", d.toString().trim()));
  ffmpeg.on("error", e => console.error("[ffmpeg error]", e.message));

  return ffmpeg.stdout;
}

// ── Cola de reproducción ──────────────────────────────────────────────────────

const queues = new Map();

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || q.queue.length === 0) {
    q?.textChannel?.send({ content: "Cola terminada. 👋" }).catch(() => {});
    q?.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  const track = q.queue.shift();
  q.current = track;

  try {
    console.log(`[Musica] Iniciando stream: ${track.preview}`);
    const audioStream = createFfmpegStream(track.preview, q.volume || 80);

    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Raw,
    });

    q.player.play(resource);

    q.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#A238FF")  // morado Deezer
        .setTitle("🎵 Reproduciendo ahora")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: "Duracion",   value: "0:30 (preview)", inline: true },
          { name: "Solicitado", value: track.requestedBy || "-", inline: true },
        )
        .setFooter({ text: "NexaBot Music • Deezer" })
      ]
    }).catch(() => {});

  } catch (e) {
    console.error(`[Musica] Error stream: ${e.message}`);
    q?.textChannel?.send({ content: EMOJI.CRUZ + " Error reproduciendo: " + e.message }).catch(() => {});
    setTimeout(() => playNext(guildId), 1000);
  }
}

async function addToQueue(guildId, voiceChannel, textChannel, track) {
  let q = queues.get(guildId);

  if (!q) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
    player.on("error", err => {
      console.error("[Musica] Player error:", err.message);
      const q2 = queues.get(guildId);
      q2?.textChannel?.send({ content: EMOJI.CRUZ + " Error de audio: " + err.message }).catch(() => {});
      setTimeout(() => playNext(guildId), 1000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
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
        .setFooter({ text: "Posición: " + q.queue.length })
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
      .addStringOption(o => o.setName("busqueda").setDescription("Nombre del artista y cancion").setRequired(true))
    )
    .addSubcommand(s => s.setName("pause").setDescription("Pausa la reproduccion"))
    .addSubcommand(s => s.setName("resume").setDescription("Reanuda la reproduccion"))
    .addSubcommand(s => s.setName("skip").setDescription("Salta a la siguiente cancion"))
    .addSubcommand(s => s.setName("stop").setDescription("Para la musica y vacia la cola"))
    .addSubcommand(s => s.setName("cola").setDescription("Muestra la cola actual"))
    .addSubcommand(s => s
      .setName("volumen")
      .setDescription("Cambia el volumen (1-100)")
      .addIntegerOption(o => o.setName("nivel").setDescription("Nivel de volumen").setRequired(true).setMinValue(1).setMaxValue(100))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "play") {
      const vc = interaction.member.voice.channel;
      if (!vc) return interaction.reply({ content: EMOJI.CRUZ + " Debes estar en un canal de voz.", flags: 64 });

      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        const trackInfo = await searchDeezer(busqueda);
        trackInfo.requestedBy = interaction.user.toString();

        console.log(`[Musica] Track: ${trackInfo.title} | Preview: ${trackInfo.preview}`);
        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo);
        await interaction.editReply({ content: EMOJI.CHECK + " Añadiendo **" + trackInfo.title + "** a la cola..." });

      } catch (e) {
        console.error("[Musica] Error play:", e.message);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const q = queues.get(interaction.guildId);
    if (!q) return interaction.reply({ content: EMOJI.CRUZ + " No hay musica reproduciendose.", flags: 64 });

    if (sub === "pause")  { q.player.pause();   return interaction.reply({ content: "⏸️ Musica pausada." }); }
    if (sub === "resume") { q.player.unpause(); return interaction.reply({ content: "▶️ Musica reanudada." }); }
    if (sub === "skip")   { q.player.stop();    return interaction.reply({ content: "⏭️ Cancion saltada." }); }

    if (sub === "stop") {
      q.queue = []; q.player.stop(); q.connection.destroy(); queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹️ Musica detenida y cola vaciada." });
    }

    if (sub === "cola") {
      const lista = [
        q.current ? "▶️ **" + q.current.title + "** - 0:30" : "(nada)",
        ...q.queue.slice(0, 9).map((t, i) => (i + 1) + ". **" + t.title + "** - 0:30")
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor("#A238FF").setTitle("🎵 Cola")
          .setDescription(lista)
          .setFooter({ text: (q.queue.length + (q.current ? 1 : 0)) + " canciones" })]
      });
    }

    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      q.volume = nivel;
      return interaction.reply({ content: "🔊 Volumen: **" + nivel + "%** (se aplica en la siguiente canción)" });
    }
  },
};
