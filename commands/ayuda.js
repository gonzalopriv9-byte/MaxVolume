const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const CATEGORIAS = {
  proteccion: {
    emoji: '🛡️',
    nombre: 'Protección',
    comandos: [
      { nombre: 'antinuke', descripcion: 'Configura el sistema anti-nuke del servidor' },
      { nombre: 'proteccion', descripcion: 'Gestiona la protección anti-links y anti-mentions' },
      { nombre: 'banglobal', descripcion: 'Banea usuarios globalmente en todos los servidores' },
      { nombre: 'warn', descripcion: 'Sistema de advertencias (añadir, ver, quitar)' },
      { nombre: 'check', descripcion: 'Verifica el estado de seguridad del servidor' }
    ]
  },
  configuracion: {
    emoji: '⚙️',
    nombre: 'Configuración',
    comandos: [
      { nombre: 'setup', descripcion: 'Menú principal de configuración del bot' },
      { nombre: 'backup', descripcion: 'Crea/restaura backups del servidor' },
      { nombre: 'backup-auto', descripcion: 'Configura backups automáticos' },
      { nombre: 'logs', descripcion: 'Configura el sistema de logs avanzados' },
      { nombre: 'modroleid', descripcion: 'Configura el rol de moderador' },
      { nombre: 'anunciar', descripcion: 'Envía anuncios personalizados' }
    ]
  },
  tickets: {
    emoji: '🎫',
    nombre: 'Tickets',
    comandos: [
      { nombre: 'addticket', descripcion: 'Añade usuarios a un ticket' },
      { nombre: 'closeticket', descripcion: 'Cierra un ticket manualmente' },
      { nombre: 'desreclamar', descripcion: 'Libera un ticket reclamado' }
    ]
  },
  economia: {
    emoji: '💰',
    nombre: 'Economía & Juegos',
    comandos: [
      { nombre: 'economia', descripcion: 'Ver balance, trabajar, transferir dinero' },
      { nombre: 'blackjack', descripcion: 'Juega al blackjack y apuesta dinero' },
      { nombre: 'sorteo', descripcion: 'Crea sorteos con premios' },
      { nombre: 'encuesta', descripcion: 'Crea encuestas con votación' },
      { nombre: 'nivel', descripcion: 'Ver tu nivel y XP (sistema Pro+)' }
    ]
  },
  dni: {
    emoji: '🪪',
    nombre: 'Sistema DNI',
    comandos: [
      { nombre: 'creardni', descripcion: 'Crea tu DNI virtual' },
      { nombre: 'verdni', descripcion: 'Muestra tu DNI o el de otro usuario' },
      { nombre: 'eliminardni', descripcion: 'Elimina tu DNI permanentemente' }
    ]
  },
  premium: {
    emoji: '⭐',
    nombre: 'Premium',
    comandos: [
      { nombre: 'premium', descripcion: 'Gestiona suscripciones premium del servidor' }
    ]
  },
  utilidades: {
    emoji: '🔧',
    nombre: 'Utilidades',
    comandos: [
      { nombre: 'ping', descripcion: 'Muestra la latencia del bot' },
      { nombre: 'ayuda', descripcion: 'Muestra este menú de ayuda' },
      { nombre: 'mantenimiento', descripcion: '[Owner] Activa/desactiva modo mantenimiento' }
    ]
  }
};

function crearEmbedCategoria(categoria, categoriaKey, pagina, totalPaginas) {
  const cat = CATEGORIAS[categoriaKey];
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(`${cat.emoji} ${cat.nombre}`)
    .setDescription('Lista de comandos disponibles en esta categoría')
    .setFooter({ text: `Página ${pagina}/${totalPaginas} • NexaBot v1.0` })
    .setTimestamp();

  for (const cmd of cat.comandos) {
    embed.addFields({
      name: `/${cmd.nombre}`,
      value: cmd.descripcion,
      inline: false
    });
  }

  return embed;
}

function crearEmbedInicio() {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🤖 Panel de Ayuda - NexaBot')
    .setDescription(
      '**Bienvenido al sistema de ayuda de NexaBot**\n\n' +
      'Usa los botones de abajo para navegar por las diferentes categorías de comandos.\n\n' +
      '**Categorías disponibles:**'
    )
    .setFooter({ text: 'Página 1/8 • NexaBot v1.0' })
    .setTimestamp();

  for (const [key, cat] of Object.entries(CATEGORIAS)) {
    const numComandos = cat.comandos.length;
    embed.addFields({
      name: `${cat.emoji} ${cat.nombre}`,
      value: `${numComandos} comando${numComandos > 1 ? 's' : ''}`,
      inline: true
    });
  }

  return embed;
}

function crearBotones(paginaActual, totalPaginas) {
  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('help_prev')
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(paginaActual === 1)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('help_home')
      .setLabel('🏠 Inicio')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(paginaActual === 1)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('help_next')
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(paginaActual === totalPaginas)
  );

  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('❓ Muestra la lista de comandos disponibles organizados por categorías'),

  async execute(interaction) {
    const categorias = Object.keys(CATEGORIAS);
    const totalPaginas = categorias.length + 1; // +1 por la página de inicio
    let paginaActual = 1;

    const embedInicial = crearEmbedInicio();
    const botonesInicial = crearBotones(paginaActual, totalPaginas);

    const mensaje = await interaction.reply({
      embeds: [embedInicial],
      components: [botonesInicial],
      ephemeral: true,
      fetchReply: true
    });

    // Collector para los botones
    const collector = mensaje.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 300000 // 5 minutos
    });

    collector.on('collect', async (i) => {
      try {
        if (i.customId === 'help_prev') {
          paginaActual--;
        } else if (i.customId === 'help_next') {
          paginaActual++;
        } else if (i.customId === 'help_home') {
          paginaActual = 1;
        }

        let embed;
        if (paginaActual === 1) {
          embed = crearEmbedInicio();
        } else {
          const categoriaKey = categorias[paginaActual - 2];
          embed = crearEmbedCategoria(CATEGORIAS[categoriaKey], categoriaKey, paginaActual, totalPaginas);
        }

        const botones = crearBotones(paginaActual, totalPaginas);

        await i.update({
          embeds: [embed],
          components: [botones]
        });
      } catch (error) {
        console.error('Error en collector de ayuda:', error);
      }
    });

    collector.on('end', async () => {
      try {
        await mensaje.edit({ components: [] });
      } catch {}
    });
  }
};
