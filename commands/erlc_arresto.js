// commands/erlc_arresto.js
// Registra un arresto a un jugador

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("arresto")
    .setDescription("Registra el arresto de un jugador")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("usuario").setDescription("Usuario arrestado").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo del arresto").setRequired(true))
    .addStringOption(o => o.setName("cargos").setDescription("Cargos imputados").setRequired(true))
    .addIntegerOption(o => o.setName("tiempo").setDescription("Tiempo de condena en minutos (in-game)").setRequired(false).setMinValue(1).setMaxValue(1440))
    .addStringOption(o => o.setName("evidencia").setDescription("URL de evidencia (foto/vídeo)").setRequired(false)),

  async execute(interaction) {
    const usuario   = interaction.options.getUser("usuario");
    const motivo    = interaction.options.getString("motivo");
    const cargos    = interaction.options.getString("cargos");
    const tiempo    = interaction.options.getInteger("tiempo") || null;
    const evidencia = interaction.options.getString("evidencia") || null;
    const oficial   = interaction.user;
    const supabase  = interaction.client.supabase;

    await interaction.deferReply();

    const arrestoId = `ARR-${Date.now().toString(36).toUpperCase()}`;

    if (supabase) {
      await supabase.from("erlc_sanciones").insert({
        id:          arrestoId,
        tipo:        "arresto",
        usuario_id:  usuario.id,
        usuario_tag: usuario.tag,
        oficial_id:  oficial.id,
        oficial_tag: oficial.tag,
        guild_id:    interaction.guild.id,
        motivo,
        cargos,
        tiempo_min:  tiempo,
        evidencia,
        created_at:  new Date().toISOString(),
      }).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor("#ef4444")
      .setTitle("🚔 ARRESTO REGISTRADO")
      .setThumbnail(usuario.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "📋 ID de Arresto",  value: `\`${arrestoId}\``,   inline: true },
        { name: "👤 Detenido",       value: `<@${usuario.id}>`,   inline: true },
        { name: "👮 Oficial",        value: `<@${oficial.id}>`,   inline: true },
        { name: "⚖️ Cargos",         value: cargos,               inline: false },
        { name: "📝 Motivo",         value: motivo,               inline: false },
        { name: "⏱️ Condena",        value: tiempo ? `${tiempo} minutos` : "Sin especificar", inline: true },
        { name: "📅 Fecha",          value: `<t:${Math.floor(Date.now()/1000)}:F>`,           inline: true },
        ...(evidencia ? [{ name: "🔗 Evidencia", value: evidencia, inline: false }] : []),
      )
      .setFooter({ text: "ERLC • Sistema de Arrestos" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    try {
      await usuario.send({
        embeds: [new EmbedBuilder()
          .setColor("#ef4444")
          .setTitle("🚔 Has sido arrestado")
          .setDescription(`Has sido arrestado en **${interaction.guild.name}**.\n\n**Cargos:** ${cargos}\n**Motivo:** ${motivo}\n**Condena:** ${tiempo ? `${tiempo} minutos` : "Sin especificar"}\n**Oficial:** ${oficial.tag}\n**ID:** \`${arrestoId}\``)
          .setTimestamp()]
      });
    } catch { /* DMs cerrados */ }
  },
};
