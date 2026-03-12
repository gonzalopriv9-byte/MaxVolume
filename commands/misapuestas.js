const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { supabase } = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('misapuestas')
    .setDescription('Ver tu historial de apuestas'),

  async execute(interaction) {
    const { data: bets } = await supabase
      .from('apuestas_usuarios')
      .select('*, apuestas_partidos(partido, status, winner)')
      .eq('user_id', interaction.user.id)
      .eq('guild_id', interaction.guild.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!bets || bets.length === 0) {
      return interaction.reply({ content: '📭 No tienes ninguna apuesta registrada.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎰 Tus últimas apuestas`)
      .setColor(0x3498DB)
      .setDescription(
        bets.map(b => {
          const estado = b.status === 'won' ? '✅ Ganada' : b.status === 'lost' ? '❌ Perdida' : '⏳ Pendiente';
          const partido = b.apuestas_partidos?.partido || 'Desconocido';
          return `**${partido}** — ${b.selection.toUpperCase()} — ${b.amount} monedas — ${estado}`;
        }).join('\n')
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
