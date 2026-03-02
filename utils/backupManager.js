const { supabase } = require("./db");

async function saveBackup(guildId, createdBy, data) {
  const { data: result, error } = await supabase
    .from("guild_backups")
    .insert({ guild_id: guildId, created_by: createdBy, data, created_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) { console.error("Error saveBackup: " + error.message); return null; }
  return result.id;
}

async function loadBackup(backupId) {
  const { data, error } = await supabase.from("guild_backups").select("*").eq("id", backupId).single();
  if (error) { console.error("Error loadBackup: " + error.message); return null; }
  return data;
}

async function listBackups(guildId) {
  const { data, error } = await supabase.from("guild_backups").select("id, created_by, created_at").eq("guild_id", guildId).order("created_at", { ascending: false }).limit(10);
  if (error) { console.error("Error listBackups: " + error.message); return []; }
  return data;
}

async function captureBackup(guild) {
  try {
    await guild.members.fetch();
  } catch (e) {
    console.warn("No se pudieron cargar todos los miembros: " + e.message);
  }

  const roles = guild.roles.cache
    .filter(r => !r.managed && r.id !== guild.id)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      name: r.name, color: r.color, hoist: r.hoist,
      mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position
    }));

  const categories = guild.channels.cache
    .filter(c => c.type === 4)
    .sort((a, b) => a.position - b.position)
    .map(c => ({
      name: c.name, position: c.position,
      permissionOverwrites: c.permissionOverwrites?.cache ? 
        Array.from(c.permissionOverwrites.cache.values()).map(p => ({
          targetId: p.id, type: p.type,
          allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString()
        })) : []
    }));

  const channels = guild.channels.cache
    .filter(c => c.type !== 4)
    .sort((a, b) => a.position - b.position)
    .map(c => ({
      name: c.name, type: c.type, topic: c.topic || null,
      nsfw: c.nsfw || false, rateLimitPerUser: c.rateLimitPerUser || 0,
      position: c.position, parentName: c.parent?.name || null,
      permissionOverwrites: c.permissionOverwrites?.cache ? 
        Array.from(c.permissionOverwrites.cache.values()).map(p => ({
          targetId: p.id, type: p.type,
          allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString()
        })) : []
    }));

  const members = guild.members.cache
    .filter(m => !m.user.bot)
    .map(m => ({ userId: m.user.id, tag: m.user.tag }));

  return { guildName: guild.name, memberCount: guild.memberCount, roles, categories, channels, members };
}

async function restoreBackup(guild, backupData) {
  const log = [];

  // 1. Crear roles
  const roleMap = {};
  for (const role of backupData.roles) {
    try {
      const newRole = await guild.roles.create({
        name: role.name, color: role.color, hoist: role.hoist,
        mentionable: role.mentionable, permissions: BigInt(role.permissions)
      });
      roleMap[role.name] = newRole.id;
      log.push("Rol creado: " + role.name);
    } catch (e) { log.push("Error rol " + role.name + ": " + e.message); }
  }

  // 2. Crear categorias
  const categoryMap = {};
  for (const cat of backupData.categories) {
    try {
      const overwrites = cat.permissionOverwrites.map(p => ({
        id: roleMap[guild.roles.cache.find(r => r.id === p.targetId)?.name] || p.targetId,
        type: p.type, allow: BigInt(p.allow), deny: BigInt(p.deny)
      }));
      const newCat = await guild.channels.create({
        name: cat.name, type: 4, position: cat.position, permissionOverwrites: overwrites
      });
      categoryMap[cat.name] = newCat.id;
      log.push("Categoria creada: " + cat.name);
    } catch (e) { log.push("Error categoria " + cat.name + ": " + e.message); }
  }

  // 3. Crear canales
  for (const ch of backupData.channels) {
    try {
      const overwrites = ch.permissionOverwrites.map(p => ({
        id: roleMap[guild.roles.cache.find(r => r.id === p.targetId)?.name] || p.targetId,
        type: p.type, allow: BigInt(p.allow), deny: BigInt(p.deny)
      }));
      await guild.channels.create({
        name: ch.name, type: ch.type, topic: ch.topic, nsfw: ch.nsfw,
        rateLimitPerUser: ch.rateLimitPerUser,
        parent: categoryMap[ch.parentName] || null,
        permissionOverwrites: overwrites
      });
      log.push("Canal creado: " + ch.name);
    } catch (e) { log.push("Error canal " + ch.name + ": " + e.message); }
  }

  return log;
}

module.exports = { saveBackup, loadBackup, listBackups, captureBackup, restoreBackup };
