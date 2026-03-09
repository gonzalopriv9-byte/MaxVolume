// commands/erlc_parte.js
// Genera un parte/informe policial

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("parte")
    .setDescription("Genera un parte policial o de incidente")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(o => o.setName("tipo").setDescription("Tipo de incidente").setRequired(true)
      .addChoices(
        { name: "🚔 Persecución", value: "persecucion" },
        { name: "🔫 Tiroteo",     value: "tiroteo" },
        { name: "🚨 Accidente",   value: "accidente" },
        { name: "🏦 Robo",        value: "robo" },
        { name: "🔪 Agresión",    value: "agresion" },
        { name: "📋 Otro",        value: "otro" },
      ))
    .addStringOption(o => o.setName("descripcion").setDescription("Descripción del incidente").setRequired(true))
    .addStringOption(o => o.setName("ubicacion").setDescription("Ubicación del incidente").setRequired(true))
    .addStringOption(o => o.setName("implicados").setDescription("Usuarios implicados (menciónalos o escribe sus nombres)").setRequired(false))
    .addStringOption(o => o.setName("resultado").setDescription("Resultado / resolución del incidente").setRequired(false))
    .addStringOption(o => o.setName("evidencia").setDescription("URL de evidencia").setRequired(false)),

  async execute(interaction) {
    const tipo        = interaction.options.getString("tipo");
    const descripcion = interaction.options.getString("descripcion");
    const ubicacion   = interaction.options.getString("ubicacion");
    const implicados  = interaction.options.getString("implicados") || "Sin especificar";
    const resultado   = interaction.options.getString("resultado") || "En investigación";
    const evidencia   = interaction.options.getString("evidencia") || null;
    const oficial     = interaction.user;
    const supabase    = interaction.client.supabase;

    await interaction.deferReply();

    const parteId = `PRT-${Date.now().toString(36).toUpperCase()}`;

    const tipoLabels = {
      persecucion: "🚔 Persecución",
      tiroteo:     "🔫 Tiroteo",
      accidente:   "🚨 Accidente",
      robo:        "🏦 Robo",
      agresion:    "🔪 Agresión",
      otro:        "📋 Otro",
    };

    const tipoColors = {
      persecucion: "#f59e0b",
      tiroteo:     "#ef4444",
      accidente:   "#f97316",
      robo:        "#8b5cf6",
      agresion:    "#dc2626",
      otro:        "#6b7280",
    };

    if (supabase) {
      await supabase.from("erlc_partes").insert({
        id:          parteId,
        tipo,
        oficial_id:  oficial.id,
        oficial_tag: oficial.tag,
        guild_id:    interaction.guild.id,
        descripcion,
        ubicacion,
        implicados,
        resultado,
        evidencia,
        created_at:  new Date().toISOString(),
      }).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor(tipoColors[tipo] || "#6b7280")
      .setTitle(`${tipoLabels[tipo]} — PARTE POLICIAL`)
      .addFields(
        { name: "📋 ID de Parte",    value: `\`${parteId}\``,             inline: true },
        { name: "👮 Oficial",         value: `<@${oficial.id}>`,           inline: true },
        { name: "📅 Fecha",           value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
        { name: "📍 Ubicación",       value: ubicacion,                    inline: false },
        { name: "📝 Descripción",     value: descripcion,                  inline: false },
        { name: "👥 Implicados",      value: implicados,                   inline: false },
        { name: "✅ Resultado",        value: resultado,                    inline: false },
        ...(evidencia ? [{ name: "🔗 Evidencia", value: evidencia, inline: false }] : []),
      )
      .setFooter({ text: "ERLC • Departamento de Policía" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
