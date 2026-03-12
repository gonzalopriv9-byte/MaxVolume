const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const EMOJI = {
  TICKET:      "<a:Ticket:1472541437470965942>",
  CRUZ:        "<a:CruzRoja:1480947488960806943>",
  CHECK:       "<a:Tick:1480638398816456848>",
  CORREO:      "<a:correo:1472550293152596000>",
  NUKE:        "<a:NUKE:1477617312679858318>",
  ADVERTENCIA: "<a:ADVERTENCIA:1477616948937490452>",
  NEXALOGO:    "<a:NEXALOGO:1477286399345561682>",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("apostar")
    .setDescription("Crear un evento de apuestas")
    .addStringOption(opt =>
      opt.setName("titulo").setDescription("Título del evento, ej: MADRID vs CITY").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("opciones")
        .setDescription("Número de opciones (2 normal · 3-4 requiere suscripción Elite)")
        .setRequired(true)
        .addChoices(
          { name: "2 opciones", value: "2" },
          { name: "3 opciones (Elite)", value: "3" },
          { name: "4 opciones (Elite)", value: "4" },
        )
    ),

  async execute(interaction) {
    const supabase = interaction.client.supabase;

    if (!supabase) {
      return interaction.reply({
        content: `${EMOJI.CRUZ} Supabase no está disponible.`,
        ephemeral: true,
      });
    }

    const titulo      = interaction.options.getString("titulo");
    const numOpciones = parseInt(interaction.options.getString("opciones"), 10);

    // ── Comprobar suscripción Elite si pide más de 2 opciones
    if (numOpciones > 2) {
      const { data: sub } = await supabase
        .from("premium_subscriptions")
        .select("active, expires_at")
        .eq("guild_id", interaction.guild.id)
        .eq("active", true)
        .maybeSingle();

      const ahora = new Date();
      const valida = sub && (sub.expires_at === null || new Date(sub.expires_at) > ahora);

      if (!valida) {
        return interaction.reply({
          content:
            `${EMOJI.ADVERTENCIA} **Necesitas una suscripción Elite activa** para crear eventos con más de 2 opciones.\n` +
            `Usa \`/premium\` para más información.`,
          ephemeral: true,
        });
      }
    }

    // ── Mostrar modal para rellenar las opciones
    const modal = new ModalBuilder()
      .setCustomId(`apostar_opciones_${numOpciones}_${encodeURIComponent(titulo)}`)
      .setTitle(`Opciones del evento (${numOpciones})`);

    for (let i = 1; i <= numOpciones; i++) {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`opcion${i}`)
            .setLabel(`Opción ${i}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(i === 1 ? "Ej: Real Madrid" : i === 2 ? "Ej: Man City" : `Opción ${i}`)
            .setRequired(true)
        )
      );
    }

    await interaction.showModal(modal);
  },
};
