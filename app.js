const TelegramBot = require('node-telegram-bot-api');
const request = require('request');
const progress = require('request-progress');
const fs = require('fs');
const rp = require('request-promise');
const Promise = require("bluebird");

const format = require('string-format')
format.extend(String.prototype, {})

if (!process.env.DOCKER) {
    const envConfig = require('dotenv').parse(fs.readFileSync('.env'))
    for (let k in envConfig) process.env[k] = envConfig[k]
}
const lang = process.env.LANG;
const token = process.env.TOKEN;
const logChannelId = process.env.LOG_CHANNEL_ID;
const cloudMusicApi = {host: process.env.API_HOST, api: process.env.API};
const defaultBitrate = process.env.DEFAULT_BITRATE;
const cacheOn = process.env.CACHE == 'true';
const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;

const words = JSON.parse(fs.readFileSync('./langs/' + lang + '.json'));
const bot = new TelegramBot(token, {polling: true, onlyFirstMatch: true});

const botLog = msg => bot.sendMessage(logChannelId, msg, {parse_mode: 'Markdown'});
const parseArtistMD = artists => artists.reduce((prevText, artist) => '{}[{}]({}) / '.format(prevText, artist.name, 'https://music.163.com/#/artist?id=' + artist.id), '').slice(0,-3);
const parseArtists = artists => artists.reduce((prevText, artist) => '{}{} / '.format(prevText, artist.name), '').slice(0,-3);
const getNameMD = msg => '[{}](tg://user?id={})'.format(msg.chat.first_name + (msg.chat.last_name ? (' ' + msg.chat.last_name) : ''), msg.chat.id);
const getRedisKey = (songId, bitrate) => songId + '.' + bitrate;

if (cacheOn){
    var rediz = require('redis');
    Promise.promisifyAll(rediz);
    var redis = rediz.createClient({ "host": process.env.REDIS_HOST, "port": process.env.REDIS_PORT});
    redis.on('error', err => { botLog(words.processErrorLog.format('Redis', err.toString()))});
}

bot.onText(/\/start/, (msg, _) => {
    let chatId = msg.chat.id;
    let name = getNameMD(msg);
    let logText = words.logStart.format(name);

    botLog(logText)
    bot.sendMessage(chatId, words.start, {parse_mode: 'Markdown'});
});

bot.onText(/\/help/, (msg, _) => {
    let chatId = msg.chat.id;
    let name = getNameMD(msg);
    let logText = words.logHelp.format(name);

    botLog(logText)
    bot.sendMessage(chatId, words.help, {parse_mode: 'Markdown'});
});

bot.onText(/(?:^(\d+)|song\/(\d+)\/|song\?id=(\d+))(?:.*?\.)?(?:(\d+))?/, (msg, match) => {
    let chatId = msg.chat.id;
    let name = getNameMD(msg);

    let songId = match[1] || match[2] || match[3];
    let bitrate = (match[4] || defaultBitrate) + '000';

    const options = {
        uri: '{}{}/{}/{}'.format(cloudMusicApi.host, cloudMusicApi.api, songId, bitrate),
        json: true
    };
    
    rp(options)
        .then(async song => {
            let songParsedUrl = "{}/{}/{}/{}".format(cloudMusicApi.host, songId, bitrate, song.sign);
            let songTitle = song.song.name;
            let songArtists = parseArtists(song.song.artist);
            let songOriginalUrl = "https://music.163.com/#/song?id=" + songId;
            let songText = words.songText.format(songTitle, songOriginalUrl, parseArtistMD(song.song.artist), songParsedUrl);
            let logText = words.logSearch.format(name, bitrate.slice(0,-3), songArtists, songTitle, songOriginalUrl);
            botLog(logText);

            let audioIsCached = await (cacheOn ? redis.existsAsync(getRedisKey(songId, bitrate)) : false)

            audioIsCached 
                ? bot.sendAudio(
                    chatId, 
                    await (redis.getAsync(getRedisKey(songId, bitrate))),
                    {caption: songText, parse_mode: 'Markdown', title: songTitle, performer: songArtists, reply_to_message_id: msg.message_id},
                    {contentType: 'audio/mpeg'})
                : bot.sendMessage(chatId, words.downloadInit, {reply_to_message_id: msg.message_id})
                    .then(sentMsg => {
                        bot.sendAudio(
                            chatId,
                            progress(request(songParsedUrl), {})
                                .on('progress', state => {
                                    bot.editMessageText(words.downloading.format(
                                        Math.floor(state.percent * 100) + '%', 
                                        Math.floor(state.speed / 1000) + 'Kb/s',
                                        Math.floor(state.size.transferred / 1000).toString(),
                                        Math.floor(state.size.total / 1000).toString(),
                                        words.secs.format(Math.floor(state.time.remaining))), {chat_id: sentMsg.chat.id, message_id: sentMsg.message_id})
                                })
                                .on('end', () => bot.editMessageText(words.uploading, {chat_id: sentMsg.chat.id, message_id: sentMsg.message_id})),
                            {caption: songText, parse_mode: 'Markdown', title: songTitle, performer: songArtists, reply_to_message_id: msg.message_id}, 
                            {contentType: 'audio/mpeg'})
                            .then(async sentMusic => {
                                bot.deleteMessage(sentMsg.chat.id, sentMsg.message_id);
                                if (cacheOn) await redis.setAsync(getRedisKey(songId, bitrate), sentMusic.audio.file_id);
                            })
                    })
        })
        .catch(err => {
            botLog(words.errorLog.format(name, err.toString()));
            bot.sendMessage(chatId, words.error.format(adminTelegramId), {reply_to_message_id: msg.message_id, parse_mode: 'Markdown'});
        });
});

bot.onText(/[^]*/, (msg, text) => {
    let chatId = msg.chat.id;
    let name = getNameMD(msg);

    let logText = words.logUnexpectedInput.format(name, text)

    botLog(logText);
    bot.sendMessage(chatId, words.unexpectedInput, {parse_mode: 'Markdown'});
})
