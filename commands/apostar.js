// ───────── SISTEMA DE APUESTAS: MODAL OPCIONES ─────────
if (interaction.isModalSubmit() && interaction.customId.startsWith("apostar_opciones_")) {
  // customId: apostar_opciones_<numOpciones>_<titulo>
  const partes = interaction.customId.split("_");
  // partes[0]="apostar" partes[1]="opciones" partes[2]=numOpciones partes[3..]=titulo codificado
  const numOpciones = parseInt(partes[2], 10);
  const titulo = decodeURIComponent(partes.slice(3).join("_"));

  const opciones = [];
  for (let i = 1; i <= numOpciones; i++) {
    opciones.push(interaction.fields.getTextInputValue(`opcion${i}`));
  }

  await interaction.deferReply({ ephemeral: true });

  const supabase = interaction.client.supabase;
  const emojiOpciones = ["🅰️", "🅱️", "🅲", "🅳"];
  const colores = [ButtonStyle.Success, ButtonStyle.Danger, ButtonStyle.Primary, ButtonStyle.Secondary];

  try {
    const embedFields = opciones.map((op, i) => ({
      name: `Opción ${i + 1}`,
      value: `${emojiOpciones[i]} ${op}`,
      inline: true,
    }));
    embedFields.push({ name: "Estado", value: "`ABIERTA`", inline: false });

    const embed = new EmbedBuilder()
      .setColor("#00BFFF")
      .setTitle(`${EMOJI.NEXALOGO} Evento de apuestas`)
      .setDescription(
        `**${titulo}**\n\n` +
        `Pulsa un botón para apostar por tu opción.\n` +
        `Cada apuesta usará tu saldo de UnbelievaBoat (cash).`
      )
      .addFields(embedFields)
      .setFooter({ text: "Sistema de apuestas NexaBot + UnbelievaBoat" })
      .setTimestamp();

    // Botones temporales
    const tempRow = new ActionRowBuilder().addComponents(
      opciones.map((op, i) =>
        new ButtonBuilder()
          .setCustomId(`bet_event_pending_${i + 1}`)
          .setLabel(`Apostar por ${op}`)
          .setStyle(colores[i])
      )
    );

    const msg = await interaction.channel.send({ embeds: [embed], components: [tempRow] });

    // Guardar en Supabase
    const insertData = {
      guild_id:   interaction.guild.id,
      channel_id: interaction.channel.id,
      message_id: msg.id,
      titulo,
      opcion1: opciones[0],
      opcion2: opciones[1],
      status: "open",
    };
    if (opciones[2]) insertData.opcion3 = opciones[2];
    if (opciones[3]) insertData.opcion4 = opciones[3];

    const { data, error } = await supabase
      .from("bet_events")
      .insert([insertData])
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase bet_events insert error:", error);
      return interaction.editReply({ content: `${EMOJI.CRUZ} Error guardando el evento en la base de datos.` });
    }

    const eventId = data.id;

    // Actualizar botones con ID real
    const realRow = new ActionRowBuilder().addComponents(
      opciones.map((op, i) =>
        new ButtonBuilder()
          .setCustomId(`bet_event_${eventId}_${i + 1}`)
          .setLabel(`Apostar por ${op}`)
          .setStyle(colores[i])
      )
    );
    await msg.edit({ components: [realRow] });

    await interaction.editReply({
      content:
        `${EMOJI.CHECK} **Evento de apuestas creado correctamente.**\n\n` +
        `> 🆔 **ID del evento:** \`${eventId}\`\n` +
        `> ${EMOJI.ADVERTENCIA} **Guarda este ID**, lo necesitarás para dar el resultado con \`/resolverapuesta\`.\n` +
        `> ${EMOJI.NEXALOGO} El evento ya es visible en el canal.`,
    });

  } catch (err) {
    console.error("Error creando apuesta desde modal:", err);
    await interaction.editReply({ content: `${EMOJI.CRUZ} Ocurrió un error creando el evento.` });
  }
  return;
}
