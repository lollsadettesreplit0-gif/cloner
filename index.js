const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// Server HTTP per Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord merger is running!');
}).listen(PORT);

// ========== CONFIGURAZIONE ==========
const TOKEN = process.env.DISCORD_TOKEN;
const SOURCE_ID = '1425102156125442140'; // Server con creators già presenti
const TARGET_ID = '1462477828971954493'; // Server nuovo da cui prendere quelli mancanti

const client = new Client({ checkUpdate: false });

client.on('ready', async () => {
    console.log(`✅ Selfbot attivo: ${client.user.tag}`);
    console.log(`📊 SOURCE (con creators): ${SOURCE_ID}`);
    console.log(`📊 TARGET (da cui prendere): ${TARGET_ID}`);
    console.log('⏳ Merge intelligente tra 5 secondi...');
    await sleep(5000);
    await mergeServers();
});

async function mergeServers() {
    console.log('🎯 INIZIO MERGE INTELLIGENTE!');
    
    const source = client.guilds.cache.get(SOURCE_ID);
    const target = client.guilds.cache.get(TARGET_ID);

    if (!source || !target) {
        console.error('❌ Server non trovati!');
        return;
    }

    console.log(`🔄 Merge: ${target.name} → ${source.name}`);

    try {
        // STEP 0: Aggiungi il simbolo '・' ai canali del SOURCE che non ce l'hanno
        console.log('\n✨ Aggiungendo simbolo "・" ai canali SOURCE che ne mancano...');
        
        const sourceTextChannels = source.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0);
        
        for (const ch of sourceTextChannels.values()) {
            if (!ch.name.startsWith('・')) {
                try {
                    const newName = `・${ch.name}`;
                    console.log(`✏️ Rinominando #${ch.name} → #${newName}...`);
                    await ch.setName(newName).catch(err => {
                        console.error(`⚠️ Errore: ${err.message}`);
                    });
                    await sleep(200);
                } catch (err) {
                    console.error(`❌ Errore rinomina: ${err.message}`);
                }
            }
        }
        
        console.log('✅ Simboli aggiunti al SOURCE');

        // STEP 1: Analizza creators in entrambi i server
        console.log('\n📊 ANALIZZANDO CREATORS...');
        
        const sourceChannels = source.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0)
            .map(ch => ch.name.toLowerCase());
        
        const targetChannels = target.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0)
            .map(ch => ({ name: ch.name.toLowerCase(), original: ch }));

        console.log(`📝 SOURCE: ${sourceChannels.length} creators`);
        console.log(`📝 TARGET: ${targetChannels.length} creators`);

        // STEP 2: Trova quali creators mancano nel SOURCE
        console.log('\n🔍 CERCANDO CREATORS MANCANTI...');
        const missingCreators = [];
        const existingCreators = [];

        for (const targetCh of targetChannels) {
            const exists = sourceChannels.includes(targetCh.name);
            
            if (exists) {
                existingCreators.push(targetCh.name);
                console.log(`✅ ESISTE: #${targetCh.name}`);
            } else {
                missingCreators.push(targetCh);
                console.log(`❌ MANCANTE: #${targetCh.name}`);
            }
        }

        console.log(`\n📊 RIEPILOGO ANALISI:`);
        console.log(`   Creators già nel SOURCE: ${existingCreators.length}`);
        console.log(`   Creators da copiare: ${missingCreators.length}`);

        // STEP 3: Controlla categorie nel SOURCE
        console.log(`\n📁 Categorie nel SOURCE:`);
        
        const existingCategories = source.channels.cache
            .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
            .sort((a, b) => a.position - b.position);
        
        existingCategories.forEach((cat, idx) => {
            console.log(`   ${idx + 1}. ${cat.name}`);
        });
        
        const categories = Array.from(existingCategories.values());
        
        if (categories.length === 0) {
            console.error('❌ Nessuna categoria nel SOURCE!');
            return;
        }

        // STEP 4: Copia SOLO i creators mancanti
        console.log(`\n📥 INIZIO COPIA CREATORS MANCANTI...`);
        
        let creatorIndex = 0;
        let totalMsg = 0;
        let totalFiles = 0;

        for (const creator of missingCreators) {
            const categoryIndex = creatorIndex % categories.length;
            const category = categories[categoryIndex];
            
            if (!category) {
                console.error(`❌ Categoria non trovata per #${creator.name}`);
                continue;
            }

            try {
                // Anticlone: Verifica che il canale non esista già
                const alreadyExists = source.channels.cache.find(ch => 
                    ch.name.toLowerCase() === creator.name.toLowerCase() && 
                    (ch.type === 'GUILD_TEXT' || ch.type === 0)
                );
                
                if (alreadyExists) {
                    console.log(`⏭️ SALTATO: #${creator.name} (esiste già nel SOURCE)`);
                    creatorIndex++;
                    continue;
                }

                console.log(`📝 Creando #${creator.name} in ${category.name}...`);
                
                const newCh = await source.channels.create(creator.name, {
                    type: 0,
                    parent: category.id,
                    topic: creator.original?.topic || '',
                    nsfw: true
                }).catch(err => {
                    if (err.message.includes('50035')) { // Channel name already taken
                        console.log(`⏭️ SALTATO: #${creator.name} (nome già in uso)`);
                        return null;
                    }
                    throw err;
                });

                if (!newCh) {
                    creatorIndex++;
                    continue;
                }

                console.log(`✅ Creato #${creator.name}`);

                // Se è un creator nuovo, copia i suoi messaggi dal TARGET
                if (creator.original) {
                    console.log(`📂 Copiando messaggi da #${creator.name}...`);
                    
                    let lastId;
                    let chMsg = 0;

                    while (true) {
                        const opts = { limit: 50 };
                        if (lastId) opts.before = lastId;

                        const msgs = await creator.original.messages.fetch(opts).catch(() => null);
                        
                        if (!msgs || msgs.size === 0) break;

                        const msgsArray = Array.from(msgs.values()).reverse();

                        for (const msg of msgsArray) {
                            try {
                                if (msg.system || msg.author.bot) continue;
                                if (!msg.content && msg.attachments.size === 0 && msg.embeds.length === 0) continue;

                                const files = [];
                                
                                for (const att of msg.attachments.values()) {
                                    try {
                                        console.log(`    📎 Processing: ${att.name}`);
                                        
                                        if (att.size > 20971520) continue;
                                        
                                        const data = await downloadFile(att.url);
                                        if (data) {
                                            const ext = att.name.split('.').pop();
                                            files.push({ attachment: data, name: `GRINDR.${ext}` });
                                            totalFiles++;
                                        }
                                    } catch (err) {
                                        console.error(`⚠️ Download error: ${err.message}`);
                                    }
                                }

                                let txt = msg.content || '';
                                
                                if (files.length > 0) {
                                    await newCh.send({ files: files }).catch(() => {});
                                }

                                if (msg.embeds.length > 0) {
                                    await newCh.send({ embeds: msg.embeds.slice(0, 10) }).catch(() => {});
                                }

                                if (txt && files.length === 0 && msg.embeds.length === 0) {
                                    await newCh.send({ content: txt.slice(0, 2000) }).catch(() => {});
                                }

                                chMsg++;
                                totalMsg++;
                                await sleep(300);

                            } catch (err) {
                                console.error(`⚠️ Msg error: ${err.message}`);
                            }
                        }

                        lastId = msgs.last().id;
                        await sleep(2000);
                    }

                    if (chMsg > 0) {
                        console.log(`✅ #${creator.name}: ${chMsg} messaggi copiati`);
                    }
                }

                creatorIndex++;
                await sleep(300);

            } catch (err) {
                console.error(`❌ Errore #${creator.name}: ${err.message}`);
            }
        }

        console.log(`\n🎉 MERGE COMPLETATO!`);
        console.log(`📊 Creators ordinati in 3 categorie`);
        console.log(`📊 Creators copiati: ${missingCreators.length}`);
        console.log(`📊 Messaggi totali: ${totalMsg}`);
        console.log(`📊 File copiati: ${totalFiles}`);

        // STEP 6: Aggiungi il simbolo '・' a ogni canale del SOURCE
        console.log(`\n✨ Aggiungendo simbolo '・' a tutti i canali...`);
        
        const allSourceChannels = source.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0);
        
        for (const ch of allSourceChannels.values()) {
            try {
                // Controlla se ha già il simbolo
                if (!ch.name.startsWith('・')) {
                    const newName = `・${ch.name}`;
                    console.log(`✏️ Rinominando #${ch.name} → #${newName}...`);
                    
                    await ch.setName(newName).catch(err => {
                        console.error(`⚠️ Errore rinomina ${ch.name}: ${err.message}`);
                    });
                    
                    await sleep(300);
                } else {
                    console.log(`✅ #${ch.name} ha già il simbolo`);
                }
            } catch (err) {
                console.error(`❌ Errore ${ch.name}: ${err.message}`);
            }
        }

        console.log(`\n✅ SIMBOLO AGGIUNTO A TUTTI I CANALI!`);

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
