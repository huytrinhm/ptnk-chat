const request = require("request");
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

function updateProfileField(update_data) {
  request(
    {
      uri: "https://graph.facebook.com/v14.0/me/messenger_profile",
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: "POST",
      json: update_data,
    },
    (err, res, body) => {
      if (err) {
        console.error("Unable to update profile:" + err);
      }
    }
  );
}

function initializeProfile() {
  const update_data = {
    get_started: {
      payload: "Get Started",
    },
    greeting: [
      {
        locale: "default",
        text: "Chào mừng {{user_full_name}} đến với PTNK Chatible 2!\n\nLưu ý: PTNK Chatible 2 được lập ra với mục đích kết nối học sinh trường PTNK - ĐHQG TP.HCM. Nếu bạn không là học sinh, cựu học sinh PTNK hoặc không có nhu cầu kết nối với HS/CHS PTNK, vui lòng cân nhắc sử dụng các trang trò chuyện ẩn danh khác.",
      },
    ],
    persistent_menu: [
      {
        locale: "default",
        composer_input_disabled: false,
        call_to_actions: [
          {
            type: "postback",
            title: "Bắt đầu",
            payload: "Bắt đầu",
          },
          {
            type: "postback",
            title: "Trợ giúp",
            payload: "Trợ giúp",
          },
        ],
      },
    ],
  };
  updateProfileField(update_data);
}

module.exports = { initializeProfile };
