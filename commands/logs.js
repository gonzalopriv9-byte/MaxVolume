// commands/logs.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require("discord.js");
const { updateGuildConfig, loadGuildConfig } = require("../utils/configManager");
const { getEffectiveLimits } = require("../utils/premiumManager");
const { LOG_TYPES } = require("../utils/advancedLogs");

const EMOJI = {
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ:  "<a:Cruz:1472540885102235689>",
};

const ALL_TYPES = Object.values(LOG_TYPES);
const TYPE_LABELS = {
  message_delete:  "🗑️ Mensajes borrados",
  message_edit:    "✏️ Mensajes editados",
  member_join:     "📥 Entradas de miembros",
  member_leave:    "📤 Salidas de miembros",
  member_ban:      "🔨 Bans",
  member_unban:    "✅ Desbans",
  member_kick:     "👢 Kicks",
  role_create:     "🎭 Roles creados",
  role_delete:     "🗑️ Roles eliminados",
  role_update:     "✏️ Roles editados",
  channel_create:  "📁 Canales creados",
  channel_delete:  "🗑️ Canales eliminados",
  nickname_change: "📝 Cambios de apodo",
  voice_join:      "🔊 Entradas a voz",
  voice_leave:     "🔇 Salidas de voz",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configurar logs avanzados del servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName("configurar")
        .setDescription("Activar logs y elegir canal")
        .addChannelOption(opt =>
          opt.setName("canal")
            .setDescription("Canal donde se enviarán los logs")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addBooleanOption(opt => opt.setName("activar").setDescription("Activar/desactivar logs").setRequired(true)))
    .addSubcommand(sub =>
      sub.setName("tipos")
        .setDescription("Ver y gestionar qué tipos de logs están activos"))
    .addSubcommand(sub =>
      sub.setName("activar-tipo")
        .setDescription("Activar un tipo de log específico")
        .addStringOption(opt =>
          opt.setName("tipo")
            .setDescription("Tipo de log")
            .setRequired(true)
            .addChoices(...ALL_TYPES.map(t => ({ name: TYPE_LABELS[t] || t, value: t })))))
    .addSubcommand(sub =>
      sub.setName("desactivar-tipo")
        .setDescription("Desactivar un tipo de log específico")
        .addStringOption(opt =>
          opt.setName("tipo")
            .setDescription("Tipo de log")
            .setRequired(true)
            .addChoices(...ALL_TYPES.map(t => ({ name: TYPE_LABELS[t] || t, value: t }))))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 64 });

    const limits = await getEffectiveLimits(interaction.guild.id);
    if (!limits.hasAdvancedLogs) {
      return interaction.editReply({
        content: "🔵 **Los logs avanzados requieren NEXA Pro** (5,99€/mes)\nUsa `/premium planes` para ver más.",
      });
    }

    const config = await loadGuildConfig(interaction.guild.id);

    // ==================== CONFIGURAR ====================
    if (sub === "configurar") {
      const canal  = interaction.options.getChannel("canal");
      const activo = interaction.options.getBoolean("activar");

      await updateGuildConfig(interaction.guild.id, {
        advancedLogs: {
          ...config.advancedLogs,
          enabled: activo,
          channelId: canal.id,
          enabledTypes: config.advancedLogs?.enabledTypes || ALL_TYPES,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(activo ? "#00ff88" : "#ff4466")
        .setTitle(`${activo ? "✅" : "❌"} Logs ${activo ? "Activados" : "Desactivados"}`)
        .addFields(
          { name: "Canal", value: `<#${canal.id}>`, inline: true },
          { name: "Tipos activos", value: `${(config.advancedLogs?.enabledTypes || ALL_TYPES).length}/${ALL_TYPES.length}`, inline: true },
        )
        .setFooter({ text: "Usa /logs tipos para ver qué está activo" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== TIPOS ====================
    if (sub === "tipos") {
      const enabled = config.advancedLogs?.enabledTypes || ALL_TYPES;

      const lines = ALL_TYPES.map(t =>
        `${enabled.includes(t) ? "✅" : "❌"} ${TYPE_LABELS[t] || t}`
      );

      const embed = new EmbedBuilder()
        .setColor("#00d4ff")
        .setTitle("📋 Tipos de Logs")
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Usa /logs activar-tipo o desactivar-tipo para cambiar" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== ACTIVAR TIPO ====================
    if (sub === "activar-tipo") {
      const tipo = interaction.options.getString("tipo");
      const enabled = config.advancedLogs?.enabledTypes || [...ALL_TYPES];
      if (!enabled.includes(tipo)) enabled.push(tipo);

      await updateGuildConfig(interaction.guild.id, {
        advancedLogs: { ...config.advancedLogs, enabledTypes: enabled },
      });

      return interaction.editReply({ content: `${EMOJI.CHECK} Log **${TYPE_LABELS[tipo]}** activado.` });
    }

    // ==================== DESACTIVAR TIPO ====================
    if (sub === "desactivar-tipo") {
      const tipo = interaction.options.getString("tipo");
      const enabled = (config.advancedLogs?.enabledTypes || ALL_TYPES).filter(t => t !== tipo);

      await updateGuildConfig(interaction.guild.id, {
        advancedLogs: { ...config.advancedLogs, enabledTypes: enabled },
      });

      return interaction.editReply({ content: `${EMOJI.CHECK} Log **${TYPE_LABELS[tipo]}** desactivado.` });
    }
  },
};
