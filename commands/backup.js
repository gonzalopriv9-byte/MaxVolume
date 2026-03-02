const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = require("discord.js");
const { saveBackup, loadBackup, listBackups, captureBackup, restoreBackup } = require("../utils/backupManager");
const config = require("../config.js");

const EMOJI = {
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ: "<a:Cruz:1472540885102235689>",
  WARNING: "<a:ADVERTENCIA:1477616948937490452>",
  NUKE: "<a:NUKE:1477617312679858318>"
   NEXALOGO: "<a:NEXALOGO:1477286399345561682>"
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Sistema de backups del servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName("crear")
        .setDescription("Guarda un backup completo del servidor (roles, canales, permisos, miembros)")
    )
    .addSubcommand(sub =>
      sub
        .setName("listar")
        .setDescription("Muestra los backups guardados de este servidor")
    )
    .addSubcommand(sub =>
      sub
        .setName("restaurar")
        .setDescription("Restaura un backup en este servidor")
        .addStringOption(opt =>
          opt
            .setName("id")
            .setDescription("ID del backup a restaurar")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 64 });

    // ==================== CREAR ====================
    if (sub === "crear") {
      try {
        await interaction.editReply({
          content: `${EMOJI.WARNING} Capturando datos del servidor... esto puede tardar unos segundos.`
        });

        const data = await captureBackup(interaction.guild);
        const backupId = await saveBackup(interaction.guild.id, interaction.user.id, data);

        if (!backupId) {
          return interaction.editReply({
            content: `${EMOJI.CRUZ} Error al guardar el backup en la base de datos.`
          });
        }

        const embed = new EmbedBuilder()
          .setColor("#00FF00")
          .setTitle(`${EMOJI.CHECK} Backup Creado`)
          .setDescription("El backup se ha guardado correctamente.")
          .addFields(
            { name: "ID del Backup", value: "`" + backupId + "`", inline: false },
            { name: "Roles", value: "" + data.roles.length, inline: true },
            { name: "Categorias", value: "" + data.categories.length, inline: true },
            { name: "Canales", value: "" + data.channels.length, inline: true },
            { name: "Miembros guardados", value: "" + data.members.length, inline: true },
            { name: "Servidor", value: data.guildName, inline: true }
          )
          .setFooter({ text: "Guarda el ID para restaurar el backup" })
          .setTimestamp();

        return interaction.editReply({ content: "", embeds: [embed] });
      } catch (e) {
        return interaction.editReply({
          content: `${EMOJI.CRUZ} Error creando backup: ${e.message}`
        });
      }
    }

    // ==================== LISTAR ====================
    if (sub === "listar") {
      try {
        const backups = await listBackups(interaction.guild.id);
        if (backups.length === 0) {
          return interaction.editReply({
            content: `${EMOJI.WARNING} No hay backups guardados para este servidor.`
          });
        }

        const embed = new EmbedBuilder()
          .setColor("#00BFFF")
          .setTitle(`${EMOJI.WARNING} Backups de ${interaction.guild.name}`)
          .setDescription(
            backups
              .map(
                (b, i) =>
                  `**${i + 1}.** \`${b.id}\`\n` +
                  `Creado por: <@${b.created_by}> | ` +
                  `<t:${Math.floor(new Date(b.created_at).getTime() / 1000)}:R>`
              )
              .join("\n\n")
          )
          .setFooter({ text: "Usa /backup restaurar <id> para restaurar" })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (e) {
        return interaction.editReply({
          content: `${EMOJI.CRUZ} Error listando backups: ${e.message}`
        });
      }
    }

    // ==================== RESTAURAR ====================
    if (sub === "restaurar") {
      const backupId = interaction.options.getString("id");

      try {
        const backup = await loadBackup(backupId);
        if (!backup) {
          return interaction.editReply({
            content: `${EMOJI.CRUZ} Backup no encontrado con ese ID.`
          });
        }

        await interaction.editReply({
          content: `${EMOJI.WARNING} Restaurando backup... esto puede tardar varios minutos.`
        });

        const log = await restoreBackup(interaction.guild, backup.data);

        // Invitación (opcional, para el owner)
        let invite = null;
        try {
          const channel = interaction.guild.channels.cache.find(
            c =>
              c.type === ChannelType.GuildText &&
              c
                .permissionsFor(interaction.guild.members.me)
                .has(PermissionFlagsBits.CreateInstantInvite)
          );
          if (channel) invite = await channel.createInvite({ maxAge: 0, maxUses: 0 });
        } catch (e) {
          console.error("Error invitacion: " + e.message);
        }

        const errores = log.filter(l => l.startsWith("Error"));
        const exitos = log.filter(l => !l.startsWith("Error"));

        const embed = new EmbedBuilder()
          .setColor(errores.length > 0 ? "#FFA500" : "#00FF00")
          .setTitle(`${EMOJI.CHECK} Backup Restaurado`)
          .addFields(
            { name: "Creados", value: "" + exitos.length, inline: true },
            { name: "Errores", value: "" + errores.length, inline: true }
          )
          .setFooter({ text: "Backup ID: " + backupId })
          .setTimestamp();

        if (errores.length > 0) {
          embed.addFields({
            name: "Errores detallados",
            value: errores
              .slice(0, 5)
              .join("\n")
              .substring(0, 1024)
          });
        }

        await interaction.editReply({ content: "", embeds: [embed] });

        // ==================== NUEVO: DM AL OWNER EN VEZ DE DMs MASIVOS ====================
        const ownerId = config.ownerId || interaction.guild.ownerId;
        const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
        if (!owner) return;

        const dmEmbed = new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle(`${EMOJI.WARNING} Restauración de Backup en ${interaction.guild.name}`)
          .setDescription(
            "Se ha restaurado un backup en tu servidor.\n\n" +
              "Por motivos de **privacidad y seguridad**, el bot **ya no envía mensajes automáticos por DM a todos los miembros**.\n\n" +
              "Si quieres informar a la gente, puedo prepararte un mensaje de ejemplo para que lo publiques manualmente en un canal."
          )
          .addFields(
            {
              name: "Invitación",
              value: invite ? invite.url : "No se ha podido generar una invitación automática.",
              inline: false
            }
          )
          .setTimestamp();

        const yesButton = new ButtonBuilder()
          .setCustomId(`backup_notify_yes_${interaction.guild.id}`)
          .setLabel("Sí, preparar mensaje")
          .setStyle(ButtonStyle.Success);

        const noButton = new ButtonBuilder()
          .setCustomId(`backup_notify_no_${interaction.guild.id}`)
          .setLabel("No, ahora no")
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(yesButton, noButton);

        await owner
          .send({
            embeds: [dmEmbed],
            components: [row]
          })
          .catch(() => {});
      } catch (e) {
        return interaction.editReply({
          content: `${EMOJI.CRUZ} Error restaurando: ${e.message}`
        });
      }
    }
  }
};
