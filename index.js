const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

// Server HTTP per Render
const PORT = process.env.PORT || 3000;
http.createState((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot running!');
}).listen(PORT, () => {
    console.log(`🌐 Server HTTP listening on port ${PORT}`);
});

const TOKENS = [
    process.env.DISCORD_TOKEN,
    process.env.DISCORD_TOKEN_BACKUP,
    process.env.DISCORD_TOKEN_BACKUP2
].filter(t => t);

const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID;
const SOURCE_GUILD_ID = process.env.SOURCE_GUILD_ID;
const STATE_FILE = 'clone_state.json';

const EXCLUDED_CHANNELS = [
    '1299125689659686952',
    '1299822514670801008',
    '1299126325776224357',
    '1319797024773898330',
    '1417217261743247440'
];

let client = null;
let currentTokenIndex = 0;
let state = {
    phase: 'START',
    channelMap: {},
    processedChannels: [],
    stats: {
        messages: 0,
        files: 0,
        errors: 0
    }
};

console.log(`🔐 Tokens: ${TOKENS.length}`);

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            console.log(`📂 State loaded: Phase ${state.phase}`);
            return true;
        } catch (err) {
            console.error('⚠️ Error loading state');
            return false;
        }
    }
    return false;
}

function saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function switchToken() {
    currentTokenIndex++;
    if (currentTokenIndex >= TOKENS.length) {
        console.error('❌ All tokens exhausted');
        process.exit(1);
    }
    console.log(`🔄 Switching to token ${currentTokenIndex + 1}/${TOKENS.length}`);
    if (client) await client.destroy();
    await sleep(3000);
    createAndLogin();
}

function createAndLogin() {
    client = new Client({ checkUpdate: false });
    
    client.on('ready', async () => {
        console.log(`✅ Bot ready: ${client.user.tag} (Token ${currentTokenIndex + 1})`);
        await runClone();
    });

    client.on('error', (err) => {
        if (err.message.includes('401')) {
            console.error('⚠️ Token invalid');
            saveState();
            switchToken();
        }
    });

    client.login(TOKENS[currentTokenIndex]).catch(err => {
        console.error(`❌ Login failed: ${err.message}`);
        saveState();
        switchToken();
    });
}

async function runClone() {
    const target = client.guilds.cache.get(TARGET_GUILD_ID);
    const source = client.guilds.cache.get(SOURCE_GUILD_ID);

    if (!target || !source) {
        console.error('❌ Servers not found');
        return;
    }

    try {
        // PHASE 1: DELETE
        if (state.phase === 'START') {
            console.log('🎯 PHASE 1: DELETE CHANNELS');
            const toDelete = Array.from(source.channels.cache.values());
            for (const ch of toDelete) {
                try {
                    await ch.delete();
                    console.log(`  ✓ Deleted: ${ch.name}`);
                    await sleep(300);
                } catch (err) {
                    console.error(`  ✗ Error: ${ch.name}`);
                }
            }
            state.phase = 'CREATE_STRUCTURE';
            saveState();
            await sleep(2000);
        }

        // PHASE 2: CREATE STRUCTURE
        if (state.phase === 'CREATE_STRUCTURE') {
            console.log('📁 PHASE 2: CREATE STRUCTURE');
            
            const cats = target.channels.cache
                .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
                .sort((a, b) => a.position - b.position);

            const catMap = new Map();

            for (const cat of cats.values()) {
                const newCat = await source.channels.create(cat.name, {
                    type: 4,
                    position: cat.position
                }).catch(() => null);
                if (newCat) catMap.set(cat.id, newCat.id);
                await sleep(300);
            }

            // Create text channels
            for (const [targetCatId, sourceCatId] of catMap.entries()) {
                const targetCat = target.channels.cache.get(targetCatId);
                const sourceCat = source.channels.cache.get(sourceCatId);

                const textChs = targetCat.children.cache
                    .filter(ch => (ch.type === 'GUILD_TEXT' || ch.type === 0));

                for (const ch of textChs.values()) {
                    if (EXCLUDED_CHANNELS.includes(ch.id) || EXCLUDED_CHANNELS.includes(ch.name)) {
                        continue;
                    }

                    const newCh = await source.channels.create(ch.name, {
                        type: 0,
                        parent: sourceCatId,
                        topic: ch.topic || '',
                        nsfw: true,
                        position: ch.position
                    }).catch(() => null);

                    if (newCh) {
                        state.channelMap[ch.id] = newCh.id;
                    }
                    await sleep(300);
                }

                // Create voice channels
                const voiceChs = targetCat.children.cache
                    .filter(ch => ch.type === 'GUILD_VOICE' || ch.type === 2);

                for (const ch of voiceChs.values()) {
                    await source.channels.create(ch.name, {
                        type: 2,
                        parent: sourceCatId,
                        position: ch.position
                    }).catch(() => null);
                    await sleep(300);
                }
            }

            console.log(`✅ Structure created: ${Object.keys(state.channelMap).length} channels`);
            state.phase = 'COPY_MESSAGES';
            saveState();
        }

        // PHASE 3: COPY MESSAGES
        if (state.phase === 'COPY_MESSAGES') {
            console.log('📥 PHASE 3: COPY MESSAGES');

            for (const [targetChId, sourceChId] of Object.entries(state.channelMap)) {
                if (state.processedChannels.includes(targetChId)) {
                    console.log(`⏭️ Already processed: ${targetChId}`);
                    continue;
                }

                const targetCh = target.channels.cache.get(targetChId);
                const sourceCh = source.channels.cache.get(sourceChId);

                if (!targetCh || !sourceCh) {
                    console.error(`✗ Channel not found: ${targetChId}`);
                    continue;
                }

                try {
                    console.log(`📂 Processing #${targetCh.name}...`);
                    let lastId = null;
                    let count = 0;

                    while (true) {
                        const opts = { limit: 50 };
                        if (lastId) opts.before = lastId;

                        const msgs = await targetCh.messages.fetch(opts).catch(() => null);
                        if (!msgs || msgs.size === 0) break;

                        const msgsArray = Array.from(msgs.values()).reverse();

                        for (const msg of msgsArray) {
                            try {
                                if (msg.system || msg.author.bot) continue;
                                if (!msg.content && msg.attachments.size === 0 && msg.embeds.length === 0) continue;

                                const files = [];
                                const links = [];

                                // Handle attachments
                                for (const att of msg.attachments.values()) {
                                    try {
                                        if (att.size > 20971520) {
                                            links.push(att.url);
                                            continue;
                                        }
                                        const data = await downloadFile(att.url);
                                        if (data) {
                                            const ext = att.name.split('.').pop();
                                            files.push({ attachment: data, name: `GRINDR.${ext}` });
                                            state.stats.files++;
                                        }
                                    } catch (err) {
                                        links.push(att.url);
                                    }
                                }

                                // Send files
                                if (files.length > 0) {
                                    try {
                                        await sourceCh.send({ files: files });
                                    } catch (err) {
                                        for (const link of links) {
                                            await sourceCh.send(link).catch(() => {});
                                            await sleep(300);
                                        }
                                    }
                                }

                                // Send links
                                if (links.length > 0) {
                                    for (const link of links) {
                                        await sourceCh.send(link).catch(() => {});
                                        await sleep(300);
                                    }
                                }

                                // Send embeds
                                if (msg.embeds.length > 0) {
                                    await sourceCh.send({ embeds: msg.embeds.slice(0, 10) }).catch(() => {});
                                }

                                // Send text
                                if (msg.content && files.length === 0 && links.length === 0) {
                                    await sourceCh.send({ content: msg.content.slice(0, 2000) }).catch(() => {});
                                }

                                count++;
                                state.stats.messages++;
                                await sleep(500);

                            } catch (err) {
                                state.stats.errors++;
                                await sleep(2000);
                            }
                        }

                        lastId = msgs.last().id;
                        await sleep(2000);
                    }

                    console.log(`✅ #${targetCh.name}: ${count} messages`);
                    state.processedChannels.push(targetChId);
                    saveState();

                } catch (err) {
                    console.error(`✗ Error processing #${targetCh.name}`);
                    state.stats.errors++;
                    saveState();
                }

                await sleep(1000);
            }

            state.phase = 'SHUFFLE';
            saveState();
        }

        // PHASE 4: SHUFFLE
        if (state.phase === 'SHUFFLE') {
            console.log('🔀 PHASE 4: SHUFFLE CHANNELS');

            const cats = source.channels.cache
                .filter(ch => ch.type === 'GUILD_CATEGORY' || ch.type === 4)
                .map(c => c);

            if (cats.length > 1) {
                const textChs = source.channels.cache
                    .filter(ch => (ch.type === 'GUILD_TEXT' || ch.type === 0) && ch.parentId)
                    .map(c => c);

                for (let i = 0; i < textChs.length; i++) {
                    const randomCh = textChs[Math.floor(Math.random() * textChs.length)];
                    const randomCat = cats[Math.floor(Math.random() * cats.length)];

                    try {
                        await randomCh.setParent(randomCat.id).catch(() => {});
                        console.log(`  🔀 Moved #${randomCh.name}`);
                        await sleep(200);
                    } catch (err) {
                        // ignore
                    }
                }
            }

            state.phase = 'DONE';
            saveState();
        }

        if (state.phase === 'DONE') {
            console.log('');
            console.log('═══════════════════════════════════════════');
            console.log('🎉 CLONE COMPLETE!');
            console.log('═══════════════════════════════════════════');
            console.log(`Messages: ${state.stats.messages}`);
            console.log(`Files: ${state.stats.files}`);
            console.log(`Errors: ${state.stats.errors}`);
            if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
        }

    } catch (err) {
        console.error('❌ Critical error:', err);
        state.stats.errors++;
        saveState();
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
        return null;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// START
loadState();
createAndLogin();
