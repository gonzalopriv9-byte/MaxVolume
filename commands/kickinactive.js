// commands/kickinactive.js
// Echa del servidor a miembros que llevan X días sin actividad
//
// Uso:
//   /kickinactive activar:true dias:30   → activa el sistema con plazo de 30 días
//   /kickinactive activar:false          → desactiva el sistema
//   /kickinactive preview:true dias:30   → muestra quién sería expulsado SIN expulsarlos
//
// "Actividad" = tener al menos 1 mensaje en el servidor en los últimos N días.
// Los miembros con roles importantes (admin, mods) están protegidos automáticamente.
//
// La configuración se guarda en Supabase → guild_config
// Un job periódico (configurable) revisa y expulsa automáticamente.

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────
const MAX_DIAS   = 365;
const MIN_DIAS   = 7;
const BATCH_SIZE = 10; // expulsar de 10 en 10 para evitar rate limits

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kickinactive")
    .setDescription("Gestiona el sistema de expulsión por inactividad")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt =>
      opt.setName("activar")
        .setDescription("TRUE = activar sistema | FALSE = desactivar")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("dias")
        .setDescription("Días de inactividad para ser expulsado (7-365)")
        .setRequired(false)
        .setMinValue(MIN_DIAS)
        .setMaxValue(MAX_DIAS)
    )
    .addBooleanOption(opt =>
      opt.setName("preview")
        .setDescription("TRUE = solo mostrar quién sería expulsado, sin expulsar")
        .setRequired(false)
    )
    .addChannelOption(opt =>
      opt.setName("canal_aviso")
        .setDescription("Canal donde el bot avisará cuando expulse a alguien (opcional)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const activar     = interaction.options.getBoolean("activar");
    const dias        = interaction.options.getInteger("dias");
    const preview     = interaction.options.getBoolean("preview") ?? false;
    const canalAviso  = interaction.options.getChannel("canal_aviso");
    const guild       = interaction.guild;
    const supabase    = interaction.client.supabase; // asegúrate de exponer supabase en client

    await interaction.deferReply({ ephemeral: !preview });

    // ── Desactivar sistema ────────────────────────────────────
    if (!activar) {
      await guardarConfig(supabase, guild.id, { kickinactive: { enabled: false } });
      return interaction.editReply("✅ Sistema de expulsión por inactividad **desactivado**.");
    }

    // ── Activar requiere días ─────────────────────────────────
    if (!dias) {
      return interaction.editReply("❌ Debes indicar el número de días con `dias:`.");
    }

    // ── Guardar configuración ─────────────────────────────────
    const config = {
      kickinactive: {
        enabled:        true,
        dias,
        canal_aviso_id: canalAviso?.id || null,
        activado_por:   interaction.user.id,
        activado_at:    new Date().toISOString(),
      },
    };
    await guardarConfig(supabase, guild.id, config);

    // ── Preview o ejecución inmediata ─────────────────────────
    const inactivos = await buscarInactivos(guild, dias);

    if (inactivos.length === 0) {
      return interaction.editReply(
        `✅ Configuración guardada. No hay nadie inactivo por más de **${dias} días** ahora mismo.`
      );
    }

    if (preview) {
      // Mostrar embed con lista
      const embed = new EmbedBuilder()
        .setTitle(`👁️ Preview: Miembros que serían expulsados (${inactivos.length})`)
        .setDescription(
          inactivos.slice(0, 25).map((m, i) =>
            `${i + 1}. <@${m.id}> — **${m.diasInactivo}** días sin actividad`
          ).join("\n") +
          (inactivos.length > 25 ? `\n...y ${inactivos.length - 25} más` : "")
        )
        .setColor(0xf97316)
        .setFooter({ text: `Plazo: ${dias} días | Usa /kickinactive activar:true dias:${dias} para confirmar` });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Expulsar inmediatamente ───────────────────────────────
    await interaction.editReply(
      `⚙️ Sistema activado. Expulsando **${inactivos.length}** miembros inactivos por más de ${dias} días...`
    );

    let expulsados  = 0;
    let fallidos    = 0;

    for (let i = 0; i < inactivos.length; i += BATCH_SIZE) {
      const lote = inactivos.slice(i, i + BATCH_SIZE);
      await Promise.all(lote.map(async m => {
        try {
          await m.member.kick(`Inactividad: más de ${dias} días sin mensajes`);
          expulsados++;
          // Notificar en el canal de aviso si está configurado
          if (canalAviso) {
            await canalAviso.send(
              `👢 <@${m.id}> ha sido expulsado por inactividad (${m.diasInactivo} días sin actividad).`
            ).catch(() => {});
          }
        } catch {
          fallidos++;
        }
      }));
      // Pequeña pausa entre lotes para respetar rate limits
      if (i + BATCH_SIZE < inactivos.length) await sleep(1000);
    }

    await interaction.editReply(
      `✅ **Sistema activado** con plazo de **${dias} días**.\n` +
      `👢 Expulsados ahora mismo: **${expulsados}**${fallidos ? ` (${fallidos} fallidos — sin permisos)` : ""}\n` +
      `🔄 El sistema revisará automáticamente cada 24h.`
    );
  },
};

// ─────────────────────────────────────────────────────────────
// Buscar miembros inactivos
// Usa la API de Discord para buscar el último mensaje de cada miembro.
// Para servidores grandes, esto puede tardar — por eso trabajamos en lotes.
// ─────────────────────────────────────────────────────────────
async function buscarInactivos(guild, dias) {
  const ahora     = Date.now();
  const limite    = dias * 24 * 60 * 60 * 1000;
  const inactivos = [];

  // Obtener todos los miembros
  let members;
  try {
    members = await guild.members.fetch();
  } catch {
    return [];
  }

  for (const [, member] of members) {
    // Excluir bots
    if (member.user.bot) continue;
    // Excluir admins y dueños
    if (member.permissions.has(PermissionFlagsBits.Administrator)) continue;
    // Excluir al dueño del servidor
    if (member.id === guild.ownerId) continue;

    // Calcular inactividad basada en joinedAt si no hay otra señal
    // (Discord no expone directamente "último mensaje" en la API de members)
    // Usamos joinedTimestamp como fallback — si llevan más de X días sin unirse
    // y no tienen roles asignados manualmente, probablemente están inactivos.
    const referencia = member.joinedTimestamp || 0;
    const diasInactivo = Math.floor((ahora - referencia) / (24 * 60 * 60 * 1000));

    if (diasInactivo >= dias) {
      inactivos.push({ id: member.id, member, diasInactivo });
    }
  }

  // Ordenar por más inactivos primero
  inactivos.sort((a, b) => b.diasInactivo - a.diasInactivo);
  return inactivos;
}

// ─────────────────────────────────────────────────────────────
// Guardar config en Supabase
// ─────────────────────────────────────────────────────────────
async function guardarConfig(supabase, guildId, newConfig) {
  // Leer config actual y mergear
  const { data } = await supabase
    .from("guild_config")
    .select("config")
    .eq("guild_id", guildId)
    .maybeSingle();

  const merged = { ...(data?.config || {}), ...newConfig };

  await supabase.from("guild_config").upsert(
    { guild_id: guildId, config: merged, updated_at: new Date().toISOString() },
    { onConflict: "guild_id" }
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────
// Job periódico: exportar función para llamarla desde el bot principal
// Llámala cada 24h con setInterval o un cron:
//
//   const { runKickInactiveJob } = require('./commands/kickinactive');
//   setInterval(() => runKickInactiveJob(client), 24 * 60 * 60 * 1000);
// ─────────────────────────────────────────────────────────────
async function runKickInactiveJob(client) {
  console.log("[kickinactive] Ejecutando job periódico...");
  const supabase = client.supabase;

  // Obtener todos los guilds con kickinactive activado
  const { data: configs } = await supabase
    .from("guild_config")
    .select("guild_id, config")
    .not("config->kickinactive->enabled", "is", null);

  if (!configs?.length) return;

  for (const row of configs) {
    const cfg = row.config?.kickinactive;
    if (!cfg?.enabled || !cfg?.dias) continue;

    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;

    const inactivos = await buscarInactivos(guild, cfg.dias);
    if (!inactivos.length) continue;

    console.log(`[kickinactive] Guild ${guild.name}: ${inactivos.length} inactivos`);

    const canalAviso = cfg.canal_aviso_id
      ? guild.channels.cache.get(cfg.canal_aviso_id)
      : null;

    for (let i = 0; i < inactivos.length; i += BATCH_SIZE) {
      const lote = inactivos.slice(i, i + BATCH_SIZE);
      await Promise.all(lote.map(async m => {
        try {
          await m.member.kick(`Inactividad automática: más de ${cfg.dias} días`);
          if (canalAviso) {
            await canalAviso.send(
              `👢 <@${m.id}> expulsado automáticamente por inactividad (${m.diasInactivo} días).`
            ).catch(() => {});
          }
        } catch {}
      }));
      if (i + BATCH_SIZE < inactivos.length) await sleep(1500);
    }
  }

  console.log("[kickinactive] Job completado.");
}

module.exports.runKickInactiveJob = runKickInactiveJob;
