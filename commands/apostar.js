const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const PREMIUM_ROLE_ID = "BOOSTER";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("apostar")
    .setDescription("Crear un evento de apuestas con UnbelievaBoat")
    .addStringOption(opt =>
      opt.setName("titulo").setDescription("Ej: Champions League: MADRID vs CITY").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("opcion1").setDescription("Nombre opción 1").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("opcion2").setDescription("Nombre opción 2").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("opcion3").setDescription("(Premium) Nombre opción 3").setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("opcion4").setDescription("(Premium) Nombre opción 4").setRequired(false)
    ),

  async execute(interaction) {
    const supabase = interaction.client.supabase;

    const EMOJI = {
      TICKET:      "<a:Ticket:1472541437470965942>",
      CRUZ:        "<a:CruzRoja:1480947488960806943>",
      CHECK:       "<a:Tick:1480638398816456848>",
      CORREO:      "<a:correo:1472550293152596000>",
      NUKE:        "<a:NUKE:1477617312679858318>",
      ADVERTENCIA: "<a:ADVERTENCIA:1477616948937490452>",
      NEXALOGO:    "<a:NEXALOGO:1477286399345561682>",
    };

    if (!supabase) {
      return interaction.reply({
        content: `${EMOJI.CRUZ} Supabase no está disponible en el cliente.`,
        ephemeral: true,
      });
    }

    const titulo  = interaction.options.getString("titulo");
    const opcion1 = interaction.options.getString("opcion1");
    const opcion2 = interaction.options.getString("opcion2");
    const opcion3 = interaction.options.getString("opcion3");
    const opcion4 = interaction.options.getString("opcion4");

    const miembro = interaction.member;
    const esBooster = miembro.premiumSince !== null;

    if ((opcion3 || opcion4) && !esBooster) {
      return interaction.reply({
        content: `${EMOJI.CRUZ} Las opciones 3 y 4 son exclusivas para **boosters del servidor** 🚀\nHaz boost al servidor para desbloquear apuestas con más opciones.`,
        ephemeral: true,
      });
    }

    const opciones = [opcion1, opcion2];
    if (esBooster && opcion3) opciones.push(opcion3);
    if (esBooster && opcion4) opciones.push(opcion4);

    await interaction.deferReply({ ephemeral: true });

    try {
      const emojiOpciones = ["🅰️", "🅱️", "🅲", "🅳"];

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

      const tempButtons = opciones.map((op, i) =>
        new ButtonBuilder()
          .setCustomId(`bet_event_pending_${i + 1}`)
          .setLabel(`Apostar por ${op}`)
          .setStyle(i === 0 ? ButtonStyle.Success : i === 1 ? ButtonStyle.Danger : ButtonStyle.Primary)
      );
      const tempRow = new ActionRowBuilder().addComponents(tempButtons);

      const msg = await interaction.channel.send({ embeds: [embed], components: [tempRow] });

      const insertData = {
        guild_id:   interaction.guild.id,
        channel_id: interaction.channel.id,
        message_id: msg.id,
        titulo,
        opcion1,
        opcion2,
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
        return interaction.editReply({
          content: `${EMOJI.CRUZ} Error guardando el evento en la base de datos.`,
        });
      }

      const eventId = data.id;

      const realButtons = opciones.map((op, i) =>
        new ButtonBuilder()
          .setCustomId(`bet_event_${eventId}_${i + 1}`)
          .setLabel(`Apostar por ${op}`)
          .setStyle(i === 0 ? ButtonStyle.Success : i === 1 ? ButtonStyle.Danger : ButtonStyle.Primary)
      );
      const realRow = new ActionRowBuilder().addComponents(realButtons);
      await msg.edit({ components: [realRow] });

      await interaction.editReply({
        content:
          `${EMOJI.CHECK} **Evento de apuestas creado correctamente.**\n\n` +
          `> 🆔 **ID del evento:** \`${eventId}\`\n` +
          `> ${EMOJI.ADVERTENCIA} **Guarda este ID**, lo necesitarás para dar el resultado con \`/resolverapuesta\`.\n` +
          `> ${EMOJI.NEXALOGO} El evento ya es visible en el canal.`,
      });

    } catch (err) {
      console.error("Error en /apostar:", err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `${EMOJI.CRUZ} Ocurrió un error creando el evento.` });
      } else {
        await interaction.reply({ content: `${EMOJI.CRUZ} Ocurrió un error creando el evento.`, ephemeral: true });
      }
    }
  },
};
