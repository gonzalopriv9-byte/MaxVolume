// commands/economia.js
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const eco = require("../utils/economySystem");
const { getEffectiveLimits } = require("../utils/premiumManager");
const { supabase } = require("../utils/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("economia")
    .setDescription("Sistema de economía virtual del servidor")
    .addSubcommand(sub =>
      sub.setName("balance")
        .setDescription("Ver tu saldo o el de alguien")
        .addUserOption(opt => opt.setName("usuario").setDescription("Usuario a consultar")))
    .addSubcommand(sub =>
      sub.setName("daily")
        .setDescription("Reclamar recompensa diaria"))
    .addSubcommand(sub =>
      sub.setName("trabajar")
        .setDescription("Trabajar para ganar monedas"))
    .addSubcommand(sub =>
      sub.setName("depositar")
        .setDescription("Depositar en el banco")
        .addIntegerOption(opt => opt.setName("cantidad").setDescription("Cantidad").setRequired(true).setMinValue(1)))
    .addSubcommand(sub =>
      sub.setName("retirar")
        .setDescription("Retirar del banco")
        .addIntegerOption(opt => opt.setName("cantidad").setDescription("Cantidad").setRequired(true).setMinValue(1)))
    .addSubcommand(sub =>
      sub.setName("transferir")
        .setDescription("Enviar monedas a otro usuario")
        .addUserOption(opt => opt.setName("usuario").setDescription("Destinatario").setRequired(true))
        .addIntegerOption(opt => opt.setName("cantidad").setDescription("Cantidad").setRequired(true).setMinValue(1)))
    .addSubcommand(sub =>
      sub.setName("ranking")
        .setDescription("Ver los más ricos del servidor"))
    .addSubcommand(sub =>
      sub.setName("tienda")
        .setDescription("Ver la tienda de roles"))
    .addSubcommand(sub =>
      sub.setName("comprar")
        .setDescription("Comprar un item de la tienda")
        .addIntegerOption(opt => opt.setName("item").setDescription("Número del item").setRequired(true).setMinValue(1)))
    // Admin commands (permisos verificados en execute)
    .addSubcommand(sub =>
      sub.setName("tienda-añadir")
        .setDescription("Añadir item a la tienda [Admin]")
        .addStringOption(opt => opt.setName("nombre").setDescription("Nombre del item").setRequired(true))
        .addIntegerOption(opt => opt.setName("precio").setDescription("Precio en monedas").setRequired(true).setMinValue(1))
        .addRoleOption(opt => opt.setName("rol").setDescription("Rol que otorga (opcional)")))
    .addSubcommand(sub =>
      sub.setName("dar")
        .setDescription("Dar monedas a un usuario [Admin]")
        .addUserOption(opt => opt.setName("usuario").setDescription("Usuario").setRequired(true))
        .addIntegerOption(opt => opt.setName("cantidad").setDescription("Cantidad").setRequired(true).setMinValue(1)))
    .addSubcommand(sub =>
      sub.setName("quitar")
        .setDescription("Quitar monedas a un usuario [Admin]")
        .addUserOption(opt => opt.setName("usuario").setDescription("Usuario").setRequired(true))
        .addIntegerOption(opt => opt.setName("cantidad").setDescription("Cantidad").setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const limits = await getEffectiveLimits(interaction.guild.id);
    if (!limits.hasEconomy) {
      return interaction.reply({
        content: "🟣 **La economía requiere NEXA Elite** (12,99€/mes)\nActívalo en: `/premium info`",
        flags: 64,
      });
    }

    // Verificar permisos de administrador para comandos admin
    const adminCommands = ["tienda-añadir", "dar", "quitar"];
    if (adminCommands.includes(sub)) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Necesitas permisos de **Administrador** para usar este comando.",
          flags: 64,
        });
      }
    }

    if (sub === "balance")    return eco.cmdBalance(interaction);
    if (sub === "daily")      return eco.cmdDaily(interaction);
    if (sub === "trabajar")   return eco.cmdWork(interaction);
    if (sub === "depositar")  return eco.cmdDeposit(interaction);
    if (sub === "retirar")    return eco.cmdWithdraw(interaction);
    if (sub === "transferir") return eco.cmdTransfer(interaction);
    if (sub === "ranking")    return eco.cmdLeaderboard(interaction);
    if (sub === "tienda")     return eco.cmdShop(interaction);
    if (sub === "comprar")    return eco.cmdBuy(interaction);

    // ==================== TIENDA AÑADIR ====================
    if (sub === "tienda-añadir") {
      const nombre = interaction.options.getString("nombre");
      const precio = interaction.options.getInteger("precio");
      const rol    = interaction.options.getRole("rol");

      await supabase.from("economy_shop").insert({
        guild_id: interaction.guild.id,
        name: nombre,
        price: precio,
        role_id: rol?.id || null,
        active: true,
        created_at: new Date().toISOString(),
      });

      return interaction.reply({
        content: `✅ Item **${nombre}** añadido a la tienda por **${precio} 💎**${rol ? ` (otorga <@&${rol.id}>)` : ""}`,
        flags: 64,
      });
    }

    // ==================== DAR MONEDAS ====================
    if (sub === "dar") {
      const target = interaction.options.getUser("usuario");
      const amount = interaction.options.getInteger("cantidad");
      await eco.updateBalance(target.id, interaction.guild.id, amount);
      return interaction.reply({ content: `✅ Diste **${amount} 💎** a <@${target.id}>`, flags: 64 });
    }

    // ==================== QUITAR MONEDAS ====================
    if (sub === "quitar") {
      const target = interaction.options.getUser("usuario");
      const amount = interaction.options.getInteger("cantidad");
      await eco.updateBalance(target.id, interaction.guild.id, -amount);
      return interaction.reply({ content: `✅ Quitaste **${amount} 💎** a <@${target.id}>`, flags: 64 });
    }
  },
};
