// commands/musica.js — play-dl + @discordjs/voice (sin wrappers)
// Compatible con Node v20, funciona en Raspberry Pi

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const path = require("path");
const fs = require("fs");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

// Convierte formato Netscape cookies.txt → string HTTP (NAME=val; NAME2=val2)
function parseCookiesTxt(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
      const parts = line.split("\t");
      if (parts.length < 7) return null;
      const name = parts[5].trim();
      const value = parts[6].trim();
      if (!name || !value) return null;
      return `${name}=${value}`;
    })
    .filter(Boolean)
    .join("; ");
}

// Inicializar play-dl con cookies de YouTube al arrancar
const playdl = require("play-dl");
(async () => {
  try {
    const cookiesPath = path.join(__dirname, "../youtube.com_cookies.txt");
    if (fs.existsSync(cookiesPath)) {
      const cookieString = parseCookiesTxt(cookiesPath);
      await playdl.setToken({
        youtube: {
          cookie: cookieString,
        },
      });
      console.log("[Música] Cookies de YouTube cargadas correctamente.");
    } else {
      console.warn("[Música] No se encontró youtube.com_cookies.txt — YouTube puede bloquear requests.");
    }
  } catch (e) {
    console.error("[Música] Error cargando cookies:", e.message);
  }
})();

// Cola por guild: Map<guildId, { connection, player, queue: [], current, textChannel, volume }>
const queues = new Map();

function getQueue(guildId) { return queues.get(guildId); }

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || q.queue.length === 0) {
    q?.textChannel?.send({ content: "⏹ Cola terminada." }).catch(() => {});
    q?.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  const track = q.queue.shift();
  q.current = track;

  try {
    const stream = await playdl.stream(track.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    resource.volume?.setVolume((q.volume || 80) / 100);
    q.player.play(resource);

    q.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🎵 Reproduciendo ahora")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: "⏱ Duración",    value: track.duration || "?",       inline: true },
          { name: "👤 Solicitado", value: track.requestedBy || "—",    inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
      ]
    }).catch(() => {});
  } catch (e) {
    q.textChannel?.send({ content: EMOJI.CRUZ + " Error reproduciendo: " + e.message }).catch(() => {});
    playNext(guildId);
  }
}

async function addToQueue(guildId, voiceChannel, textChannel, track) {
  let q = queues.get(guildId);

  if (!q) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();

    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
    player.on("error", (err) => {
      q?.textChannel?.send({ content: EMOJI.CRUZ + " Error de audio: " + err.message }).catch(() => {});
      playNext(guildId);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
      } catch {
        connection.destroy();
        queues.delete(guildId);
      }
    });

    q = { connection, player, queue: [track], current: null, textChannel, volume: 80, loop: 0 };
    queues.set(guildId, q);
    playNext(guildId);
  } else {
    q.queue.push(track);
    q.textChannel = textChannel;
    textChannel.send({
      embeds: [new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("➕ Añadido a la cola")
        .setDescription(`**${track.title}** — ${track.duration || "?"}`)
        .setFooter({ text: "Posición: " + (q.queue.length) })
      ]
    }).catch(() => {});
  }
}

module.exports = {
  setupPlayer: async () => {},

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("Sistema de música")
    .addSubcommand(s => s
      .setName("play")
      .setDescription("Reproduce una canción o URL de YouTube")
      .addStringOption(o => o.setName("busqueda").setDescription("Nombre o URL").setRequired(true))
    )
    .addSubcommand(s => s.setName("pause").setDescription("Pausa la reproducción"))
    .addSubcommand(s => s.setName("resume").setDescription("Reanuda la reproducción"))
    .addSubcommand(s => s.setName("skip").setDescription("Salta a la siguiente canción"))
    .addSubcommand(s => s.setName("stop").setDescription("Para la música y vacía la cola"))
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
      if (!vc) return interaction.reply({ content: EMOJI.CRUZ + " Debes estar en un canal de voz.", ephemeral: true });

      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        let trackInfo;
        if (busqueda.includes("youtube.com") || busqueda.includes("youtu.be")) {
          const info = await playdl.video_info(busqueda);
          trackInfo = {
            title:       info.video_details.title,
            url:         info.video_details.url,
            duration:    info.video_details.durationRaw,
            thumbnail:   info.video_details.thumbnails?.[0]?.url,
            requestedBy: interaction.user.toString(),
          };
        } else {
          const results = await playdl.search(busqueda, { limit: 1, source: { youtube: "video" } });
          if (!results.length) return interaction.editReply({ content: EMOJI.CRUZ + " No se encontró ningún resultado." });
          const v = results[0];
          trackInfo = {
            title:       v.title,
            url:         v.url,
            duration:    v.durationRaw,
            thumbnail:   v.thumbnails?.[0]?.url,
            requestedBy: interaction.user.toString(),
          };
        }

        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo);
        await interaction.editReply({ content: EMOJI.CHECK + " Añadiendo **" + trackInfo.title + "** a la cola..." });

      } catch (e) {
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const q = getQueue(interaction.guildId);
    if (!q) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });

    if (sub === "pause") {
      q.player.pause();
      return interaction.reply({ content: "⏸ Música pausada." });
    }
    if (sub === "resume") {
      q.player.unpause();
      return interaction.reply({ content: "▶️ Música reanudada." });
    }
    if (sub === "skip") {
      q.player.stop();
      return interaction.reply({ content: "⏭ Canción saltada." });
    }
    if (sub === "stop") {
      q.queue = [];
      q.player.stop();
      q.connection.destroy();
      queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹ Música detenida y cola vaciada." });
    }
    if (sub === "cola") {
      const lista = [
        q.current ? "▶️ **" + q.current.title + "** — " + (q.current.duration || "?") : "▶️ (nada)",
        ...q.queue.slice(0, 9).map((t, i) => (i + 1) + ". **" + t.title + "** — " + (t.duration || "?"))
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("🎵 Cola de reproducción")
          .setDescription(lista)
          .setFooter({ text: (q.queue.length + (q.current ? 1 : 0)) + " canciones en total" })
        ]
      });
    }
    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      q.volume = nivel;
      try {
        const resource = q.player.state?.resource;
        resource?.volume?.setVolume(nivel / 100);
      } catch {}
      return interaction.reply({ content: "🔊 Volumen establecido a **" + nivel + "%**" });
    }
  },
};
