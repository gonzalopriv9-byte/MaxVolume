// commands/sorteo.js
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { createGiveaway, rerollGiveaway, endGiveaway } = require("../utils/giveawayManager");
const { getEffectiveLimits } = require("../utils/premiumManager");

const EMOJI = {
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ:  "<a:Cruz:1472540885102235689>",
};

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2];
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * ms[unit];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sorteo")
    .setDescription("Sistema de sorteos/giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName("crear")
        .setDescription("Crear un nuevo sorteo")
        .addStringOption(opt => opt.setName("premio").setDescription("¿Qué se sortea?").setRequired(true))
        .addStringOption(opt => opt.setName("duracion").setDescription("Duración: 1m, 1h, 1d, etc.").setRequired(true))
        .addIntegerOption(opt => opt.setName("ganadores").setDescription("Número de ganadores (default: 1)").setMinValue(1).setMaxValue(10))
        .addRoleOption(opt => opt.setName("rol-requerido").setDescription("Rol necesario para participar"))
        .addIntegerOption(opt => opt.setName("nivel-minimo").setDescription("Nivel mínimo para participar").setMinValue(1)))
    .addSubcommand(sub =>
      sub.setName("terminar")
        .setDescription("Terminar un sorteo antes de tiempo")
        .addStringOption(opt => opt.setName("id").setDescription("ID del sorteo").setRequired(true)))
    .addSubcommand(sub =>
      sub.setName("reroll")
        .setDescription("Elegir un nuevo ganador")
        .addStringOption(opt => opt.setName("id").setDescription("ID del sorteo").setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const limits = await getEffectiveLimits(interaction.guild.id);
    if (!limits.hasGiveaways) {
      return interaction.reply({
        content: "🔵 **Los sorteos requieren NEXA Pro** (5,99€/mes)\nActívalo en: `/premium info`",
        flags: 64,
      });
    }

    await interaction.deferReply();

    // ==================== CREAR ====================
    if (sub === "crear") {
      const prize    = interaction.options.getString("premio");
      const durStr   = interaction.options.getString("duracion");
      const winners  = interaction.options.getInteger("ganadores") || 1;
      const reqRole  = interaction.options.getRole("rol-requerido");
      const minLevel = interaction.options.getInteger("nivel-minimo");

      const durationMs = parseDuration(durStr);
      if (!durationMs || durationMs < 10000) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Duración inválida. Usa formato: \`10s\`, \`30m\`, \`2h\`, \`1d\`` });
      }
      if (durationMs > 30 * 86400000) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} La duración máxima es 30 días.` });
      }

      const id = await createGiveaway(interaction.channel, {
        prize,
        durationMs,
        winnersCount: winners,
        requiredRole: reqRole?.id || null,
        minLevel: minLevel || null,
      }, interaction.user.id);

      if (!id) return interaction.editReply({ content: `${EMOJI.CRUZ} Error al crear el sorteo.` });

      return interaction.editReply({ content: `${EMOJI.CHECK} Sorteo creado (ID: \`${id}\`) 🎉` });
    }

    // ==================== TERMINAR ====================
    if (sub === "terminar") {
      const id = interaction.options.getString("id");
      await endGiveaway(id, interaction.client, console.log);
      return interaction.editReply({ content: `${EMOJI.CHECK} Sorteo terminado.` });
    }

    // ==================== REROLL ====================
    if (sub === "reroll") {
      const id = interaction.options.getString("id");
      const newWinner = await rerollGiveaway(id, interaction.guild, console.log);
      if (!newWinner) return interaction.editReply({ content: `${EMOJI.CRUZ} No se pudo hacer reroll.` });
      return interaction.editReply({ content: `🎉 Nuevo ganador: <@${newWinner}>!` });
    }
  },
};
