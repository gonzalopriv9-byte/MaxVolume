const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const EMOJI = {
  CRUZ:     "<a:CruzRoja:1480947488960806943>",
  CHECK:    "<a:Tick:1480638398816456848>",
  NEXALOGO: "<a:NEXALOGO:1477286399345561682>",
  LOADING:  "<a:Loading:1481763726972555324>",
};

console.log("✅ resolverapuesta CARGADO");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resolverapuesta")
    .setDescription("Resolver o gestionar una apuesta")
    .addSubcommand(sub =>
      sub.setName("resultado")
        .setDescription("Declarar el resultado ganador de un evento")
        .addStringOption(opt => opt.setName("id").setDescription("ID del evento").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("cerrar")
        .setDescription("Cerrar apuestas (ya no se aceptan nuevas, pero aún no se resuelve)")
        .addStringOption(opt => opt.setName("id").setDescription("ID del evento").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("cancelar")
        .setDescription("Cancelar un evento y devolver el dinero a todos")
        .addStringOption(opt => opt.setName("id").setDescription("ID del evento").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("info")
        .setDescription("Ver información y apuestas de un evento")
        .addStringOption(opt => opt.setName("id").setDescription("ID del evento").setRequired(true))
    ),

  async execute(interaction) {
    const supabase = interaction.client.supabase;
    const sub      = interaction.options.getSubcommand();
    const eventId  = interaction.options.getString("id");

    await interaction.deferReply({ ephemeral: true });

    const { data: event, error: evErr } = await supabase
      .from("bet_events").select("*").eq("id", eventId).single();

    if (evErr || !event)
      return interaction.editReply({ content: `${EMOJI.CRUZ} Evento \`${eventId}\` no encontrado.` });

    // ── INFO
    if (sub === "info") {
      const { data: bets } = await supabase.from("bets").select("*").eq("event_id", eventId);
      const total = (bets || []).reduce((a, b) => a + b.amount, 0);

      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle(`${EMOJI.NEXALOGO} Evento: ${event.titulo}`)
        .addFields(
          { name: "Estado",      value: event.status,           inline: true },
          { name: "Apostadores", value: String((bets || []).length), inline: true },
          { name: "Pozo total",  value: `${total.toLocaleString()} 💵`, inline: true },
        )
        .setFooter({ text: `ID: ${eventId}` })
        .setTimestamp();

      for (let i = 1; i <= 4; i++) {
        if (!event[`opcion${i}`]) continue;
        const sub = (bets || []).filter(b => b.option === i);
        const suma = sub.reduce((a, b) => a + b.amount, 0);
        embed.addFields({
          name: `Opción ${i}: ${event[`opcion${i}`]}`,
          value: `${sub.length} apostadores • ${suma.toLocaleString()} 💵`,
          inline: false,
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    // ── CERRAR
    if (sub === "cerrar") {
      if (event.status !== "open")
        return interaction.editReply({ content: `${EMOJI.CRUZ} El evento no está abierto (estado: \`${event.status}\`).` });

      await supabase.from("bet_events").update({ status: "closed" }).eq("id", eventId);

      // Actualizar mensaje del canal con botones desactivados
      try {
        const guild   = await interaction.client.guilds.fetch(event.guild_id);
        const channel = await guild.channels.fetch(event.channel_id);
        const msg     = await channel.messages.fetch(event.message_id);
        const apostarCmd = interaction.client.commands.get("apostar");
        if (apostarCmd?.buildEventEmbed && apostarCmd?.buildBetButtons) {
          const updatedEvent = { ...event, status: "closed" };
          const embed = await apostarCmd.buildEventEmbed(supabase, updatedEvent);
          const rows  = apostarCmd.buildBetButtons(updatedEvent, true);
          await msg.edit({ embeds: [embed], components: rows });
        }
      } catch (_) {}

      return interaction.editReply({ content: `${EMOJI.CHECK} Apuestas cerradas para **${event.titulo}**. Ya no se aceptan nuevas apuestas.\nUsa \`/resolverapuesta resultado\` cuando quieras dar el ganador.` });
    }

    // ── CANCELAR
    if (sub === "cancelar") {
      if (event.status === "resolved")
        return interaction.editReply({ content: `${EMOJI.CRUZ} El evento ya fue resuelto, no se puede cancelar.` });

      const { data: bets } = await supabase.from("bets").select("*").eq("event_id", eventId);
      let devueltos = 0;
      for (const b of (bets || [])) {
        try {
          await interaction.client.ubAddBalance(event.guild_id, b.user_id, { cash: b.amount });
          devueltos++;
        } catch (_) {}
      }

      await supabase.from("bet_events").update({ status: "cancelled" }).eq("id", eventId);

      try {
        const guild   = await interaction.client.guilds.fetch(event.guild_id);
        const channel = await guild.channels.fetch(event.channel_id);
        const msg     = await channel.messages.fetch(event.message_id);
        const cancelEmbed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(`❌ Apuesta Cancelada: ${event.titulo}`)
          .setDescription("El evento fue cancelado. Todas las apuestas han sido devueltas.")
          .setTimestamp();
        await msg.edit({ embeds: [cancelEmbed], components: [] });
      } catch (_) {}

      return interaction.editReply({ content: `${EMOJI.CHECK} Evento cancelado. Se devolvió el dinero a **${devueltos}** apostadores.` });
    }

    // ── RESULTADO
    if (sub === "resultado") {
      if (event.status === "resolved")
        return interaction.editReply({ content: `${EMOJI.CRUZ} Este evento ya fue resuelto.` });

      const opciones = [];
      for (let i = 1; i <= 4; i++) {
        if (event[`opcion${i}`])
          opciones.push({ label: `${["🟢","🔴","🔵","⚫"][i-1]} Opción ${i}: ${event[`opcion${i}`]}`, value: String(i) });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`resolve_event_${eventId}`)
        .setPlaceholder("Selecciona la opción ganadora...")
        .addOptions(opciones);

      const row = new ActionRowBuilder().addComponents(select);
      return interaction.editReply({ content: `${EMOJI.NEXALOGO} **${event.titulo}** — Selecciona el ganador:`, components: [row] });
    }
  },
};
