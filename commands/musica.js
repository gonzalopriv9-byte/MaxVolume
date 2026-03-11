// commands/musica.js
// Usa @distube/ytdl-core (fork activo de ytdl-core con soporte 2026)
// + @discordjs/voice para streaming directo sin yt-dlp

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
const ytdl = require("@distube/ytdl-core");
const ytsr = require("ytsr");
const path = require("path");
const fs   = require("fs");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

// Cargar cookies de YouTube para evitar bot detection
function loadCookies() {
  try {
    const cp = path.join(__dirname, "../youtube.com_cookies.txt");
    if (!fs.existsSync(cp)) return [];
    const lines = fs.readFileSync(cp, "utf8").split("\n");
    const cookies = [];
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      const name  = parts[5]?.trim();
      const value = parts[6]?.trim();
      if (name && value) cookies.push({ name, value });
    }
    console.log(`[Musica] Cargadas ${cookies.length} cookies de YouTube.`);
    return cookies;
  } catch (e) {
    console.error("[Musica] Error cargando cookies:", e.message);
    return [];
  }
}

const ytdlAgent = ytdl.createAgent(loadCookies());

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
    console.log(`[Musica] Iniciando stream: ${track.url}`);

    const stream = ytdl(track.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25, // 32MB buffer para evitar cortes
      agent: ytdlAgent,
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
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
          { name: "Duracion",   value: track.duration || "?",    inline: true },
          { name: "Solicitado", value: track.requestedBy || "-", inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
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
        .setDescription(`**${track.title}** - ${track.duration || "?"}`)
        .setFooter({ text: "Posición: " + q.queue.length })
      ]
    }).catch(() => {});
  }
}

module.exports = {
  setupPlayer: async () => {},

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("Sistema de musica")
    .addSubcommand(s => s
      .setName("play")
      .setDescription("Reproduce una cancion o URL de YouTube")
      .addStringOption(o => o.setName("busqueda").setDescription("Nombre o URL").setRequired(true))
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
        let trackInfo;

        if (ytdl.validateURL(busqueda)) {
          // URL directa de YouTube
          const info = await ytdl.getInfo(busqueda, { agent: ytdlAgent });
          const v = info.videoDetails;
          trackInfo = {
            title:       v.title,
            url:         v.video_url,
            duration:    new Date(parseInt(v.lengthSeconds) * 1000).toISOString().substr(11, 8),
            thumbnail:   v.thumbnails?.[0]?.url,
            requestedBy: interaction.user.toString(),
          };
        } else {
          // Búsqueda por texto con ytsr
          const results = await ytsr(busqueda, { limit: 5 });
          const video = results.items.find(i => i.type === "video");
          if (!video) return interaction.editReply({ content: EMOJI.CRUZ + " No se encontró ningún resultado." });
          trackInfo = {
            title:       video.title,
            url:         video.url,
            duration:    video.duration || "?",
            thumbnail:   video.bestThumbnail?.url,
            requestedBy: interaction.user.toString(),
          };
        }

        console.log(`[Musica] Track URL: ${trackInfo.url}`);
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
        q.current ? "▶️ **" + q.current.title + "** - " + (q.current.duration || "?") : "(nada)",
        ...q.queue.slice(0, 9).map((t, i) => (i + 1) + ". **" + t.title + "** - " + (t.duration || "?"))
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor("#5865F2").setTitle("🎵 Cola")
          .setDescription(lista)
          .setFooter({ text: (q.queue.length + (q.current ? 1 : 0)) + " canciones" })]
      });
    }

    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      q.volume = nivel;
      try { q.player.state?.resource?.volume?.setVolume(nivel / 100); } catch {}
      return interaction.reply({ content: "🔊 Volumen: **" + nivel + "%**" });
    }
  },
};
