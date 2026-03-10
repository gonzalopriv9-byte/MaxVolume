// commands/musica.js - yt-dlp | ffmpeg | @discordjs/voice
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
const { spawn } = require("child_process");
const path = require("path");
const fs   = require("fs");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

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

const playdl = require("play-dl");
(async () => {
  try {
    const cp = path.join(__dirname, "../youtube.com_cookies.txt");
    if (fs.existsSync(cp)) {
      await playdl.setToken({ youtube: { cookie: parseCookiesTxt(cp) } });
      console.log("[Musica] Cookies cargadas para play-dl.");
    }
  } catch (e) {
    console.error("[Musica] Error cookies:", e.message);
  }
})();

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const COOKIES_FILE = path.join(__dirname, "../youtube.com_cookies.txt");

const queues = new Map();
function getQueue(guildId) { return queues.get(guildId); }

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || q.queue.length === 0) {
    q?.textChannel?.send({ content: "Cola terminada." }).catch(() => {});
    q?.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  const track = q.queue.shift();
  q.current = track;

  try {
    console.log(`[Musica] Iniciando: ${track.url}`);

    // yt-dlp: descarga mejor audio y lo saca por stdout
    const ytdlpArgs = [
      "-f", "bestaudio",
      "--no-playlist",
      "-o", "-",
      "--quiet",
    ];
    if (fs.existsSync(COOKIES_FILE)) {
      ytdlpArgs.push("--cookies", COOKIES_FILE);
    }
    ytdlpArgs.push(track.url);

    const ytdlp = spawn(YTDLP, ytdlpArgs, { stdio: ["ignore", "pipe", "pipe"] });
    ytdlp.stderr.on("data", d => console.error("[yt-dlp]", d.toString().trim()));
    ytdlp.on("error", err => {
      console.error("[Musica] yt-dlp error:", err.message);
      q?.textChannel?.send({ content: EMOJI.CRUZ + " Error yt-dlp: " + err.message }).catch(() => {});
      playNext(guildId);
    });

    // ffmpeg: convierte cualquier formato a PCM s16le que @discordjs/voice entiende nativamente
    const ffmpeg = spawn(FFMPEG, [
      "-i", "pipe:0",          // stdin = stream de yt-dlp
      "-f", "s16le",           // PCM signed 16-bit little-endian
      "-ar", "48000",          // 48kHz (Discord)
      "-ac", "2",              // stereo
      "-loglevel", "error",    // solo errores
      "pipe:1",                // stdout = audio procesado
    ], { stdio: ["pipe", "pipe", "pipe"] });

    // Conectar yt-dlp -> ffmpeg
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stderr.on("data", d => console.error("[ffmpeg]", d.toString().trim()));
    ffmpeg.on("error", err => {
      console.error("[Musica] ffmpeg error:", err.message);
      q?.textChannel?.send({ content: EMOJI.CRUZ + " Error ffmpeg: " + err.message }).catch(() => {});
      playNext(guildId);
    });

    // Crear recurso de audio desde stdout de ffmpeg
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,   // PCM raw = StreamType.Raw
      inlineVolume: true,
    });

    resource.volume?.setVolume((q.volume || 80) / 100);
    q.player.play(resource);

    q.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("Reproduciendo ahora")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: "Duracion",   value: track.duration || "?",  inline: true },
          { name: "Solicitado", value: track.requestedBy || "-", inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
      ]
    }).catch(() => {});

  } catch (e) {
    console.error(`[Musica] Error stream: ${e.message}`);
    q?.textChannel?.send({ content: EMOJI.CRUZ + " Error reproduciendo: " + e.message }).catch(() => {});
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
      console.error("[Musica] Player error:", err.message);
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
        .setTitle("Anadido a la cola")
        .setDescription(`**${track.title}** - ${track.duration || "?"}`)
        .setFooter({ text: "Posicion: " + q.queue.length })
      ]
    }).catch(() => {});
  }
}

async function getInfoYtdlp(url) {
  return new Promise((resolve, reject) => {
    const args = ["--dump-json", "--no-playlist"];
    if (fs.existsSync(COOKIES_FILE)) {
      args.push("--cookies", COOKIES_FILE);
    }
    args.push(url);

    let data = "";
    const proc = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { data += chunk.toString(); });
    proc.stderr.on("data", chunk => {
      const msg = chunk.toString();
      if (msg.toLowerCase().includes("error")) console.error("[Musica] yt-dlp info stderr:", msg.trim());
    });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code !== 0) return reject(new Error("yt-dlp info fallo con codigo " + code));
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error("yt-dlp JSON invalido: " + e.message)); }
    });
  });
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
      if (!vc) return interaction.reply({ content: EMOJI.CRUZ + " Debes estar en un canal de voz.", ephemeral: true });

      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");

      try {
        let trackInfo;

        if (busqueda.includes("youtube.com") || busqueda.includes("youtu.be")) {
          const info = await getInfoYtdlp(busqueda);
          const dur = info.duration ? new Date(info.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, "") : "?";
          trackInfo = {
            title:       info.title,
            url:         `https://www.youtube.com/watch?v=${info.id}`,
            duration:    dur,
            thumbnail:   info.thumbnail,
            requestedBy: interaction.user.toString(),
          };
        } else {
          const results = await playdl.search(busqueda, { limit: 1, source: { youtube: "video" } });
          if (!results.length) return interaction.editReply({ content: EMOJI.CRUZ + " No se encontro ningun resultado." });
          const v = results[0];
          trackInfo = {
            title:       v.title,
            url:         `https://www.youtube.com/watch?v=${v.id}`,
            duration:    v.durationRaw,
            thumbnail:   v.thumbnails?.[0]?.url,
            requestedBy: interaction.user.toString(),
          };
        }

        console.log(`[Musica] Track URL: ${trackInfo.url}`);
        await addToQueue(interaction.guildId, vc, interaction.channel, trackInfo);
        await interaction.editReply({ content: EMOJI.CHECK + " Anadiendo **" + trackInfo.title + "** a la cola..." });

      } catch (e) {
        console.error("[Musica] Error play:", e.message);
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const q = getQueue(interaction.guildId);
    if (!q) return interaction.reply({ content: EMOJI.CRUZ + " No hay musica reproduciendose.", ephemeral: true });

    if (sub === "pause")  { q.player.pause();   return interaction.reply({ content: "Musica pausada." }); }
    if (sub === "resume") { q.player.unpause(); return interaction.reply({ content: "Musica reanudada." }); }
    if (sub === "skip")   { q.player.stop();    return interaction.reply({ content: "Cancion saltada." }); }

    if (sub === "stop") {
      q.queue = []; q.player.stop(); q.connection.destroy(); queues.delete(interaction.guildId);
      return interaction.reply({ content: "Musica detenida y cola vaciada." });
    }
    if (sub === "cola") {
      const lista = [
        q.current ? "** " + q.current.title + "** - " + (q.current.duration || "?") : "(nada)",
        ...q.queue.slice(0, 9).map((t, i) => (i+1) + ". **" + t.title + "** - " + (t.duration || "?"))
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor("#5865F2").setTitle("Cola").setDescription(lista)
          .setFooter({ text: (q.queue.length + (q.current ? 1 : 0)) + " canciones" })]
      });
    }
    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      q.volume = nivel;
      try { q.player.state?.resource?.volume?.setVolume(nivel / 100); } catch {}
      return interaction.reply({ content: "Volumen: **" + nivel + "%**" });
    }
  },
};
