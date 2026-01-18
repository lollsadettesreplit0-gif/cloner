const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// Server HTTP per Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord bot is running!');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// ========== CONFIGURAZIONE ==========
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID; // Server da COPIARE (senza permessi)
const SOURCE_GUILD_ID = process.env.SOURCE_GUILD_ID; // Server dove INCOLLARE (con admin)

const client = new Client({ checkUpdate: false });

// Mappa: canale_target_id -> canale_source_id
const channelMap = new Map();

client.on('ready', () => {
    console.log(`✅ Connesso come ${client.user.tag}`);
    console.log(`📥 TARGET (da copiare): ${TARGET_GUILD_ID}`);
    console.log(`📤 SOURCE (dove incollare): ${SOURCE_GUILD_ID}`);
    console.log(`📝 Scrivi !clone nel server SOURCE per iniziare`);
});

client.on('messageCreate', async (message) => {
    // Ignora i tuoi messaggi
    if (message.author.id === client.user.id) return;

    // Comando !clone - esegui dal SOURCE server (dove hai admin)
    if (message.content === '!clone' && message.guild?.id === SOURCE_GUILD_ID) {
        const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID); // Server da copiare
        const sourceGuild = client.guilds.cache.get(SOURCE_GUILD_ID); // Tuo server

        if (!targetGuild || !sourceGuild) {
            return message.reply('❌ Server non trovati! Verifica gli ID.');
        }

        await message.reply(`🔄 Copiando **${targetGuild.name}** in questo server...`);

        try {
            // STEP 1: Elimina canali esistenti nel SOURCE (il tuo server)
            await message.reply(`🗑️ Pulizia canali vecchi...`);
            const deletePromises = sourceGuild.channels.cache.map(ch => 
                ch.delete().catch(() => {})
            );
            await Promise.all(deletePromises);
            await sleep(2000);

            // STEP 2: Clona categorie e canali DAL target AL source
            const categories = targetGuild.channels.cache
                .filter(ch => ch.type === 4) // 4 = Category
                .sort((a, b) => a.position - b.position);

            let statusChannel = null; // Canale per gli aggiornamenti

            for (const category of categories.values()) {
                const newCategory = await sourceGuild.channels.create(category.name, {
                    type: 4,
                    position: category.position
                });
                await sleep(500);

                // Clona canali text
                const textChannels = targetGuild.channels.cache
                    .filter(ch => ch.parentId === category.id && ch.type === 0)
                    .sort((a, b) => a.position - b.position);

                for (const channel of textChannels.values()) {
                    const newChannel = await sourceGuild.channels.create(channel.name, {
                        type: 0,
                        parent: newCategory.id,
                        topic: channel.topic || '',
                        nsfw: true, // Forza NSFW
                        position: channel.position
                    });
                    channelMap.set(channel.id, newChannel.id);
                    
                    // Usa il primo canale creato per gli aggiornamenti
                    if (!statusChannel) statusChannel = newChannel;
                    
                    await sleep(500);
                }

                // Clona canali voice
                const voiceChannels = targetGuild.channels.cache
                    .filter(ch => ch.parentId === category.id && ch.type === 2)
                    .sort((a, b) => a.position - b.position);

                for (const channel of voiceChannels.values()) {
                    await sourceGuild.channels.create(channel.name, {
                        type: 2,
                        parent: newCategory.id,
                        position: channel.position
                    });
                    await sleep(500);
                }
            }

            // Canali senza categoria
            const noCategory = targetGuild.channels.cache
                .filter(ch => !ch.parentId && ch.type === 0)
                .sort((a, b) => a.position - b.position);

            for (const channel of noCategory.values()) {
                const newChannel = await sourceGuild.channels.create(channel.name, {
                    type: 0,
                    topic: channel.topic || '',
                    nsfw: true,
                    position: channel.position
                });
                channelMap.set(channel.id, newChannel.id);
                
                if (!statusChannel) statusChannel = newChannel;
                
                await sleep(500);
            }

            if (!statusChannel) {
                console.error('❌ Nessun canale creato per gli aggiornamenti!');
                return;
            }

            await statusChannel.send(`✅ Struttura clonata! ${channelMap.size} canali creati.`);
            await statusChannel.send(`📥 Inizio copia messaggi e media dal TARGET...`);

            // STEP 3: Copia tutti i messaggi con media DAL target AL source
            let totalMessages = 0;
            let totalMedia = 0;

            for (const [targetId, sourceId] of channelMap.entries()) {
                const targetChannel = targetGuild.channels.cache.get(targetId);
                const sourceChannel = sourceGuild.channels.cache.get(sourceId);

                if (!targetChannel || !sourceChannel) continue;

                try {
                    await statusChannel.send(`📂 Copiando **#${targetChannel.name}**...`);
                    
                    let lastId;
                    let channelMessages = 0;
                    let channelMedia = 0;

                    while (true) {
                        const options = { limit: 100 };
                        if (lastId) options.before = lastId;

                        const messages = await targetChannel.messages.fetch(options);
                        if (messages.size === 0) break;

                        // Ordine cronologico
                        const messagesArray = Array.from(messages.values()).reverse();

                        for (const msg of messagesArray) {
                            try {
                                // Prepara il contenuto
                                const timestamp = msg.createdAt.toLocaleString('it-IT');
                                let content = msg.content || '';
                                const header = `**${msg.author.username}** (${timestamp})`;

                                // Download e re-upload degli allegati
                                const downloadedFiles = [];
                                
                                for (const attachment of msg.attachments.values()) {
                                    try {
                                        const fileData = await downloadFile(attachment.url);
                                        if (fileData) {
                                            downloadedFiles.push({
                                                attachment: fileData,
                                                name: attachment.name
                                            });
                                            channelMedia++;
                                            totalMedia++;
                                        }
                                    } catch (err) {
                                        console.error(`Errore download ${attachment.name}:`, err.message);
                                        content += `\n[File: ${attachment.name} - ${attachment.url}]`;
                                    }
                                }

                                // Invia il messaggio con file ri-uppati
                                const fullContent = content ? `${header}: ${content}` : header;
                                
                                await sourceChannel.send({
                                    content: fullContent.slice(0, 2000),
                                    files: downloadedFiles,
                                    embeds: msg.embeds.slice(0, 10)
                                });

                                channelMessages++;
                                totalMessages++;
                                
                                // Rate limit: 1 messaggio ogni 1-2 secondi
                                await sleep(1500);

                            } catch (err) {
                                console.error(`Errore copia messaggio:`, err.message);
                                await sleep(2000);
                            }
                        }

                        lastId = messages.last().id;
                        await sleep(3000); // Pausa tra batch
                    }

                    await statusChannel.send(`✅ **#${targetChannel.name}**: ${channelMessages} msg, ${channelMedia} file`);

                } catch (error) {
                    console.error(`Errore canale ${targetChannel.name}:`, error.message);
                    await statusChannel.send(`❌ Errore in #${targetChannel.name}`);
                }

                await sleep(5000); // Pausa tra canali
            }

            await statusChannel.send(`🎉 **COMPLETATO!**\n📊 ${totalMessages} messaggi\n📎 ${totalMedia} file copiati`);

        } catch (error) {
            console.error(error);
            if (message.channel) {
                await message.channel.send(`❌ Errore generale: ${error.message}`);
            }
        }
    }
});

// Download file da URL
async function downloadFile(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 25000000 // 25MB max
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error('Download fallito:', error.message);
        return null;
    }
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Login
client.login(TOKEN).catch(err => {
    console.error('❌ Errore login:', err.message);
    process.exit(1);
});
