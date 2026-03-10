// commands/givepersonality.js
// Asigna una personalidad/prompt personalizado a la IA del bot para este servidor
// Solo disponible con plan Elite

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getGuildTier } = require("../utils/premiumManager");
const { updateGuildConfig, loadGuildConfig } = require("../utils/configManager");

const EMOJI = {
  CHECK:       "<a:Tick:1480638398816456848>",
  CRUZ:        "<a:CruzRoja:1480947488960806943>",
  NEXALOGO:    "<a:NEXALOGO:1477286399345561682>",
  ADVERTENCIA: "<a:ADVERTENCIA:1477616948937490452>",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("givepersonality")
    .setDescription("Personaliza la IA del bot para este servidor [Solo Elite]")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName("set")
      .setDescription("Establece la personalidad de la IA")
      .addStringOption(o => o
        .setName("prompt")
        .setDescription("Instrucciones de personalidad para la IA (máx. 1000 caracteres)")
        .setRequired(true)
        .setMaxLength(1000)
      )
    )
    .addSubcommand(sub => sub
      .setName("ver")
      .setDescription("Muestra la personalidad actual configurada")
    )
    .addSubcommand(sub => sub
      .setName("reset")
      .setDescription("Restaura la personalidad por defecto de NexaBot")
    ),

  async execute(interaction) {
    // ── Check plan Elite ──────────────────────────────────
    const tier = await getGuildTier(interaction.guild.id);
    if (tier !== "elite") {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#f59e0b")
          .setTitle(EMOJI.ADVERTENCIA + " Plan Elite requerido")
          .setDescription("El comando `/givepersonality` y las funciones de IA avanzada solo están disponibles con el plan **Elite**.\n\nUsa `/premium` para ver los planes disponibles.")
          .setFooter({ text: "NexaBot Premium" })
        ],
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── VER ───────────────────────────────────────────────
    if (sub === "ver") {
      const config = await loadGuildConfig(interaction.guild.id);
      const prompt = config?.ai?.customPrompt || null;
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle(EMOJI.NEXALOGO + " Personalidad actual de la IA")
          .setDescription(prompt
            ? "```\n" + prompt + "\n```"
            : "Usando la personalidad **por defecto** de NexaBot.")
          .setFooter({ text: "Usa /givepersonality set para cambiarla" })
        ],
        ephemeral: true,
      });
    }

    // ── RESET ─────────────────────────────────────────────
    if (sub === "reset") {
      await updateGuildConfig(interaction.guild.id, { ai: { customPrompt: null } });
      return interaction.reply({
        content: EMOJI.CHECK + " Personalidad de la IA restaurada a los valores por defecto.",
        ephemeral: true,
      });
    }

    // ── SET ───────────────────────────────────────────────
    if (sub === "set") {
      const prompt = interaction.options.getString("prompt");
      await updateGuildConfig(interaction.guild.id, { ai: { customPrompt: prompt } });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#22c55e")
          .setTitle(EMOJI.CHECK + " Personalidad configurada")
          .setDescription("La IA usará el siguiente prompt en este servidor:")
          .addFields({ name: "📝 Prompt activo", value: "```\n" + prompt + "\n```" })
          .setFooter({ text: "Menciona al bot para probarlo" })
          .setTimestamp()
        ],
        ephemeral: true,
      });
    }
  },
};
