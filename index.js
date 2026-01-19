const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const TOKENS = [
    process.env.DISCORD_TOKEN,
    process.env.DISCORD_TOKEN_BACKUP,
    process.env.DISCORD_TOKEN_BACKUP2
].filter(t => t);

const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID;
const SOURCE_GUILD_ID = process.env.SOURCE_GUILD_ID;
const CHECKPOINT_FILE = 'clone_progress.json';

const EXCLUDED_CHANNELS = [
    '1299125689659686952',
    '1299822514670801008',
    '1299126325776224357',
    '1319797024773898330',
    '1417217261743247440'
];

const client = new Client({ checkUpdate: false });
let channelMap = new Map();
let currentTokenIndex = 0;
let cloneState = {
    step: 'start',
    copiedChannels: [],
    totalMsg: 0,
    totalFiles: 0
};

console.log(`🔐 Tokens disponibili: ${TOKENS.length}`);
if (TOKENS.length === 0) {
    console.error('❌ ERRORE: Nessun token disponibile nel .env');
    process.exit(1);
}

function loadCheckpoint() {
    if (fs.existsSync(CHECKPOINT_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
            console.log(`📂 Progresso trovato: Step ${data.step}`);
            cloneState = data;
            if (data.channelMap) {
                channelMap = new Map(data.channelMap);
            }
            return true;
        } catch (err) {
            console.error('⚠️ Errore caricamento checkpoint:', err.message);
            return false;
        }
    }
    return false;
}

function saveCheckpoint() {
    const data = {
        ...cloneState,
        channelMap: Array.from(channelMap.entries()),
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}

client.on('ready', async () => {
    console.log(`✅ Selfbot attivo: ${client.user.tag}`);
    console.log(`📥 TARGET: ${TARGET_GUILD_ID}`);
    console.log(`📤 SOURCE: ${SOURCE_GUILD_ID}`);
    const hasCheckpoint = loadCheckpoint();
    if (hasCheckpoint && cloneState.step !== 'done') {
        console.log(`⏳ Checkpoint trovato! Riprendendo da step: ${cloneState.step}`);
    } else {
        console.log('⏳ Clonazione automatica tra 5 secondi...');
        await sleep(5000);
    }
    await startClone();
});

client.on('error', (err) => {
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        console.error('⚠️ TOKEN INVALIDATO! Tentando con backup...');
        saveCheckpoint();
        switchToken();
    }
});

async function switchToken() {
    currentTokenIndex++;
    if (currentTokenIndex >= TOKENS.length) {
        console.error('❌ TUTTI I TOKEN ESAURITI!');
        process.exit(1);
    }
    console.log(`🔄 Cambio a token ${currentTokenIndex + 1}/${TOKENS.length}`);
    try {
        await client.destroy();
        await sleep(2000);
        await client.login(TOKENS[currentTokenIndex]);
    } catch (err) {
        console.error(`❌ Errore cambio token: ${err.message}`);
        switchToken();
    }
}

async function startClone() {
    const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);
    const sourceGuild = client.guilds.cache.get(SOURCE_GUILD_ID);
    if (!targetGuild || !sourceGuild) {
        console.error('❌ Server non trovati!');
        return;
    }

    try {
        if (cloneState.step === 'start') {
            console.log('🎯 INIZIO CLONAZIONE!');
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
            cloneState.step = 'categories';
            saveCheckpoint();
        }

        if (cloneState.step === 'categories') {
            console.log('📁 INIZIO CLONAZIONE CATEGORIE...');
            const categories = targetGuild.channels.cache
                .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
                .sort((a, b) => a.position - b.position);
            console.log(`📁 Categorie trovate: ${categories.size}`);

            for (const category of categories.values()) {
                console.log(`📁 Creando categoria: ${category.name}`);
                const newCat = await sourceGuild.channels.create(category.name, {
                    type: 4,
                    position: category.position
                }).catch(err => {
                    console.error(`❌ Errore categoria ${category.name}: ${err.message}`);
                    return null;
                });
                if (!newCat) continue;
                await sleep(300);

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

                const voiceChannels = targetGuild.channels.cache
                    .filter(ch => ch.parentId === category.id && (ch.type === 'GUILD_VOICE' || ch.type === 2))
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
                    await sleep(300);
                }
            }

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
            cloneState.step = 'messages';
            saveCheckpoint();
        }

        if (cloneState.step === 'messages') {
            console.log('📥 INIZIO COPIA MESSAGGI');
            for (const [targetId, sourceId] of channelMap.entries()) {
                if (cloneState.copiedChannels.includes(targetId)) {
                    console.log(`⏭️ Canale già copiato: ${targetId}`);
                    continue;
                }
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
                                            const ext = att.name.split('.').pop();
                                            files.push({ attachment: data, name: `GRINDR.${ext}` });
                                            chFiles++;
                                            cloneState.totalFiles++;
                                        }
                                    } catch (err) {
                                        console.error(`    ⚠️ Download ${att.name}: ${err.message}`);
                                        links.push(att.url);
                                    }
                                }

                                if (files.length > 0) {
                                    try {
                                        await sourceCh.send({ files: files });
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
                                        await sourceCh.send({ embeds: msg.embeds.slice(0, 10) });
                                    } catch (err) {
                                        console.error(`    ⚠️ Send embeds: ${err.message}`);
                                    }
                                }

                                let txt = msg.content || '';
                                if (txt && files.length === 0 && links.length === 0 && msg.embeds.length === 0) {
                                    try {
                                        await sourceCh.send({ content: txt.slice(0, 2000) });
                                    } catch (err) {
                                        console.error(`    ⚠️ Send text: ${err.message}`);
                                    }
                                }

                                chMsg++;
                                cloneState.totalMsg++;
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
                    cloneState.copiedChannels.push(targetId);
                    saveCheckpoint();
                } catch (err) {
                    console.error(`❌ Errore ${targetCh.name}: ${err.message}`);
                    saveCheckpoint();
                }
                await sleep(1000);
            }

            console.log(`🎉 MESSAGGI COMPLETATI: ${cloneState.totalMsg} messaggi, ${cloneState.totalFiles} file`);
            cloneState.step = 'shuffle';
            saveCheckpoint();
        }

        if (cloneState.step === 'shuffle') {
            console.log('🔀 INIZIO MESCOLAMENTO CANALI...');
            const allCategories = sourceGuild.channels.cache
                .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
                .map(cat => cat);
            if (allCategories.length > 1) {
                const allTextChannels = sourceGuild.channels.cache
                    .filter(ch => (ch.type === 'GUILD_TEXT' || ch.type === 0) && ch.parentId)
                    .map(ch => ch);
                console.log(`📊 Canali text da mescolare: ${allTextChannels.length}`);
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
            } else {
                console.log('⏭️ Non ci sono abbastanza categorie per il mescolamento');
            }
            cloneState.step = 'done';
            saveCheckpoint();
        }

        if (cloneState.step === 'done') {
            console.log('');
            console.log('═══════════════════════════════════════════');
            console.log('🎉 CLONAZIONE COMPLETATA CON SUCCESSO!');
            console.log('═══════════════════════════════════════════');
            console.log(`Messaggi copiati: ${cloneState.totalMsg}`);
            console.log(`File copiati: ${cloneState.totalFiles}`);
            if (fs.existsSync(CHECKPOINT_FILE)) {
                fs.unlinkSync(CHECKPOINT_FILE);
            }
        }
    } catch (err) {
        console.error('❌ ERRORE GENERALE:', err);
        saveCheckpoint();
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

client.login(TOKENS[currentTokenIndex]).catch(err => {
    console.error(`❌ Login fallito con token 1: ${err.message}`);
    console.log('🔄 Tentando con token backup...');
    saveCheckpoint();
    switchToken();
});
