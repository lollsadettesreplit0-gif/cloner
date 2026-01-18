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
                
                // Per user account: controlla se riesci a leggere PRIMA di clonare
                let hasAccess = true;
                try {
                    await channel.messages.fetch({ limit: 1 });
                } catch (err) {
                    console.log(`  ⏭️ SALTATO: ${channel.name} (no access)`);
                    hasAccess = false;
                }
                
                if (!hasAccess) continue;
                
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
                .filter(ch => ch.parentId === category.id && (ch.type === 'GUILD_VOICE' || ch.type === 2))
                .sort((a, b) => a.position - b.position);

            for (const channel of voiceChannels.values()) {
                // Salta voice a cui non hai accesso
                let hasAccess = true;
                try {
                    // Per voice, prova a fare fetch di info
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
            
            // Per user account: controlla se riesci a leggere PRIMA di clonare
            let hasAccess = true;
            try {
                await channel.messages.fetch({ limit: 1 });
            } catch (err) {
                console.log(`⏭️ SALTATO: ${channel.name} (no access)`);
                hasAccess = false;
            }
            
            if (!hasAccess) continue;
            
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

        // Crea il canale "server-logs" per gli aggiornamenti
        console.log('📋 Creando canale server-logs...');
        const logsChannel = await sourceGuild.channels.create('server-logs', {
            type: 0, // Text
            topic: 'Clone progress logs',
            nsfw: false
        }).catch(err => {
            console.error('Errore creazione logs channel:', err.message);
            return statusChannel; // Fallback
        });

        const logsCh = logsChannel || statusChannel;

        console.log(`✅ Struttura clonata: ${channelMap.size} canali text mappati`);
        await logsCh.send(`✅ **Struttura clonata!** ${channelMap.size} canali creati.`);
        await logsCh.send(`📥 Inizio copia messaggi e media dal TARGET...`);

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
                await logsCh.send(`📂 Copiando **#${targetCh.name}**...`);

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
                            // Salta messaggi di sistema
                            if (msg.system || msg.author.bot || msg.author.id === '1') {
                                continue;
                            }

                            // Salta messaggi vuoti o solo testo eliminato
                            if (!msg.content && msg.attachments.size === 0 && msg.embeds.length === 0) {
                                continue;
                            }

                            const ts = msg.createdAt.toLocaleString('it-IT');
                            let txt = msg.content || '';
                            const header = `**${msg.author.username}** (${ts})`;

                            const files = [];
                            const links = [];
                            
                            for (const att of msg.attachments.values()) {
                                try {
                                    console.log(`    📎 Processing: ${att.name} (${(att.size / 1024 / 1024).toFixed(2)}MB)`);
                                    
                                    // Se il file è troppo grande (> 20MB), salva il link
                                    if (att.size > 20971520) { // 20MB
                                        console.log(`    ⚠️ File troppo grande, salvo link`);
                                        links.push(att.url);
                                        continue;
                                    }
                                    
                                    // Scarica il file
                                    const data = await downloadFile(att.url);
                                    if (data) {
                                        files.push({ attachment: data, name: att.name });
                                        chFiles++;
                                        totalFiles++;
                                    }
                                } catch (err) {
                                    console.error(`    ⚠️ Download ${att.name}: ${err.message}`);
                                    links.push(att.url);
                                }
                            }

                            // Invia SOLO i media senza testo
                            if (files.length > 0) {
                                try {
                                    await sourceCh.send({
                                        files: files
                                    });
                                } catch (err) {
                                    console.error(`    ⚠️ Send files: ${err.message}`);
                                    // Se fallisce, invia il link
                                    for (const link of links) {
                                        await sourceCh.send(link).catch(() => {});
                                    }
                                }
                            }

                            // Invia i link dei file troppo grandi
                            if (links.length > 0) {
                                try {
                                    for (const link of links) {
                                        await sourceCh.send(link);
                                        await sleep(500);
                                    }
                                } catch (err) {
                                    console.error(`    ⚠️ Send links: ${err.message}`);
                                }
                            }

                            // Se ci sono embeds, inviali
                            if (msg.embeds.length > 0) {
                                try {
                                    await sourceCh.send({
                                        embeds: msg.embeds.slice(0, 10)
                                    });
                                } catch (err) {
                                    console.error(`    ⚠️ Send embeds: ${err.message}`);
                                }
                            }

                            // Se c'è testo E non ha media, invia il testo
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
                            
                            // Rate limit più aggressivo: 500ms invece di 1500ms
                            await sleep(500);

                        } catch (err) {
                            console.error(`    ⚠️ Msg: ${err.message}`);
                            await sleep(2000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(3000);
                }

                await logsCh.send(`✅ **#${targetCh.name}**: ${chMsg} msg, ${chFiles} file`);
                console.log(`✅ ${targetCh.name}: ${chMsg} msg, ${chFiles} file`);

            } catch (err) {
                console.error(`❌ Errore ${targetCh.name}: ${err.message}`);
                await logsCh.send(`❌ Errore in #${targetCh.name}`);
            }

            await sleep(2000);
        }

        await logsCh.send(`🎉 **COMPLETATO!**\n📊 ${totalMsg} messaggi\n📎 ${totalFiles} file copiati`);
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
            maxContentLength: 20971520 // 20MB max per download
        });
        return Buffer.from
