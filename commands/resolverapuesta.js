const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resolverapuesta")
    .setDescription("Resuelve un evento de apuestas y distribuye los premios")
    .addStringOption(opt =>
      opt
        .setName("event_id")
        .setDescription("ID del evento de apuestas a resolver")
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
        content: `${EMOJI.CRUZ} Supabase no está disponible.`,
        ephemeral: true,
      });
    }

    // Solo admins/mods pueden resolver apuestas
    if (!interaction.member.permissions.has("ManageGuild")) {
      return interaction.reply({
        content: `${EMOJI.CRUZ} No tienes permisos para resolver apuestas.`,
        ephemeral: true,
      });
    }

    const eventId = interaction.options.getString("event_id");
    await interaction.deferReply({ ephemeral: true });

    try {
      // 1) Buscar evento
      const { data: evento, error: evErr } = await supabase
        .from("bet_events")
        .select("*")
        .eq("id", eventId)
        .eq("guild_id", interaction.guild.id)
        .single();

      if (evErr || !evento) {
        return interaction.editReply({
          content: `${EMOJI.CRUZ} No se encontró el evento con ID \`${eventId}\`.`,
        });
      }

      if (evento.status !== "open") {
        return interaction.editReply({
          content: `${EMOJI.CRUZ} Este evento ya está cerrado/resuelto.`,
        });
      }

      // 2) Mostrar menú para elegir ganador
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`resolve_event_${eventId}`)
        .setPlaceholder("Selecciona el resultado ganador...")
        .addOptions([
          {
            label: `🅰️ Gana: ${evento.opcion1}`,
            value: "1",
            description: `Opción 1`,
          },
          {
            label: `🅱️ Gana: ${evento.opcion2}`,
            value: "2",
            description: `Opción 2`,
          },
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor("#FFA500")
        .setTitle(`${EMOJI.NEXALOGO} Resolver apuesta`)
        .setDescription(`**${evento.titulo}**\n\nSelecciona quién ganó para distribuir los premios.`)
        .addFields(
          { name: "Opción 1", value: `🅰️ ${evento.opcion1}`, inline: true },
          { name: "Opción 2", value: `🅱️ ${evento.opcion2}`, inline: true },
        )
        .setFooter({ text: `Event ID: ${eventId}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (err) {
      console.error("Error en /resolverapuesta:", err);
      await interaction.editReply({
        content: `${EMOJI.CRUZ} Error inesperado al buscar el evento.`,
      });
    }
  },
};
