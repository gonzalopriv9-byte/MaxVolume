// utils/giveawayManager.js
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { supabase } = require("./db");

const EMOJI = {
  GIFT:  "🎁",
  PARTY: "🎉",
  CLOCK: "⏰",
  CHECK: "<a:Check:1472540340584972509>",
  CRUZ:  "<a:Cruz:1472540885102235689>",
};

// ==================== HELPERS ====================
function timeLeft(endsAt) {
  const ms = new Date(endsAt) - Date.now();
  if (ms <= 0) return "Terminado";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function buildEmbed(giveaway) {
  const ended = new Date(giveaway.ends_at) <= new Date();
  const embed = new EmbedBuilder()
    .setColor(ended ? "#555555" : "#00d4ff")
    .setTitle(`${EMOJI.GIFT} ${giveaway.prize}`)
    .setDescription(
      `**Ganadores:** ${giveaway.winners_count}\n` +
      `**Participantes:** ${giveaway.entries || 0}\n` +
      (giveaway.required_role ? `**Rol requerido:** <@&${giveaway.required_role}>\n` : "") +
      (giveaway.min_level ? `**Nivel mínimo:** ${giveaway.min_level}\n` : "") +
      `\n${ended ? "✅ **TERMINADO**" : `${EMOJI.CLOCK} Termina: <t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:R>`}`
    )
    .setFooter({ text: ended ? "Sorteo terminado" : `Haz clic en 🎉 para participar` })
    .setTimestamp(new Date(giveaway.ends_at));

  if (giveaway.winners?.length) {
    embed.addFields({
      name: "🏆 Ganadores",
      value: giveaway.winners.map(id => `<@${id}>`).join(", "),
    });
  }

  return embed;
}

// ==================== CREAR SORTEO ====================
async function createGiveaway(channel, options, hostId) {
  const { prize, durationMs, winnersCount, requiredRole, minLevel } = options;
  const endsAt = new Date(Date.now() + durationMs).toISOString();

  // Insertar en DB
  const { data, error } = await supabase.from("giveaways").insert({
    guild_id: channel.guild.id,
    channel_id: channel.id,
    host_id: hostId,
    prize,
    winners_count: winnersCount || 1,
    required_role: requiredRole || null,
    min_level: minLevel || null,
    ends_at: endsAt,
    active: true,
    entries: 0,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error || !data) return null;

  const embed = buildEmbed(data);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_join_${data.id}`)
      .setLabel("🎉 Participar")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`giveaway_count_${data.id}`)
      .setLabel("0 participantes")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });

  await supabase.from("giveaways").update({ message_id: msg.id }).eq("id", data.id);

  return data.id;
}

// ==================== UNIRSE AL SORTEO ====================
async function joinGiveaway(interaction, giveawayId, guildConfig) {
  // Obtener sorteo
  const { data: giveaway } = await supabase
    .from("giveaways")
    .select("*")
    .eq("id", giveawayId)
    .single();

  if (!giveaway || !giveaway.active) {
    return interaction.reply({ content: `${EMOJI.CRUZ} Este sorteo ya no está activo.`, flags: 64 });
  }

  if (new Date(giveaway.ends_at) <= new Date()) {
    return interaction.reply({ content: `${EMOJI.CRUZ} Este sorteo ya terminó.`, flags: 64 });
  }

  const userId = interaction.user.id;
  const member = interaction.member;

  // Check rol requerido
  if (giveaway.required_role && !member.roles.cache.has(giveaway.required_role)) {
    return interaction.reply({
      content: `${EMOJI.CRUZ} Necesitas el rol <@&${giveaway.required_role}> para participar.`,
      flags: 64,
    });
  }

  // Check nivel mínimo (si hay sistema de niveles)
  if (giveaway.min_level) {
    const { data: levelData } = await supabase
      .from("user_levels")
      .select("total_xp")
      .eq("user_id", userId)
      .eq("guild_id", giveaway.guild_id)
      .single();

    if (levelData) {
      const { getLevelFromXP } = require("./levelSystem");
      const { level } = getLevelFromXP(levelData.total_xp);
      if (level < giveaway.min_level) {
        return interaction.reply({
          content: `${EMOJI.CRUZ} Necesitas nivel **${giveaway.min_level}** para participar. Tienes nivel **${level}**.`,
          flags: 64,
        });
      }
    }
  }

  // Comprobar si ya participa
  const { data: existing } = await supabase
    .from("giveaway_entries")
    .select("id")
    .eq("giveaway_id", giveawayId)
    .eq("user_id", userId)
    .single();

  if (existing) {
    return interaction.reply({ content: `${EMOJI.CRUZ} Ya estás participando en este sorteo.`, flags: 64 });
  }

  // Añadir entrada
  await supabase.from("giveaway_entries").insert({
    giveaway_id: giveawayId,
    user_id: userId,
    guild_id: giveaway.guild_id,
    joined_at: new Date().toISOString(),
  });

  // Actualizar contador
  const newCount = (giveaway.entries || 0) + 1;
  await supabase.from("giveaways").update({ entries: newCount }).eq("id", giveawayId);

  // Actualizar botón del mensaje
  try {
    const channel = interaction.guild.channels.cache.get(giveaway.channel_id);
    if (channel && giveaway.message_id) {
      const msg = await channel.messages.fetch(giveaway.message_id);
      const updatedGiveaway = { ...giveaway, entries: newCount };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel("🎉 Participar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`giveaway_count_${giveawayId}`).setLabel(`${newCount} participantes`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      await msg.edit({ embeds: [buildEmbed(updatedGiveaway)], components: [row] });
    }
  } catch {}

  return interaction.reply({ content: `${EMOJI.CHECK} ¡Estás participando en el sorteo de **${giveaway.prize}**! 🎉`, flags: 64 });
}

// ==================== TERMINAR SORTEO ====================
async function endGiveaway(giveawayId, client, addLog) {
  const { data: giveaway } = await supabase
    .from("giveaways")
    .select("*")
    .eq("id", giveawayId)
    .single();

  if (!giveaway || !giveaway.active) return;

  // Obtener participantes
  const { data: entries } = await supabase
    .from("giveaway_entries")
    .select("user_id")
    .eq("giveaway_id", giveawayId);

  const participants = entries?.map(e => e.user_id) || [];

  let winners = [];
  if (participants.length > 0) {
    // Elegir ganadores al azar
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    winners = shuffled.slice(0, Math.min(giveaway.winners_count, participants.length));
  }

  // Actualizar DB
  await supabase.from("giveaways").update({
    active: false,
    winners: winners,
    ended_at: new Date().toISOString(),
  }).eq("id", giveawayId);

  // Actualizar mensaje
  try {
    const guild = client.guilds.cache.get(giveaway.guild_id);
    if (!guild) return;
    const channel = guild.channels.cache.get(giveaway.channel_id);
    if (!channel) return;
    const msg = await channel.messages.fetch(giveaway.message_id);

    const finalGiveaway = { ...giveaway, active: false, winners, entries: participants.length };
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel("🎉 Sorteo terminado").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`giveaway_count_${giveawayId}`).setLabel(`${participants.length} participantes`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
    await msg.edit({ embeds: [buildEmbed(finalGiveaway)], components: [disabledRow] });

    if (winners.length > 0) {
      await channel.send({
        content: `${EMOJI.PARTY} ¡Felicidades ${winners.map(id => `<@${id}>`).join(", ")}! Ganaron **${giveaway.prize}** ${EMOJI.PARTY}\n\nContacta a <@${giveaway.host_id}> para reclamar tu premio.`,
      });
    } else {
      await channel.send({ content: `❌ No había suficientes participantes para el sorteo de **${giveaway.prize}**.` });
    }

    addLog("success", `Sorteo terminado: ${giveaway.prize} — Ganadores: ${winners.join(", ") || "ninguno"}`);
  } catch (e) {
    addLog("error", "Error terminando sorteo: " + e.message);
  }
}

// ==================== REROLL ====================
async function rerollGiveaway(giveawayId, guild, addLog) {
  const { data: giveaway } = await supabase
    .from("giveaways")
    .select("*")
    .eq("id", giveawayId)
    .single();

  if (!giveaway) return null;

  const { data: entries } = await supabase
    .from("giveaway_entries")
    .select("user_id")
    .eq("giveaway_id", giveawayId);

  const participants = entries?.map(e => e.user_id) || [];
  if (participants.length === 0) return null;

  const newWinner = participants[Math.floor(Math.random() * participants.length)];

  await supabase.from("giveaways").update({
    winners: [newWinner],
  }).eq("id", giveawayId);

  return newWinner;
}

// ==================== SCHEDULER - Revisar sorteos expirados ====================
async function checkExpiredGiveaways(client, addLog) {
  const { data: expired } = await supabase
    .from("giveaways")
    .select("id")
    .eq("active", true)
    .lte("ends_at", new Date().toISOString());

  for (const g of expired || []) {
    await endGiveaway(g.id, client, addLog);
  }
}

module.exports = { createGiveaway, joinGiveaway, endGiveaway, rerollGiveaway, checkExpiredGiveaways, buildEmbed };
