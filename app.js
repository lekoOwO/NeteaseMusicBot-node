const bool = require('boolean').boolean;
const fs = require('fs');

if (!bool(process.env.DOCKER)) {
    const envConfig = require('dotenv').parse(fs.readFileSync('.env'))
    for (let k in envConfig) process.env[k] = envConfig[k]
}

const TelegramBot = require('node-telegram-bot-api');
const request = require('request');
const progress = require('request-progress');
const rp = require('request-promise');
const Promise = require("bluebird");
const InlineKeyboard = require("telegram-keyboard-wrapper");
const generateSafeId = require('generate-safe-id');
const express = process.env.WEBHOOK_HOST ? require('express') : undefined;
const bodyParser = process.env.WEBHOOK_HOST ? require('body-parser') : undefined;

const format = require('string-format')
format.extend(String.prototype, {})

const lang = fs.existsSync('./langs/' + (process.env.LANG || "zh-TW") + '.json') ? process.env.LANG || "zh-TW" : "zh-TW";
const token = process.env.TOKEN;
const logChannelId = process.env.LOG_CHANNEL_ID;
const cloudMusicApi = {host: process.env.API_HOST, api: process.env.API};
const defaultBitrate = process.env.DEFAULT_BITRATE || '320';
const cacheOn = bool(process.env.CACHE);
const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
const regex = /(?:^(\d+)|song\/(\d+)\/|song\?id=(\d+))(?:.*?\.)?(?:(\d+))?/;

const words = JSON.parse(fs.readFileSync('./langs/' + lang + '.json'));
const cert = {
    cert: fs.existsSync(process.env.CERT || '/certs/cert.crt') ? process.env.CERT || '/certs/cert.crt' : undefined,
    key: fs.existsSync(process.env.KEY || '/certs/key.key') ? process.env.KEY || '/certs/key.key' : undefined
}
const bot = new TelegramBot(token, {
    polling: true, 
    onlyFirstMatch: true, 
    webhook: process.env.WEBHOOK_HOST ? {
        port: parseInt(process.env.WEBHOOK_PORT) || 443,
        key: cert.key,
        cert: cert.cert,
        host: process.env.WEBHOOK_IP
    } : undefined
    });

const app = process.env.WEBHOOK_HOST ? express() : undefined;

const botLog = msg => bot.sendMessage(logChannelId, msg, {parse_mode: 'Markdown', disable_web_page_preview: true});
const parseArtistMD = artists => artists.reduce((prevText, artist) => '{}[{}]({}) / '.format(prevText, artist.name, 'https://music.163.com/#/artist?id=' + artist.id), '').slice(0,-3);
const parseArtists = artists => artists.reduce((prevText, artist) => '{}{} / '.format(prevText, artist.name), '').slice(0,-3);
const getNameMD = user => '[{}](tg://user?id={})'.format(user.first_name + (user.last_name ? (' ' + user.last_name) : ''), user.id);
const getRedisKey = (songId, bitrate) => songId + '.' + bitrate;

if (cacheOn){
    var rediz = require('redis');
    Promise.promisifyAll(rediz);
    var redis = rediz.createClient({ "host": process.env.REDIS_HOST, "port": process.env.REDIS_PORT, "password": process.env.REDIS_PASSWORD});
    redis.on('error', err => {
        console.log(err);
        botLog(words.processErrorLog.format('Redis', err.toString()));
    });
}

if (process.env.WEBHOOK_HOST) {
    app.use(bodyParser.json());
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
    app.listen(parseInt(process.env.WEBHOOK_PORT) || 443, () => {
        botLog('Express server is listening on {}'.format(parseInt(process.env.WEBHOOK_PORT) || 443));
        bot.setWebHook(`${process.env.WEBHOOK_HOST}/bot${token}`, cert.cert ? {
            certificate: cert.cert
            } : undefined)
    });
}

function getMusicInfo(songId, bitrate, name, cb){
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
            let albumUrl = "https://music.163.com/#/album?id=" + song.song.album.id;
            let playerUrl = `${cloudMusicApi.host}/?music_id=${songId}&bitrate=${bitrate.slice(0,3)}`
            let songText = words.songText.format(songTitle, songOriginalUrl, parseArtistMD(song.song.artist), song.song.album.name, albumUrl, songParsedUrl, playerUrl);
            let logText = words.logSearch.format(name, bitrate.slice(0,-3), songArtists, songTitle, songOriginalUrl);            

            cb(null, {
                songParsedUrl: songParsedUrl,
                songTitle: songTitle,
                songArtists: songArtists,
                songOriginalUrl: songOriginalUrl,
                songText: songText,
                logText: logText,
                albumUrl: albumUrl,
                album: song.song.album.name,
                albumPicUrl: song.song.album.picUrl,
                audioIsCached: await (cacheOn ? redis.existsAsync(getRedisKey(songId, bitrate)) : false) ? await (redis.getAsync(getRedisKey(songId, bitrate))) : false
            });
        })
        .catch(err => {
            console.log(err);
            cb(err, null);
        })
}

function response(msg, songId, bitrate = defaultBitrate) {
    let chatId = msg.chat.id;
    let name = getNameMD(msg.chat);
    bitrate += '000';

    let messageId = msg.message_id;

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
            let albumUrl = "https://music.163.com/#/album?id=" + song.song.album.id;
            let playerUrl = `${cloudMusicApi.host}/?music_id=${songId}&bitrate=${bitrate.slice(0,3)}`
            let songText = words.songText.format(songTitle, songOriginalUrl, parseArtistMD(song.song.artist), song.song.album.name, albumUrl, songParsedUrl, playerUrl);
            let logText = words.logSearch.format(name, bitrate.slice(0,-3), songArtists, songTitle, songOriginalUrl);
            botLog(logText);

            let audioIsCached = await (cacheOn ? redis.existsAsync(getRedisKey(songId, bitrate)) : false)

            audioIsCached 
                ? bot.sendAudio(
                    chatId, 
                    await (redis.getAsync(getRedisKey(songId, bitrate))),
                    {caption: songText, parse_mode: 'Markdown', title: songTitle, performer: songArtists, reply_to_message_id: messageId},
                    {contentType: 'audio/mpeg'})
                : bot.sendMessage(chatId, words.downloadInit, {reply_to_message_id: messageId})
                    .then(sentMsg => {
                        bot.sendAudio(
                            chatId,
                            progress(request({
								url: songParsedUrl,
								headers: {
									'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36'
								}
							}), {})
                                .on('progress', state => {
                                    bot.editMessageText(words.downloading.format(
                                        Math.floor(state.percent * 100) + '%', 
                                        Math.floor(state.speed / 1000) + 'Kb/s',
                                        Math.floor(state.size.transferred / 1000).toString(),
                                        Math.floor(state.size.total / 1000).toString(),
                                        words.secs.format(Math.floor(state.time.remaining))), {chat_id: sentMsg.chat.id, message_id: sentMsg.message_id})
                                })
                                .on('end', () => bot.editMessageText(words.uploading, {chat_id: sentMsg.chat.id, message_id: sentMsg.message_id})),
                            {caption: songText, parse_mode: 'Markdown', title: songTitle, performer: songArtists, reply_to_message_id: messageId}, 
                            {contentType: 'audio/mpeg'})
                            .then(async sentMusic => {
                                bot.deleteMessage(sentMsg.chat.id, sentMsg.message_id);
                                if (cacheOn) await redis.setAsync(getRedisKey(songId, bitrate), sentMusic.audio.file_id);
                            })
                    })
        })
        .catch(err => {
            console.log(err);
            botLog(words.errorLog.format(name, err.toString()));
            bot.sendMessage(chatId, words.errorAccurred.format(adminTelegramId), {reply_to_message_id: messageId, parse_mode: 'Markdown'});
        });
}

bot.onText(/^\/start$/, (msg, _) => {
    let chatId = msg.chat.id;
    let name = getNameMD(msg.chat);
    let logText = words.logStart.format(name);

    botLog(logText)
    bot.sendMessage(chatId, words.start, {parse_mode: 'Markdown'});
});

bot.onText(/\/help/, (msg, _) => {
    let chatId = msg.chat.id;
    let name = getNameMD(msg.chat);
    let logText = words.logHelp.format(name);

    botLog(logText)
    bot.sendMessage(chatId, words.help, {parse_mode: 'Markdown'});
});

bot.onText(regex, (msg, match) => {
    let songId = match[1] || match[2] || match[3];
    let bitrate = match[4] || defaultBitrate;
    
    response(msg, songId, bitrate)
});

bot.onText(/[^]*/, (msg, text) => {
    let messageEntity = msg.entities || msg.caption_entities;
    var isResponsed = false;

    if (messageEntity) {
        for (i of messageEntity){
            if (i.url){
                if(i.url.includes('music.163.com') != ''){
                    let match = i.url.match(regex);
                    let songId = match[1] || match[2] || match[3];
                    let bitrate = match[4] || defaultBitrate;

                    response(msg, songId, bitrate)
                    isResponsed = true;
                }
            }
        }
    }

    if(!isResponsed) {
        let chatId = msg.chat.id;
        let name = getNameMD(msg.chat);
        let logText = words.logUnexpectedInput.format(name, text)
        botLog(logText);
        bot.sendMessage(chatId, words.unexpectedInput, {parse_mode: 'Markdown'});
    }
})

bot.on("inline_query", query => {
    if (query.query.slice(-1) != ".") return

    let name = getNameMD(query.from);

    let match = query.query.slice(0, -1).match(regex)
    let songId = match[1] || match[2] || match[3];
    let bitrate = (match[4] || defaultBitrate) + '000';

    getMusicInfo(songId, bitrate, name, (err, info) => {
        if (err) {
            console.log(err);
            botLog(words.errorLogInline.format(name, err.toString()));
            bot.answerInlineQuery(query.id, [{
                type: "article",
                id: generateSafeId(),
                title: words.error,
                input_message_content: {
                    message_text: words.errorAccurred.format(adminTelegramId),
                    parse_mode: "Markdown"
                }
            }])
            return
        }

        info.audioIsCached
            ? bot.answerInlineQuery(query.id, [{
                type: "audio",
                id: generateSafeId(),
                audio_file_id: info.audioIsCached,
                caption: info.songText,
                parse_mode: "Markdown"
            }])
            : bot.answerInlineQuery(query.id, [{
                type: "article",
                id: generateSafeId(),
                title: info.songTitle,
                input_message_content: {
                    message_text: info.songText,
                    parse_mode: "Markdown",
                    disable_web_page_preview: true
                },
                thumb_url: info.albumPicUrl
            }])
    })
})

bot.on('polling_error', (error) => {
    botLog(error.toString());  // => 'EFATAL'
  });

bot.on('webhook_error', (error) => {
    botLog(error.toString());  // => 'EPARSE'
});

botLog(words.HelloWorld);



