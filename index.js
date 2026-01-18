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

// CANALI DA ESCLUDERE
const EXCLUDED_CHANNELS = [
    '1299125689659686952',
    '1299822514670801008',
    '1299126325776224357',
    '1319797024773898330',
    '1417217261743247440'
];

const client = new Client({ checkUpdate: false });
const channelMap = new Map();

client.on('ready', async () => {
    console.log(`✅ Selfbot attivo: ${client.user.tag}`);
    console.log(`📥 TARGET: ${TARGET_GUILD_ID}`);
    console.log(`📤 SOURCE: ${SOURCE_GUILD_ID}`);
    console.log('⏳ Clonazione automatica tra 5 secondi...');
    await sleep(5000);
    await startClone();
});

async function startClone() {
    console.log('🎯 INIZIO CLONAZIONE!');
    
    const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);
    const sourceGuild = client.guilds.cache.get(SOURCE_GUILD_ID);

    if (!targetGuild || !sourceGuild) {
        console.error('❌ Server non trovati!');
        return;
    }

    console.log(`🔄 Clonazione: ${targetGuild.name} → ${sourceGuild.name}`);

    try {
        // STEP 1: Elimina canali SOURCE
        console.log('🗑️ Eliminazione canali SOURCE...');
        const channelsToDelete = Array.from(sourceGuild.channels.cache.values());
        
        for (const ch of channelsToDelete) {
            try {
                console.log(`  ❌ Eliminando: ${ch.name}`);
                await ch.delete();
                await sleep(300);
            } catch (err) {
                console.error(`  ⚠️ Errore eliminazione ${ch.name}: ${err.message}`);
            }
        }

        await sleep(2000);
        console.log('✅ Canali eliminati');

        // STEP 2: Clona categorie
        const categories = targetGuild.channels.cache
            .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
            .sort((a, b) => a.position - b.position);

        console.log(`📁 Categorie trovate: ${categories.size}`);

        for (const category of categories.values()) {
            console.log(`📁 Creando categoria: ${category.name}`);
            
            // Controlla se ci sono canali accessibili in questa categoria
            const categoryChannelsCheck = targetGuild.channels.cache
                .filter(ch => {
                    if (ch.parentId !== category.id) return false;
                    const type = ch.type;
                    return type !== 'GUILD_VOICE' && type !== 2 && 
                           type !== 'GUILD_PUBLIC_THREAD' && type !== 11 &&
                           type !== 'GUILD_PRIVATE_THREAD' && type !== 12 &&
                           type !== 'GUILD_CATEGORY' && type !== 4;
                })
                .sort((a, b) => a.position - b.position);
            
            // Controlla se ha accesso ad almeno UN canale della categoria
            let hasAccessToCategory = false;
            for (const ch of categoryChannelsCheck.values()) {
                try {
                    await ch.messages.fetch({ limit: 1 });
                    hasAccessToCategory = true;
                    break;
                } catch (err) {
                    // Continua
                }
            }
            
            if (!hasAccessToCategory && categoryChannelsCheck.size > 0) {
                console.log(`⏭️ SALTATA CATEGORIA: ${category.name} (no access)`);
                continue;
            }
            
            const newCat = await sourceGuild.channels.create(category.name, {
                type: 4,
                position: category.position
            }).catch(err => {
                console.error(`❌ Errore categoria ${category.name}: ${err.message}`);
                return null;
            });

            if (!newCat) continue;
            await sleep(300);

            // Clona canali text della categoria
            const channelsInCategory = targetGuild.channels.cache
                .filter(ch => {
                    if (ch.parentId !== category.id) return false;
                    const type = ch.type;
                    return type !== 'GUILD_VOICE' && type !== 2 && 
                           type !== 'GUILD_PUBLIC_THREAD' && type !== 11 &&
                           type !== 'GUILD_PRIVATE_THREAD' && type !== 12 &&
                           type !== 'GUILD_CATEGORY' && type !== 4;
                })
                .sort((a, b) => a.position - b.position);

            for (const channel of channelsInCategory.values()) {
                if (EXCLUDED_CHANNELS.includes(channel.name) || EXCLUDED_CHANNELS.includes(channel.id)) {
                    console.log(`  ⏭️ SALTATO: ${channel.name} (escluso)`);
                    continue;
                }
                
                let hasAccess = true;
                try {
                    await channel.messages.fetch({ limit: 1 });
                } catch (err) {
                    console.log(`  ⏭️ SALTATO: ${channel.name} (no access)`);
                    hasAccess = false;
                }
                
                if (!hasAccess) continue;
                
                console.log(`  📝 Creando: ${channel.name}`);
                
                let channelType = 0;
                if (channel.type === 'GUILD_TEXT' || channel.type === 0) channelType = 0;
                else if (channel.type === 'GUILD_NEWS' || channel.type === 5) channelType = 5;
                else if (channel.type === 'GUILD_FORUM' || channel.type === 15) channelType = 15;
                
                const newCh = await sourceGuild.channels.create(channel.name, {
                    type: channelType,
                    parent: newCat.id,
                    topic: channel.topic || '',
                    nsfw: true,
                    position: channel.position
                }).catch(err => {
                    console.error(`  ❌ Errore ${channel.name}: ${err.message}`);
                    return null;
                });

                if (newCh) {
                    channelMap.set(channel.id, newCh.id);
                }
                
                await sleep(300);
            }

            // Clona canali voice della categoria
            const voiceChannels = targetGuild.channels.cache
                .filter(ch => ch.parentId === category.id && (ch.type === 'GUILD_VOICE' || ch.type === 2))
                .sort((a, b) => a.position - b.position);

            for (const channel of voiceChannels.values()) {
                let hasAccess = true;
                try {
                    await channel.fetch();
                } catch (err) {
                    console.log(`  ⏭️ SALTATO VOICE: ${channel.name} (no access)`);
                    hasAccess = false;
                }
                
                if (!hasAccess) continue;
                
                console.log(`  🔊 Creando voice: ${channel.name}`);
                
                await sourceGuild.channels.create(channel.name, {
                    type: 2,
                    parent: newCat.id,
                    position: channel.position
                }).catch(err => {
                    console.error(`  ❌ Errore voice ${channel.name}: ${err.message}`);
                });
                
                await sleep(300);
            }
        }

        // Clona canali senza categoria
        const noCategory = targetGuild.channels.cache
            .filter(ch => {
                if (ch.parentId) return false;
                const type = ch.type;
                return type !== 'GUILD_VOICE' && type !== 2 && 
                       type !== 'GUILD_PUBLIC_THREAD' && type !== 11 &&
                       type !== 'GUILD_PRIVATE_THREAD' && type !== 12 &&
                       type !== 'GUILD_CATEGORY' && type !== 4;
            })
            .sort((a, b) => a.position - b.position);

        if (noCategory.size > 0) {
            console.log(`📝 Canali senza categoria: ${noCategory.size}`);
        }

        for (const channel of noCategory.values()) {
            if (EXCLUDED_CHANNELS.includes(channel.name) || EXCLUDED_CHANNELS.includes(channel.id)) {
                console.log(`⏭️ SALTATO: ${channel.name} (escluso)`);
                continue;
            }
            
            let hasAccess = true;
            try {
                await channel.messages.fetch({ limit: 1 });
            } catch (err) {
                console.log(`⏭️ SALTATO: ${channel.name} (no access)`);
                hasAccess = false;
            }
            
            if (!hasAccess) continue;
            
            console.log(`📝 Creando: ${channel.name}`);
            
            let channelType = 0;
            if (channel.type === 'GUILD_TEXT' || channel.type === 0) channelType = 0;
            else if (channel.type === 'GUILD_NEWS' || channel.type === 5) channelType = 5;
            else if (channel.type === 'GUILD_FORUM' || channel.type === 15) channelType = 15;
            
            const newCh = await sourceGuild.channels.create(channel.name, {
                type: channelType,
                topic: channel.topic || '',
                nsfw: true,
                position: channel.position
            }).catch(err => {
                console.error(`❌ Errore ${channel.name}: ${err.message}`);
                return null;
            });

            if (newCh) {
                channelMap.set(channel.id, newCh.id);
            }
            
            await sleep(300);
        }

        console.log(`✅ Struttura clonata: ${channelMap.size} canali`);

        // STEP 3: Copia messaggi
        console.log('📥 INIZIO COPIA MESSAGGI');
        let totalMsg = 0;
        let totalFiles = 0;

        for (const [targetId, sourceId] of channelMap.entries()) {
            const targetCh = targetGuild.channels.cache.get(targetId);
            const sourceCh = sourceGuild.channels.cache.get(sourceId);

            if (!targetCh || !sourceCh) continue;

            try {
                console.log(`📂 Copiando #${targetCh.name}...`);

                let lastId;
                let chMsg = 0;
                let chFiles = 0;

                while (true) {
                    const opts = { limit: 50 };
                    if (lastId) opts.before = lastId;

                    const msgs = await targetCh.messages.fetch(opts).catch(err => {
                        console.error(`  ⚠️ Errore fetch: ${err.message}`);
                        return null;
                    });

                    if (!msgs || msgs.size === 0) break;

                    const msgsArray = Array.from(msgs.values()).reverse();

                    for (const msg of msgsArray) {
                        try {
                            if (msg.system || msg.author.bot || msg.author.id === '1') {
                                continue;
                            }

                            if (!msg.content && msg.attachments.size === 0 && msg.embeds.length === 0) {
                                continue;
                            }

                            const files = [];
                            const links = [];
                            
                            for (const att of msg.attachments.values()) {
                                try {
                                    console.log(`    📎 Processing: ${att.name}`);
                                    
                                    if (att.size > 20971520) {
                                        console.log(`    ⚠️ File troppo grande, salvo link`);
                                        links.push(att.url);
                                        continue;
                                    }
                                    
                                    const data = await downloadFile(att.url);
                                    if (data) {
                                        // Rinomina il file come GRINDR
                                        const ext = att.name.split('.').pop();
                                        files.push({ attachment: data, name: `GRINDR.${ext}` });
                                        chFiles++;
                                        totalFiles++;
                                    }
                                } catch (err) {
                                    console.error(`    ⚠️ Download ${att.name}: ${err.message}`);
                                    links.push(att.url);
                                }
                            }

                            if (files.length > 0) {
                                try {
                                    await sourceCh.send({
                                        files: files
                                    });
                                } catch (err) {
                                    console.error(`    ⚠️ Send files: ${err.message}`);
                                    for (const link of links) {
                                        await sourceCh.send(link).catch(() => {});
                                    }
                                }
                            }

                            if (links.length > 0) {
                                try {
                                    for (const link of links) {
                                        await sourceCh.send(link);
                                        await sleep(300);
                                    }
                                } catch (err) {
                                    console.error(`    ⚠️ Send links: ${err.message}`);
                                }
                            }

                            if (msg.embeds.length > 0) {
                                try {
                                    await sourceCh.send({
                                        embeds: msg.embeds.slice(0, 10)
                                    });
                                } catch (err) {
                                    console.error(`    ⚠️ Send embeds: ${err.message}`);
                                }
                            }

                            let txt = msg.content || '';
                            if (txt && files.length === 0 && links.length === 0 && msg.embeds.length === 0) {
                                try {
                                    await sourceCh.send({
                                        content: txt.slice(0, 2000)
                                    });
                                } catch (err) {
                                    console.error(`    ⚠️ Send text: ${err.message}`);
                                }
                            }

                            chMsg++;
                            totalMsg++;
                            await sleep(500);

                        } catch (err) {
                            console.error(`    ⚠️ Msg: ${err.message}`);
                            await sleep(2000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(2000);
                }

                console.log(`✅ ${targetCh.name}: ${chMsg} msg, ${chFiles} file`);

            } catch (err) {
                console.error(`❌ Errore ${targetCh.name}: ${err.message}`);
            }

            await sleep(1000);
        }

        console.log(`🎉 COMPLETATO: ${totalMsg} messaggi, ${totalFiles} file`);

        // STEP 4: Mescola i canali tra categorie diverse
        console.log('🔀 Inizio mescolamento canali per offuscare la copia...');
        
        const allCategories = sourceGuild.channels.cache
            .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
            .map(cat => cat);
        
        if (allCategories.length > 1) {
            const allTextChannels = sourceGuild.channels.cache
                .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0)
                .filter(ch => ch.parentId)
                .map(ch => ch);
            
            // Mescola gli indici
            for (let i = 0; i < allTextChannels.length; i++) {
                const randomIndex = Math.floor(Math.random() * allTextChannels.length);
                const randomCategory = allCategories[Math.floor(Math.random() * allCategories.length)];
                
                try {
                    const channel = allTextChannels[randomIndex];
                    console.log(`🔀 Spostando #${channel.name} in ${randomCategory.name}...`);
                    await channel.setParent(randomCategory.id).catch(() => {});
                    await sleep(200);
                } catch (err) {
                    console.error(`⚠️ Errore mescolamento: ${err.message}`);
                }
            }
            
            console.log('✅ Mescolamento completato');
        }

    } catch (err) {
        console.error('❌ ERRORE GENERALE:', err);
    }
}

async function downloadFile(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 20971520
        });
        return Buffer.from(res.data);
    } catch (err) {
        console.error('Download fallito:', err.message);
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
