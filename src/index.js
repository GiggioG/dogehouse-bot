const WebSocket = require("ws");
require('dotenv').config();
const {
    DOGEHOUSE_ACCESS_TOKEN,
    DOGEHOUSE_REFRESH_TOKEN,
    DOGEHOUSE_HEARTBEAT_INTERVAL,
    DOGEHOUSE_HEARTBEAT_TIMEOUT,
    DOGEHOUSE_ROOM_ID,
    DOGEHOUSE_API_KEY
} = process.env;
let API = {
    sock: new WebSocket("wss://api.dogehouse.tv/socket"),
    opListeners: {},
    fetchListeners: {},
    rawListeners: {},
    sendRaw: async(msg) => {
        console.log(`=> ${msg}`);
        API.sock.send(msg);
    },
    send: async(op, data, fetchId = null) => {
        let msg = { op, d: data };
        if (fetchId !== null) {
            msg.fetchId = fetchId;
        }
        API.sendRaw(JSON.stringify(msg));
    },
    addOpListener: async(op, callback) => {
        if (!API.opListeners[op]) {
            API.opListeners[op] = [{ op, callback }];
        } else {
            API.opListeners[op].push({ op, callback });
        }
    },
    addFetchListener: async(fetchId, callback) => {
        if (!API.fetchListeners[fetchId]) {
            API.fetchListeners[fetchId] = [{ fetchId, callback }];
        } else {
            API.fetchListeners[fetchId].push({ fetchId, callback });
        }
    },
    addRawListener: async(raw, callback) => {
        if (!API.rawListeners[raw]) {
            API.rawListeners[raw] = [{ raw, callback }];
        } else {
            API.rawListeners[raw].push({ raw, callback });
        }
    },
    waitForOp: async op => new Promise((resolve, reject) => {
        API.addOpListener(op, resolve);
    }),
    waitForFetch: async fetchId => new Promise((resolve, reject) => {
        API.addFetchListener(fetchId, resolve);
    }),
    waitForRaw: async raw => new Promise((resolve, reject) => {
        API.addRawListener(raw, resolve);
    }),
    parseNewMsg: async msg => {
        if (!msg.startsWith('{')) {
            console.log(`<= ${msg}`);
            if (API.rawListeners[msg] && API.rawListeners[msg].length) {
                API.rawListeners[msg][0].callback(msg);
                API.rawListeners[msg].shift();
            }
            return;
        }
        msg = JSON.parse(msg);
        if (msg.op == "fetch_done") {
            if (API.fetchListeners[msg.fetchId] && API.fetchListeners[msg.fetchId].length) {
                API.fetchListeners[msg.fetchId][0].callback(msg);
                API.fetchListeners[msg.fetchId].shift();
            }
            console.log(msg);
            return;
        }
        if (msg.op == "new_chat_msg") {
            console.log(`${msg.d.msg.username}> ${msg.d.msg.tokens.map(t=>t.v).join(' ')}`);
            //command parser here in the future
            if ((msg.d.msg.tokens[0].t == "text") && (msg.d.msg.tokens[0].v == "g!test")) {
                if (msg.d.msg.tokens.length != 1) { return; }
                await API.sendChatMsg(API.textToChatTokens("test successful"), [msg.d.userId]);
            }
            //command parser here in the future
            return;
        }
        if (API.opListeners[msg.op] && API.opListeners[msg.op].length) {
            API.opListeners[msg.op][0].callback(msg);
            API.opListeners[msg.op].shift();
            console.log(msg);
        }
    },
    auth: async(accessToken, refreshToken) => {
        API.send("auth", {
            accessToken,
            refreshToken,
            reconnectToVoice: true,
            currentRoomId: null,
            muted: false
        });
        return await API.waitForOp("auth-good");
    },
    ping: async() => {
        API.sendRaw("ping");
        return await API.waitForRaw("pong");
    },
    generateIdPart: len => {
        let randomChars = "0123456789abcdef";
        let ret = "";
        for (let i = 0; i < len; i++) {
            ret += randomChars.charAt(Math.floor(Math.random() * randomChars.length));
        }
        return ret;
    },
    generateId: () => {
        let parts = [
            API.generateIdPart(8),
            API.generateIdPart(4),
            API.generateIdPart(4),
            API.generateIdPart(4),
            API.generateIdPart(12)
        ];
        return parts.join('-');
    },
    joinRoom: async roomId => {
        //{"op":"join_room_and_get_info","d":{"roomId":"3daf5a80-5b0a-4dde-9527-9db1f7f13755"},"fetchId":"38159846-d74d-4ebf-a589-b976f7c149d0"}
        let fetchId = API.generateId();
        API.send("join_room_and_get_info", {
            roomId
        }, fetchId);
        return API.waitForFetch(fetchId);
    },
    sendChatMsg: async(tokens, whisperedTo = []) => {
        API.send("send_room_chat_msg", {
            tokens,
            whisperedTo
        });
        return await API.waitForOp("new_chat_msg");
    },
    textToChatTokens: text => text.split(' ').map(e => ({ v: e, t: "text" }))
}
API.sock.on("open", async() => {
    setInterval(API.ping, DOGEHOUSE_HEARTBEAT_INTERVAL);
    API.sock.on("message", API.parseNewMsg);
    API.user = await API.auth(DOGEHOUSE_ACCESS_TOKEN, DOGEHOUSE_REFRESH_TOKEN);
    if (!API.user) {
        console.error("NO USER, USER: ");
        console.error(user);
        process.exit(-1);
    }
    API.room = await API.joinRoom(DOGEHOUSE_ROOM_ID);
    if (!API.room) {
        console.error("NO ROOM, ROOM: ");
        console.error(room);
        process.exit(-2);
    }
    await API.sendChatMsg(API.textToChatTokens("type g!test and I will whisper \"test successful\" to you."));
    //process.exit();
});