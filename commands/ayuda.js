const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('❓Muestra la lista de comandos disponibles'),

  async execute(interaction) {
    const commands = interaction.client.commands;
    const embed = new EmbedBuilder()
      .setTitle('Comandos de NEXA Bot')
      .setColor('Random')
      .setDescription(commands.size
        ? Array.from(commands.values()).map(c => `**/${c.data.name}** → ${c.data.description}`).join('\n')
        : 'No hay comandos registrados');

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
