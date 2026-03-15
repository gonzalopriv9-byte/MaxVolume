// commands/blockartist.js — Bloquear artistas de la autocola

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const EMOJI = {
  CHECK: "<a:Tick:1480638398816456848>",
  CRUZ:  "<a:CruzRoja:1480947488960806943>",
};

// Parsear duración: "30m", "2h", "1d", "1semana" → ms
function parseDuration(str) {
  if (!str) return null; // null = permanente
  const s = str.toLowerCase().trim();
  const match = s.match(/^(\d+)\s*(m|min|minutos?|h|hora?s?|d|dia?s?|w|semana?s?|week?s?)$/);
  if (!match) return undefined; // inválido
  const n = parseInt(match[1]);
  const unit = match[2][0];
  const multipliers = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return n * (multipliers[unit] || 86400000);
}

function formatDuration(ms) {
  if (!ms) return "Permanente";
  const m=Math.floor(ms/60000), h=Math.floor(m/60), d=Math.floor(h/24);
  if (d>0) return `${d} día${d>1?"s":""}`;
  if (h>0) return `${h} hora${h>1?"s":""}`;
  return `${m} minuto${m>1?"s":""}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blockartist")
    .setDescription("Gestiona artistas bloqueados de la autocola")
    .addSubcommand(s => s
      .setName("add")
      .setDescription("Bloquea un artista de la autocola")
      .addStringOption(o => o.setName("artista").setDescription("Nombre del artista").setRequired(true))
      .addStringOption(o => o.setName("duracion").setDescription("Duración: 30m, 2h, 1d, 1semana (vacío = permanente)").setRequired(false))
    )
    .addSubcommand(s => s
      .setName("remove")
      .setDescription("Desbloquea un artista")
      .addStringOption(o => o.setName("artista").setDescription("Nombre del artista").setRequired(true))
    )
    .addSubcommand(s => s
      .setName("list")
      .setDescription("Ver artistas bloqueados")
    ),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── ADD ──
    if (sub === "add") {
      const artist  = interaction.options.getString("artista").trim();
      const durStr  = interaction.options.getString("duracion");
      const durMs   = parseDuration(durStr);

      if (durMs === undefined)
        return interaction.reply({ content: `${EMOJI.CRUZ} Duración inválida. Usa: \`30m\`, \`2h\`, \`1d\`, \`1semana\` o déjalo vacío para permanente.`, flags: 64 });

      const expiresAt = durMs ? new Date(Date.now() + durMs).toISOString() : null;

      const { error } = await supabase.from("blocked_artists").upsert({
        guild_id:   guildId,
        artist:     artist.toLowerCase(),
        blocked_by: interaction.user.id,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      }, { onConflict: "guild_id,artist" });

      if (error) return interaction.reply({ content: `${EMOJI.CRUZ} Error: ${error.message}`, flags: 64 });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#ef4444")
        .setTitle("🚫 Artista bloqueado")
        .setDescription(`**${artist}** no aparecerá en la autocola.`)
        .addFields(
          { name: "⏱️ Duración",   value: formatDuration(durMs),                                           inline: true },
          { name: "📅 Expira",      value: expiresAt ? `<t:${Math.floor(new Date(expiresAt).getTime()/1000)}:R>` : "Nunca", inline: true },
          { name: "👤 Bloqueado por", value: interaction.user.toString(), inline: true },
        )
        .setFooter({ text: "NexaBot Music Pro  ·  usa /blockartist remove para desbloquear" })
      ]});
    }

    // ── REMOVE ──
    if (sub === "remove") {
      const artist = interaction.options.getString("artista").trim().toLowerCase();
      const { data } = await supabase.from("blocked_artists").select("id").eq("guild_id", guildId).eq("artist", artist).single();

      if (!data) return interaction.reply({ content: `${EMOJI.CRUZ} **${artist}** no está bloqueado.`, flags: 64 });

      await supabase.from("blocked_artists").delete().eq("guild_id", guildId).eq("artist", artist);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954")
        .setTitle("✅ Artista desbloqueado")
        .setDescription(`**${artist}** volverá a aparecer en la autocola.`)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }

    // ── LIST ──
    if (sub === "list") {
      // Limpiar expirados primero
      await supabase.from("blocked_artists")
        .delete()
        .eq("guild_id", guildId)
        .lt("expires_at", new Date().toISOString());

      const { data } = await supabase.from("blocked_artists")
        .select("*").eq("guild_id", guildId).order("created_at", { ascending: false });

      if (!data?.length) return interaction.reply({
        content: "✅ No hay artistas bloqueados en este servidor.",
        flags: 64
      });

      const lista = data.map(b => {
        const exp = b.expires_at
          ? `expira <t:${Math.floor(new Date(b.expires_at).getTime()/1000)}:R>`
          : "permanente";
        return `🚫 **${b.artist}** — ${exp}`;
      }).join("\n");

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#ef4444")
        .setTitle("🚫 Artistas bloqueados")
        .setDescription(lista)
        .addFields({ name: "Total", value: `${data.length} artista${data.length>1?"s":""}`, inline: true })
        .setFooter({ text: "NexaBot Music Pro  ·  /blockartist remove [artista] para desbloquear" })
      ]});
    }
  },
};
