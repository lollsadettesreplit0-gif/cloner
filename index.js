const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// Server HTTP per Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord selfbot is running!');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// ========== CONFIGURAZIONE ==========
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID;
const SOURCE_GUILD_ID = process.env.SOURCE_GUILD_ID;

const client = new Client({
    checkUpdate: false,
    partials: ['MESSAGE', 'CHANNEL']
});

const channelMap = new Map();

client.on('ready', async () => {
    console.log(`✅ Selfbot attivo: ${client.user.tag}`);
    console.log(`📥 TARGET: ${TARGET_GUILD_ID}`);
    console.log(`📤 SOURCE: ${SOURCE_GUILD_ID}`);
});

// Per i selfbot usiamo il modo corretto di intercettare i messaggi
client.on('messageCreate', async (message) => {
    // Debug
    console.log(`Msg: ${message.content} | Author: ${message.author.tag} | Guild: ${message.guild?.id}`);
    
    // IMPORTANTE: Non ignorare i propri messaggi per i selfbot!
    // Il selfbot deve rispondere ai TUOI comandi
    
    if (message.content === '!clone' && message.guild?.id === SOURCE_GUILD_ID) {
        console.log('🎯 Comando !clone ricevuto!');
        
        const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);
        const sourceGuild = client.guilds.cache.get(SOURCE_GUILD_ID);

        if (!targetGuild || !sourceGuild) {
            return message.reply('❌ Server non trovati!').catch(console.error);
        }

        await message.reply(`🔄 Inizio clonazione di **${targetGuild.name}**...`).catch(console.error);

        try {
            // Elimina canali SOURCE
            console.log('🗑️ Eliminazione canali...');
            for (const ch of sourceGuild.channels.cache.values()) {
                try {
                    await ch.delete();
                    await sleep(300);
                } catch (err) {
                    console.error(`Errore eliminazione ${ch.name}:`, err.message);
                }
            }

            await sleep(2000);
            console.log('✅ Canali eliminati');

            // Clona categorie
            const categories = targetGuild.channels.cache
                .filter(ch => ch.type === 4)
                .sort((a, b) => a.position - b.position);

            let statusChannel = null;

            for (const category of categories.values()) {
                console.log(`📁 Creando categoria: ${category.name}`);
                
                const newCat = await sourceGuild.channels.create(category.name, {
                    type: 4,
                    position: category.position
                }).catch(err => {
                    console.error(`Errore categoria ${category.name}:`, err.message);
                    return null;
                });

                if (!newCat) continue;
                await sleep(500);

                // Canali text
                const textChannels = targetGuild.channels.cache
                    .filter(ch => ch.parentId === category.id && ch.type === 0)
                    .sort((a, b) => a.position - b.position);

                for (const channel of textChannels.values()) {
                    console.log(`📝 Creando canale: ${channel.name}`);
                    
                    const newCh = await sourceGuild.channels.create(channel.name, {
                        type: 0,
                        parent: newCat.id,
                        topic: channel.topic || '',
                        nsfw: true,
                        position: channel.position
                    }).catch(err => {
                        console.error(`Errore canale ${channel.name}:`, err.message);
                        return null;
                    });

                    if (newCh) {
                        channelMap.set(channel.id, newCh.id);
                        if (!statusChannel) statusChannel = newCh;
                    }
                    
                    await sleep(500);
                }

                // Canali voice
                const voiceChannels = targetGuild.channels.cache
                    .filter(ch => ch.parentId === category.id && ch.type === 2)
                    .sort((a, b) => a.position - b.position);

                for (const channel of voiceChannels.values()) {
                    console.log(`🔊 Creando voice: ${channel.name}`);
                    
                    await sourceGuild.channels.create(channel.name, {
                        type: 2,
                        parent: newCat.id,
                        position: channel.position
                    }).catch(err => {
                        console.error(`Errore voice ${channel.name}:`, err.message);
                    });
                    
                    await sleep(500);
                }
            }

            // Canali senza categoria
            const noCategory = targetGuild.channels.cache
                .filter(ch => !ch.parentId && ch.type === 0)
                .sort((a, b) => a.position - b.position);

            for (const channel of noCategory.values()) {
                console.log(`📝 Creando canale root: ${channel.name}`);
                
                const newCh = await sourceGuild.channels.create(channel.name, {
                    type: 0,
                    topic: channel.topic || '',
                    nsfw: true,
                    position: channel.position
                }).catch(err => {
                    console.error(`Errore canale ${channel.name}:`, err.message);
                    return null;
                });

                if (newCh) {
                    channelMap.set(channel.id, newCh.id);
                    if (!statusChannel) statusChannel = newCh;
                }
                
                await sleep(500);
            }

            if (!statusChannel) {
                console.error('❌ Nessun canale per status!');
                return;
            }

            await statusChannel.send(`✅ ${channelMap.size} canali creati!`);
            await statusChannel.send(`📥 Inizio copia messaggi...`);
            console.log('📥 Inizio copia messaggi');

            // Copia messaggi
            let totalMsg = 0;
            let totalFiles = 0;

            for (const [targetId, sourceId] of channelMap.entries()) {
                const targetCh = targetGuild.channels.cache.get(targetId);
                const sourceCh = sourceGuild.channels.cache.get(sourceId);

                if (!targetCh || !sourceCh) continue;

                try {
                    console.log(`📂 Copiando #${targetCh.name}...`);
                    await statusChannel.send(`📂 **#${targetCh.name}**...`);

                    let lastId;
                    let chMsg = 0;
                    let chFiles = 0;

                    while (true) {
                        const opts = { limit: 50 };
                        if (lastId) opts.before = lastId;

                        const msgs = await targetCh.messages.fetch(opts).catch(err => {
                            console.error(`Errore fetch: ${err.message}`);
                            return null;
                        });

                        if (!msgs || msgs.size === 0) break;

                        const msgsArray = Array.from(msgs.values()).reverse();

                        for (const msg of msgsArray) {
                            try {
                                const ts = msg.createdAt.toLocaleString('it-IT');
                                let txt = msg.content || '';
                                const header = `**${msg.author.username}** (${ts})`;

                                const files = [];
                                
                                for (const att of msg.attachments.values()) {
                                    try {
                                        const data = await downloadFile(att.url);
                                        if (data) {
                                            files.push({ attachment: data, name: att.name });
                                            chFiles++;
                                            totalFiles++;
                                        }
                                    } catch (err) {
                                        console.error(`Download ${att.name}: ${err.message}`);
                                        txt += `\n[${att.name}: ${att.url}]`;
                                    }
                                }

                                const full = txt ? `${header}: ${txt}` : header;
                                
                                await sourceCh.send({
                                    content: full.slice(0, 2000),
                                    files: files,
                                    embeds: msg.embeds.slice(0, 10)
                                }).catch(err => {
                                    console.error(`Send: ${err.message}`);
                                });

                                chMsg++;
                                totalMsg++;
                                await sleep(1500);

                            } catch (err) {
                                console.error(`Msg: ${err.message}`);
                                await sleep(2000);
                            }
                        }

                        lastId = msgs.last().id;
                        await sleep(3000);
                    }

                    await statusChannel.send(`✅ **#${targetCh.name}**: ${chMsg} msg, ${chFiles} file`);
                    console.log(`✅ ${targetCh.name}: ${chMsg} msg`);

                } catch (err) {
                    console.error(`Errore ${targetCh.name}:`, err.message);
                    await statusChannel.send(`❌ #${targetCh.name}`);
                }

                await sleep(5000);
            }

            await statusChannel.send(`🎉 FATTO!\n📊 ${totalMsg} msg\n📎 ${totalFiles} file`);
            console.log(`🎉 Completato: ${totalMsg} msg, ${totalFiles} file`);

        } catch (err) {
            console.error('❌ Errore generale:', err);
        }
    }
});

async function downloadFile(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 25000000
        });
        return Buffer.from(res.data);
    } catch (err) {
        console.error('Download:', err.message);
        return null;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(TOKEN).catch(err => {
    console.error('❌ Login fallito:', err.message);
    process.exit(1);
});
