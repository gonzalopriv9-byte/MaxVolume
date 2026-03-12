const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('misapuestas')
    .setDescription('Ver tus apuestas activas y el historial'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const supabase = interaction.client.supabase;

    const { data: apuestas, error } = await supabase
      .from('apuestas_usuarios')
      .select('*, apuestas_partidos(partido, competicion, status, resultado, cuota_local, cuota_empate, cuota_visitante)')
      .eq('user_id', interaction.user.id)
      .eq('guild_id', interaction.guild.id)
      .order('created_at', { ascending: false })
      .limit(15);

    if (error || !apuestas?.length) {
      return interaction.editReply({ content: '📋 No tienes apuestas registradas en este servidor.' });
    }

    const cuotaLabel = { local: '🔴 Local', empate: '🟡 Empate', visitante: '🔵 Visitante' };
    const statusLabel = { open: '🟢 Abierta', closed: '🔒 Cerrada', resolved: '✅ Resuelta' };

    const fields = apuestas.map(a => {
      const p = a.apuestas_partidos;
      const cuotaMap = { local: p?.cuota_local, empate: p?.cuota_empate, visitante: p?.cuota_visitante };
      const cuota = cuotaMap[a.opcion] || 1;
      const gananciaEsperada = Math.floor(a.cantidad * cuota);
      let resultado = '';
      if (p?.status === 'resolved') {
        resultado = a.opcion === p.resultado ? `\n🏆 **GANASTE** +${gananciaEsperada} 💰` : `\n❌ Perdiste`;
      }
      return {
        name: `${p?.competicion || '?'} — ${p?.partido || 'Partido desconocido'}`,
        value: `Opción: **${cuotaLabel[a.opcion] || a.opcion}** | Apostado: **${a.cantidad}** 💰 | Cuota: x${Number(cuota).toFixed(2)}\nEstado: ${statusLabel[p?.status] || p?.status}${resultado}`,
        inline: false
      };
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎰 Mis apuestas — ${interaction.user.username}`)
      .setColor(0x3498DB)
      .addFields(fields)
      .setFooter({ text: `Mostrando las últimas ${apuestas.length} apuestas` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
