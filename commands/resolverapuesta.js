const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuBuilder as StringSelectMenuBuilder
} = require("discord.js");

const EMOJI = {
  CRUZ: "<a:CruzRoja:1480947488960806943>",
  CHECK: "<a:Tick:1480638398816456848>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resolverapuesta")
    .setDescription("Resolver un evento de apuestas (elige la opción ganadora)")
    .addStringOption(option =>
      option.setName("id")
        .setDescription("ID del evento de apuestas")
        .setRequired(true)
    ),

  async execute(interaction) {
    const supabase = interaction.client.supabase;
    const eventId = interaction.options.getString("id");

    if (!supabase) {
      return interaction.reply({ content: `${EMOJI.CRUZ} Supabase no disponible.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const { data: event, error } = await supabase
      .from("bet_events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (error || !event) {
      return interaction.editReply({ content: `${EMOJI.CRUZ} Evento no encontrado.` });
    }

    if (event.status !== "open") {
      return interaction.editReply({ content: `${EMOJI.CRUZ} Este evento ya está resuelto.` });
    }

    // Opciones dinámicas
    const opciones = [];
    for (let i = 1; i <= 4; i++) {
      const opcion = event[`opcion${i}`];
      if (opcion) {
        opciones.push({
          label: `Opción ${i}: ${opcion.substring(0, 100)}`,
          value: i.toString(),
          description: `Resolver con opción ${i}`
        });
      }
    }

    if (opciones.length === 0) {
      return interaction.editReply({ content: `${EMOJI.CRUZ} No hay opciones válidas.` });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`resolve_event_${eventId}`)
      .setPlaceholder("👑 Elige la opción GANADORA")
      .addOptions(opciones.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle(`${EMOJI.NEXALOGO} Resolver: ${event.titulo}`)
      .setDescription("Selecciona la **opción ganadora** del evento.")
      .addFields({ name: "🆔 ID", value: `\`${eventId}\``, inline: true })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
