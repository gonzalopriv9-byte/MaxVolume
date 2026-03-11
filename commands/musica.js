// commands/musica.js
// Stream via yt-dlp (proceso externo) — compatible con ARM32 sin Deno
// Búsqueda via yt-dlp --get-id (no necesita ytsr ni YouTube API)

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
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs   = require("fs");

const COOKIES_PATH = path.join(__dirname, "../youtube.com_cookies.txt");
const YTDLP = "yt-dlp"; // en PATH tras añadir ~/.local/bin

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

// Ejecuta yt-dlp y devuelve stdout como string
function ytdlpRun(args) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, args, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// Busca en YouTube y devuelve info del primer resultado
async function searchYoutube(query) {
  // Si es URL directa, obtener info directamente
  const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query);
  const target = isUrl ? query : `ytsearch1:${query}`;

  const cookiesArgs = fs.existsSync(COOKIES_PATH)
    ? ["--cookies", COOKIES_PATH]
    : [];

  const raw = await ytdlpRun([
    ...cookiesArgs,
    "--no-warnings",
    "--print", "%(id)s\t%(title)s\t%(duration_string)s\t%(thumbnail)s",
    "--no-playlist",
    "--skip-download",
    target,
  ]);

  const [id, title, duration, thumbnail] = raw.split("\t");
  if (!id) throw new Error("No se encontró ningún resultado.");

  return {
    title:     title || "Sin título",
    url:       `https://www.youtube.com/watch?v=${id}`,
    duration:  duration || "?",
    thumbnail: thumbnail || null,
  };
}

// Crea un stream de audio usando yt-dlp como proceso externo
function createYtdlpStream(url) {
  const cookiesArgs = fs.existsSync(COOKIES_PATH)
    ? ["--cookies", COOKIES_PATH]
    : [];

  const proc = spawn(YTDLP, [
    ...cookiesArgs,
    "--no-warnings",
    "-f", "bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "-o", "-",   // output a stdout
    url,
  ]);

  proc.stderr.on("data", d => {
    const msg = d.toString();
    if (!msg.includes("WARNING")) console.error("[yt-dlp stderr]", msg.trim());
  });

  return proc.stdout; // readable stream directo a ffmpeg/discordjs
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
    console.log(`[Musica] Iniciando stream: ${track.url}`);
    const audioStream = createYtdlpStream(track.url);

    const resource = createAudioResource(audioStream, {
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

    q = { connection, player, queue: [track], current: null, textChannel, volume: 80 };
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

// ── Comando Slash ─────────────────────────────────────────────────────────────

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
        const trackInfo = await searchYoutube(busqueda);
        trackInfo.requestedBy = interaction.user.toString();

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
