// commands/musica.js — ytdl-core (stream) + play-dl (search) + @discordjs/voice
// Compatible con Node v20, Raspberry Pi ARM

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
const ytdl = require("ytdl-core");
const path = require("path");
const fs   = require("fs");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

// Convierte Netscape cookies.txt → string HTTP para play-dl
function parseCookiesTxt(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const p = l.split("\t");
      if (p.length < 7) return null;
      const n = p[5].trim(), v = p[6].trim();
      return (n && v) ? `${n}=${v}` : null;
    })
    .filter(Boolean)
    .join("; ");
}

// Inicializar play-dl con cookies (solo para búsquedas)
const playdl = require("play-dl");
(async () => {
  try {
    const cp = path.join(__dirname, "../youtube.com_cookies.txt");
    if (fs.existsSync(cp)) {
      await playdl.setToken({ youtube: { cookie: parseCookiesTxt(cp) } });
      console.log("[Música] Cookies cargadas para play-dl.");
    }
  } catch (e) {
    console.error("[Música] Error cookies:", e.message);
  }
})();

// Cookies para ytdl-core (array de objetos)
let ytdlCookies = [];
try {
  const cp = path.join(__dirname, "../youtube.com_cookies.txt");
  if (fs.existsSync(cp)) {
    ytdlCookies = fs.readFileSync(cp, "utf8")
      .split("\n")
      .filter(l => l && !l.startsWith("#"))
      .map(l => {
        const p = l.split("\t");
        if (p.length < 7) return null;
        return { name: p[5].trim(), value: p[6].trim() };
      })
      .filter(Boolean);
    console.log(`[Música] ${ytdlCookies.length} cookies cargadas para ytdl-core.`);
  }
} catch (e) {
  console.error("[Música] Error cookies ytdl:", e.message);
}

const ytdlOptions = {
  filter: "audioonly",
  quality: "highestaudio",
  highWaterMark: 1 << 25, // 32MB buffer
  requestOptions: {
    headers: {
      cookie: ytdlCookies.map(c => `${c.name}=${c.value}`).join("; "),
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    },
  },
};

// Cola por guild
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
    console.log(`[Música] Streaming: ${track.url}`);
    const ytStream = ytdl(track.url, ytdlOptions);
    const resource = createAudioResource(ytStream, {
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
          { name: "⏱ Duración",   value: track.duration || "?",    inline: true },
          { name: "👤 Solicitado", value: track.requestedBy || "—", inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
      ]
    }).catch(() => {});
  } catch (e) {
    console.error(`[Música] Error stream: ${e.message}`);
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
    player.on("error", err => {
      console.error("[Música] Player error:", err.message);
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
        .setFooter({ text: "Posición: " + q.queue.length })
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
          // URL directa — obtener info con ytdl-core
          const info = await ytdl.getInfo(busqueda, { requestOptions: ytdlOptions.requestOptions });
          const v = info.videoDetails;
          trackInfo = {
            title:       v.title,
            url:         v.video_url,
            duration:    new Date(parseInt(v.lengthSeconds) * 1000).toISOString().substr(11, 8).replace(/^00:/, ""),
            thumbnail:   v.thumbnails?.[0]?.url,
            requestedBy: interaction.user.toString(),
          };
        } else {
          // Búsqueda por texto — usar play-dl para encontrar el video
          const results = await playdl.search(busqueda, { limit: 1, source: { youtube: "video" } });
          if (!results.length) return interaction.editReply({ content: EMOJI.CRUZ + " No se encontró ningún resultado." });
          const v = results[0];
          // Reconstruir URL limpia para evitar URLs malformadas de play-dl
          const cleanUrl = `https://www.youtube.com/watch?v=${v.id}`;
          trackInfo = {
            title:       v.title,
            url:         cleanUrl,
            duration:    v.durationRaw,
            thumbnail:   v.thumbnails?.[0]?.url,
            requestedBy: interaction.user.toString(),
          };
        }

        console.log(`[Música] Track URL: ${trackInfo.url}`);
        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo);
        await interaction.editReply({ content: EMOJI.CHECK + " Añadiendo **" + trackInfo.title + "** a la cola..." });

      } catch (e) {
        console.error("[Música] Error play:", e.message);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const q = getQueue(interaction.guildId);
    if (!q) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });

    if (sub === "pause")  { q.player.pause();   return interaction.reply({ content: "⏸ Música pausada." }); }
    if (sub === "resume") { q.player.unpause(); return interaction.reply({ content: "▶️ Música reanudada." }); }
    if (sub === "skip")   { q.player.stop();    return interaction.reply({ content: "⏭ Canción saltada." }); }

    if (sub === "stop") {
      q.queue = []; q.player.stop(); q.connection.destroy(); queues.delete(interaction.guildId);
      return interaction.reply({ content: "⏹ Música detenida y cola vaciada." });
    }
    if (sub === "cola") {
      const lista = [
        q.current ? "▶️ **" + q.current.title + "** — " + (q.current.duration || "?") : "▶️ (nada)",
        ...q.queue.slice(0, 9).map((t, i) => (i+1) + ". **" + t.title + "** — " + (t.duration || "?"))
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor("#5865F2").setTitle("🎵 Cola").setDescription(lista)
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
