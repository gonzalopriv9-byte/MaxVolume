const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("apostar")
    .setDescription("Crear un evento de apuestas deportivas con UnbelievaBoat")
    .addStringOption(opt =>
      opt
        .setName("titulo")
        .setDescription("Ej: Champions League: MADRID vs CITY")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("opcion1")
        .setDescription("Nombre opción 1 (local)")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("opcion2")
        .setDescription("Nombre opción 2 (visitante)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const supabase = interaction.client.supabase;
    const EMOJI = {
      CRUZ: "<a:CruzRoja:1480947488960806943>",
      CHECK: "<a:Tick:1480638398816456848>",
      NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
    };

    if (!supabase) {
      return interaction.reply({
        content: `${EMOJI.CRUZ} Supabase no está disponible en el cliente.`,
        ephemeral: true,
      });
    }

    const titulo = interaction.options.getString("titulo");
    const opcion1 = interaction.options.getString("opcion1");
    const opcion2 = interaction.options.getString("opcion2");

    await interaction.deferReply();

    try {
      // 1) Crear embed base del evento
      const embed = new EmbedBuilder()
        .setColor("#00BFFF")
        .setTitle(`${EMOJI.NEXALOGO} Evento de apuestas`)
        .setDescription(
          `**${titulo}**\n\n` +
          `Pulsa un botón para apostar por tu opción.\n` +
          `Cada apuesta usará tu saldo de UnbelievaBoat (cash).`
        )
        .addFields(
          { name: "Opción 1", value: `🅰️ ${opcion1}`, inline: true },
          { name: "Opción 2", value: `🅱️ ${opcion2}`, inline: true },
          { name: "Estado", value: "`ABIERTA`", inline: false },
        )
        .setFooter({ text: "Sistema de apuestas NexaBot + UnbelievaBoat" })
        .setTimestamp();

      // 2) Botones para elegir opción
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("bet_event_pending_1") // luego lo reemplazaremos con el id real
          .setLabel(`Apostar por ${opcion1}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("bet_event_pending_2")
          .setLabel(`Apostar por ${opcion2}`)
          .setStyle(ButtonStyle.Danger),
      );

      // 3) Enviar mensaje en el canal
      const msg = await interaction.channel.send({
        embeds: [embed],
        components: [row],
      });

      // 4) Guardar evento en Supabase
      const { data, error } = await supabase
        .from("bet_events")
        .insert([
          {
            guild_id: interaction.guild.id,
            channel_id: interaction.channel.id,
            message_id: msg.id,
            titulo,
            opcion1,
            opcion2,
            status: "open",
          },
        ])
        .select()
        .single();

      if (error || !data) {
        console.error("Supabase bet_events insert error:", error);
        return interaction.editReply({
          content: `${EMOJI.CRUZ} Error guardando el evento en la base de datos.`,
        });
      }

      const eventId = data.id;

      // 5) Actualizar botones con el id real del evento
      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bet_event_${eventId}_1`)
          .setLabel(`Apostar por ${opcion1}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`bet_event_${eventId}_2`)
          .setLabel(`Apostar por ${opcion2}`)
          .setStyle(ButtonStyle.Danger),
      );

      await msg.edit({ components: [updatedRow] });

      await interaction.editReply({
        content: `${EMOJI.CHECK} Evento de apuestas creado correctamente.`,
      });
    } catch (err) {
      console.error("Error en /apostar:", err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `${EMOJI.CRUZ} Ocurrió un error creando el evento.`,
        });
      } else {
        await interaction.reply({
          content: `${EMOJI.CRUZ} Ocurrió un error creando el evento.`,
          ephemeral: true,
        });
      }
    }
  },
};
