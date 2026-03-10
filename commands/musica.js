// commands/musica.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

// ─────────────────────────────────────────────────────────────
// Setup DisTube v5 (llamar una vez desde index.js)
// ─────────────────────────────────────────────────────────────
function setupDistube(client) {
  let DisTube, YtDlpPlugin, RepeatMode;
  try {
    ({ DisTube, RepeatMode } = require("distube"));
    ({ YtDlpPlugin } = require("@distube/yt-dlp"));
  } catch (e) {
    console.error("❌ DisTube no instalado:", e.message);
    return;
  }

  const distube = new DisTube(client, {
    plugins: [new YtDlpPlugin()],
  });

  client.distube = distube;
  client.RepeatMode = RepeatMode;

  const color = "#5865F2";

  distube.on("playSong", (queue, song) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle("🎵 Reproduciendo ahora")
        .setDescription(`**[${song.name}](${song.url})**`)
        .setThumbnail(song.thumbnail)
        .addFields(
          { name: "⏱ Duración",    value: song.formattedDuration, inline: true },
          { name: "👤 Solicitado", value: song.member?.toString() || "—", inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
      ]
    }).catch(() => {});
  });

  distube.on("addSong", (queue, song) => {
    queue.textChannel?.send({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle("➕ Añadido a la cola")
        .setDescription(`**${song.name}** — ${song.formattedDuration}`)
        .setFooter({ text: "Posición en cola: " + queue.songs.length })
      ]
    }).catch(() => {});
  });

  distube.on("finish", queue => {
    queue.textChannel?.send({ content: "⏹ Cola terminada. ¡Hasta la próxima!" }).catch(() => {});
  });

  distube.on("error", (error, queue) => {
    queue?.textChannel?.send({ content: `❌ Error: ${error.message}` }).catch(() => {});
    console.error("[DisTube]", error);
  });

  console.log("✅ DisTube v5 inicializado");
}

// ─────────────────────────────────────────────────────────────
// Comando
// ─────────────────────────────────────────────────────────────
module.exports = {
  setupDistube,

  data: new SlashCommandBuilder()
    .setName("musica")
    .setDescription("Sistema de música")
    .addSubcommand(s => s
      .setName("play")
      .setDescription("Reproduce una canción o URL")
      .addStringOption(o => o.setName("busqueda").setDescription("Nombre o URL de la canción").setRequired(true))
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
    )
    .addSubcommand(s => s
      .setName("loop")
      .setDescription("Cambia el modo de repetición")
      .addStringOption(o => o.setName("modo").setDescription("Modo").setRequired(true)
        .addChoices(
          { name: "🚫 Sin loop",       value: "0" },
          { name: "🔂 Canción actual", value: "1" },
          { name: "🔁 Cola completa",  value: "2" },
        ))
    ),

  async execute(interaction) {
    const distube = interaction.client.distube;
    if (!distube) {
      return interaction.reply({ content: EMOJI.CRUZ + " Sistema de música no disponible.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // PLAY
    if (sub === "play") {
      const vc = interaction.member.voice.channel;
      if (!vc) return interaction.reply({ content: EMOJI.CRUZ + " Debes estar en un canal de voz.", ephemeral: true });
      const busqueda = interaction.options.getString("busqueda");
      await interaction.deferReply();
      try {
        await distube.play(vc, busqueda, {
          member:      interaction.member,
          textChannel: interaction.channel,
        });
        await interaction.editReply({ content: EMOJI.CHECK + " Buscando **" + busqueda + "**..." });
      } catch (e) {
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const queue = distube.getQueue(interaction.guildId);

    if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });

    if (sub === "pause")  { queue.pause();  return interaction.reply({ content: "⏸ Música pausada." }); }
    if (sub === "resume") { queue.resume(); return interaction.reply({ content: "▶️ Música reanudada." }); }
    if (sub === "skip")   { await queue.skip(); return interaction.reply({ content: "⏭ Canción saltada." }); }
    if (sub === "stop")   { await queue.stop(); return interaction.reply({ content: "⏹ Música detenida y cola vaciada." }); }

    if (sub === "cola") {
      const lista = queue.songs
        .slice(0, 10)
        .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} **${s.name}** — ${s.formattedDuration}`)
        .join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("🎵 Cola de reproducción")
          .setDescription(lista + (queue.songs.length > 10 ? `\n...y ${queue.songs.length - 10} más` : ""))
          .setFooter({ text: `${queue.songs.length} canciones en cola` })
        ]
      });
    }

    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      queue.setVolume(nivel);
      return interaction.reply({ content: `🔊 Volumen establecido a **${nivel}%**` });
    }

    if (sub === "loop") {
      const RepeatMode = interaction.client.RepeatMode;
      const modo = parseInt(interaction.options.getString("modo"));
      queue.setRepeatMode(modo);
      const modos = ["🚫 Sin loop", "🔂 Repitiendo canción", "🔁 Repitiendo cola"];
      return interaction.reply({ content: `Modo de repetición: **${modos[modo]}**` });
    }
  },
};
