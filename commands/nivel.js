// commands/nivel.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getUserLevel, getLeaderboard, getLevelFromXP, xpForLevel } = require("../utils/levelSystem");
const { getEffectiveLimits } = require("../utils/premiumManager");
const { loadGuildConfig, updateGuildConfig } = require("../utils/configManager");

const EMOJI = {
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ:  "<a:Cruz:1472540885102235689>",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nivel")
    .setDescription("Sistema de niveles y XP")
    .addSubcommand(sub =>
      sub.setName("ver")
        .setDescription("Ver tu nivel o el de otro usuario")
        .addUserOption(opt => opt.setName("usuario").setDescription("Usuario a consultar")))
    .addSubcommand(sub =>
      sub.setName("ranking")
        .setDescription("Ver el ranking de niveles del servidor"))
    .addSubcommand(sub =>
      sub.setName("config")
        .setDescription("Configurar el sistema de niveles [Admin]")
        .addBooleanOption(opt => opt.setName("activar").setDescription("Activar/desactivar sistema").setRequired(true))
        .addChannelOption(opt => opt.setName("canal").setDescription("Canal donde anunciar los level ups"))
        .addRoleOption(opt => opt.setName("rol-nivel5").setDescription("Rol automático al llegar a nivel 5"))
        .addRoleOption(opt => opt.setName("rol-nivel10").setDescription("Rol automático al llegar a nivel 10"))
        .addRoleOption(opt => opt.setName("rol-nivel20").setDescription("Rol automático al llegar a nivel 20"))
        .addRoleOption(opt => opt.setName("rol-nivel50").setDescription("Rol automático al llegar a nivel 50")))
    .addSubcommand(sub =>
      sub.setName("ignorar-canal")
        .setDescription("Ignorar un canal para ganar XP [Admin]")
        .addChannelOption(opt => opt.setName("canal").setDescription("Canal a ignorar").setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    // Verificar permisos de administrador para comandos admin
    const adminCommands = ["config", "ignorar-canal"];
    if (adminCommands.includes(sub)) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply({
          content: "❌ Necesitas permisos de **Administrador** para usar este comando.",
        });
      }
    }

    // ==================== VER NIVEL ====================
    if (sub === "ver") {
      const limits = await getEffectiveLimits(interaction.guild.id, interaction.user.id);
      if (!limits.hasLevels) {
        return interaction.editReply({
          content: "🔵 **El sistema de niveles requiere NEXA Pro** (5,99€/mes)\nActívalo en: `/premium info`",
        });
      }

      const target = interaction.options.getUser("usuario") || interaction.user;
      const data = await getUserLevel(target.id, interaction.guild.id);
      const { level, currentXP, xpNeeded } = getLevelFromXP(data.total_xp || 0);

      const barFilled = Math.floor((currentXP / xpNeeded) * 20);
      const bar = "█".repeat(barFilled) + "░".repeat(20 - barFilled);

      const embed = new EmbedBuilder()
        .setColor("#00d4ff")
        .setTitle(`⭐ Nivel de ${target.username}`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "Nivel",     value: `**${level}**`, inline: true },
          { name: "XP Total",  value: `${(data.total_xp || 0).toLocaleString()}`, inline: true },
          { name: "Mensajes",  value: `${(data.messages || 0).toLocaleString()}`, inline: true },
          { name: `Progreso al nivel ${level + 1}`, value: `\`${bar}\` ${currentXP}/${xpNeeded} XP`, inline: false },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== RANKING ====================
    if (sub === "ranking") {
      const limits = await getEffectiveLimits(interaction.guild.id);
      if (!limits.hasLevels) {
        return interaction.editReply({
          content: "🔵 **El sistema de niveles requiere NEXA Pro** (5,99€/mes)\nActívalo en: `/premium info`",
        });
      }

      const board = await getLeaderboard(interaction.guild.id, 10);
      if (!board.length) return interaction.editReply({ content: "No hay datos de niveles aún." });

      const medals = ["🥇", "🥈", "🥉"];
      const lines = board.map((entry, i) =>
        `${medals[i] || `**${i + 1}.**`} <@${entry.userId}> — Nivel **${entry.level}** · ${entry.totalXP.toLocaleString()} XP`
      );

      const embed = new EmbedBuilder()
        .setColor("#00d4ff")
        .setTitle(`⭐ Ranking de Niveles — ${interaction.guild.name}`)
        .setDescription(lines.join("\n"))
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== CONFIG ====================
    if (sub === "config") {
      const limits = await getEffectiveLimits(interaction.guild.id);
      if (!limits.hasLevels) {
        return interaction.editReply({
          content: "🔵 **El sistema de niveles requiere NEXA Pro** (5,99€/mes)\nActívalo en: `/premium info`",
        });
      }

      const activar = interaction.options.getBoolean("activar");
      const canal   = interaction.options.getChannel("canal");
      const r5      = interaction.options.getRole("rol-nivel5");
      const r10     = interaction.options.getRole("rol-nivel10");
      const r20     = interaction.options.getRole("rol-nivel20");
      const r50     = interaction.options.getRole("rol-nivel50");

      const config = await loadGuildConfig(interaction.guild.id);
      const levelRoles = config.levels?.levelRoles || {};
      if (r5)  levelRoles[5]  = r5.id;
      if (r10) levelRoles[10] = r10.id;
      if (r20) levelRoles[20] = r20.id;
      if (r50) levelRoles[50] = r50.id;

      await updateGuildConfig(interaction.guild.id, {
        levels: {
          ...config.levels,
          enabled: activar,
          channelId: canal?.id || config.levels?.channelId || null,
          levelRoles,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(activar ? "#00ff88" : "#ff4466")
        .setTitle(`${activar ? "✅" : "❌"} Sistema de Niveles ${activar ? "Activado" : "Desactivado"}`)
        .addFields(
          { name: "Canal de anuncios", value: canal ? `<#${canal.id}>` : "Mismo canal del mensaje", inline: true },
          { name: "Roles configurados", value: Object.keys(levelRoles).length > 0
            ? Object.entries(levelRoles).map(([lvl, rid]) => `Nivel ${lvl}: <@&${rid}>`).join("\n")
            : "Ninguno", inline: false },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== IGNORAR CANAL ====================
    if (sub === "ignorar-canal") {
      const canal = interaction.options.getChannel("canal");
      const config = await loadGuildConfig(interaction.guild.id);
      const ignored = config.levels?.ignoredChannels || [];

      if (ignored.includes(canal.id)) {
        // Quitar de ignorados
        const newIgnored = ignored.filter(id => id !== canal.id);
        await updateGuildConfig(interaction.guild.id, { levels: { ...config.levels, ignoredChannels: newIgnored } });
        return interaction.editReply({ content: `${EMOJI.CHECK} <#${canal.id}> ya **cuenta** para ganar XP.` });
      } else {
        ignored.push(canal.id);
        await updateGuildConfig(interaction.guild.id, { levels: { ...config.levels, ignoredChannels: ignored } });
        return interaction.editReply({ content: `${EMOJI.CHECK} <#${canal.id}> ahora **ignora** XP.` });
      }
    }
  },
};
