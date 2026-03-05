// utils/advancedLogs.js
const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const { supabase } = require("./db");

// ==================== TIPOS DE LOG ====================
const LOG_TYPES = {
  MESSAGE_DELETE: "message_delete",
  MESSAGE_EDIT:   "message_edit",
  MEMBER_JOIN:    "member_join",
  MEMBER_LEAVE:   "member_leave",
  MEMBER_BAN:     "member_ban",
  MEMBER_UNBAN:   "member_unban",
  MEMBER_KICK:    "member_kick",
  ROLE_CREATE:    "role_create",
  ROLE_DELETE:    "role_delete",
  ROLE_UPDATE:    "role_update",
  CHANNEL_CREATE: "channel_create",
  CHANNEL_DELETE: "channel_delete",
  NICKNAME_CHANGE:"nickname_change",
  VOICE_JOIN:     "voice_join",
  VOICE_LEAVE:    "voice_leave",
};

const LOG_COLORS = {
  message_delete: "#ff4466",
  message_edit:   "#ffaa00",
  member_join:    "#00ff88",
  member_leave:   "#ff4466",
  member_ban:     "#ff0000",
  member_unban:   "#00ff88",
  member_kick:    "#ff6600",
  role_create:    "#00d4ff",
  role_delete:    "#ff4466",
  role_update:    "#ffaa00",
  channel_create: "#00d4ff",
  channel_delete: "#ff4466",
  nickname_change:"#ffaa00",
  voice_join:     "#00ff88",
  voice_leave:    "#ff4466",
};

// ==================== GUARDAR LOG EN SUPABASE ====================
async function saveAdvancedLog(guildId, type, data) {
  await supabase.from("advanced_logs").insert({
    guild_id: guildId,
    type,
    data: JSON.stringify(data),
    created_at: new Date().toISOString(),
  }).catch(() => {});
}

// ==================== ENVIAR LOG AL CANAL ====================
async function sendLog(guild, guildConfig, type, embed) {
  try {
    const logChannelId = guildConfig?.advancedLogs?.channelId;
    if (!logChannelId) return;

    // Comprobar si este tipo está habilitado
    const enabledTypes = guildConfig?.advancedLogs?.enabledTypes;
    if (enabledTypes && !enabledTypes.includes(type)) return;

    const channel = guild.channels.cache.get(logChannelId);
    if (!channel) return;

    await channel.send({ embeds: [embed] });
  } catch { /* canal eliminado o sin permisos */ }
}

// ==================== HANDLERS ====================

async function onMessageDelete(message, guildConfig) {
  if (!message.guild || message.author?.bot) return;
  if (!guildConfig?.advancedLogs?.enabled) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.message_delete)
    .setTitle("🗑️ Mensaje Eliminado")
    .setDescription(message.content?.slice(0, 1024) || "*[Sin contenido / adjunto]*")
    .addFields(
      { name: "Canal", value: `<#${message.channel.id}>`, inline: true },
      { name: "Autor", value: `<@${message.author?.id}> (${message.author?.tag})`, inline: true },
    )
    .setFooter({ text: `ID usuario: ${message.author?.id}` })
    .setTimestamp();

  await sendLog(message.guild, guildConfig, LOG_TYPES.MESSAGE_DELETE, embed);
  await saveAdvancedLog(message.guild.id, LOG_TYPES.MESSAGE_DELETE, {
    channelId: message.channel.id,
    authorId: message.author?.id,
    content: message.content?.slice(0, 500),
  });
}

async function onMessageUpdate(oldMsg, newMsg, guildConfig) {
  if (!oldMsg.guild || oldMsg.author?.bot) return;
  if (!guildConfig?.advancedLogs?.enabled) return;
  if (oldMsg.content === newMsg.content) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.message_edit)
    .setTitle("✏️ Mensaje Editado")
    .addFields(
      { name: "Antes", value: (oldMsg.content?.slice(0, 500) || "*vacío*"), inline: false },
      { name: "Después", value: (newMsg.content?.slice(0, 500) || "*vacío*"), inline: false },
      { name: "Canal", value: `<#${newMsg.channel.id}>`, inline: true },
      { name: "Autor", value: `<@${newMsg.author?.id}>`, inline: true },
      { name: "Ir al mensaje", value: `[Clic aquí](${newMsg.url})`, inline: true },
    )
    .setTimestamp();

  await sendLog(oldMsg.guild, guildConfig, LOG_TYPES.MESSAGE_EDIT, embed);
}

async function onMemberJoin(member, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
  const isNew = accountAge < 7;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.member_join)
    .setTitle("📥 Miembro Entró")
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "Usuario", value: `<@${member.id}> (${member.user.tag})`, inline: true },
      { name: "Cuenta creada", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "Miembro #", value: `${member.guild.memberCount}`, inline: true },
    )
    .setFooter({ text: isNew ? "⚠️ Cuenta nueva (menos de 7 días)" : `ID: ${member.id}` })
    .setTimestamp();

  if (isNew) embed.setColor("#ffaa00");

  await sendLog(member.guild, guildConfig, LOG_TYPES.MEMBER_JOIN, embed);
}

async function onMemberLeave(member, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  const roles = member.roles.cache
    .filter(r => r.id !== member.guild.id)
    .map(r => `<@&${r.id}>`)
    .slice(0, 10)
    .join(" ") || "Ninguno";

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.member_leave)
    .setTitle("📤 Miembro Salió")
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "Usuario", value: `${member.user.tag}`, inline: true },
      { name: "Se unió", value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Desconocido", inline: true },
      { name: "Roles", value: roles, inline: false },
    )
    .setFooter({ text: `ID: ${member.id}` })
    .setTimestamp();

  await sendLog(member.guild, guildConfig, LOG_TYPES.MEMBER_LEAVE, embed);
}

async function onMemberBan(ban, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  // Intentar obtener el responsable del ban por audit log
  let executor = null;
  try {
    const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
    const entry = logs.entries.first();
    if (entry && entry.target?.id === ban.user.id) executor = entry.executor;
  } catch {}

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.member_ban)
    .setTitle("🔨 Miembro Baneado")
    .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "Usuario", value: `${ban.user.tag} (<@${ban.user.id}>)`, inline: true },
      { name: "Motivo", value: ban.reason || "Sin motivo", inline: true },
      { name: "Por", value: executor ? `<@${executor.id}>` : "Desconocido", inline: true },
    )
    .setFooter({ text: `ID: ${ban.user.id}` })
    .setTimestamp();

  await sendLog(ban.guild, guildConfig, LOG_TYPES.MEMBER_BAN, embed);
  await saveAdvancedLog(ban.guild.id, LOG_TYPES.MEMBER_BAN, {
    userId: ban.user.id,
    reason: ban.reason,
    executorId: executor?.id,
  });
}

async function onRoleCreate(role, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.role_create)
    .setTitle("🎭 Rol Creado")
    .addFields(
      { name: "Rol", value: `<@&${role.id}> (${role.name})`, inline: true },
      { name: "Color", value: role.hexColor, inline: true },
      { name: "Mencionable", value: role.mentionable ? "Sí" : "No", inline: true },
    )
    .setTimestamp();

  await sendLog(role.guild, guildConfig, LOG_TYPES.ROLE_CREATE, embed);
}

async function onRoleDelete(role, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.role_delete)
    .setTitle("🗑️ Rol Eliminado")
    .addFields(
      { name: "Rol", value: role.name, inline: true },
      { name: "Color", value: role.hexColor, inline: true },
      { name: "Miembros tenían el rol", value: `${role.members.size}`, inline: true },
    )
    .setTimestamp();

  await sendLog(role.guild, guildConfig, LOG_TYPES.ROLE_DELETE, embed);
}

async function onChannelCreate(channel, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.channel_create)
    .setTitle("📁 Canal Creado")
    .addFields(
      { name: "Canal", value: `<#${channel.id}> (${channel.name})`, inline: true },
      { name: "Tipo", value: channel.type.toString(), inline: true },
    )
    .setTimestamp();

  await sendLog(channel.guild, guildConfig, LOG_TYPES.CHANNEL_CREATE, embed);
}

async function onChannelDelete(channel, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS.channel_delete)
    .setTitle("🗑️ Canal Eliminado")
    .addFields(
      { name: "Canal", value: channel.name, inline: true },
      { name: "Tipo", value: channel.type.toString(), inline: true },
    )
    .setTimestamp();

  await sendLog(channel.guild, guildConfig, LOG_TYPES.CHANNEL_DELETE, embed);
}

async function onVoiceStateUpdate(oldState, newState, guildConfig) {
  if (!guildConfig?.advancedLogs?.enabled) return;
  if (newState.member?.user?.bot) return;

  if (!oldState.channelId && newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.voice_join)
      .setTitle("🔊 Entró a voz")
      .addFields(
        { name: "Usuario", value: `<@${newState.id}>`, inline: true },
        { name: "Canal", value: `<#${newState.channelId}>`, inline: true },
      )
      .setTimestamp();
    await sendLog(newState.guild, guildConfig, LOG_TYPES.VOICE_JOIN, embed);

  } else if (oldState.channelId && !newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.voice_leave)
      .setTitle("🔇 Salió de voz")
      .addFields(
        { name: "Usuario", value: `<@${oldState.id}>`, inline: true },
        { name: "Canal", value: `<#${oldState.channelId}>`, inline: true },
      )
      .setTimestamp();
    await sendLog(oldState.guild, guildConfig, LOG_TYPES.VOICE_LEAVE, embed);
  }
}

module.exports = {
  LOG_TYPES,
  onMessageDelete,
  onMessageUpdate,
  onMemberJoin,
  onMemberLeave,
  onMemberBan,
  onRoleCreate,
  onRoleDelete,
  onChannelCreate,
  onChannelDelete,
  onVoiceStateUpdate,
};
