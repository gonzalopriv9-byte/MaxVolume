const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { supabase } = require('../utils/db');
const { removeMoney } = require('../utils/apuestasManager');

/**
 * Maneja los botones de apuestas y el submit del modal de cantidad.
 * Registrar en index.js:
 *   const { handleApuestasInteraction } = require('./handlers/apuestasHandler');
 *   // Dentro de interactionCreate:
 *   await handleApuestasInteraction(interaction);
 */
async function handleApuestasInteraction(interaction) {
  // --- Botón de apuesta deportiva ---
  if (interaction.isButton() && interaction.customId.startsWith('apuesta_')) {
    const parts = interaction.customId.split('_'); // ['apuesta', 'local'|'empate'|'visitante', matchId]
    const seleccion = parts[1];
    const matchId = parts[2];

    // Verificar que la apuesta sigue abierta
    const { data: match } = await supabase
      .from('apuestas_partidos')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match || match.status !== 'open') {
      return interaction.reply({ content: '⛔ Esta apuesta ya está cerrada.', ephemeral: true });
    }
    if (new Date() > new Date(match.close_time)) {
      await supabase.from('apuestas_partidos').update({ status: 'closed' }).eq('id', matchId);
      return interaction.reply({ content: '⛔ El tiempo de apuestas ha terminado.', ephemeral: true });
    }

    // Verificar si el usuario ya apostó en este partido
    const { data: existing } = await supabase
      .from('apuestas_usuarios')
      .select('id')
      .eq('match_id', matchId)
      .eq('user_id', interaction.user.id)
      .single();

    if (existing) {
      return interaction.reply({ content: '⚠️ Ya has apostado en este partido.', ephemeral: true });
    }

    // Determinar cuota según selección
    const cuotaMap = { local: match.cuota_local, empate: match.cuota_empate, visitante: match.cuota_visitante };
    const cuota = cuotaMap[seleccion];

    // Mostrar modal para que el usuario introduzca la cantidad
    const modal = new ModalBuilder()
      .setCustomId(`modal_apuesta_${matchId}_${seleccion}_${cuota}`)
      .setTitle(`Apostar en: ${match.partido}`);

    const input = new TextInputBuilder()
      .setCustomId('cantidad')
      .setLabel(`Cantidad (min: ${match.apuesta_min}, max: ${match.apuesta_max})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`Ej: 100`)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }

  // --- Submit del modal de apuesta deportiva ---
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_apuesta_')) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split('_'); // ['modal','apuesta', matchId, seleccion, cuota]
    const matchId = parts[2];
    const seleccion = parts[3];
    const cuota = parseFloat(parts[4]);
    const cantidadRaw = interaction.fields.getTextInputValue('cantidad');
    const cantidad = parseInt(cantidadRaw);

    const { data: match } = await supabase
      .from('apuestas_partidos')
      .select('*')
      .eq('id', matchId)
      .single();

    if (!match) return interaction.editReply({ content: '❌ Partido no encontrado.' });
    if (isNaN(cantidad) || cantidad < match.apuesta_min || cantidad > match.apuesta_max) {
      return interaction.editReply({ content: `❌ Cantidad inválida. Debe ser entre ${match.apuesta_min} y ${match.apuesta_max}.` });
    }

    // Quitar dinero con UnbelievaBoat
    const ok = await removeMoney(interaction.guild.id, interaction.user.id, cantidad);
    if (!ok) {
      return interaction.editReply({ content: '❌ No se pudo quitar el dinero. ¿Tienes saldo suficiente? Comprueba que el bot tiene los permisos en UnbelievaBoat.' });
    }

    // Guardar apuesta en DB
    await supabase.from('apuestas_usuarios').insert({
      guild_id: interaction.guild.id,
      match_id: matchId,
      user_id: interaction.user.id,
      selection: seleccion,
      amount: cantidad,
      odds: cuota,
      status: 'pending'
    });

    const gananciaEstimada = Math.floor(cantidad * cuota);
    const embed = new EmbedBuilder()
      .setTitle('✅ Apuesta registrada')
      .setColor(0x2ECC71)
      .addFields(
        { name: '⚽ Partido', value: match.partido, inline: false },
        { name: '🎯 Selección', value: seleccion.toUpperCase(), inline: true },
        { name: '💰 Apostado', value: `${cantidad} monedas`, inline: true },
        { name: '📈 Cuota', value: `x${cuota.toFixed(2)}`, inline: true },
        { name: '🏆 Ganas si aciertas', value: `${gananciaEstimada} monedas`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = { handleApuestasInteraction };
