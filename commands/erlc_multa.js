// commands/erlc_multa.js
// Registra una multa a un jugador y la guarda en Supabase

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("multa")
    .setDescription("Registra una multa a un jugador")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("usuario").setDescription("Usuario multado").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo de la multa").setRequired(true))
    .addIntegerOption(o => o.setName("cantidad").setDescription("Cantidad en $ (dólares in-game)").setRequired(true).setMinValue(1).setMaxValue(999999))
    .addStringOption(o => o.setName("articulo").setDescription("Artículo legal infringido").setRequired(false)),

  async execute(interaction) {
    const usuario   = interaction.options.getUser("usuario");
    const motivo    = interaction.options.getString("motivo");
    const cantidad  = interaction.options.getInteger("cantidad");
    const articulo  = interaction.options.getString("articulo") || "Sin especificar";
    const oficial   = interaction.user;
    const supabase  = interaction.client.supabase;

    await interaction.deferReply();

    const multaId = `MUL-${Date.now().toString(36).toUpperCase()}`;

    // Guardar en Supabase
    if (supabase) {
      await supabase.from("erlc_sanciones").insert({
        id:          multaId,
        tipo:        "multa",
        usuario_id:  usuario.id,
        usuario_tag: usuario.tag,
        oficial_id:  oficial.id,
        oficial_tag: oficial.tag,
        guild_id:    interaction.guild.id,
        motivo,
        articulo,
        cantidad,
        created_at:  new Date().toISOString(),
      }).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor("#f59e0b")
      .setTitle("🚨 MULTA EMITIDA")
      .setThumbnail(usuario.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "📋 ID de Multa",   value: `\`${multaId}\``,      inline: true },
        { name: "👤 Ciudadano",     value: `<@${usuario.id}>`,    inline: true },
        { name: "👮 Oficial",       value: `<@${oficial.id}>`,    inline: true },
        { name: "💵 Cantidad",      value: `$${cantidad.toLocaleString("es-ES")}`, inline: true },
        { name: "📜 Artículo",      value: articulo,              inline: true },
        { name: "📅 Fecha",         value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false },
        { name: "📝 Motivo",        value: motivo,                inline: false },
      )
      .setFooter({ text: "ERLC • Sistema de Multas" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // DM al multado
    try {
      await usuario.send({
        embeds: [new EmbedBuilder()
          .setColor("#f59e0b")
          .setTitle("🚨 Has recibido una multa")
          .setDescription(`Has sido multado en **${interaction.guild.name}**.\n\n**Cantidad:** $${cantidad.toLocaleString("es-ES")}\n**Motivo:** ${motivo}\n**Artículo:** ${articulo}\n**Oficial:** ${oficial.tag}\n**ID:** \`${multaId}\``)
          .setTimestamp()]
      });
    } catch { /* DMs cerrados */ }
  },
};
