const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.DISCORD_TOKEN;
const TEST_GUILD_ID = process.env.GUILD_ID || "1397702689168556094";

// Paso 1: solo carga los archivos en client.commands (sin registrar en Discord)
function loadCommands(client) {
  const commandsPath = path.join(__dirname, "..", "commands");

  if (!fs.existsSync(commandsPath)) {
    console.warn("Carpeta 'commands' no encontrada");
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log("Comando cargado: " + command.data.name);
      } else {
        console.warn("Advertencia: " + file + " no tiene 'data' o 'execute' - ignorado");
      }
    } catch (error) {
      console.error("Error cargando " + file + ": " + error.message);
    }
  }
}

// Paso 2: registra los comandos en Discord (llamar desde el evento ready)
async function registerCommands(client) {
  if (!CLIENT_ID || !TOKEN) {
    console.warn("Falta CLIENT_ID o TOKEN - Comandos no registrados en Discord");
    return;
  }

  const commands = Array.from(client.commands.values()).map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  // 1. Servidor de pruebas (instantaneo)
  try {
    console.log("Registrando " + commands.length + " comandos en servidor de pruebas...");
    const guildData = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, TEST_GUILD_ID),
      { body: commands }
    );
    console.log(guildData.length + " comandos registrados en servidor de pruebas");
  } catch (error) {
    console.error("Error registrando en servidor de pruebas: " + error.message);
    if (error.rawError) console.error("Detalle: " + JSON.stringify(error.rawError));
  }

  // 2. Global
  try {
    console.log("Registrando " + commands.length + " comandos globalmente...");
    const globalData = await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log(globalData.length + " comandos registrados globalmente");
  } catch (error) {
    console.error("Error registrando globalmente: " + error.message);
    if (error.rawError) console.error("Detalle global: " + JSON.stringify(error.rawError));
  }
}

module.exports = { loadCommands, registerCommands };
