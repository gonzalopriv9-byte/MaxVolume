const { REST, Routes } = require('discord.js');
const loadEnv = require('../src/config/env');
const { loadCommands } = require('../src/commands');

async function main() {
  const env = loadEnv();
  const commands = [...loadCommands().values()].map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  if (env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body: commands
    });
    console.log(`Registered ${commands.length} guild commands in ${env.DISCORD_GUILD_ID}`);
    return;
  }

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commands });
  console.log(`Registered ${commands.length} global commands`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
