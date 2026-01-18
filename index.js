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

// CANALI DA ESCLUDERE (per ID o nome)
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
    console.log(`📥 TARGET (da copiare): ${TARGET_GUILD_ID}`);
    console.log(`📤 SOURCE (dove incollare): ${SOURCE_GUILD_ID}`);
    
    // PARTE AUTOMATICAMENTE DOPO 5 SECONDI
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
        console.error(`Target: ${targetGuild ? 'OK' : 'MANCANTE'}`);
        console.error(`Source: ${sourceGuild ? 'OK' : 'MANCANTE'}`);
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

        // DEBUG: Mostra TUTTI i canali del TARGET
        console.log('📋 DEBUG - Tutti i canali del TARGET:');
        console.log(`   Totale canali cache: ${targetGuild.channels.cache.size}`);
        
        targetGuild.channels.cache.forEach(ch => {
            console.log(`   - ${ch.name} | Tipo: ${ch.type} | Parent: ${ch.parentId || 'NESSUNO'} | ID: ${ch.id}`);
        });
        
        // STEP 2: Clona TUTTI i canali dal TARGET (qualsiasi tipo)
        console.log('📋 Analizzando canali del TARGET...');
        
        // Prima clona le categorie
        const categories = targetGuild.channels.cache
            .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
            .sort((a, b) => a.position - b.position);

        console.log(`📁 Categorie trovate: ${categories.size}`);

        let statusChannel = null;

        for (const category of categories.values()) {
            console.log(`📁 Creando categoria: ${category.name}`);
            
            const newCat = await sourceGuild.channels.create(category.name, {
                type: 4, // GUILD_CATEGORY
                position: category.position
            }).catch(err => {
                console.error(`❌ Errore categoria ${category.name}: ${err.message}`);
                return null;
            });

            if (!newCat) continue;
            await sleep(500);

            // Clona TUTTI i canali della categoria (qualsiasi tipo tranne voice e thread)
            const channelsInCategory = targetGuild.channels.cache
                .filter(ch => {
                    if (ch.parentId !== category.id) return false;
                    const type = ch.type;
                    // Escludi voice e thread
                    return type !== 'GUILD_VOICE' && type !== 2 && 
                           type !== 'GUILD_PUBLIC_THREAD' && type !== 11 &&
                           type !== 'GUILD_PRIVATE_THREAD' && type !== 12 &&
                           type !== 'GUILD_CATEGORY' && type !== 4;
                })
                .sort((a, b) => a.position - b.position);

            console.log(`  Canali in ${category.name}: ${channelsInCategory.size}`);

            for (const channel of channelsInCategory.values()) {
                // Salta canali esclusi
                if (EXCLUDED_CHANNELS.includes(channel.name) || EXCLUDED_CHANNELS.includes(channel.id)) {
                    console.log(`  ⏭️ SALTATO: ${channel.name} (escluso)`);
                    continue;
                }
                
                console.log(`  📝 Creando: ${channel.name} (tipo: ${channel.type})`);
                
                // Converti tipo stringa in numero per la creazione
                let channelType = 0; // Default: text
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
                    if (!statusChannel) statusChannel = newCh;
                }
                
                await sleep(500);
            }

            // Clona canali voice della categoria
            const voiceChannels = targetGuild.channels.cache
                .filter(ch => ch.parentId === category.id && ch.type === 2)
                .sort((a, b) => a.position - b.position);

            for (const channel of voiceChannels.values()) {
                console.log(`  🔊 Creando voice: ${channel.name}`);
                
                await sourceGuild.channels.create(channel.name, {
                    type: 2,
                    parent: newCat.id,
                    position: channel.position
                }).catch(err => {
                    console.error(`  ❌ Errore voice ${channel.name}: ${err.message}`);
                });
                
                await sleep(500);
            }
        }

        // Clona canali senza categoria (TUTTI i tipi tranne voice, thread e category)
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
            // Salta canali esclusi
            if (EXCLUDED_CHANNELS.includes(channel.name) || EXCLUDED_CHANNELS.includes(channel.id)) {
                console.log(`⏭️ SALTATO: ${channel.name} (escluso)`);
                continue;
            }
            
            console.log(`📝 Creando: ${channel.name} (tipo: ${channel.type})`);
            
            // Converti tipo stringa in numero
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
                if (!statusChannel) statusChannel = newCh;
            }
            
            await sleep(500);
        }

        if (!statusChannel) {
            console.error('❌ Nessun canale creato per status!');
            return;
        }

        console.log(`✅ Struttura clonata: ${channelMap.size} canali text mappati`);
        await statusChannel.send(`✅ **Struttura clonata!** ${channelMap.size} canali creati.`);
        await statusChannel.send(`📥 Inizio copia messaggi e media dal TARGET...`);

        // STEP 3: Copia tutti i messaggi con media
        console.log('📥 INIZIO COPIA MESSAGGI');
        let totalMsg = 0;
        let totalFiles = 0;

        for (const [targetId, sourceId] of channelMap.entries()) {
            const targetCh = targetGuild.channels.cache.get(targetId);
            const sourceCh = sourceGuild.channels.cache.get(sourceId);

            if (!targetCh || !sourceCh) continue;

            try {
                console.log(`📂 Copiando #${targetCh.name}...`);
                await statusChannel.send(`📂 Copiando **#${targetCh.name}**...`);

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
                            const ts = msg.createdAt.toLocaleString('it-IT');
                            let txt = msg.content || '';
                            const header = `**${msg.author.username}** (${ts})`;

                            const files = [];
                            
                            for (const att of msg.attachments.values()) {
                                try {
                                    console.log(`    📎 Download: ${att.name}`);
                                    const data = await downloadFile(att.url);
                                    if (data) {
                                        files.push({ attachment: data, name: att.name });
                                        chFiles++;
                                        totalFiles++;
                                    }
                                } catch (err) {
                                    console.error(`    ⚠️ Download ${att.name}: ${err.message}`);
                                    txt += `\n[${att.name}: ${att.url}]`;
                                }
                            }

                            const full = txt ? `${header}: ${txt}` : header;
                            
                            await sourceCh.send({
                                content: full.slice(0, 2000),
                                files: files,
                                embeds: msg.embeds.slice(0, 10)
                            }).catch(err => {
                                console.error(`    ⚠️ Send: ${err.message}`);
                            });

                            chMsg++;
                            totalMsg++;
                            await sleep(1500);

                        } catch (err) {
                            console.error(`    ⚠️ Msg: ${err.message}`);
                            await sleep(2000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(3000);
                }

                await statusChannel.send(`✅ **#${targetCh.name}**: ${chMsg} msg, ${chFiles} file`);
                console.log(`✅ ${targetCh.name}: ${chMsg} msg, ${chFiles} file`);

            } catch (err) {
                console.error(`❌ Errore ${targetCh.name}: ${err.message}`);
                await statusChannel.send(`❌ Errore in #${targetCh.name}`);
            }

            await sleep(5000);
        }

        await statusChannel.send(`🎉 **COMPLETATO!**\n📊 ${totalMsg} messaggi\n📎 ${totalFiles} file copiati`);
        console.log(`🎉 COMPLETATO: ${totalMsg} messaggi, ${totalFiles} file`);

    } catch (err) {
        console.error('❌ ERRORE GENERALE:', err);
        console.error(err.stack);
    }
}

async function downloadFile(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 25000000
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
