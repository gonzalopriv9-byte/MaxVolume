// commands/encuesta.js
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { createPoll, endPoll } = require("../utils/pollSystem");
const { getEffectiveLimits } = require("../utils/premiumManager");

const EMOJI = {
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ:  "<a:Cruz:1472540885102235689>",
};

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2];
  return n * { m: 60000, h: 3600000, d: 86400000 }[unit];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("encuesta")
    .setDescription("Crear una encuesta con votación")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName("crear")
        .setDescription("Crear una nueva encuesta")
        .addStringOption(opt => opt.setName("pregunta").setDescription("Pregunta de la encuesta").setRequired(true))
        .addStringOption(opt => opt.setName("opcion1").setDescription("Opción 1").setRequired(true))
        .addStringOption(opt => opt.setName("opcion2").setDescription("Opción 2").setRequired(true))
        .addStringOption(opt => opt.setName("opcion3").setDescription("Opción 3"))
        .addStringOption(opt => opt.setName("opcion4").setDescription("Opción 4"))
        .addStringOption(opt => opt.setName("opcion5").setDescription("Opción 5"))
        .addStringOption(opt => opt.setName("duracion").setDescription("Duración automática: 30m, 2h, 1d (opcional)")))
    .addSubcommand(sub =>
      sub.setName("cerrar")
        .setDescription("Cerrar una encuesta")
        .addStringOption(opt => opt.setName("id").setDescription("ID de la encuesta").setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const limits = await getEffectiveLimits(interaction.guild.id);
    if (!limits.hasPolls) {
      return interaction.reply({
        content: "🔵 **Las encuestas requieren NEXA Pro** (5,99€/mes)\nActívalo en: `/premium info`",
        flags: 64,
      });
    }

    // ==================== CREAR ====================
    if (sub === "crear") {
      await interaction.deferReply();

      const question = interaction.options.getString("pregunta");
      const options = [1, 2, 3, 4, 5]
        .map(i => interaction.options.getString(`opcion${i}`))
        .filter(Boolean);

      if (options.length < 2) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Necesitas al menos 2 opciones.` });
      }

      const durStr   = interaction.options.getString("duracion");
      const duration = parseDuration(durStr);

      const id = await createPoll(interaction.channel, question, options, interaction.user.id, duration);
      if (!id) return interaction.editReply({ content: `${EMOJI.CRUZ} Error al crear la encuesta.` });

      return interaction.editReply({ content: `${EMOJI.CHECK} Encuesta creada (ID: \`${id}\`) 📊` });
    }

    // ==================== CERRAR ====================
    if (sub === "cerrar") {
      await interaction.deferReply({ flags: 64 });
      const id = interaction.options.getString("id");
      const success = await endPoll(id, interaction.guild, interaction.user.id, console.log);
      if (!success) return interaction.editReply({ content: `${EMOJI.CRUZ} No se pudo cerrar. Verifica el ID o que seas el creador.` });
      return interaction.editReply({ content: `${EMOJI.CHECK} Encuesta cerrada.` });
    }
  },
};
