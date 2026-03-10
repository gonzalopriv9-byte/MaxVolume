// commands/musica.js
// Sistema de música con discord-player v6 (compatible Node v20)

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

async function setupPlayer(client) {
  let Player, DefaultExtractors;
  try {
    ({ Player } = require("discord-player"));
    ({ DefaultExtractors } = require("@discord-player/extractor"));
  } catch (e) {
    console.error("❌ discord-player no instalado:", e.message);
    return;
  }

  const player = new Player(client);
  await player.extractors.loadMulti(DefaultExtractors);
  client.musicPlayer = player;

  player.events.on("playerStart", (queue, track) => {
    queue.metadata?.channel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🎵 Reproduciendo ahora")
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail)
        .addFields(
          { name: "⏱ Duración",    value: track.duration,                    inline: true },
          { name: "👤 Solicitado", value: track.requestedBy?.toString() || "—", inline: true },
        )
        .setFooter({ text: "NexaBot Music" })
      ]
    }).catch(() => {});
  });

  player.events.on("audioTrackAdd", (queue, track) => {
    queue.metadata?.channel?.send({
      embeds: [new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("➕ Añadido a la cola")
        .setDescription(`**${track.title}** — ${track.duration}`)
        .setFooter({ text: "Posición: " + queue.tracks.size })
      ]
    }).catch(() => {});
  });

  player.events.on("emptyQueue", queue => {
    queue.metadata?.channel?.send({ content: "⏹ Cola terminada. ¡Hasta la próxima!" }).catch(() => {});
  });

  player.events.on("error", (queue, error) => {
    queue.metadata?.channel?.send({ content: "❌ Error: " + error.message }).catch(() => {});
    console.error("[discord-player]", error);
  });

  console.log("✅ discord-player inicializado");
}

module.exports = {
  setupPlayer,

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
    const player = interaction.client.musicPlayer;
    if (!player) {
      return interaction.reply({ content: EMOJI.CRUZ + " Sistema de música no disponible.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "play") {
      const vc = interaction.member.voice.channel;
      if (!vc) return interaction.reply({ content: EMOJI.CRUZ + " Debes estar en un canal de voz.", ephemeral: true });
      await interaction.deferReply();
      const busqueda = interaction.options.getString("busqueda");
      try {
        await player.play(vc, busqueda, {
          nodeOptions: { metadata: { channel: interaction.channel }, volume: 80 },
          requestedBy: interaction.user,
        });
        await interaction.editReply({ content: EMOJI.CHECK + " Buscando **" + busqueda + "**..." });
      } catch (e) {
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const queue = player.nodes.get(interaction.guildId);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });
    }

    if (sub === "pause")  { queue.node.pause();  return interaction.reply({ content: "⏸ Música pausada." }); }
    if (sub === "resume") { queue.node.resume(); return interaction.reply({ content: "▶️ Música reanudada." }); }
    if (sub === "skip")   { queue.node.skip();   return interaction.reply({ content: "⏭ Canción saltada." }); }
    if (sub === "stop")   { queue.delete();      return interaction.reply({ content: "⏹ Música detenida y cola vaciada." }); }

    if (sub === "cola") {
      const current = queue.currentTrack;
      const tracks  = queue.tracks.toArray().slice(0, 9);
      const lista   = [
        "▶️ **" + (current?.title || "?") + "** — " + (current?.duration || "?"),
        ...tracks.map((t, i) => (i + 1) + ". **" + t.title + "** — " + t.duration)
      ].join("\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("🎵 Cola de reproducción")
          .setDescription(lista)
          .setFooter({ text: (queue.tracks.size + 1) + " canciones en total" })
        ]
      });
    }

    if (sub === "volumen") {
      const nivel = interaction.options.getInteger("nivel");
      queue.node.setVolume(nivel);
      return interaction.reply({ content: "🔊 Volumen establecido a **" + nivel + "%**" });
    }

    if (sub === "loop") {
      const { QueueRepeatMode } = require("discord-player");
      const modos   = [QueueRepeatMode.OFF, QueueRepeatMode.TRACK, QueueRepeatMode.QUEUE];
      const nombres = ["🚫 Sin loop", "🔂 Repitiendo canción", "🔁 Repitiendo cola"];
      const modo    = parseInt(interaction.options.getString("modo"));
      queue.setRepeatMode(modos[modo]);
      return interaction.reply({ content: "Modo de repetición: **" + nombres[modo] + "**" });
    }
  },
};
