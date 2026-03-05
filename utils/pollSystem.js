// utils/pollSystem.js  — PRO tier
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { supabase } = require("./db");

function buildPollEmbed(poll) {
  const total = poll.votes ? Object.values(poll.votes).reduce((a, b) => a + b, 0) : 0;
  const ended = !poll.active;

  const options = poll.options.map((opt, i) => {
    const votes = poll.votes?.[i] || 0;
    const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
    const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
    return `**${i + 1}.** ${opt}\n\`${bar}\` ${pct}% (${votes} votos)`;
  });

  return new EmbedBuilder()
    .setColor(ended ? "#555555" : "#00d4ff")
    .setTitle(`📊 ${poll.question}`)
    .setDescription(options.join("\n\n"))
    .addFields({ name: "Total votos", value: `${total}`, inline: true })
    .setFooter({ text: ended ? "Encuesta cerrada" : "Selecciona una opción para votar" })
    .setTimestamp();
}

function buildPollComponents(pollId, options, disabled = false) {
  const rows = [];
  for (let i = 0; i < options.length; i += 4) {
    const row = new ActionRowBuilder();
    for (let j = i; j < Math.min(i + 4, options.length); j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_vote_${pollId}_${j}`)
          .setLabel(`${j + 1}. ${options[j].slice(0, 40)}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled)
      );
    }
    rows.push(row);
  }

  // Botón de cerrar (solo para staff)
  if (!disabled) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll_end_${pollId}`)
        .setLabel("⛔ Cerrar encuesta")
        .setStyle(ButtonStyle.Danger)
    ));
  }

  return rows.slice(0, 5); // Discord max 5 action rows
}

// ==================== CREAR ENCUESTA ====================
async function createPoll(channel, question, options, hostId, durationMs = null) {
  const endsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;

  const { data, error } = await supabase.from("polls").insert({
    guild_id: channel.guild.id,
    channel_id: channel.id,
    host_id: hostId,
    question,
    options,
    votes: {},
    active: true,
    ends_at: endsAt,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error || !data) return null;

  const embed = buildPollEmbed(data);
  const components = buildPollComponents(data.id, options);

  const msg = await channel.send({ embeds: [embed], components });
  await supabase.from("polls").update({ message_id: msg.id }).eq("id", data.id);

  return data.id;
}

// ==================== VOTAR ====================
async function votePoll(interaction, pollId, optionIdx) {
  const { data: poll } = await supabase
    .from("polls")
    .select("*")
    .eq("id", pollId)
    .single();

  if (!poll || !poll.active) {
    return interaction.reply({ content: "❌ Esta encuesta ya no está activa.", flags: 64 });
  }

  // Check si ya votó
  const { data: existing } = await supabase
    .from("poll_votes")
    .select("id, option_idx")
    .eq("poll_id", pollId)
    .eq("user_id", interaction.user.id)
    .single();

  const votes = poll.votes || {};

  if (existing) {
    // Cambiar voto
    if (existing.option_idx === optionIdx) {
      return interaction.reply({ content: "Ya votaste esta opción.", flags: 64 });
    }
    // Restar voto anterior
    votes[existing.option_idx] = Math.max(0, (votes[existing.option_idx] || 0) - 1);
    await supabase.from("poll_votes").update({ option_idx: optionIdx }).eq("id", existing.id);
  } else {
    await supabase.from("poll_votes").insert({
      poll_id: pollId,
      user_id: interaction.user.id,
      option_idx: optionIdx,
      voted_at: new Date().toISOString(),
    });
  }

  // Sumar nuevo voto
  votes[optionIdx] = (votes[optionIdx] || 0) + 1;
  await supabase.from("polls").update({ votes }).eq("id", pollId);

  // Actualizar mensaje
  try {
    const updatedPoll = { ...poll, votes };
    const channel = interaction.guild.channels.cache.get(poll.channel_id);
    const msg = await channel.messages.fetch(poll.message_id);
    await msg.edit({ embeds: [buildPollEmbed(updatedPoll)], components: buildPollComponents(pollId, poll.options) });
  } catch {}

  return interaction.reply({
    content: `✅ Votaste por **${poll.options[optionIdx]}**${existing ? " (voto cambiado)" : ""}`,
    flags: 64,
  });
}

// ==================== CERRAR ENCUESTA ====================
async function endPoll(pollId, guild, requesterId, addLog) {
  const { data: poll } = await supabase
    .from("polls")
    .select("*")
    .eq("id", pollId)
    .single();

  if (!poll) return false;
  if (poll.host_id !== requesterId) {
    // También permitir a admins
    const member = guild.members.cache.get(requesterId);
    if (!member?.permissions.has("Administrator")) return false;
  }

  await supabase.from("polls").update({ active: false }).eq("id", pollId);

  try {
    const channel = guild.channels.cache.get(poll.channel_id);
    const msg = await channel.messages.fetch(poll.message_id);
    await msg.edit({
      embeds: [buildPollEmbed({ ...poll, active: false })],
      components: buildPollComponents(pollId, poll.options, true),
    });
  } catch {}

  addLog("info", `Encuesta cerrada: ${poll.question}`);
  return true;
}

// ==================== SCHEDULER ====================
async function checkExpiredPolls(client, addLog) {
  const { data: expired } = await supabase
    .from("polls")
    .select("id, guild_id")
    .eq("active", true)
    .not("ends_at", "is", null)
    .lte("ends_at", new Date().toISOString());

  for (const p of expired || []) {
    const guild = client.guilds.cache.get(p.guild_id);
    if (guild) await endPoll(p.id, guild, "system", addLog);
  }
}

module.exports = { createPoll, votePoll, endPoll, checkExpiredPolls };
