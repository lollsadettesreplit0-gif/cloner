const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Copy messages running!');
}).listen(PORT);

const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_ID = process.env.TARGET_GUILD_ID;
const SOURCE_ID = process.env.SOURCE_GUILD_ID;

const client = new Client({ checkUpdate: false });
let progress = {
    channels: {},
    stats: { messages: 0, files: 0 }
};

let alreadyRan = false;

function loadProgress() {
    if (fs.existsSync('copy_progress.json')) {
        try {
            progress = JSON.parse(fs.readFileSync('copy_progress.json', 'utf8'));
            console.log(`📂 Progress loaded: ${Object.keys(progress.channels).length} channels`);
            return true;
        } catch (err) {
            return false;
        }
    }
    return false;
}

function saveProgress() {
    fs.writeFileSync('copy_progress.json', JSON.stringify(progress, null, 2));
}

client.on('ready', async () => {
    if (alreadyRan) return;
    alreadyRan = true;

    console.log(`✅ Bot: ${client.user.tag}`);
    
    const target = client.guilds.cache.get(TARGET_ID);
    const source = client.guilds.cache.get(SOURCE_ID);

    if (!target || !source) {
        console.error('❌ Server not found');
        process.exit(1);
    }

    loadProgress();

    try {
        const sourceChannels = source.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0);

        console.log(`📥 COPYING MESSAGES - ${sourceChannels.size} channels`);

        for (const sourceCh of sourceChannels.values()) {
            const chId = sourceCh.id;

            if (!progress.channels[chId]) {
                progress.channels[chId] = { copied: false, lastMsgId: null, msgCount: 0 };
            }

            if (progress.channels[chId].copied) {
                console.log(`⏭️ #${sourceCh.name} - DONE`);
                continue;
            }

            try {
                console.log(`📂 #${sourceCh.name}...`);
                let lastId = progress.channels[chId].lastMsgId;
                let count = progress.channels[chId].msgCount;

                const targetCh = target.channels.cache.find(
                    ch => ch.name === sourceCh.name && (ch.type === 'GUILD_TEXT' || ch.type === 0)
                );

                if (!targetCh) continue;

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
                                        progress.stats.files++;
                                    }
                                } catch (err) {
                                    links.push(att.url);
                                }
                            }

                            if (files.length > 0) {
                                await sourceCh.send({ files: files }).catch(() => {});
                            }

                            if (links.length > 0) {
                                for (const link of links) {
                                    await sourceCh.send(link).catch(() => {});
                                    await sleep(300);
                                }
                            }

                            if (msg.embeds.length > 0) {
                                await sourceCh.send({ embeds: msg.embeds.slice(0, 10) }).catch(() => {});
                            }

                            if (msg.content && files.length === 0 && links.length === 0) {
                                await sourceCh.send({ content: msg.content.slice(0, 2000) }).catch(() => {});
                            }

                            count++;
                            progress.stats.messages++;
                            progress.channels[chId].lastMsgId = msg.id;
                            progress.channels[chId].msgCount = count;
                            saveProgress();

                            await sleep(500);

                        } catch (err) {
                            saveProgress();
                            await sleep(2000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(2000);
                }

                progress.channels[chId].copied = true;
                saveProgress();

            } catch (err) {
                console.error(`✗ #${sourceCh.name}`);
                saveProgress();
            }

            await sleep(1000);
        }

        console.log('✅ DONE!');
        console.log(`Messages: ${progress.stats.messages}, Files: ${progress.stats.files}`);
        process.exit(0);

    } catch (err) {
        console.error('❌ Error:', err);
        saveProgress();
        process.exit(1);
    }
});

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

client.login(TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
