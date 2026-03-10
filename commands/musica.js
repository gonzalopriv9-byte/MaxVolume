// commands/musica.js
// Sistema de música completo usando DisTube
// Instalar: npm install distube @distube/yt-dlp
//
// En index.js añadir (una vez, en el ready o antes del login):
//   const { setupDistube } = require('./commands/musica');
//   setupDistube(client);

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const EMOJI = {
  CHECK:    "<a:Tick:1480638398816456848>",
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

// ─────────────────────────────────────────────────────────────
// Setup DisTube (llamar una vez desde index.js)
// ─────────────────────────────────────────────────────────────
function setupDistube(client) {
  let DisTube;
  try {
    DisTube = require("distube").DisTube;
  } catch {
    console.error("❌ DisTube no instalado. Ejecuta: npm install distube @distube/yt-dlp");
    return;
  }

  const distube = new DisTube(client, {
    emitNewSongOnly: true,
    joinNewVoiceChannel: true,
  });

  client.distube = distube;

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
          { name: "👤 Solicitado", value: song.user?.toString() || "—", inline: true },
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

  distube.on("error", (channel, e) => {
    channel?.send({ content: `❌ Error: ${e.message}` }).catch(() => {});
    console.error("[DisTube]", e);
  });

  console.log("✅ DisTube inicializado");
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getDistube(interaction) {
  return interaction.client.distube;
}

function checkVoice(interaction) {
  const vc = interaction.member.voice.channel;
  if (!vc) {
    interaction.reply({ content: EMOJI.CRUZ + " Debes estar en un canal de voz.", ephemeral: true });
    return null;
  }
  return vc;
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
    const distube = getDistube(interaction);
    if (!distube) {
      return interaction.reply({ content: EMOJI.CRUZ + " Sistema de música no disponible.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // PLAY
    if (sub === "play") {
      const vc = checkVoice(interaction); if (!vc) return;
      const busqueda = interaction.options.getString("busqueda");
      await interaction.deferReply();
      try {
        await distube.play(vc, busqueda, {
          member:      interaction.member,
          textChannel: interaction.channel,
          message:     interaction,
        });
        await interaction.editReply({ content: EMOJI.CHECK + " Buscando **" + busqueda + "**..." });
      } catch (e) {
        await interaction.editReply({ content: EMOJI.CRUZ + " Error: " + e.message });
      }
      return;
    }

    const queue = distube.getQueue(interaction.guild);

    // PAUSE
    if (sub === "pause") {
      if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });
      distube.pause(interaction.guild);
      return interaction.reply({ content: "⏸ Música pausada." });
    }

    // RESUME
    if (sub === "resume") {
      if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música en cola.", ephemeral: true });
      distube.resume(interaction.guild);
      return interaction.reply({ content: "▶️ Música reanudada." });
    }

    // SKIP
    if (sub === "skip") {
      if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });
      await distube.skip(interaction.guild);
      return interaction.reply({ content: "⏭ Canción saltada." });
    }

    // STOP
    if (sub === "stop") {
      if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });
      await distube.stop(interaction.guild);
      return interaction.reply({ content: "⏹ Música detenida y cola vaciada." });
    }

    // COLA
    if (sub === "cola") {
      if (!queue || !queue.songs.length) {
        return interaction.reply({ content: "📭 La cola está vacía.", ephemeral: true });
      }
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

    // VOLUMEN
    if (sub === "volumen") {
      if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });
      const nivel = interaction.options.getInteger("nivel");
      distube.setVolume(interaction.guild, nivel);
      return interaction.reply({ content: `🔊 Volumen establecido a **${nivel}%**` });
    }

    // LOOP
    if (sub === "loop") {
      if (!queue) return interaction.reply({ content: EMOJI.CRUZ + " No hay música reproduciéndose.", ephemeral: true });
      const modo = parseInt(interaction.options.getString("modo"));
      distube.setRepeatMode(interaction.guild, modo);
      const modos = ["🚫 Sin loop", "🔂 Repitiendo canción", "🔁 Repitiendo cola"];
      return interaction.reply({ content: `Modo de repetición: **${modos[modo]}**` });
    }
  },
};
