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

function cleanDescription(contents) {
  return (
    contents
      .replace(/\{STEAM_CLAN_IMAGE\}\/[^\s\]]+/g, "")
      .replace(/\[img\][\s\S]*?\[\/img\]/gi, "")
      .replace(/\[previewyoutube=[^\]]+\][\s\S]*?\[\/previewyoutube\]/gi, "🎬 [Video PV đính kèm trong bài]")
      .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, "[$2]($1)")
      .replace(/\[\/?[a-z0-9=*#]+\]/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400) + "..."
  );
}

async function postToDiscord(item) {
  const imageUrl = extractImage(item.contents, APP_ID);
  const cleanText = cleanDescription(item.contents);

  const payload = {
    username: "Carmen",
    avatar_url: "https://i.pinimg.com/736x/d6/66/b2/d666b2606bc9785c6c71ddb7d3f6aa2d.jpg",
    content: `<@&${ROLE_ID}>`,
    allowed_mentions: {
      roles: [ROLE_ID],
    },
    embeds: [
      {
        title: item.title,
        url: item.url,
        description: `${cleanText}\n\n🔗 **[Xem thông báo gốc trên Steam](${item.url})**`,
        color: 13632027,
        image: {
          url: imageUrl,
        },
        author: {
          name: "Project Moon • Limbus Company",
        },
        footer: {
          text: `AppID: ${APP_ID}`,
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
