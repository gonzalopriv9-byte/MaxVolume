const { 
  SlashCommandBuilder, 
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { updateGuildConfig, loadGuildConfig } = require('../utils/configManager');

const EMOJI = {
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ: "<a:Cruz:1472540885102235689>",
  TICKET: "<a:Ticket:1472541437470965942>",
   NUKE: "<a:NUKE:1477617312679858318>",
   NEXALOGO: "<a:NEXALOGO:1477286399345561682>"
};

// Almacenamiento temporal para configuración de tickets
const ticketSetupData = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configuracion rapida y completa del bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(subcommand =>
      subcommand
        .setName('tickets')
        .setDescription('Configurar sistema completo de tickets')
        .addRoleOption(option =>
          option.setName('staff').setDescription('Rol del staff').setRequired(true))
        .addChannelOption(option =>
          option.setName('valoraciones').setDescription('Canal de valoraciones')
            .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(option =>
          option.setName('modo').setDescription('Tipo de panel')
            .addChoices(
              { name: 'Boton Simple', value: 'button' },
              { name: 'Menu Desplegable', value: 'select' }
            ).setRequired(false))
        .addStringOption(option =>
          option.setName('titulo').setDescription('Titulo del embed del panel').setRequired(false))
        .addStringOption(option =>
          option.setName('descripcion').setDescription('Descripcion del embed del panel').setRequired(false)))

    .addSubcommand(subcommand =>
      subcommand
        .setName('bienvenida')
        .setDescription('Configurar mensajes de bienvenida')
        .addChannelOption(option =>
          option.setName('canal').setDescription('Canal de bienvenidas')
            .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(option =>
          option.setName('imagen').setDescription('URL imagen de fondo (opcional)').setRequired(false))
      .addAttachmentOption(option =>
        option.setName('imagen_archivo').setDescription('Sube directamente la imagen de fondo (PNG/JPG/GIF)').setRequired(false)))

    .addSubcommand(subcommand =>
      subcommand
        .setName('verificacion')
        .setDescription('Configurar verificacion por email')
        .addRoleOption(option =>
          option.setName('rol').setDescription('Rol de verificado').setRequired(true)))

    .addSubcommand(subcommand =>
      subcommand
        .setName('trabajos')
        .setDescription('Configurar sistema de trabajos')
        .addRoleOption(option => option.setName('policia').setDescription('Rol de Policia').setRequired(false))
        .addRoleOption(option => option.setName('medico').setDescription('Rol de Medico').setRequired(false))
        .addRoleOption(option => option.setName('bombero').setDescription('Rol de Bombero').setRequired(false))
        .addRoleOption(option => option.setName('mecanico').setDescription('Rol de Mecanico').setRequired(false)))

    .addSubcommand(subcommand =>
      subcommand
        .setName('todo')
        .setDescription('Configurar TODOS los sistemas a la vez')
        .addChannelOption(option =>
          option.setName('bienvenidas').setDescription('Canal de bienvenidas')
            .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addChannelOption(option =>
          option.setName('valoraciones').setDescription('Canal de valoraciones de tickets')
            .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption(option => option.setName('staff').setDescription('Rol del staff').setRequired(true))
        .addRoleOption(option => option.setName('verificado').setDescription('Rol de verificado').setRequired(true))
        .addRoleOption(option => option.setName('anunciar').setDescription('Rol que puede usar /anunciar (opcional)').setRequired(false))),

  async execute(interaction) {
    console.log("🛠️ [SETUP] Comando ejecutado por", interaction.user.tag);
    
    try {
      const subcommand = interaction.options.getSubcommand();
      console.log("🛠️ [SETUP] Subcomando:", subcommand);

      // ==================== TICKETS ====================
      if (subcommand === 'tickets') {
        console.log("🛠️ [SETUP] Entrando en subcomando tickets");
        
        const staff = interaction.options.getRole('staff');
        const valoraciones = interaction.options.getChannel('valoraciones');
        const modo = interaction.options.getString('modo') || 'button';
        const titulo = interaction.options.getString('titulo') || EMOJI.TICKET + ' Sistema de Tickets';
        const descripcion = interaction.options.getString('descripcion') || 
          '¿Necesitas ayuda? Haz clic en el botón para abrir un ticket.\n\n' +
          '**¿Qué es un ticket?**\nUn canal privado con el staff.\n\n' +
          '**¿Cuándo usar?**\n• Reportar problemas\n• Hacer preguntas\n• Solicitar ayuda\n\n' +
          EMOJI.CHECK + ' El staff será notificado.';

        console.log("🛠️ [SETUP] Staff:", staff.id);
        console.log("🛠️ [SETUP] Valoraciones:", valoraciones.id);
        console.log("🛠️ [SETUP] Modo:", modo);

        // Guardar datos temporalmente
        ticketSetupData.set(interaction.user.id, {
          guildId: interaction.guild.id,
          staff: staff.id,
          valoraciones: valoraciones.id,
          modo,
          titulo,
          descripcion,
          channelId: interaction.channel.id
        });

        console.log("🛠️ [SETUP] Datos guardados en ticketSetupData para", interaction.user.id);

        // Mostrar modal para configurar preguntas
        const modal = new ModalBuilder()
          .setCustomId('setup_tickets_questions')
          .setTitle('Preguntas del Ticket');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('question_1_label')
              .setLabel('Pregunta 1 (obligatoria)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ej: Usuario de Roblox')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('question_1_placeholder')
              .setLabel('Texto de ayuda para pregunta 1')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ej: Escribe tu usuario de Roblox')
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('question_2_label')
              .setLabel('Pregunta 2 (obligatoria)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ej: Motivo del ticket')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('question_2_placeholder')
              .setLabel('Texto de ayuda para pregunta 2')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ej: Describe tu problema')
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('question_3_label')
              .setLabel('Pregunta 3 (opcional)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Deja vacío si no quieres más preguntas')
              .setRequired(false)
          )
        );

        console.log("🛠️ [SETUP] Modal creado, mostrando...");
        
        try {
          await interaction.showModal(modal);
          console.log("✅ [SETUP] Modal mostrado correctamente a", interaction.user.tag);
        } catch (modalError) {
          console.error("❌ [SETUP] Error mostrando modal:", modalError);
          throw modalError;
        }
        
        return;
      }

      await interaction.deferReply({ flags: 64 });
      const guild = interaction.guild;

      // ==================== BIENVENIDA ====================
      if (subcommand === 'bienvenida') {
        const canal = interaction.options.getChannel('canal');
        const imagenUrl = interaction.options.getString('imagen') || null;
        const imagenAdj = interaction.options.getAttachment('imagen_archivo') || null;

        // Prioridad: adjunto > URL > imagen por defecto
        let imageUrl = 'https://raw.githubusercontent.com/gonzalopriv9-byte/EspanoletesBOT.1/main/assets/ChatGPT_Image_13_feb_2026_19_27_59.webp';
        if (imagenAdj) {
          const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
          if (!validTypes.includes(imagenAdj.contentType)) {
            return interaction.editReply({ content: EMOJI.CRUZ + ' La imagen debe ser PNG, JPG, GIF o WEBP.' });
          }
          imageUrl = imagenAdj.url; // URL CDN de Discord — permanente mientras el archivo exista
        } else if (imagenUrl) {
          imageUrl = imagenUrl;
        }

        await updateGuildConfig(guild.id, {
          welcome: {
            enabled: true,
            channelId: canal.id,
            imageUrl
          }
        });

        return interaction.editReply({
          content: EMOJI.CHECK + ' **Bienvenidas configuradas:**\n\nCanal: <#' + canal.id + '>\nImagen: ' + (imagenAdj ? 'Imagen subida ✅' : imageUrl.substring(0, 60) + '...')
        });
      }

      // ==================== VERIFICACION ====================
      if (subcommand === 'verificacion') {
        const rol = interaction.options.getRole('rol');

        await updateGuildConfig(guild.id, {
          verification: {
            enabled: true,
            roleId: rol.id
          }
        });

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('✅ Verificación')
          .setDescription('**Verifica tu cuenta para acceder al servidor.**\n\nClick en el botón para verificarte por email.')
          .setFooter({ text: 'Sistema de verificación' }).setTimestamp();

        await interaction.channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_start').setLabel('VERIFICARSE').setStyle(ButtonStyle.Success)
          )]
        });

        return interaction.editReply({
          content: EMOJI.CHECK + ' **Verificación configurada:**\n\nRol: <@&' + rol.id + '>\n\n**Panel creado arriba**'
        });
      }

      // ==================== TRABAJOS ====================
      if (subcommand === 'trabajos') {
        const policia = interaction.options.getRole('policia');
        const medico = interaction.options.getRole('medico');
        const bombero = interaction.options.getRole('bombero');
        const mecanico = interaction.options.getRole('mecanico');

        const roles = {};
        if (policia) roles.policia = { roleId: policia.id, emoji: '👮', nombre: 'Policia' };
        if (medico) roles.medico = { roleId: medico.id, emoji: '⚕️', nombre: 'Medico' };
        if (bombero) roles.bombero = { roleId: bombero.id, emoji: '🚒', nombre: 'Bombero' };
        if (mecanico) roles.mecanico = { roleId: mecanico.id, emoji: '🔧', nombre: 'Mecanico' };

        if (Object.keys(roles).length === 0) {
          return interaction.editReply({ content: EMOJI.CRUZ + ' Debes especificar al menos un rol.' });
        }

        await updateGuildConfig(guild.id, {
          trabajos: {
            enabled: true,
            roles
          }
        });

        const contadores = {};
        for (const [key, t] of Object.entries(roles)) {
          const role = guild.roles.cache.get(t.roleId);
          contadores[key] = role ? role.members.size : 0;
        }

        const trabajosList = Object.entries(roles)
          .map(([k, t]) => t.emoji + ' **' + t.nombre + ':** `' + contadores[k] + '` personas')
          .join('\n');

        const embed = new EmbedBuilder()
          .setColor('#00BFFF').setTitle('💼 CENTRO DE EMPLEO')
          .setDescription('Selecciona tu trabajo:\n\n**Personal actual:**\n' + trabajosList + '\n\n• Solo puedes tener un trabajo a la vez.')
          .setFooter({ text: 'Sistema de empleos' }).setTimestamp();

        const rows = [];
        const arr = Object.entries(roles);
        for (let i = 0; i < arr.length; i += 2) {
          const row = new ActionRowBuilder();
          for (let j = i; j < Math.min(i + 2, arr.length); j++) {
            const [key, t] = arr[j];
            row.addComponents(new ButtonBuilder().setCustomId('trabajo_' + key).setLabel(t.emoji + ' ' + t.nombre).setStyle(j % 2 === 0 ? ButtonStyle.Primary : ButtonStyle.Success));
          }
          rows.push(row);
        }
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('trabajo_quitar').setLabel('❌ Renunciar').setStyle(ButtonStyle.Danger)
        ));

        await interaction.channel.send({ embeds: [embed], components: rows });

        return interaction.editReply({
          content: EMOJI.CHECK + ' **Trabajos configurados:**\n\n' + trabajosList + '\n\n**Panel creado arriba**'
        });
      }

      // ==================== TODO ====================
      if (subcommand === 'todo') {
        const canalBienvenidas = interaction.options.getChannel('bienvenidas');
        const canalValoraciones = interaction.options.getChannel('valoraciones');
        const rolStaff = interaction.options.getRole('staff');
        const rolVerificado = interaction.options.getRole('verificado');
        const rolAnunciar = interaction.options.getRole('anunciar');

        const errores = [];
        const exitos = [];

        try {
          await updateGuildConfig(guild.id, {
            welcome: {
              enabled: true,
              channelId: canalBienvenidas.id,
              imageUrl: 'https://raw.githubusercontent.com/gonzalopriv9-byte/EspanoletesBOT.1/main/assets/ChatGPT_Image_13_feb_2026_19_27_59.webp'
            }
          });
          exitos.push('👋 Bienvenidas → <#' + canalBienvenidas.id + '>');
        } catch (e) { errores.push('Bienvenidas: ' + e.message); }

        try {
          let categoria = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('ticket')
          );
          if (!categoria) {
            categoria = await guild.channels.create({
              name: '📂 TICKETS',
              type: ChannelType.GuildCategory,
              permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: rolStaff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
              ]
            });
          }
          await updateGuildConfig(guild.id, {
            tickets: {
              enabled: true,
              categoryId: categoria.id,
              staffRoles: [rolStaff.id],
              ratingsChannelId: canalValoraciones.id,
              mode: 'button',
              categories: [],
              defaultQuestions: [
                { id: 'field_1', label: 'Usuario de Roblox', placeholder: 'Tu usuario de Roblox', required: true },
                { id: 'field_2', label: 'Motivo del ticket', placeholder: 'Describe tu problema', required: true }
              ]
            }
          });
          exitos.push('🎫 Tickets → <#' + categoria.id + '>');
        } catch (e) { errores.push('Tickets: ' + e.message); }

        try {
          await updateGuildConfig(guild.id, {
            verification: {
              enabled: true,
              roleId: rolVerificado.id
            }
          });
          exitos.push('✅ Verificación → <@&' + rolVerificado.id + '>');
        } catch (e) { errores.push('Verificación: ' + e.message); }

        // Configurar rol de anunciar si se especificó
        if (rolAnunciar) {
          try {
            await updateGuildConfig(guild.id, {
              anunciar: {
                enabled: true,
                roleId: rolAnunciar.id
              }
            });
            exitos.push('📢 Anunciar → <@&' + rolAnunciar.id + '>');
          } catch (e) { errores.push('Anunciar: ' + e.message); }
        }

        const resultEmbed = new EmbedBuilder()
          .setColor(errores.length > 0 ? '#FFA500' : '#00FF00')
          .setTitle(EMOJI.CHECK + ' Configuración Completa')
          .setDescription(
            '**Sistemas configurados:**\n' + exitos.join('\n') +
            (errores.length > 0 ? '\n\n**Errores:**\n' + errores.join('\n') : '') +
            '\n\n**Siguiente paso:**\n• `/setup tickets` - Panel de tickets\n• `/setup verificacion` - Panel de verificación'
          )
          .setFooter({ text: 'Configurado por ' + interaction.user.tag }).setTimestamp();

        return interaction.editReply({ embeds: [resultEmbed] });
      }

    } catch (error) {
      console.error('❌ [SETUP] Error en /setup:', error);
      console.error('❌ [SETUP] Stack:', error.stack);
      
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: EMOJI.CRUZ + ' Error: ' + error.message, flags: 64 }).catch(() => {});
      } else {
        return interaction.editReply({ content: EMOJI.CRUZ + ' Error: ' + error.message }).catch(() => {});
      }
    }
  },

  // Handler para el modal de preguntas
  async handleModal(interaction) {
    console.log("🛠️ [SETUP MODAL] handleModal llamado por", interaction.user.tag);
    
    if (interaction.customId !== 'setup_tickets_questions') {
      console.log("⚠️ [SETUP MODAL] customId no coincide:", interaction.customId);
      return false;
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const setupData = ticketSetupData.get(interaction.user.id);
      if (!setupData) {
        console.error("❌ [SETUP MODAL] setupData no encontrado para", interaction.user.id);
        return interaction.editReply({ content: EMOJI.CRUZ + ' Sesión expirada. Ejecuta `/setup tickets` de nuevo.' });
      }

      console.log("🛠️ [SETUP MODAL] setupData encontrado:", setupData);

      const guild = interaction.client.guilds.cache.get(setupData.guildId);
      if (!guild) {
        console.error("❌ [SETUP MODAL] Guild no encontrado:", setupData.guildId);
        return interaction.editReply({ content: EMOJI.CRUZ + ' Servidor no encontrado.' });
      }

      // Recoger preguntas del modal
      const questions = [];
      
      const q1Label = interaction.fields.getTextInputValue('question_1_label');
      const q1Placeholder = interaction.fields.getTextInputValue('question_1_placeholder') || 'Escribe tu respuesta...';
      questions.push({
        id: 'field_1',
        label: q1Label,
        placeholder: q1Placeholder,
        required: true
      });

      const q2Label = interaction.fields.getTextInputValue('question_2_label');
      const q2Placeholder = interaction.fields.getTextInputValue('question_2_placeholder') || 'Escribe tu respuesta...';
      questions.push({
        id: 'field_2',
        label: q2Label,
        placeholder: q2Placeholder,
        required: true
      });

      const q3Label = interaction.fields.getTextInputValue('question_3_label');
      if (q3Label && q3Label.trim()) {
        questions.push({
          id: 'field_3',
          label: q3Label,
          placeholder: 'Escribe tu respuesta...',
          required: false
        });
      }

      console.log("🛠️ [SETUP MODAL] Preguntas recopiladas:", questions);

      // Crear categoría de Discord si no existe
      let categoria = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('ticket')
      );
      if (!categoria) {
        console.log("🛠️ [SETUP MODAL] Creando categoría de tickets...");
        categoria = await guild.channels.create({
          name: '📂 TICKETS',
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: setupData.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
          ]
        });
      }

      console.log("🛠️ [SETUP MODAL] Categoría:", categoria.name, categoria.id);

      // Cargar configuración existente para preservar categorías de /addticket
      const existingConfig = await loadGuildConfig(setupData.guildId);
      const existingCategories = existingConfig?.tickets?.categories || [];
      
      console.log("🛠️ [SETUP MODAL] Categorías existentes:", existingCategories.length);

      // Guardar configuración en Supabase
      const configToSave = {
        tickets: {
          enabled: true,
          categoryId: categoria.id,
          staffRoles: [setupData.staff],
          ratingsChannelId: setupData.valoraciones,
          mode: setupData.modo,
          panelTitle: setupData.titulo,
          panelDescription: setupData.descripcion,
          categories: existingCategories, // ✅ CONSERVAR CATEGORÍAS EXISTENTES
          defaultQuestions: questions
        }
      };

      console.log("🛠️ [SETUP MODAL] Guardando config:", JSON.stringify(configToSave));
      await updateGuildConfig(setupData.guildId, configToSave);
      console.log("✅ [SETUP MODAL] Config guardada en Supabase");

      // Crear panel en el canal original
      const channel = guild.channels.cache.get(setupData.channelId);
      if (!channel) {
        ticketSetupData.delete(interaction.user.id);
        return interaction.editReply({ 
          content: EMOJI.CHECK + ' **Tickets configurado correctamente**\n\n' +
            'Categoría: <#' + categoria.id + '>\n' +
            'Staff: <@&' + setupData.staff + '>\n' +
            'Valoraciones: <#' + setupData.valoraciones + '>\n\n' +
            '⚠️ No se pudo crear el panel en el canal original.\n' +
            'Usa este comando en el canal donde quieras el panel: `/setup tickets` de nuevo.' 
        });
      }

      const embed = new EmbedBuilder()
        .setColor('#00BFFF')
        .setTitle(setupData.titulo)
        .setDescription(setupData.descripcion)
        .setFooter({ text: 'Sistema de soporte' }).setTimestamp();

      console.log("🛠️ [SETUP MODAL] Creando panel en canal", channel.name);

      let panelMessage;
      if (setupData.modo === 'button') {
        panelMessage = await channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_ticket').setLabel('🎫 Abrir Ticket').setStyle(ButtonStyle.Primary)
          )]
        });
      } else {
        // Crear menú con todas las categorías
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('open_ticket_select')
          .setPlaceholder('Selecciona el tipo de ticket');
        
        // Añadir opción General
        selectMenu.addOptions({ 
          label: 'General', 
          value: 'general', 
          description: 'Ticket general', 
          emoji: '🎫' 
        });
        
        // Añadir categorías personalizadas
        for (const cat of existingCategories) {
          selectMenu.addOptions({
            label: cat.nombre,
            value: cat.id,
            description: cat.descripcion || 'Sin descripción',
            emoji: cat.emoji || '🎫'
          });
        }
        
        panelMessage = await channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
      }

      console.log("✅ [SETUP MODAL] Panel creado:", panelMessage.url);

      // Limpiar datos temporales
      ticketSetupData.delete(interaction.user.id);

      const questionsList = questions.map((q, i) => `${i + 1}. **${q.label}** ${q.required ? '(obligatoria)' : '(opcional)'}`).join('\n');
      const categoriesList = existingCategories.length > 0 
        ? '\n\n**Categorías personalizadas:** ' + existingCategories.length
        : '';

      return interaction.editReply({
        content: EMOJI.CHECK + ' **Tickets configurado:**\n\n' +
          'Categoría: <#' + categoria.id + '>\n' +
          'Staff: <@&' + setupData.staff + '>\n' +
          'Valoraciones: <#' + setupData.valoraciones + '>\n' +
          'Modo: ' + (setupData.modo === 'button' ? 'Botón Simple' : 'Menú Desplegable') + '\n\n' +
          '**Preguntas configuradas:**\n' + questionsList + categoriesList + '\n\n' +
          '**Panel creado:** ' + panelMessage.url + '\n' +
          'Usa `/addticket` para añadir más categorías.'
      });

    } catch (error) {
      console.error('❌ [SETUP MODAL] Error en handleModal:', error);
      console.error('❌ [SETUP MODAL] Stack:', error.stack);
      ticketSetupData.delete(interaction.user.id);
      return interaction.editReply({ content: EMOJI.CRUZ + ' Error: ' + error.message });
    }
  }
};
