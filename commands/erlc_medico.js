// commands/erlc_medico.js
// Genera un informe médico de atención

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("informe_medico")
    .setDescription("Genera un informe médico de atención")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("paciente").setDescription("Usuario atendido").setRequired(true))
    .addStringOption(o => o.setName("diagnostico").setDescription("Diagnóstico / motivo de atención").setRequired(true))
    .addStringOption(o => o.setName("tratamiento").setDescription("Tratamiento aplicado").setRequired(true))
    .addStringOption(o => o.setName("estado").setDescription("Estado del paciente al alta")
      .setRequired(true)
      .addChoices(
        { name: "✅ Estable — dado de alta", value: "estable" },
        { name: "⚠️ Crítico — en observación", value: "critico" },
        { name: "💀 Fallecido", value: "fallecido" },
        { name: "🏥 Trasladado a hospital", value: "trasladado" },
      ))
    .addStringOption(o => o.setName("notas").setDescription("Notas adicionales").setRequired(false)),

  async execute(interaction) {
    const paciente    = interaction.options.getUser("paciente");
    const diagnostico = interaction.options.getString("diagnostico");
    const tratamiento = interaction.options.getString("tratamiento");
    const estado      = interaction.options.getString("estado");
    const notas       = interaction.options.getString("notas") || "Ninguna";
    const medico      = interaction.user;
    const supabase    = interaction.client.supabase;

    await interaction.deferReply();

    const informeId = `MED-${Date.now().toString(36).toUpperCase()}`;

    const estadoLabels = {
      estable:   "✅ Estable — dado de alta",
      critico:   "⚠️ Crítico — en observación",
      fallecido: "💀 Fallecido",
      trasladado:"🏥 Trasladado a hospital",
    };

    const estadoColors = {
      estable:   "#22c55e",
      critico:   "#f59e0b",
      fallecido: "#6b7280",
      trasladado:"#3b82f6",
    };

    if (supabase) {
      try { await supabase.from("erlc_informes_medicos").insert({
        id:          informeId,
        paciente_id: paciente.id,
        paciente_tag:paciente.tag,
        medico_id:   medico.id,
        medico_tag:  medico.tag,
        guild_id:    interaction.guild.id,
        diagnostico,
        tratamiento,
        estado,
        notas,
        created_at:  new Date().toISOString(),
      }); } catch(e) { console.error("[ERLC DB]", e.message); }
    }

    const embed = new EmbedBuilder()
      .setColor(estadoColors[estado] || "#3b82f6")
      .setTitle("🏥 INFORME MÉDICO")
      .setThumbnail(paciente.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "📋 ID de Informe",    value: `\`${informeId}\``,         inline: true },
        { name: "🤒 Paciente",         value: `<@${paciente.id}>`,        inline: true },
        { name: "🩺 Médico",           value: `<@${medico.id}>`,          inline: true },
        { name: "🔬 Diagnóstico",      value: diagnostico,                inline: false },
        { name: "💊 Tratamiento",      value: tratamiento,                inline: false },
        { name: "📊 Estado al alta",   value: estadoLabels[estado],       inline: true },
        { name: "📅 Fecha atención",   value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false },
        { name: "📝 Notas",            value: notas,                      inline: false },
      )
      .setFooter({ text: "ERLC • Servicio Médico de Emergencias" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
