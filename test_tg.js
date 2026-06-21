import https from 'https';

const botToken = "8611861705:AAFBa_jLekSxHlI_toGi6knWfObD_jv_ZhA";
const chatId = "1844291161";
const text = "Direct test from CropTube backend agent!";

const payload = JSON.stringify({ chat_id: chatId, text });
const options = {
  hostname: 'api.telegram.org',
  path: `/bot${botToken}/sendMessage`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
};

console.log("Sending request...");
const tgReq = https.request(options, (tgRes) => {
  let data = '';
  tgRes.on('data', chunk => { data += chunk; });
  tgRes.on('end', () => {
    console.log("Response status:", tgRes.statusCode);
    console.log("Response body:", data);
  });
});

tgReq.on('error', (err) => {
  console.error("Request error:", err);
});

tgReq.write(payload);
tgReq.end();
