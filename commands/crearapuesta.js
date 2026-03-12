const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crearapuesta')
    .setDescription('Crea un panel de apuestas deportivas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('deporte').setDescription('Deporte (ej: Fútbol)').setRequired(true))
    .addStringOption(o => o.setName('competicion').setDescription('Competición (ej: La Liga)').setRequired(true))
    .addStringOption(o => o.setName('partido').setDescription('Partido (ej: Real Madrid vs Barcelona)').setRequired(true))
    .addNumberOption(o => o.setName('cuota_local').setDescription('Cuota victoria local (ej: 1.80)').setRequired(true))
    .addNumberOption(o => o.setName('cuota_empate').setDescription('Cuota empate (ej: 3.50)').setRequired(true))
    .addNumberOption(o => o.setName('cuota_visitante').setDescription('Cuota victoria visitante (ej: 4.20)').setRequired(true))
    .addIntegerOption(o => o.setName('minutos').setDescription('Minutos hasta cierre de apuestas').setRequired(true))
    .addIntegerOption(o => o.setName('apuesta_minima').setDescription('Apuesta mínima (default: 10)').setRequired(false))
    .addIntegerOption(o => o.setName('apuesta_maxima').setDescription('Apuesta máxima (default: 10000)').setRequired(false)),

  async execute(interaction) {
    const deporte = interaction.options.getString('deporte');
    const competicion = interaction.options.getString('competicion');
    const partido = interaction.options.getString('partido');
    const cuotaLocal = interaction.options.getNumber('cuota_local');
    const cuotaEmpate = interaction.options.getNumber('cuota_empate');
    const cuotaVisitante = interaction.options.getNumber('cuota_visitante');
    const minutos = interaction.options.getInteger('minutos');
    const apuestaMin = interaction.options.getInteger('apuesta_minima') || 10;
    const apuestaMax = interaction.options.getInteger('apuesta_maxima') || 10000;
    const closeTime = new Date(Date.now() + minutos * 60000);

    const { data: match, error } = await supabase
      .from('apuestas_partidos')
      .insert({
        guild_id: interaction.guild.id,
        deporte,
        competicion,
        partido,
        cuota_local: cuotaLocal,
        cuota_empate: cuotaEmpate,
        cuota_visitante: cuotaVisitante,
        close_time: closeTime.toISOString(),
        apuesta_min: apuestaMin,
        apuesta_max: apuestaMax,
        status: 'open'
      })
      .select()
      .single();

    if (error) {
      console.error('[crearapuesta] Error DB:', error);
      return interaction.reply({ content: '❌ Error al crear la apuesta en la base de datos.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎰 Apuesta Deportiva`)
      .setColor(0xF1C40F)
      .addFields(
        { name: '🏅 Deporte', value: deporte, inline: true },
        { name: '🏆 Competición', value: competicion, inline: true },
        { name: '⚽ Partido', value: partido, inline: false },
        { name: '🔴 Local', value: `x${cuotaLocal.toFixed(2)}`, inline: true },
        { name: '🟡 Empate', value: `x${cuotaEmpate.toFixed(2)}`, inline: true },
        { name: '🔵 Visitante', value: `x${cuotaVisitante.toFixed(2)}`, inline: true },
        { name: '⏰ Cierre', value: `<t:${Math.floor(closeTime.getTime() / 1000)}:R>`, inline: true },
        { name: '💰 Min/Max apuesta', value: `${apuestaMin} / ${apuestaMax} monedas`, inline: true }
      )
      .setFooter({ text: `ID: ${match.id} | Pulsa un botón para apostar` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`apuesta_local_${match.id}`).setLabel(`Local x${cuotaLocal.toFixed(2)}`).setStyle(ButtonStyle.Primary).setEmoji('🔴'),
      new ButtonBuilder().setCustomId(`apuesta_empate_${match.id}`).setLabel(`Empate x${cuotaEmpate.toFixed(2)}`).setStyle(ButtonStyle.Secondary).setEmoji('🟡'),
      new ButtonBuilder().setCustomId(`apuesta_visitante_${match.id}`).setLabel(`Visitante x${cuotaVisitante.toFixed(2)}`).setStyle(ButtonStyle.Danger).setEmoji('🔵')
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
};
