const TelegramBot = require('node-telegram-bot-api');
const request = require('request');
const progress = require('request-progress');
const fs = require('fs');
const rp = require('request-promise');

const format = require('string-format')
format.extend(String.prototype, {})

const lang = process.env.LANG;
const token = process.env.TOKEN;
const logChannelId = process.env.LOG_CHANNEL_ID;
const cloudMusicApi = {host: process.env.API_HOST, api: process.env.API};
const defaultBitrate = process.env.DEFAULT_BITRATE;

const words = JSON.parse(fs.readFileSync('./langs/' + lang + '.json'));
const bot = new TelegramBot(token, {polling: true});

const botLog = msg => bot.sendMessage(logChannelId, msg);
const parseArtistMD = artists => artists.reduce((prevText, artist) => '{}[{}]({}) / '.format(prevText, artist.name, 'https://music.163.com/#/artist?id=' + artist.id), '').slice(0,-3);
const parseArtists = artists => artists.reduce((prevText, artist) => '{}{} / '.format(prevText, artist.name), '').slice(0,-3);

bot.onText(/\/start/, (msg, _) => {
    let chatId = msg.chat.id;
    let name = msg.chat.first_name + (msg.chat.last_name ? (' ' + msg.chat.last_name) : '') + ' (' +  (msg.chat.username || msg.chat.id) + ')';
    let logText = words.logStart.format(name);

    botLog(logText)
    bot.sendMessage(chatId, words.start);
});

bot.onText(/\/help/, (msg, _) => {
    let chatId = msg.chat.id;
    let name = msg.chat.first_name + (msg.chat.last_name ? (' ' + msg.chat.last_name) : '') + ' (' +  (msg.chat.username || msg.chat.id) + ')';
    let logText = words.logHelp.format(name);

    botLog(logText)
    bot.sendMessage(chatId, words.help);
});

bot.onText(/(?:^(\d+)|song\/(\d+)\/|song\?id=(\d+))(?:.*?\.)?(?:(\d+))?/, (msg, match) => {
    let chatId = msg.chat.id;
    let name = msg.chat.first_name + (msg.chat.last_name ? (' ' + msg.chat.last_name) : '') + ' (' +  (msg.chat.username || msg.chat.id) + ')';

    let songId = match[1] || match[2] || match[3];
    let bitrate = (match[4] || defaultBitrate) + '000';

    const options = {
        uri: '{}{}/{}/{}'.format(cloudMusicApi.host, cloudMusicApi.api, songId, bitrate),
        json: true
    };
    
    rp(options)
        .then(song => {
            let songUrl = "{}/{}/{}/{}".format(cloudMusicApi.host, songId, bitrate, song.sign);
            let songTitle = song.song.name;
            let songArtists = parseArtists(song.song.artist);
            let songText = words.songText.format(
                songTitle, 
                "https://music.163.com/#/song?id=" + songId, 
                parseArtistMD(song.song.artist),
                songUrl);

            let logText = words.logSearch.format(name, bitrate.slice(0,-3), songArtists, songTitle);
            botLog(logText)
            
            bot.sendMessage(chatId, words.downloadInit, {reply_to_message_id: msg.message_id})
                .then(sentMsg => {
                    bot.sendAudio(
                        chatId,
                        progress(request(songUrl), {})
                            .on('progress', state => {
                                bot.editMessageText(words.downloading.format(
                                    Math.floor(state.percent * 100) + '%', 
                                    Math.floor(state.speed / 1000) + 'Kb/s',
                                    Math.floor(state.size.transferred / 1000).toString(),
                                    Math.floor(state.size.total / 1000).toString(),
                                    words.secs.format(Math.floor(state.time.remaining))), {chat_id: sentMsg.chat.id, message_id: sentMsg.message_id})
                            })
                            .on('end', () => bot.deleteMessage(sentMsg.chat.id, sentMsg.message_id)),
                        {caption: songText, parse_mode: 'Markdown', title: songTitle, performer: songArtists, reply_to_message_id: msg.message_id})
                    })
        })
        .catch(function (err) {
            botLog(err.toString())
            bot.sendMessage(chatId, err.toString(), {reply_to_message_id: msg.message_id});
        });
});
