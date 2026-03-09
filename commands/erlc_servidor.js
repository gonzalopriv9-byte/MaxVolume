// commands/erlc_servidor.js
// Abre o cierra el servidor de ERLC con anuncio en canal configurado

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { loadGuildConfig, updateGuildConfig } = require("../utils/configManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("servidor")
    .setDescription("Gestiona el estado del servidor de ERLC")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
      .setName("abrir")
      .setDescription("Anuncia que el servidor está abierto")
      .addStringOption(o => o.setName("notas").setDescription("Notas adicionales para el anuncio").setRequired(false))
      .addIntegerOption(o => o.setName("slots").setDescription("Plazas disponibles").setRequired(false).setMinValue(1).setMaxValue(200))
    )
    .addSubcommand(sub => sub
      .setName("cerrar")
      .setDescription("Anuncia que el servidor está cerrado")
      .addStringOption(o => o.setName("motivo").setDescription("Motivo del cierre").setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName("config")
      .setDescription("Configura el canal de anuncios del servidor")
      .addChannelOption(o => o.setName("canal").setDescription("Canal donde se anunciará el estado").setRequired(true))
      .addRoleOption(o => o.setName("rol_ping").setDescription("Rol al que se mencionará en los anuncios").setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName("estado")
      .setDescription("Muestra el estado actual del servidor")
    ),

  async execute(interaction) {
    const sub      = interaction.options.getSubcommand();
    const config   = await loadGuildConfig(interaction.guild.id);
    const supabase = interaction.client.supabase;

    // ── CONFIG ────────────────────────────────────────────────
    if (sub === "config") {
      const canal   = interaction.options.getChannel("canal");
      const rolPing = interaction.options.getRole("rol_ping");
      await updateGuildConfig(interaction.guild.id, {
        erlc: { ...(config?.erlc || {}), canalServidor: canal.id, rolPing: rolPing?.id || null }
      });
      return interaction.reply({
        content: `✅ Canal configurado: <#${canal.id}>${rolPing ? ` | Ping: <@&${rolPing.id}>` : ""}`,
        ephemeral: true,
      });
    }

    // ── ESTADO ────────────────────────────────────────────────
    if (sub === "estado") {
      const estadoActual = config?.erlc?.estadoServidor || "desconocido";
      const abiertoPor   = config?.erlc?.abiertoPor || null;
      const desde        = config?.erlc?.desdeTimestamp || null;
      const embed = new EmbedBuilder()
        .setColor(estadoActual === "abierto" ? "#22c55e" : "#ef4444")
        .setTitle("🎮 Estado del Servidor ERLC")
        .addFields(
          { name: "Estado",   value: estadoActual === "abierto" ? "🟢 Abierto" : "🔴 Cerrado", inline: true },
          { name: "Desde",    value: desde ? `<t:${desde}:R>` : "—", inline: true },
          { name: "Gestionado por", value: abiertoPor ? `<@${abiertoPor}>` : "—", inline: true },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── ABRIR / CERRAR ────────────────────────────────────────
    const canalId = config?.erlc?.canalServidor;
    if (!canalId) {
      return interaction.reply({
        content: "❌ No hay un canal configurado. Usa `/servidor config` primero.",
        ephemeral: true,
      });
    }
    const canal = interaction.guild.channels.cache.get(canalId);
    if (!canal) return interaction.reply({ content: "❌ Canal no encontrado.", ephemeral: true });

    const rolPingId = config?.erlc?.rolPing;
    const pingContent = rolPingId ? `<@&${rolPingId}> ` : "";

    if (sub === "abrir") {
      const notas = interaction.options.getString("notas") || null;
      const slots = interaction.options.getInteger("slots") || null;

      await updateGuildConfig(interaction.guild.id, {
        erlc: { ...(config?.erlc || {}), estadoServidor: "abierto", abiertoPor: interaction.user.id, desdeTimestamp: Math.floor(Date.now()/1000) }
      });

      const embed = new EmbedBuilder()
        .setColor("#22c55e")
        .setTitle("🟢 ¡SERVIDOR ABIERTO!")
        .setDescription("El servidor de ERLC está **abierto** y listo para jugar.")
        .addFields(
          { name: "👮 Abierto por",  value: `<@${interaction.user.id}>`,       inline: true },
          { name: "🕐 Hora apertura",value: `<t:${Math.floor(Date.now()/1000)}:T>`, inline: true },
          ...(slots ? [{ name: "🎮 Plazas",    value: `${slots} slots`,          inline: true }] : []),
          ...(notas ? [{ name: "📝 Notas",     value: notas,                     inline: false }] : []),
        )
        .setFooter({ text: "ERLC • Estado del servidor" })
        .setTimestamp();

      await canal.send({ content: pingContent, embeds: [embed] });
      return interaction.reply({ content: "✅ Servidor marcado como **abierto**.", ephemeral: true });
    }

    if (sub === "cerrar") {
      const motivo = interaction.options.getString("motivo") || "Sin especificar";

      await updateGuildConfig(interaction.guild.id, {
        erlc: { ...(config?.erlc || {}), estadoServidor: "cerrado", abiertoPor: null, desdeTimestamp: null }
      });

      const embed = new EmbedBuilder()
        .setColor("#ef4444")
        .setTitle("🔴 SERVIDOR CERRADO")
        .setDescription("El servidor de ERLC está **cerrado** temporalmente.")
        .addFields(
          { name: "👮 Cerrado por",  value: `<@${interaction.user.id}>`,       inline: true },
          { name: "🕐 Hora cierre",  value: `<t:${Math.floor(Date.now()/1000)}:T>`, inline: true },
          { name: "📝 Motivo",       value: motivo,                             inline: false },
        )
        .setFooter({ text: "ERLC • Estado del servidor" })
        .setTimestamp();

      await canal.send({ content: pingContent, embeds: [embed] });
      return interaction.reply({ content: "✅ Servidor marcado como **cerrado**.", ephemeral: true });
    }
  },
};
