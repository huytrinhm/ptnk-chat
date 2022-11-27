const request = require("request");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const admin = require("firebase-admin");
const ADMIN_ID = process.env.ADMIN_ID;

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_CREDENTIAL)
  ),
});

const db = admin.firestore();
const pair_doc = db.collection("pair").doc("pair_doc");
const wait_doc = db.collection("wait").doc("wait_doc");
const name_doc = db.collection("name").doc("name_doc");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

let cached_pairs = {};
let cached_names = {};
let full_maintainance = false;
let maintainance_message = "";

async function get_cache(sender_psid) {
  if (!cached_pairs.hasOwnProperty(sender_psid)) {
    let pairDoc = (await pair_doc.get()).data();
    cached_pairs = pairDoc;

    if (!cached_pairs.hasOwnProperty(sender_psid)) {
      cached_pairs[sender_psid] = "x";
      pair_doc.update(sender_psid, "x");
    }
  }

  return cached_pairs[sender_psid];
}

async function update_cache_name(sender_psid) {
  if (cached_names.hasOwnProperty(sender_psid)) return;

  let nameDoc = (await name_doc.get()).data();
  cached_names = nameDoc;

  if (!cached_names.hasOwnProperty(sender_psid)) {
    cached_names[sender_psid] = (
      await fetch(
        "https://graph.facebook.com/v14.0/" +
          sender_psid +
          "?fields=name&access_token=" +
          PAGE_ACCESS_TOKEN
      ).then((d) => d.json())
    ).name;
    name_doc.update(sender_psid, cached_names[sender_psid]);
  }
  
}
async function forceReloadCache() {
  cached_pairs = (await pair_doc.get()).data();
}

async function match(id1, id2) {
  cached_pairs[id2] = id1;
  cached_pairs[id1] = id2;

  await Promise.all([
    wait_doc.update({
      wait_list: admin.firestore.FieldValue.arrayRemove(id1, id2),
    }),
    pair_doc.update({
      [id2]: id1,
      [id1]: id2,
    }),
  ]);

  callSendAPI(id1, {
    text: 'Đã kết nối! Nhắn "kết thúc" để kết thúc cuộc trò chuyện.',
  });
  callSendAPI(id2, {
    text: 'Đã kết nối! Nhắn "kết thúc" để kết thúc cuộc trò chuyện.',
  });
}

async function handleStart(sender_psid, message = null) {
  update_cache_name(sender_psid);
  let partner_id = await get_cache(sender_psid);

  if (partner_id[0] !== "x") {
    if (message === null)
      callSendAPI(sender_psid, {
        text: "Bạn đang trong một cuộc trò chuyện. Vui lòng kết thúc cuộc trò chuyện này trước khi bắt đầu cuộc trò chuyện khác.",
        quick_replies: [
          {
            content_type: "text",
            title: "Kết thúc",
            payload: "Kết thúc",
          },
        ],
      });
    else handleChat(sender_psid, message);
    return;
  }

  callSendAPI(sender_psid, {
    text: 'Đang tìm kiếm :Đ Nhắn "dừng" để dừng tìm kiếm.',
  });
  let waiting_list = (await wait_doc.get()).data().wait_list;

  if (waiting_list.includes(sender_psid)) return;

  if (waiting_list.length > 0) {
    for (const user of waiting_list) {
      let check = await get_cache(user);
      if (
        check[0] != "x" ||
        check.includes(sender_psid) ||
        partner_id.includes(user)
      )
        continue;

      match(sender_psid, user);
      return;
    }
  }

  wait_doc.update({
    wait_list: admin.firestore.FieldValue.arrayUnion(sender_psid),
  });
}

async function handleEnd(sender_psid) {
  let partner_id = await get_cache(sender_psid);

  if (partner_id[0] === "x") {
    callSendAPI(sender_psid, {
      text: "Bạn hiện không ở trong một cuộc trò chuyện.",
      quick_replies: [
        {
          content_type: "text",
          title: "Bắt đầu",
          payload: "Bắt đầu",
        },
      ],
    });
    return;
  }

  cached_pairs[partner_id] = "x" + sender_psid;
  cached_pairs[sender_psid] = "x" + partner_id;
  pair_doc.update({
    [sender_psid]: "x" + partner_id,
    [partner_id]: "x" + sender_psid,
  });

  callSendAPI(sender_psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "Đã kết thúc cuộc trò chuyện!",
        buttons: [
          {
            type: "postback",
            title: "Bắt đầu",
            payload: "Bắt đầu"
          },
          {
            type: "web_url",
            url: "https://forms.gle/Zu7wWPM9Vw5GuPw58",
            title: "Báo xấu"
          }
        ]
      }
    }
  });
  callSendAPI(partner_id, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "Đối phương đã kết thúc cuộc trò chuyện!",
        buttons: [
          {
            type: "postback",
            title: "Bắt đầu",
            payload: "Bắt đầu"
          },
          {
            type: "web_url",
            url: "https://forms.gle/Zu7wWPM9Vw5GuPw58",
            title: "Báo xấu"
          }
        ]
      }
    }
  });
}

async function handleStopSearch(sender_psid, message = null) {
  let partner_id = await get_cache(sender_psid);

  if (partner_id[0] !== "x") {
    if (message !== null) handleChat(sender_psid, message);
    return;
  }

  wait_doc
    .update({
      wait_list: admin.firestore.FieldValue.arrayRemove(sender_psid),
    })
    .then(() => {
      callSendAPI(sender_psid, {
        text: "Đã dừng tìm kiếm.",
        quick_replies: [
          {
            content_type: "text",
            title: "Bắt đầu",
            payload: "Bắt đầu",
          },
        ],
      });
    });
}

async function getMessageContent(mid, action = "Reacted 🎈 to") {
  let message = await fetch(
    "https://graph.facebook.com/v8.0/" +
      mid +
      "?fields=message&access_token=" +
      PAGE_ACCESS_TOKEN
  ).then((d) => d.json());
  message = message.message;

  if (message !== "") {
    return (
      action + message.replaceAll(/> .*?\n/g, "").replaceAll(/^|\n/g, "\n> ")
    );
  }

  let attachments = await fetch(
    "https://graph.facebook.com/v8.0/" +
      mid +
      "/attachments?access_token=" +
      PAGE_ACCESS_TOKEN
  ).then((d) => d.json());
  attachments = attachments.data;
  if (!attachments) {
    if (action === "") return `> Replied to a message`;
    else return `${action} a message`;
  }

  let type = attachments[0] ? attachments[0].mime_type : "";
  if (type.includes("image")) {
    if (action === "") return `> Replied to an image`;
    else return `${action} an image`;
  } else if (type.includes("audio")) {
    if (action === "") return `> Replied to an audio`;
    else return `${action} an audio`;
  } else if (type.includes("video")) {
    if (action === "") return `> Replied to a video`;
    else return `${action} a video`;
  } else {
    if (action === "") return `> Replied to an attachment`;
    else return `${action} an attachment`;
  }
}

async function handleChat(sender_psid, message) {
  let partner_id = await get_cache(sender_psid);

  if (partner_id[0] === "x") {
    callSendAPI(sender_psid, {
      text: 'Bạn hiện không ở trong một cuộc trò chuyện. Nhắn "bắt đầu" để bắt đầu trò chuyện.',
      quick_replies: [
        {
          content_type: "text",
          title: "Bắt đầu",
          payload: "Bắt đầu",
        },
        {
          content_type: "text",
          title: "Trợ giúp",
          payload: "Trợ giúp",
        },
      ],
    });
    return;
  }

  let response = {};
  let silent = false;

  if (message.text) {
    response.text = message.text;
    if (response.text.includes("/silent")) silent = true;
  }

  if (message.reply_to) {
    response.text =
      (await getMessageContent(message.reply_to.mid, "")) +
      "\n" +
      (response.text??"");
  }

  callSendAPI(partner_id, response, silent);
  if (message.attachments) {
    for (const attachment of message.attachments) {
      callSendAPI(partner_id, {
        attachment: {
          type: attachment.type,
          payload: {
            url: attachment.payload.url,
          },
        },
      });
    }
  }
}

async function handleRead(sender_psid) {
  if (full_maintainance) return;
  let partner_id = await get_cache(sender_psid);

  if (partner_id[0] === "x") return;

  callReadAPI(partner_id);
}

async function handleReact(sender_psid, reaction) {
  if (full_maintainance) return;
  let partner_id = await get_cache(sender_psid);

  if (partner_id[0] === "x") return;

  let content = await getMessageContent(
    reaction.mid,
    reaction.emoji ? `Reacted ${reaction.emoji} to` : "Unreacted to"
  );
  callSendAPI(partner_id, { text: content }, true);
}

function handleHelp(sender_psid) {
  callSendAPI(sender_psid, {
    text: 'Nhắn "bắt đầu" để bắt đầu trò chuyện. Nhắn "kết thúc" để kết thúc cuộc trò chuyện. Trong lúc đang tìm kiếm, bạn có thể nhắn "dừng" để dừng tìm kiếm.',
    quick_replies: [
      {
        content_type: "text",
        title: "Bắt đầu",
        payload: "Bắt đầu",
      },
    ],
  });
}

function handleMaintainance(sender_psid) {
  callSendAPI(sender_psid, {
    text: maintainance_message,
  });
}

async function announcement(text) {
  let tokens = text.split("|");
  let all = tokens[1] === "all";
  let ids = [];
  if (all) ids = Object.keys((await pair_doc.get()).data());
  else {
    for (let i = 1; i < tokens.length - 1; i++) {
      ids.push(tokens[i]);
    }
  }
  ids.forEach((id) => {
    callSendAPI(
      id,
      { text: `[THÔNG BÁO HỆ THỐNG]\n${tokens[tokens.length - 1]}` },
      true
    );
  });
}

function maintain(text) {
  let tokens = text.split("|");
  full_maintainance = (tokens[1] === "true");
  maintainance_message = tokens[2];
}

function handleMessage(sender_psid, received_message) {
  if (full_maintainance) {
    handleMaintainance(sender_psid);
    return;
  }

  let text = null;

  if (typeof received_message === "undefined") return;

  if (received_message.text) text = received_message.text;

  let cleanText = text ? text.trim().toLowerCase() : "";

  if (cleanText == "bắt đầu") {
    handleStart(sender_psid, received_message);
    return;
  } else if (cleanText == "kết thúc") {
    handleEnd(sender_psid);
    return;
  } else if (cleanText == "trợ giúp") {
    handleHelp(sender_psid);
    return;
  } else if (cleanText == "dừng") {
    handleStopSearch(sender_psid, received_message);
    return;
  } else if (sender_psid == ADMIN_ID && cleanText == "force_reload") {
    forceReloadCache();
    return;
  } else if (sender_psid == ADMIN_ID && cleanText.startsWith("announce|")) {
    announcement(received_message.text);
    return;
  } else if (sender_psid == ADMIN_ID && cleanText.startsWith("maintain|")) {
    maintain(received_message.text);
    return;
  }

  handleChat(sender_psid, received_message);
}

function handlePostback(sender_psid, received_postback) {
  if (full_maintainance) {
    handleMaintainance(sender_psid);
    return;
  }

  let response = {};

  let payload = received_postback.payload;

  if (payload === "Get Started") {
    response.text =
      'Chào mừng bạn đến với PTNK Chatible 2! Nhắn "bắt đầu" để bắt đầu trò chuyện.\n\nLưu ý: PTNK Chatible 2 được lập ra với mục đích kết nối học sinh trường PTNK - ĐHQG TP.HCM. Nếu bạn không là học sinh, cựu học sinh PTNK hoặc không có nhu cầu kết nối với HS/CHS PTNK, vui lòng cân nhắc sử dụng các trang trò chuyện ẩn danh khác.';
    response.quick_replies = [
      {
        content_type: "text",
        title: "Bắt đầu",
        payload: "Bắt đầu",
      },
      {
        content_type: "text",
        title: "Trợ giúp",
        payload: "Trợ giúp",
      },
    ];
  } else if (payload === "Bắt đầu") {
    handleStart(sender_psid);
    return;
  } else if (payload === "Trợ giúp") {
    handleHelp(sender_psid);
    return;
  } else if (payload === "Kết thúc") {
    handleEnd(sender_psid);
    return;
  }

  callSendAPI(sender_psid, response);
}

function callSendAPI(sender_psid, response, silent = false) {
  let request_body = {
    recipient: {
      id: sender_psid,
    },
    message: response,
    notification_type: silent ? "NO_PUSH" : "REGULAR",
  };

  request(
    {
      uri: "https://graph.facebook.com/v14.0/me/messages",
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: "POST",
      json: request_body,
    },
    (err, res, body) => {
      if (err) {
        console.error("Unable to send message:" + err);
      }
    }
  );
}

function callReadAPI(id) {
  let request_body = {
    recipient: {
      id: id,
    },
    sender_action: "mark_seen",
  };

  request(
    {
      uri: "https://graph.facebook.com/v14.0/me/messages",
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: "POST",
      json: request_body,
    },
    (err, res, body) => {
      if (err) {
        console.error("Unable to seen message:" + err);
      }
    }
  );
}

module.exports = {
  handleMessage,
  handlePostback,
  callSendAPI,
  handleRead,
  handleReact,
};
