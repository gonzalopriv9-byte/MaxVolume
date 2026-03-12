const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');

// Map en memoria: apuestaId -> { matchData }
const apuestasActivas = new Map();
module.exports.apuestasActivas = apuestasActivas;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crearapuesta')
    .setDescription('Crea un panel de apuestas deportivas en tiempo real')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('deporte').setDescription('Deporte (ej: Fútbol)').setRequired(true))
    .addStringOption(o => o.setName('competicion').setDescription('Competición (ej: La Liga)').setRequired(true))
    .addStringOption(o => o.setName('partido').setDescription('Partido (ej: Real Madrid vs Barcelona)').setRequired(true))
    .addNumberOption(o => o.setName('cuota_local').setDescription('Cuota victoria local (ej: 1.80)').setRequired(true))
    .addNumberOption(o => o.setName('cuota_empate').setDescription('Cuota empate (ej: 3.50)').setRequired(true))
    .addNumberOption(o => o.setName('cuota_visitante').setDescription('Cuota visitante (ej: 4.20)').setRequired(true))
    .addIntegerOption(o => o.setName('minutos').setDescription('Minutos hasta cierre de apuestas').setRequired(true))
    .addIntegerOption(o => o.setName('apuesta_minima').setDescription('Apuesta mínima (default: 10)').setRequired(false))
    .addIntegerOption(o => o.setName('apuesta_maxima').setDescription('Apuesta máxima (default: 10000)').setRequired(false)),

  async execute(interaction) {
    const deporte      = interaction.options.getString('deporte');
    const competicion  = interaction.options.getString('competicion');
    const partido      = interaction.options.getString('partido');
    const cuotaLocal      = interaction.options.getNumber('cuota_local');
    const cuotaEmpate     = interaction.options.getNumber('cuota_empate');
    const cuotaVisitante  = interaction.options.getNumber('cuota_visitante');
    const minutos      = interaction.options.getInteger('minutos');
    const apuestaMin   = interaction.options.getInteger('apuesta_minima') || 10;
    const apuestaMax   = interaction.options.getInteger('apuesta_maxima') || 10000;
    const closeTime    = new Date(Date.now() + minutos * 60000);

    // Guardar en Supabase
    const supabase = interaction.client.supabase;
    const { data: match, error } = await supabase
      .from('apuestas_partidos')
      .insert({
        guild_id: interaction.guild.id,
        deporte,
        competicion,
        partido,
        cuota_local:     cuotaLocal,
        cuota_empate:    cuotaEmpate,
        cuota_visitante: cuotaVisitante,
        close_time:      closeTime.toISOString(),
        apuesta_min:     apuestaMin,
        apuesta_max:     apuestaMax,
        status:          'open',
        channel_id:      interaction.channel.id,
        created_by:      interaction.user.id
      })
      .select()
      .single();

    if (error) {
      console.error('[crearapuesta] DB error:', error);
      return interaction.reply({ content: '❌ Error al crear la apuesta en la base de datos.', ephemeral: true });
    }

    // Guardar en memoria para acceso rápido
    apuestasActivas.set(String(match.id), {
      ...match,
      participantes: { local: [], empate: [], visitante: [] }
    });

    const embed = buildPanelEmbed(match, { local: [], empate: [], visitante: [] });
    const row   = buildPanelButtons(match);

    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    // Guardar message_id para poder actualizar el panel
    await supabase
      .from('apuestas_partidos')
      .update({ message_id: msg.id })
      .eq('id', match.id);

    apuestasActivas.get(String(match.id)).message_id = msg.id;

    // Timer de cierre automático
    setTimeout(async () => {
      const activa = apuestasActivas.get(String(match.id));
      if (!activa || activa.status === 'closed') return;
      activa.status = 'closed';
      await supabase.from('apuestas_partidos').update({ status: 'closed' }).eq('id', match.id);
      try {
        const canal = await interaction.client.channels.fetch(interaction.channel.id);
        const mensaje = await canal.messages.fetch(msg.id);
        const embedCerrado = buildPanelEmbed({ ...match, status: 'closed' }, activa.participantes);
        const rowDesactivada = buildPanelButtons(match, true);
        await mensaje.edit({ embeds: [embedCerrado], components: [rowDesactivada] });
        await canal.send({ content: `⏰ **Las apuestas para \`${partido}\` han cerrado.** Un admin puede usar \`/cerrarapuesta\` para resolver el resultado.` });
      } catch (e) { console.error('[crearapuesta] Error cerrando panel:', e.message); }
    }, minutos * 60000);
  }
};

function buildPanelEmbed(match, participantes) {
  const totalLocal     = participantes.local.reduce((s, p) => s + p.cantidad, 0);
  const totalEmpate    = participantes.empate.reduce((s, p) => s + p.cantidad, 0);
  const totalVisitante = participantes.visitante.reduce((s, p) => s + p.cantidad, 0);
  const totalGeneral   = totalLocal + totalEmpate + totalVisitante;
  const cerrado        = match.status === 'closed';

  return new EmbedBuilder()
    .setTitle(`🎰 Apuesta Deportiva${cerrado ? ' — CERRADA' : ''}`)
    .setColor(cerrado ? 0x95A5A6 : 0xF1C40F)
    .addFields(
      { name: '🏅 Deporte',       value: match.deporte,      inline: true },
      { name: '🏆 Competición',   value: match.competicion,  inline: true },
      { name: '\u200b',           value: '\u200b',           inline: true },
      { name: '⚽ Partido',       value: `**${match.partido}**`, inline: false },
      { name: `🔴 Local  x${Number(match.cuota_local).toFixed(2)}`,      value: `${participantes.local.length} apostantes\n💰 ${totalLocal} monedas`,     inline: true },
      { name: `🟡 Empate  x${Number(match.cuota_empate).toFixed(2)}`,    value: `${participantes.empate.length} apostantes\n💰 ${totalEmpate} monedas`,   inline: true },
      { name: `🔵 Visitante  x${Number(match.cuota_visitante).toFixed(2)}`, value: `${participantes.visitante.length} apostantes\n💰 ${totalVisitante} monedas`, inline: true },
      { name: '📊 Total apostado', value: `${totalGeneral} monedas`, inline: true },
      { name: '⏰ Cierre',         value: cerrado ? '🔒 Cerrado' : `<t:${Math.floor(new Date(match.close_time).getTime() / 1000)}:R>`, inline: true },
      { name: '💰 Min/Max',        value: `${match.apuesta_min} / ${match.apuesta_max}`, inline: true }
    )
    .setFooter({ text: `ID: ${match.id} | ${cerrado ? 'Apuestas cerradas' : 'Pulsa un botón para apostar'}` })
    .setTimestamp();
}
module.exports.buildPanelEmbed = buildPanelEmbed;

function buildPanelButtons(match, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apuesta_local_${match.id}`).setLabel(`Local x${Number(match.cuota_local).toFixed(2)}`).setStyle(ButtonStyle.Primary).setEmoji('🔴').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`apuesta_empate_${match.id}`).setLabel(`Empate x${Number(match.cuota_empate).toFixed(2)}`).setStyle(ButtonStyle.Secondary).setEmoji('🟡').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`apuesta_visitante_${match.id}`).setLabel(`Visitante x${Number(match.cuota_visitante).toFixed(2)}`).setStyle(ButtonStyle.Danger).setEmoji('🔵').setDisabled(disabled)
  );
}
module.exports.buildPanelButtons = buildPanelButtons;
