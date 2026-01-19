const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Clone channels running!');
}).listen(PORT);

const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_ID = process.env.TARGET_GUILD_ID;
const SOURCE_ID = process.env.SOURCE_GUILD_ID;

const EXCLUDED = [
    '1299125689659686952',
    '1299822514670801008',
    '1299126325776224357',
    '1319797024773898330',
    '1417217261743247440'
];

const client = new Client({ checkUpdate: false });

client.on('ready', async () => {
    console.log(`✅ Bot: ${client.user.tag}`);
    
    const target = client.guilds.cache.get(TARGET_ID);
    const source = client.guilds.cache.get(SOURCE_ID);

    if (!target || !source) {
        console.error('❌ Server not found');
        process.exit(1);
    }

    try {
        console.log('🗑️ Deleting old channels...');
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

        await sleep(2000);
        console.log('✅ Channels deleted');

        // Create categories
        console.log('📁 Creating categories...');
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
        console.log('📝 Creating text channels...');
        const channelMap = {};
        
        for (const [targetCatId, sourceCatId] of catMap.entries()) {
            const targetCat = target.channels.cache.get(targetCatId);
            const textChs = targetCat.children.cache
                .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 0)
                .sort((a, b) => a.position - b.position);

            for (const ch of textChs.values()) {
                if (EXCLUDED.includes(ch.id) || EXCLUDED.includes(ch.name)) continue;

                const newCh = await source.channels.create(ch.name, {
                    type: 0,
                    parent: sourceCatId,
                    topic: ch.topic || '',
                    nsfw: true,
                    position: ch.position
                }).catch(() => null);

                if (newCh) {
                    channelMap[ch.id] = newCh.id;
                    console.log(`  ✓ Created: ${ch.name}`);
                }
                await sleep(300);
            }

            // Create voice channels
            const voiceChs = targetCat.children.cache
                .filter(ch => ch.type === 'GUILD_VOICE' || ch.type === 2)
                .sort((a, b) => a.position - b.position);

            for (const ch of voiceChs.values()) {
                await source.channels.create(ch.name, {
                    type: 2,
                    parent: sourceCatId,
                    position: ch.position
                }).catch(() => null);
                console.log(`  ✓ Voice: ${ch.name}`);
                await sleep(300);
            }
        }

        // Save channel map
        fs.writeFileSync('channel_map.json', JSON.stringify(channelMap, null, 2));
        console.log('✅ Channel map saved!');

        console.log('');
        console.log('═══════════════════════════════════════');
        console.log('✅ CHANNELS CLONED SUCCESSFULLY!');
        console.log('═══════════════════════════════════════');
        console.log('Run messages copy script next!');
        console.log('═══════════════════════════════════════');

        process.exit(0);

    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
