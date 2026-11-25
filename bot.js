import fs from "node:fs";

const APP_ID = "1973530"; // AppID chính thức của Limbus Company
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ROLE_ID = "1564306759814873219"; // Role ID của pm news
const STATE_FILE = "./last_news.json";

function extractImage(contents, appId) {
  const normalized = contents.replace(
    /\{STEAM_CLAN_IMAGE\}/g,
    "https://clan.akamai.steamstatic.com/images"
  );

  const bbMatch = normalized.match(/\[img\](https?:\/\/[^\s\]]+)\[\/img\]/i);
  if (bbMatch) return bbMatch[1];

  const htmlMatch = normalized.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (htmlMatch) return htmlMatch[1];

  const ytMatch = normalized.match(/\[previewyoutube=([a-zA-Z0-9_-]+)/i);
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`;

  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

// Tách tiêu đề dạng [Hàn] [Nhật] [Anh] thành từng dòng riêng biệt y như bài đăng Twitter
function formatMultiLangTitle(title) {
  const bracketMatches = title.match(/\[[^\]]+\]/g);
  if (bracketMatches && bracketMatches.length > 1) {
    return bracketMatches.map((line) => line.trim()).join("\n");
  }
  return title
    .split(/\s*\/\s*|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function postToDiscord(item) {
  const imageUrl = extractImage(item.contents, APP_ID);
  const formattedTitle = formatMultiLangTitle(item.title);

  const payload = {
    username: "Carmen",
    avatar_url: "https://i.pinimg.com/736x/d6/66/b2/d666b2606bc9785c6c71ddb7d3f6aa2d.jpg",
    content: `<@&${ROLE_ID}>`,
    allowed_mentions: {
      roles: [ROLE_ID],
    },
    embeds: [
      {
        author: {
          name: "Limbus Company (@LimbusCompany_B)",
          icon_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${APP_ID}/header.jpg`,
          url: `https://store.steampowered.com/news/app/${APP_ID}`,
        },
        title: "Tweeted",
        url: item.url,
        description: `${formattedTitle}\n\n${item.url}\n\n#LCB #림버스 #LimbusCompany #リンバス`,
        color: 1942002, // Màu xanh dương chuẩn như trong ảnh mẫu
        image: {
          url: imageUrl,
        },
        footer: {
          text: "Steam News • Limbus Company",
        },
        timestamp: new Date(item.date * 1000).toISOString(),
      },
    ],
  };

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Discord Webhook lỗi ${res.status}: ${await res.text()}`);
  }
}

function getLastSentId() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).lastGid ?? null;
}

function saveLastSentId(gid) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastGid: gid }, null, 2));
}

async function run() {
  if (!DISCORD_WEBHOOK_URL) {
    throw new Error("Thiếu biến môi trường DISCORD_WEBHOOK_URL");
  }

  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP_ID}&count=10&format=json`;
  const res = await fetch(url);
  const data = await res.json();

  const items = (data?.appnews?.newsitems ?? []).filter((item) => item.feed_type === 1);
  if (items.length === 0) return;

  const lastGid = getLastSentId();

  if (!lastGid) {
    await postToDiscord(items[0]);
    saveLastSentId(items[0].gid);
    console.log("Khởi tạo thành công & đã đăng tin mới nhất:", items[0].title);
    return;
  }

  const newItems = [];
  for (const item of items) {
    if (item.gid === lastGid) break;
    newItems.push(item);
  }

  if (newItems.length === 0) {
    console.log("Chưa có thông báo mới từ Project Moon.");
    return;
  }

  for (const item of newItems.reverse()) {
    await postToDiscord(item);
    saveLastSentId(item.gid);
    console.log("Đã đăng thông báo mới:", item.title);
  }
}

run();
