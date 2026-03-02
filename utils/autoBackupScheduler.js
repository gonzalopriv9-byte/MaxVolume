const { captureBackup, saveBackup, listBackups } = require("./backupManager");
const { loadGuildConfig, updateGuildConfig } = require("./configManager");
const { supabase } = require("./db");

/**
 * Verifica y ejecuta backups automáticos para todos los servidores configurados
 * Se ejecuta periódicamente desde index.js
 */
async function checkAndRunAutoBackups(client, addLog) {
  try {
    // Obtener todas las configs de guilds con autoBackup activo
    const { data: configs, error } = await supabase
      .from("guild_config")
      .select("guild_id, config")
      .neq("guild_id", "global");

    if (error) {
      if (addLog) addLog("error", "Error cargando configs para autobackup: " + error.message);
      return;
    }

    if (!configs || configs.length === 0) return;

    const now = Date.now();

    for (const { guild_id, config } of configs) {
      const autoBackup = config?.autoBackup;

      // Validar que está habilitado
      if (!autoBackup || !autoBackup.enabled) continue;

      // Calcular cuándo debe ejecutarse el próximo backup
      const lastBackupAt = autoBackup.lastBackupAt ? new Date(autoBackup.lastBackupAt).getTime() : 0;
      const intervalMs = (autoBackup.intervalMinutes || 360) * 60 * 1000;
      const nextBackupAt = lastBackupAt + intervalMs;

      // Si aún no es hora, continuar
      if (now < nextBackupAt) continue;

      // Ejecutar backup automático
      try {
        const guild = client.guilds.cache.get(guild_id);
        if (!guild) {
          if (addLog) addLog("warning", "Guild " + guild_id + " no encontrado en cache para autobackup");
          continue;
        }

        if (addLog) addLog("info", "Ejecutando backup automático para " + guild.name);

        // Validar que el guild está disponible antes de capturar
        if (!guild.available) {
          if (addLog) addLog("warning", "Guild " + guild.name + " no disponible (outage), saltando autobackup");
          continue;
        }

        // Capturar datos del servidor con protección extra
        let data;
        try {
          data = await captureBackup(guild);
        } catch (captureError) {
          if (addLog) addLog("error", "Error capturando datos de " + guild.name + ": " + captureError.message);
          continue;
        }

        if (!data) {
          if (addLog) addLog("error", "No se pudieron capturar datos de " + guild.name);
          continue;
        }

        // Guardar el backup con un autor especial
        const backupId = await saveBackup(guild_id, "autobackup", data);

        if (!backupId) {
          if (addLog) addLog("error", "Error guardando autobackup para " + guild.name);
          continue;
        }

        if (addLog) addLog("success", "Autobackup creado para " + guild.name + " (ID: " + backupId + ")");

        // Actualizar timestamp del último backup
        await updateGuildConfig(guild_id, {
          autoBackup: {
            ...autoBackup,
            lastBackupAt: new Date().toISOString()
          }
        });

        // Limpiar backups antiguos si exceden el límite
        await cleanOldAutoBackups(guild_id, autoBackup.maxBackups || 20, addLog);

      } catch (e) {
        if (addLog) addLog("error", "Error ejecutando autobackup para guild " + guild_id + ": " + e.message);
      }

      // Pequeño delay entre backups para no saturar
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (e) {
    if (addLog) addLog("error", "Error en checkAndRunAutoBackups: " + e.message);
  }
}

/**
 * Limpia backups automáticos antiguos manteniendo solo los últimos N
 */
async function cleanOldAutoBackups(guildId, maxBackups, addLog) {
  try {
    // Obtener todos los backups del servidor ordenados por fecha (más reciente primero)
    const { data: backups, error } = await supabase
      .from("backups")
      .select("id, created_at")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false });

    if (error) {
      if (addLog) addLog("error", "Error listando backups para limpieza: " + error.message);
      return;
    }

    if (!backups || backups.length <= maxBackups) return;

    // Backups a eliminar (los que están más allá del límite)
    const toDelete = backups.slice(maxBackups);

    for (const backup of toDelete) {
      const { error: deleteError } = await supabase
        .from("backups")
        .delete()
        .eq("id", backup.id);

      if (deleteError) {
        if (addLog) addLog("error", "Error eliminando backup antiguo " + backup.id + ": " + deleteError.message);
      } else {
        if (addLog) addLog("info", "Backup antiguo eliminado: " + backup.id);
      }
    }

    if (addLog && toDelete.length > 0) {
      addLog("info", "Limpieza completada: " + toDelete.length + " backups antiguos eliminados de guild " + guildId);
    }
  } catch (e) {
    if (addLog) addLog("error", "Error en cleanOldAutoBackups: " + e.message);
  }
}

module.exports = {
  checkAndRunAutoBackups,
  cleanOldAutoBackups
};
