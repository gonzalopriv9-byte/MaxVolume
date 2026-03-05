// utils/levelSystem.js
const { supabase } = require("./db");
const { EmbedBuilder } = require("discord.js");

const XP_PER_MESSAGE = { min: 15, max: 25 };
const XP_COOLDOWN_MS = 60 * 1000; // 1 mensaje por minuto da XP
const xpCooldowns = new Map();

// ==================== XP FORMULA ====================
// Nivel N requiere: 5*(N^2) + 50*N + 100 XP acumulado
function xpForLevel(level) {
  return 5 * (level ** 2) + 50 * level + 100;
}

function getLevelFromXP(totalXP) {
  let level = 0;
  let xpNeeded = 0;
  while (xpNeeded + xpForLevel(level + 1) <= totalXP) {
    xpNeeded += xpForLevel(level + 1);
    level++;
  }
  return { level, currentXP: totalXP - xpNeeded, xpNeeded: xpForLevel(level + 1) };
}

// ==================== OBTENER/CREAR USUARIO ====================
async function getUserLevel(userId, guildId) {
  const { data } = await supabase
    .from("user_levels")
    .select("*")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .single();

  if (!data) return { user_id: userId, guild_id: guildId, total_xp: 0, messages: 0 };
  return data;
}

// ==================== DAR XP ====================
async function addXP(userId, guildId, xp) {
  const { data: existing } = await supabase
    .from("user_levels")
    .select("total_xp, messages")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .single();

  const currentXP = existing?.total_xp || 0;
  const messages = (existing?.messages || 0) + 1;
  const newXP = currentXP + xp;

  const oldLevel = getLevelFromXP(currentXP).level;
  const newLevel = getLevelFromXP(newXP).level;

  await supabase.from("user_levels").upsert({
    user_id: userId,
    guild_id: guildId,
    total_xp: newXP,
    messages,
    updated_at: new Date().toISOString(),
  });

  return { leveledUp: newLevel > oldLevel, oldLevel, newLevel, totalXP: newXP };
}

// ==================== MANEJAR MENSAJE ====================
async function handleMessage(message, addLog, guildConfig) {
  if (!guildConfig?.levels?.enabled) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (xpCooldowns.has(key) && now - xpCooldowns.get(key) < XP_COOLDOWN_MS) return;
  xpCooldowns.set(key, now);

  // Canales ignorados
  const ignoredChannels = guildConfig.levels?.ignoredChannels || [];
  if (ignoredChannels.includes(message.channel.id)) return;

  const xp = Math.floor(Math.random() * (XP_PER_MESSAGE.max - XP_PER_MESSAGE.min + 1)) + XP_PER_MESSAGE.min;
  const result = await addXP(message.author.id, message.guild.id, xp);

  if (result.leveledUp) {
    await handleLevelUp(message, result, guildConfig, addLog);
  }
}

// ==================== LEVEL UP ====================
async function handleLevelUp(message, result, guildConfig, addLog) {
  try {
    // Dar rol de nivel si está configurado
    const levelRoles = guildConfig.levels?.levelRoles || {};
    const roleId = levelRoles[result.newLevel];
    if (roleId) {
      const role = message.guild.roles.cache.get(roleId);
      if (role) {
        await message.member.roles.add(role).catch(() => {});
      }
    }

    // Canal de level-up (o mismo canal si no hay)
    const lvlChannel = guildConfig.levels?.channelId
      ? message.guild.channels.cache.get(guildConfig.levels.channelId) || message.channel
      : message.channel;

    const embed = new EmbedBuilder()
      .setColor("#00d4ff")
      .setTitle("⬆️ ¡Subiste de nivel!")
      .setDescription(`${message.author} ha alcanzado el **nivel ${result.newLevel}** 🎉`)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    if (roleId) embed.addFields({ name: "🎁 Recompensa", value: `<@&${roleId}>`, inline: true });

    await lvlChannel.send({ embeds: [embed] });
    addLog("info", `Level up: ${message.author.tag} → nivel ${result.newLevel} en ${message.guild.name}`);
  } catch (e) {
    addLog("error", "Error level up: " + e.message);
  }
}

// ==================== RANKING ====================
async function getLeaderboard(guildId, limit = 10) {
  const { data } = await supabase
    .from("user_levels")
    .select("user_id, total_xp, messages")
    .eq("guild_id", guildId)
    .order("total_xp", { ascending: false })
    .limit(limit);

  return (data || []).map((row, i) => ({
    position: i + 1,
    userId: row.user_id,
    totalXP: row.total_xp,
    messages: row.messages,
    ...getLevelFromXP(row.total_xp),
  }));
}

module.exports = { handleMessage, getUserLevel, addXP, getLeaderboard, getLevelFromXP, xpForLevel };
