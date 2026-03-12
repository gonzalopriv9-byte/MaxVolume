const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../utils/db');
const { pagarApuestasGanadoras } = require('../utils/apuestasManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cerrarapuesta')
    .setDescription('Cierra una apuesta deportiva y paga a los ganadores')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('id').setDescription('ID del partido (ver footer del panel)').setRequired(true))
    .addStringOption(o =>
      o.setName('resultado')
       .setDescription('Resultado final')
       .setRequired(true)
       .addChoices(
         { name: '🔴 Victoria Local', value: 'local' },
         { name: '🟡 Empate', value: 'empate' },
         { name: '🔵 Victoria Visitante', value: 'visitante' }
       )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const matchId = interaction.options.getString('id');
    const resultado = interaction.options.getString('resultado');

    const { data: match, error } = await supabase
      .from('apuestas_partidos')
      .select('*')
      .eq('id', matchId)
      .eq('guild_id', interaction.guild.id)
      .single();

    if (error || !match) {
      return interaction.editReply({ content: '❌ No se encontró ninguna apuesta con ese ID.' });
    }
    if (match.status !== 'open') {
      return interaction.editReply({ content: '⚠️ Esta apuesta ya está cerrada.' });
    }

    const { ganadores, perdedores } = await pagarApuestasGanadoras(matchId, resultado, interaction.guild.id, interaction.client);

    await supabase.from('apuestas_partidos').update({ status: 'closed', winner: resultado }).eq('id', matchId);

    const embed = new EmbedBuilder()
      .setTitle('🏁 Apuesta Cerrada')
      .setColor(0x2ECC71)
      .addFields(
        { name: '⚽ Partido', value: match.partido, inline: false },
        { name: '🏆 Resultado', value: resultado.toUpperCase(), inline: true },
        { name: '✅ Ganadores', value: `${ganadores} usuarios cobrados`, inline: true },
        { name: '❌ Perdedores', value: `${perdedores} usuarios`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
