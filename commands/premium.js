// commands/premium.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const {
  PREMIUM_TIERS, TIER_LIMITS,
  getGuildTier, getUserTier,
  activateGuildPremium, activateUserPremium,
  revokeGuildPremium, revokeUserPremium,
  getEffectiveLimits,
} = require("../utils/premiumManager");

// IDs de los dueños del bot que pueden activar premium
const BOT_OWNERS = (process.env.BOT_OWNERS || "").split(",").filter(Boolean);

const EMOJI = {
  CHECK:  "<a:Check:1472540340584972509>",
  CRUZ:   "<a:Cruz:1472540885102235689>",
  NEXA:   "<a:NEXALOGO:1477286399345561682>",
  DIAMOND: "💎",
};

const TIER_EMOJIS = { free: "⚪", personal: "💎", starter: "🟢", pro: "🔵", elite: "🟣" };
const TIER_NAMES  = { free: "FREE", personal: "PERSONAL", starter: "STARTER", pro: "PRO", elite: "ELITE" };
const TIER_COLORS = { free: "#555555", personal: "#00d4ff", starter: "#00ff88", pro: "#0088ff", elite: "#aa44ff" };

module.exports = {
  data: new SlashCommandBuilder()
    .setName("premium")
    .setDescription("Sistema premium de NEXA")
    .addSubcommand(sub =>
      sub.setName("info")
        .setDescription("Ver información de tu premium actual"))
    .addSubcommand(sub =>
      sub.setName("planes")
        .setDescription("Ver todos los planes disponibles"))
    // Comandos de owner del bot
    .addSubcommand(sub =>
      sub.setName("activar-servidor")
        .setDescription("[OWNER] Activar premium en un servidor")
        .addStringOption(opt => opt.setName("guild-id").setDescription("ID del servidor").setRequired(true))
        .addStringOption(opt => opt.setName("tier").setDescription("Tier").setRequired(true)
          .addChoices(
            { name: "Starter", value: "starter" },
            { name: "Pro",     value: "pro" },
            { name: "Elite",   value: "elite" },
          ))
        .addIntegerOption(opt => opt.setName("meses").setDescription("Meses (-1 = vitalicio)").setRequired(true).setMinValue(-1).setMaxValue(120)))
    .addSubcommand(sub =>
      sub.setName("activar-usuario")
        .setDescription("[OWNER] Activar premium personal a un usuario")
        .addUserOption(opt => opt.setName("usuario").setDescription("Usuario").setRequired(true))
        .addIntegerOption(opt => opt.setName("meses").setDescription("Meses (-1 = vitalicio)").setRequired(true).setMinValue(-1).setMaxValue(120)))
    .addSubcommand(sub =>
      sub.setName("revocar-servidor")
        .setDescription("[OWNER] Revocar premium de un servidor")
        .addStringOption(opt => opt.setName("guild-id").setDescription("ID del servidor").setRequired(true)))
    .addSubcommand(sub =>
      sub.setName("revocar-usuario")
        .setDescription("[OWNER] Revocar premium de un usuario")
        .addUserOption(opt => opt.setName("usuario").setDescription("Usuario").setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 64 });

    // ==================== INFO ====================
    if (sub === "info") {
      const guildTier = await getGuildTier(interaction.guild.id);
      const userTier  = await getUserTier(interaction.user.id);
      const limits    = await getEffectiveLimits(interaction.guild.id, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(TIER_COLORS[guildTier] || TIER_COLORS.free)
        .setTitle(`${EMOJI.NEXA} NEXA Premium — Estado`)
        .addFields(
          {
            name: "🏠 Servidor",
            value: `${TIER_EMOJIS[guildTier]} **${TIER_NAMES[guildTier]}**\n` +
              `Tickets: ${limits.maxActiveTickets === 999 ? "Ilimitados" : limits.maxActiveTickets}\n` +
              `Categorías: ${limits.maxCategories}\n` +
              `Logs avanzados: ${limits.hasAdvancedLogs ? "✅" : "❌"}\n` +
              `Niveles/XP: ${limits.hasLevels ? "✅" : "❌"}\n` +
              `Sorteos: ${limits.hasGiveaways ? "✅" : "❌"}\n` +
              `Economía: ${limits.hasEconomy ? "✅" : "❌"}\n` +
              `IA: ${limits.hasAI ? "✅" : "❌"}`,
            inline: true,
          },
          {
            name: "👤 Tú",
            value: `${TIER_EMOJIS[userTier]} **${TIER_NAMES[userTier]}**\n` +
              (userTier === "personal"
                ? "✅ Soporte prioritario\n✅ Beta access\n✅ Rol @NEXA PREMIUM\n✅ Logs de todos los servidores\n✅ IA desbloqueada"
                : "Sin premium personal\nUsa `/premium planes` para ver beneficios"),
            inline: true,
          },
        )
        .setFooter({ text: "nexabot.com/premium • Soporte en el servidor oficial" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== PLANES ====================
    if (sub === "planes") {
      const embed = new EmbedBuilder()
        .setColor("#00d4ff")
        .setTitle(`${EMOJI.DIAMOND} Planes NEXA Premium`)
        .setDescription("Mejora tu servidor con funciones exclusivas")
        .addFields(
          {
            name: "💎 PERSONAL — Tú como usuario",
            value:
              "**1,99€/mes · 10€/año · 15€ vitalicio**\n" +
              "• Beta access con funciones nuevas\n" +
              "• Soporte prioritario (<2h)\n" +
              "• Rol `@NEXA PREMIUM` en el servidor oficial\n" +
              "• Categoría privada para premiums\n" +
              "• Ver logs de todos tus servidores\n" +
              "• IA desbloqueada en cualquier servidor\n" +
              "• 1 ranura de hosting gestionado por NEXA",
            inline: false,
          },
          {
            name: "🟢 STARTER — 2,99€/mes por servidor",
            value:
              "• Tickets ilimitados (free = máx 50)\n" +
              "• 3 categorías de tickets\n" +
              "• Banner/imagen de bienvenida personalizado\n" +
              "• Auto-roles al entrar (hasta 3)\n" +
              "• Backup automático",
            inline: false,
          },
          {
            name: "🔵 PRO — 5,99€/mes por servidor",
            value:
              "Todo Starter **+**\n" +
              "• **Logs avanzados** (mensajes borrados, ediciones, entradas, etc.)\n" +
              "• **Sistema de niveles y XP** con roles por nivel\n" +
              "• **Sorteos** con requisitos de rol/nivel\n" +
              "• **Encuestas** con gráficos en tiempo real\n" +
              "• **Recordatorios** programados\n" +
              "• 10 auto-roles por reacción",
            inline: false,
          },
          {
            name: "🟣 ELITE — 12,99€/mes por servidor",
            value:
              "Todo Pro **+**\n" +
              "• **Economía** virtual (monedas, tienda de roles, banco)\n" +
              "• **IA integrada** con contexto del servidor (Groq)\n" +
              "• **Verificación avanzada** (captcha, edad mínima)\n" +
              "• **Auto-roles ilimitados**\n" +
              "• Soporte dedicado con acceso directo al equipo",
            inline: false,
          },
          {
            name: "🎁 Formas de conseguir premium gratis",
            value:
              "• Boostear el servidor oficial x2 → Personal gratis\n" +
              "• Reportar muchos bugs → Personal gratis\n" +
              "• Códigos secretos en nuestras RRSS\n" +
              "• `nexabot.com/premium` para pagar",
            inline: false,
          },
        )
        .setFooter({ text: "Las suscripciones NO se reembolsan • nexabot.com/premium" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== OWNER: ACTIVAR SERVIDOR ====================
    if (sub === "activar-servidor") {
      if (!BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Solo los owners del bot pueden usar este comando.` });
      }

      const guildId = interaction.options.getString("guild-id");
      const tier    = interaction.options.getString("tier");
      const months  = interaction.options.getInteger("meses");

      const ok = await activateGuildPremium(guildId, tier, months, interaction.user.id);
      if (!ok) return interaction.editReply({ content: `${EMOJI.CRUZ} Error activando premium.` });

      const embed = new EmbedBuilder()
        .setColor(TIER_COLORS[tier])
        .setTitle(`${EMOJI.CHECK} Premium Activado`)
        .addFields(
          { name: "Servidor ID", value: guildId, inline: true },
          { name: "Tier", value: `${TIER_EMOJIS[tier]} ${TIER_NAMES[tier]}`, inline: true },
          { name: "Duración", value: months === -1 ? "Vitalicio" : `${months} mes(es)`, inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== OWNER: ACTIVAR USUARIO ====================
    if (sub === "activar-usuario") {
      if (!BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Solo los owners del bot pueden usar este comando.` });
      }

      const target = interaction.options.getUser("usuario");
      const months = interaction.options.getInteger("meses");

      const ok = await activateUserPremium(target.id, "personal", months, interaction.user.id);
      if (!ok) return interaction.editReply({ content: `${EMOJI.CRUZ} Error activando premium.` });

      const embed = new EmbedBuilder()
        .setColor("#00d4ff")
        .setTitle(`${EMOJI.CHECK} Premium Personal Activado`)
        .addFields(
          { name: "Usuario", value: `${target.tag} (<@${target.id}>)`, inline: true },
          { name: "Duración", value: months === -1 ? "Vitalicio" : `${months} mes(es)`, inline: true },
        )
        .setTimestamp();

      // Intentar notificar al usuario por DM
      try {
        await target.send({
          embeds: [new EmbedBuilder()
            .setColor("#00d4ff")
            .setTitle("💎 ¡Tienes NEXA Premium Personal!")
            .setDescription(`Tu premium ha sido activado.\n\n**Duración:** ${months === -1 ? "Vitalicio" : `${months} mes(es)`}\n\nUsa \`/premium info\` para ver tus beneficios.`)
            .setTimestamp()
          ],
        });
      } catch {}

      return interaction.editReply({ embeds: [embed] });
    }

    // ==================== OWNER: REVOCAR ====================
    if (sub === "revocar-servidor") {
      if (!BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Solo los owners del bot pueden usar este comando.` });
      }
      const guildId = interaction.options.getString("guild-id");
      await revokeGuildPremium(guildId);
      return interaction.editReply({ content: `${EMOJI.CHECK} Premium del servidor \`${guildId}\` revocado.` });
    }

    if (sub === "revocar-usuario") {
      if (!BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Solo los owners del bot pueden usar este comando.` });
      }
      const target = interaction.options.getUser("usuario");
      await revokeUserPremium(target.id);
      return interaction.editReply({ content: `${EMOJI.CHECK} Premium de ${target.tag} revocado.` });
    }
  },
};
