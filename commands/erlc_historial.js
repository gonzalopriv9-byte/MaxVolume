// commands/erlc_historial.js
// Consulta el historial de sanciones de un usuario

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("historial")
    .setDescription("Consulta el historial de sanciones ERLC de un usuario")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("usuario").setDescription("Usuario a consultar").setRequired(true))
    .addStringOption(o => o.setName("tipo").setDescription("Filtrar por tipo").setRequired(false)
      .addChoices(
        { name: "Todas", value: "todas" },
        { name: "Multas", value: "multa" },
        { name: "Arrestos", value: "arresto" },
      )),

  async execute(interaction) {
    const usuario  = interaction.options.getUser("usuario");
    const tipo     = interaction.options.getString("tipo") || "todas";
    const supabase = interaction.client.supabase;

    await interaction.deferReply({ ephemeral: true });

    if (!supabase) {
      return interaction.editReply("❌ Supabase no configurado.");
    }

    let query = supabase
      .from("erlc_sanciones")
      .select("*")
      .eq("usuario_id", usuario.id)
      .eq("guild_id", interaction.guild.id)
      .order("created_at", { ascending: false })
      .limit(15);

    if (tipo !== "todas") query = query.eq("tipo", tipo);

    const { data, error } = await query;

    if (error) return interaction.editReply("❌ Error consultando la base de datos.");

    if (!data || data.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor("#22c55e")
          .setTitle(`📋 Historial de ${usuario.username}`)
          .setDescription("✅ Sin sanciones registradas.")
          .setThumbnail(usuario.displayAvatarURL({ size: 128 }))
        ]
      });
    }

    const tipoEmojis = { multa: "💵", arresto: "🚔" };

    const embed = new EmbedBuilder()
      .setColor("#f59e0b")
      .setTitle(`📋 Historial de ${usuario.username}`)
      .setThumbnail(usuario.displayAvatarURL({ size: 128 }))
      .setDescription(`Total de registros: **${data.length}**`)
      .setFooter({ text: "ERLC • Historial de Sanciones" })
      .setTimestamp();

    data.slice(0, 10).forEach(s => {
      const fecha = new Date(s.created_at);
      embed.addFields({
        name: `${tipoEmojis[s.tipo] || "📋"} ${s.tipo.toUpperCase()} — \`${s.id}\``,
        value: `**Motivo:** ${s.motivo || "—"}\n**Oficial:** <@${s.oficial_id}>\n**Fecha:** <t:${Math.floor(fecha.getTime()/1000)}:R>${s.cantidad ? `\n**Cantidad:** $${s.cantidad.toLocaleString("es-ES")}` : ""}${s.cargos ? `\n**Cargos:** ${s.cargos}` : ""}`,
        inline: false,
      });
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
