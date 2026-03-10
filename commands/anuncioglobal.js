// commands/anuncioglobal.js
// Manda un anuncio a todos los servidores donde está el bot
// Solo puede usarlo el usuario con ID 1352652366330986526

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const OWNER_ID = "1352652366330986526";

const EMOJI = {
  CHECK:       "<a:Tick:1480638398816456848>",
  CRUZ:        "<a:CruzRoja:1480947488960806943>",
  NEXALOGO:    "<a:NEXALOGO:1477286399345561682>",
  ADVERTENCIA: "<a:ADVERTENCIA:1477616948937490452>",
  CORREO:      "<a:correo:1472550293152596000>",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anuncioglobal")
    .setDescription("Envía un anuncio a todos los servidores [Solo desarrollador]")
    .addStringOption(o => o
      .setName("titulo")
      .setDescription("Título del anuncio")
      .setRequired(true)
      .setMaxLength(256)
    )
    .addStringOption(o => o
      .setName("mensaje")
      .setDescription("Contenido del anuncio")
      .setRequired(true)
      .setMaxLength(2000)
    )
    .addStringOption(o => o
      .setName("color")
      .setDescription("Color del embed")
      .setRequired(false)
      .addChoices(
        { name: "🔵 Azul (por defecto)", value: "#5865F2" },
        { name: "🟢 Verde",              value: "#22c55e" },
        { name: "🔴 Rojo",               value: "#ef4444" },
        { name: "🟡 Amarillo",           value: "#f59e0b" },
        { name: "⚪ Blanco",             value: "#e8ecf8" },
      )
    )
    .addBooleanOption(o => o
      .setName("ping")
      .setDescription("¿Mencionar @everyone en cada servidor?")
      .setRequired(false)
    ),

  async execute(interaction) {
    // ── Solo el desarrollador ─────────────────────────────
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: EMOJI.CRUZ + " No tienes permiso para usar este comando.",
        ephemeral: true,
      });
    }

    const titulo  = interaction.options.getString("titulo");
    const mensaje = interaction.options.getString("mensaje");
    const color   = interaction.options.getString("color") || "#5865F2";
    const ping    = interaction.options.getBoolean("ping") ?? false;

    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(EMOJI.NEXALOGO + " " + titulo)
      .setDescription(mensaje)
      .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: "NexaBot • Anuncio Global" })
      .setTimestamp();

    const guilds   = interaction.client.guilds.cache;
    let enviados   = 0;
    let fallidos   = 0;

    for (const [, guild] of guilds) {
      try {
        // Buscar el primer canal donde el bot pueda escribir
        const canal = guild.channels.cache
          .filter(c =>
            c.type === 0 &&
            c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages) &&
            c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.EmbedLinks)
          )
          .sort((a, b) => a.position - b.position)
          .first();

        if (!canal) { fallidos++; continue; }

        await canal.send({
          content: ping ? "@everyone" : undefined,
          embeds:  [embed],
          allowedMentions: ping ? { parse: ["everyone"] } : { parse: [] },
        });

        enviados++;

        // Pequeña pausa para respetar rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch {
        fallidos++;
      }
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor("#22c55e")
        .setTitle(EMOJI.CHECK + " Anuncio global enviado")
        .addFields(
          { name: "✅ Enviado",  value: `${enviados} servidores`,  inline: true },
          { name: "❌ Fallidos", value: `${fallidos} servidores`,  inline: true },
          { name: "📊 Total",    value: `${guilds.size} servidores`, inline: true },
        )
        .setTimestamp()
      ],
    });
  },
};
