// utils/economySystem.js  — ELITE tier
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { supabase } = require("./db");

const CURRENCY = "💎"; // símbolo de moneda (configurable por servidor)
const DAILY_AMOUNT = { min: 100, max: 200 };
const WORK_AMOUNT  = { min: 50,  max: 150 };
const WORK_COOLDOWN_H = 1;
const DAILY_COOLDOWN_H = 24;

// ==================== HELPERS ====================
async function getWallet(userId, guildId) {
  const { data } = await supabase
    .from("economy_wallets")
    .select("*")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .single();

  if (!data) {
    await supabase.from("economy_wallets").insert({
      user_id: userId,
      guild_id: guildId,
      balance: 0,
      bank: 0,
      total_earned: 0,
      created_at: new Date().toISOString(),
    });
    return { user_id: userId, guild_id: guildId, balance: 0, bank: 0, total_earned: 0 };
  }
  return data;
}

async function updateBalance(userId, guildId, amount, bank = false) {
  const wallet = await getWallet(userId, guildId);
  const field = bank ? "bank" : "balance";
  const newVal = Math.max(0, wallet[field] + amount);
  const newTotal = amount > 0 ? (wallet.total_earned || 0) + amount : wallet.total_earned;

  await supabase.from("economy_wallets").update({
    [field]: newVal,
    total_earned: newTotal,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("guild_id", guildId);

  return newVal;
}

function cooldownLeft(lastUsed, hours) {
  if (!lastUsed) return 0;
  const ms = new Date(lastUsed).getTime() + hours * 3600000 - Date.now();
  return ms > 0 ? ms : 0;
}

function formatMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ==================== COMANDOS ====================

async function cmdBalance(interaction) {
  const target = interaction.options.getUser("usuario") || interaction.user;
  const wallet = await getWallet(target.id, interaction.guild.id);
  const total = wallet.balance + wallet.bank;

  const embed = new EmbedBuilder()
    .setColor("#00d4ff")
    .setTitle(`${CURRENCY} Wallet de ${target.username}`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "💰 Efectivo", value: `${wallet.balance.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: "🏦 Banco",    value: `${wallet.bank.toLocaleString()} ${CURRENCY}`, inline: true },
      { name: "💎 Total",    value: `${total.toLocaleString()} ${CURRENCY}`, inline: true },
    )
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function cmdDaily(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const { data: cooldown } = await supabase
    .from("economy_cooldowns")
    .select("last_daily")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .single();

  const left = cooldownLeft(cooldown?.last_daily, DAILY_COOLDOWN_H);
  if (left > 0) {
    return interaction.reply({ content: `⏰ Puedes reclamar tu daily en **${formatMs(left)}**`, flags: 64 });
  }

  const amount = Math.floor(Math.random() * (DAILY_AMOUNT.max - DAILY_AMOUNT.min + 1)) + DAILY_AMOUNT.min;
  await updateBalance(userId, guildId, amount);

  await supabase.from("economy_cooldowns").upsert({
    user_id: userId, guild_id: guildId,
    last_daily: new Date().toISOString(),
  });

  const embed = new EmbedBuilder()
    .setColor("#00ff88")
    .setTitle("✅ Daily Reclamado")
    .setDescription(`Recibiste **${amount} ${CURRENCY}**\nVuelve en 24h para reclamar otro.`)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function cmdWork(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const { data: cooldown } = await supabase
    .from("economy_cooldowns")
    .select("last_work")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .single();

  const left = cooldownLeft(cooldown?.last_work, WORK_COOLDOWN_H);
  if (left > 0) {
    return interaction.reply({ content: `⏰ Puedes trabajar de nuevo en **${formatMs(left)}**`, flags: 64 });
  }

  const jobs = [
    "programaste una web", "atendiste la tienda", "repartiste paquetes",
    "enseñaste en el colegio", "condujiste el taxi", "cocinaste en el restaurante",
    "diseñaste un logo", "hiciste una traducción", "arreglaste un coche"
  ];
  const job = jobs[Math.floor(Math.random() * jobs.length)];
  const amount = Math.floor(Math.random() * (WORK_AMOUNT.max - WORK_AMOUNT.min + 1)) + WORK_AMOUNT.min;

  await updateBalance(userId, guildId, amount);
  await supabase.from("economy_cooldowns").upsert({
    user_id: userId, guild_id: guildId,
    last_work: new Date().toISOString(),
  });

  const embed = new EmbedBuilder()
    .setColor("#00d4ff")
    .setTitle("💼 Trabajo completado")
    .setDescription(`Hoy **${job}** y ganaste **${amount} ${CURRENCY}**`)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function cmdDeposit(interaction) {
  const amount = interaction.options.getInteger("cantidad");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const wallet = await getWallet(userId, guildId);

  if (amount > wallet.balance) {
    return interaction.reply({ content: `❌ No tienes suficiente efectivo. Tienes **${wallet.balance} ${CURRENCY}**`, flags: 64 });
  }

  await updateBalance(userId, guildId, -amount);
  await updateBalance(userId, guildId, amount, true);

  return interaction.reply({ content: `🏦 Depositaste **${amount} ${CURRENCY}** en el banco.`, flags: 64 });
}

async function cmdWithdraw(interaction) {
  const amount = interaction.options.getInteger("cantidad");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const wallet = await getWallet(userId, guildId);

  if (amount > wallet.bank) {
    return interaction.reply({ content: `❌ No tienes tanto en el banco. Tienes **${wallet.bank} ${CURRENCY}**`, flags: 64 });
  }

  await updateBalance(userId, guildId, amount);
  await updateBalance(userId, guildId, -amount, true);

  return interaction.reply({ content: `💰 Retiraste **${amount} ${CURRENCY}** del banco.`, flags: 64 });
}

async function cmdTransfer(interaction) {
  const target = interaction.options.getUser("usuario");
  const amount = interaction.options.getInteger("cantidad");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  if (target.id === userId) return interaction.reply({ content: "❌ No puedes transferirte a ti mismo.", flags: 64 });
  if (target.bot) return interaction.reply({ content: "❌ No puedes transferir a bots.", flags: 64 });

  const wallet = await getWallet(userId, guildId);
  if (amount > wallet.balance) {
    return interaction.reply({ content: `❌ No tienes suficiente efectivo. Tienes **${wallet.balance} ${CURRENCY}**`, flags: 64 });
  }

  await updateBalance(userId, guildId, -amount);
  await updateBalance(target.id, guildId, amount);

  const embed = new EmbedBuilder()
    .setColor("#00ff88")
    .setTitle("💸 Transferencia Completada")
    .addFields(
      { name: "Enviado a", value: `<@${target.id}>`, inline: true },
      { name: "Cantidad", value: `${amount} ${CURRENCY}`, inline: true },
    )
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function cmdLeaderboard(interaction) {
  const guildId = interaction.guild.id;
  const { data } = await supabase
    .from("economy_wallets")
    .select("user_id, balance, bank")
    .eq("guild_id", guildId)
    .order("total_earned", { ascending: false })
    .limit(10);

  if (!data?.length) return interaction.reply({ content: "No hay datos de economía aún.", flags: 64 });

  const lines = await Promise.all(data.map(async (row, i) => {
    const total = row.balance + row.bank;
    const medals = ["🥇", "🥈", "🥉"];
    const medal = medals[i] || `${i + 1}.`;
    return `${medal} <@${row.user_id}> — **${total.toLocaleString()} ${CURRENCY}**`;
  }));

  const embed = new EmbedBuilder()
    .setColor("#00d4ff")
    .setTitle(`${CURRENCY} Ranking de Riqueza — ${interaction.guild.name}`)
    .setDescription(lines.join("\n"))
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

// ==================== TIENDA DE ROLES ====================
async function getShop(guildId) {
  const { data } = await supabase
    .from("economy_shop")
    .select("*")
    .eq("guild_id", guildId)
    .eq("active", true)
    .order("price", { ascending: true });
  return data || [];
}

async function cmdShop(interaction) {
  const items = await getShop(interaction.guild.id);

  if (!items.length) {
    return interaction.reply({ content: "La tienda está vacía. Un admin puede añadir items con `/economia tienda-añadir`", flags: 64 });
  }

  const embed = new EmbedBuilder()
    .setColor("#00d4ff")
    .setTitle(`🛒 Tienda de ${interaction.guild.name}`)
    .setDescription(items.map((item, i) =>
      `**${i + 1}. ${item.name}**\n💰 ${item.price.toLocaleString()} ${CURRENCY} ${item.role_id ? `→ <@&${item.role_id}>` : ""}`
    ).join("\n\n"))
    .setFooter({ text: "Usa /economia comprar [id] para comprar" })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function cmdBuy(interaction) {
  const itemId = interaction.options.getInteger("item");
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const items = await getShop(guildId);
  const item = items[itemId - 1];
  if (!item) return interaction.reply({ content: "❌ Item no encontrado.", flags: 64 });

  const wallet = await getWallet(userId, guildId);
  if (wallet.balance < item.price) {
    return interaction.reply({ content: `❌ No tienes suficiente. Necesitas **${item.price} ${CURRENCY}** y tienes **${wallet.balance} ${CURRENCY}**`, flags: 64 });
  }

  await updateBalance(userId, guildId, -item.price);

  if (item.role_id) {
    const role = interaction.guild.roles.cache.get(item.role_id);
    if (role) await interaction.member.roles.add(role).catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor("#00ff88")
    .setTitle("✅ Compra Realizada")
    .setDescription(`Compraste **${item.name}** por **${item.price} ${CURRENCY}**${item.role_id ? `\nRecibiste el rol <@&${item.role_id}>` : ""}`)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  cmdBalance, cmdDaily, cmdWork, cmdDeposit,
  cmdWithdraw, cmdTransfer, cmdLeaderboard, cmdShop, cmdBuy,
  getWallet, updateBalance,
};
