const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { apuestasActivas, buildPanelEmbed, buildPanelButtons } = require('./crearapuesta');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cerrarapuesta')
    .setDescription('Resuelve una apuesta y reparte ganancias')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('id').setDescription('ID de la apuesta').setRequired(true))
    .addStringOption(o =>
      o.setName('resultado')
        .setDescription('Resultado del partido')
        .setRequired(true)
        .addChoices(
          { name: '🔴 Victoria Local',    value: 'local' },
          { name: '🟡 Empate',             value: 'empate' },
          { name: '🔵 Victoria Visitante', value: 'visitante' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const id        = interaction.options.getInteger('id');
    const resultado = interaction.options.getString('resultado');
    const supabase  = interaction.client.supabase;

    // Cargar partido de Supabase
    const { data: match, error: matchErr } = await supabase
      .from('apuestas_partidos')
      .select('*')
      .eq('id', id)
      .eq('guild_id', interaction.guild.id)
      .single();

    if (matchErr || !match) {
      return interaction.editReply({ content: `❌ No se encontró la apuesta con ID \`${id}\`.` });
    }
    if (match.status === 'resolved') {
      return interaction.editReply({ content: '❌ Esta apuesta ya fue resuelta.' });
    }

    // Cargar apuestas individuales
    const { data: apuestas } = await supabase
      .from('apuestas_usuarios')
      .select('*')
      .eq('partido_id', id);

    const ganadores = (apuestas || []).filter(a => a.opcion === resultado);
    const cuotaMap  = { local: match.cuota_local, empate: match.cuota_empate, visitante: match.cuota_visitante };
    const cuota     = cuotaMap[resultado];

    let totalPagado = 0;
    const errores   = [];

    // Repartir ganancias
    for (const g of ganadores) {
      const premio = Math.floor(g.cantidad * cuota);
      try {
        await interaction.client.ubAddBalance(interaction.guild.id, g.user_id, { cash: premio });
        totalPagado += premio;
      } catch (e) {
        errores.push(`<@${g.user_id}>: ${e.message}`);
      }
    }

    // Marcar como resuelta
    await supabase
      .from('apuestas_partidos')
      .update({ status: 'resolved', resultado })
      .eq('id', id);

    // Actualizar panel en el canal original
    try {
      if (match.channel_id && match.message_id) {
        const canal   = await interaction.client.channels.fetch(match.channel_id);
        const mensaje = await canal.messages.fetch(match.message_id);

        // Reconstruir participantes para el embed
        const participantes = { local: [], empate: [], visitante: [] };
        for (const a of (apuestas || [])) {
          participantes[a.opcion]?.push({ userId: a.user_id, cantidad: a.cantidad });
        }

        const resultadoEmoji = { local: '🔴 Local', empate: '🟡 Empate', visitante: '🔵 Visitante' }[resultado];
        const embedResuelto = buildPanelEmbed({ ...match, status: 'resolved' }, participantes)
          .setColor(0x2ECC71)
          .setTitle(`✅ Apuesta Resuelta — ${resultadoEmoji} gana`)
          .addFields({ name: '🏆 Resultado', value: resultadoEmoji, inline: true },
                     { name: '👥 Ganadores', value: `${ganadores.length}`, inline: true },
                     { name: '💸 Total pagado', value: `${totalPagado} monedas`, inline: true });

        await mensaje.edit({ embeds: [embedResuelto], components: [buildPanelButtons(match, true)] });

        // Anuncio en el canal
        const listaGanadores = ganadores.slice(0, 10).map(g => `<@${g.user_id}> +${Math.floor(g.cantidad * cuota)} 💰`).join('\n');
        await canal.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ECC71)
              .setTitle(`🏆 Resultado: ${match.partido}`)
              .setDescription(`El resultado fue **${resultadoEmoji}**\n\n**Ganadores:**\n${listaGanadores || 'Nadie apostó a este resultado'}${ganadores.length > 10 ? `\n...y ${ganadores.length - 10} más` : ''}`)
              .addFields({ name: '💸 Total repartido', value: `${totalPagado} monedas`, inline: true })
              .setTimestamp()
          ]
        });
      }
    } catch (e) {
      console.error('[cerrarapuesta] Error actualizando panel:', e.message);
    }

    // Actualizar memoria si existe
    if (apuestasActivas.has(String(id))) {
      apuestasActivas.get(String(id)).status = 'resolved';
    }

    let respuesta = `✅ Apuesta **${match.partido}** resuelta.\nResultado: **${resultado}** | Ganadores: **${ganadores.length}** | Pagado: **${totalPagado} monedas**`;
    if (errores.length) respuesta += `\n\n⚠️ Errores al pagar:\n${errores.join('\n')}`;
    await interaction.editReply({ content: respuesta });
  }
};
