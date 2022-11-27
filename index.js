const {
  handleMessage,
  handlePostback,
  handleRead,
  handleReact,
} = require("./handle_messages");
const { initializeProfile } = require("./init");

const express = require("express");
const bodyParser = require("body-parser");
const app = express();

app.use(bodyParser.json());
const PORT = process.env.PORT || 1337;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "TOKEN";

initializeProfile();

app.get("/", function (req, res) {
  res.send("👀");
});

app.get("/webhook", (req, res) => {
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", (req, res) => {
  let body = req.body;
  if (body.object === "page") {
    body.entry.forEach(function (entry) {
      let webhook_event = entry.messaging[0];
      let sender_psid = webhook_event.sender.id;

      if (webhook_event.message) {
        handleMessage(sender_psid, webhook_event.message);
      } else if (webhook_event.postback) {
        handlePostback(sender_psid, webhook_event.postback);
      } else if (webhook_event.read) {
        handleRead(sender_psid);
      } else if (webhook_event.reaction) {
        handleReact(sender_psid, webhook_event.reaction);
      } else {
        console.dir(webhook_event);
      }
    });

    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log("webhook is listening"));
