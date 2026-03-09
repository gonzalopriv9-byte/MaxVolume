// commands/changeprofile.js
// Cambia el nombre y/o imagen de perfil del bot POR SERVIDOR
//
// Uso:
//   /changeprofile nombre:NuevoNombre          → cambia solo el nickname
//   /changeprofile imagen:[adjunto]            → cambia solo la imagen
//   /changeprofile nombre:X imagen:[adjunto]   → cambia ambos
//
// IMPORTANTE:
//   - El nickname es POR SERVIDOR (guild nickname) — no afecta a otros servidores ✅
//   - La imagen de perfil es GLOBAL — cambia en TODOS los servidores ⚠️
//     Solo los bots verificados (>100 servidores) pueden tener avatares por servidor.
//     Para bots normales, se informa al usuario de esta limitación.
//
// Requiere: permiso de administrador o rol staff configurado

const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("changeprofile")
    .setDescription("Cambia el nombre o imagen del bot en este servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("nombre")
        .setDescription("Nuevo nombre/nickname del bot en este servidor")
        .setRequired(false)
        .setMaxLength(32)
    )
    .addAttachmentOption(opt =>
      opt.setName("imagen")
        .setDescription("Nueva imagen de perfil (PNG/JPG, máx 8MB)")
        .setRequired(false)
    ),

  async execute(interaction) {
    // Al menos una opción debe estar presente
    const nombre  = interaction.options.getString("nombre");
    const imagen  = interaction.options.getAttachment("imagen");

    if (!nombre && !imagen) {
      return interaction.reply({
        content: "❌ Debes indicar al menos un **nombre** o una **imagen**.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const resultados = [];
    const errores    = [];

    // ── Cambiar nickname (POR SERVIDOR) ──────────────────────
    if (nombre) {
      try {
        const me = await interaction.guild.members.fetchMe();
        await me.setNickname(nombre, `Cambiado por ${interaction.user.tag}`);
        resultados.push(`✅ Nickname cambiado a **${nombre}** en este servidor`);
      } catch (e) {
        errores.push(`❌ No se pudo cambiar el nickname: ${e.message}`);
      }
    }

    // ── Cambiar avatar (GLOBAL) ───────────────────────────────
    if (imagen) {
      // Validar tipo de archivo
      const validTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      if (!validTypes.includes(imagen.contentType)) {
        errores.push("❌ La imagen debe ser PNG, JPG, GIF o WEBP");
      } else if (imagen.size > 8 * 1024 * 1024) {
        errores.push("❌ La imagen no puede pesar más de 8MB");
      } else {
        try {
          const res    = await fetch(imagen.url);
          const buffer = Buffer.from(await res.arrayBuffer());
          await interaction.client.user.setAvatar(buffer);
          resultados.push(`✅ Avatar actualizado globalmente`);
          resultados.push(`⚠️ **Nota:** El avatar cambia en **todos los servidores**. Los bots normales no pueden tener avatares distintos por servidor.`);
        } catch (e) {
          if (e.message.includes("You are being rate limited")) {
            errores.push("❌ Demasiados cambios de avatar seguidos. Espera unos minutos.");
          } else {
            errores.push(`❌ No se pudo cambiar el avatar: ${e.message}`);
          }
        }
      }
    }

    const lines = [...resultados, ...errores];
    await interaction.editReply({ content: lines.join("\n") || "Sin cambios." });
  },
};
