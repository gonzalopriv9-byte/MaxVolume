const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  StringSelectMenuBuilder, 
  ActionRowBuilder 
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resolverapuesta')
    .setDescription('Resuelve una apuesta existente')
    .addStringOption(option =>
      option.setName('id_apuesta')
        .setDescription('ID de la apuesta a resolver')
        .setRequired(true)
    ),

  async execute(interaction) {
    const idApuesta = interaction.options.getString('id_apuesta');
    
    // Buscar apuesta en DB (ajusta tu esquema Supabase)
    const { data: apuesta, error } = await supabase
      .from('apuestas')
      .select('*')
      .eq('id', idApuesta)
      .single();

    if (error || !apuesta) {
      return interaction.reply({ content: 'Apuesta no encontrada.', ephemeral: true });
    }

    // Menú para seleccionar resultado
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_resultado')
      .setPlaceholder('Elige el ganador...')
      .addOptions([
        { label: 'Equipo Local Gana', value: 'local' },
        { label: 'Equipo Visitante Gana', value: 'visitante' },
        { label: 'Empate', value: 'empate' }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setTitle(`Resolviendo: ${apuesta.partido}`)
      .setDescription(`Cuotas: Local ${apuesta.cuotaLocal}, Visitante ${apuesta.cuotaVisitante}, Empate ${apuesta.cuotaEmpate}`)
      .addFields({ name: 'Total Apostado', value: `${apuesta.totalApostado}¢`, inline: true });

    await interaction.reply({ embeds: [embed], components: [row] });

    // Collector para el menú (en tu handler de interacciones)
    // En interactions.js, maneja 'select_resultado':
    /*
    const resultado = selected.values[0];
    const ganadores = apuesta.apostantes.filter(a => a.equipo === resultado);
    const premioTotal = apuesta.totalApostado * 0.95; // 5% casa

    for (const gan of ganadores) {
      const ganancia = (premioTotal * gan.monto) / apuesta.totalLocal; // Ej para local
      // Ejecutar slash de UnbelievaBoat
      await interaction.client.api.applications(CLIENT_ID).guilds(GUILD_ID).commands(UBOAT_APP_ID).post({
        data: {
          type: 2, // Slash command
          application_id: UBOAT_APP_ID,
          guild_id: GUILD_ID,
          channel_id: interaction.channel.id,
          data: {
            name: resultado === 'local' || resultado === 'empate' ? 'add-money' : 'add-money',
            options: [
              { name: 'cash', type: 5, value: 'cash' }, // String choice?
              { name: 'member', type: 6, value: gan.userId },
              { name: 'amount', type: 10, value: ganancia }
            ]
          }
        }
      });
    }
    // Similar para perdedores: remove-money
    */
  },
};
