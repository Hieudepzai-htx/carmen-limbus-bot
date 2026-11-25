import fs from "node:fs";

const APP_ID = "1973530"; // AppID chính thức của Limbus Company
const TWITTER_USER = "LimbusCompany_B";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ROLE_ID = "1564306759814873219"; // Role ID của pm news
const STATE_FILE = "./last_news.json";

// Danh sách các cổng RSS dự phòng để lấy tweet của @LimbusCompany_B
const TWITTER_RSS_MIRRORS = [
  `https://nitter.privacyredirect.com/${TWITTER_USER}/rss`,
  `https://nitter.poast.org/${TWITTER_USER}/rss`,
  `https://rsshub.app/twitter/user/${TWITTER_USER}`,
];

function extractSteamImage(contents, appId) {
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

function decodeHtml(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 1. Lấy bài từ Steam News
async function fetchSteamNews() {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP_ID}&count=10&format=json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  return (data?.appnews?.newsitems ?? [])
    .filter((item) => item.feed_type === 1)
    .map((item) => ({
      source: "steam",
      id: `steam_${item.gid}`,
      title: formatMultiLangTitle(item.title),
      url: item.url,
      imageUrl: extractSteamImage(item.contents, APP_ID),
      date: item.date * 1000,
    }));
}

// 2. Lấy bài từ X/Twitter (@LimbusCompany_B) qua các mirror RSS
async function fetchTwitterNews() {
  for (const rssUrl of TWITTER_RSS_MIRRORS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(rssUrl, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>")) continue;

      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const block = m[1];
        const link = decodeHtml((block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim());
        const guid = decodeHtml((block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? link).trim());
        const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
        const rawDesc = decodeHtml(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "");

        // Tách ảnh trong tweet nếu có
        const imgMatch = rawDesc.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        const imageUrl = imgMatch
          ? imgMatch[1]
          : `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${APP_ID}/header.jpg`;

        // Làm sạch nội dung tweet
        const cleanText = rawDesc
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        // Đổi domain nitter về x.com cho link gốc
        const cleanLink = link.replace(/https?:\/\/[^/]+/, "https://x.com");

        return {
          source: "twitter",
          id: `tw_${guid}`,
          title: cleanText,
          url: cleanLink,
          imageUrl,
          date: pubDate ? new Date(pubDate).getTime() : Date.now(),
        };
      });

      if (items.length > 0) {
        console.log(`Đã lấy được ${items.length} tweet từ: ${rssUrl}`);
        return items;
      }
    } catch {
      // Thử sang mirror tiếp theo nếu mirror này đang bị chặn
    }
  }
  console.log("Tạm thời không kết nối được mirror Twitter/X, bỏ qua lượt này.");
  return [];
}

async function postToDiscord(post) {
  const isTwitter = post.source === "twitter";

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
          url: isTwitter
            ? `https://x.com/${TWITTER_USER}`
            : `https://store.steampowered.com/news/app/${APP_ID}`,
        },
        title: isTwitter ? "Tweeted" : "Steam Announcement",
        url: post.url,
        description: isTwitter
          ? `${post.title}\n\n${post.url}`
          : `${post.title}\n\n${post.url}\n\n#LCB #림버스 #LimbusCompany #リンバス`,
        color: isTwitter ? 1942002 : 13632027, // Xanh Twitter cho Tweet, Đỏ Carmen cho Steam
        image: {
          url: post.imageUrl,
        },
        footer: {
          text: isTwitter ? "X (Twitter) • @LimbusCompany_B" : "Steam News • Limbus Company",
        },
        timestamp: new Date(post.date).toISOString(),
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

function getState() {
  if (!fs.existsSync(STATE_FILE)) return { sentIds: [] };
  const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  return {
    sentIds: Array.isArray(parsed.sentIds) ? parsed.sentIds : [],
  };
}

function saveState(sentIds) {
  // Giữ lại 50 ID gần nhất để file nhẹ và không bao giờ gửi trùng tin cũ
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sentIds: sentIds.slice(0, 50) }, null, 2));
}

async function run() {
  if (!DISCORD_WEBHOOK_URL) {
    throw new Error("Thiếu biến môi trường DISCORD_WEBHOOK_URL");
  }

  const [steamItems, twitterItems] = await Promise.all([
    fetchSteamNews(),
    fetchTwitterNews(),
  ]);

  const state = getState();

  // Lần đầu chạy: đăng 1 tin mới nhất của mỗi nguồn có sẵn và lưu toàn bộ ID hiện có để tránh spam
  if (state.sentIds.length === 0) {
    const initialPosts = [];
    if (steamItems.length > 0) initialPosts.push(steamItems[0]);
    if (twitterItems.length > 0) initialPosts.push(twitterItems[0]);

    for (const post of initialPosts) {
      await postToDiscord(post);
    }

    const allCurrentIds = [...steamItems, ...twitterItems].map((i) => i.id);
    saveState(allCurrentIds);
    console.log("Khởi tạo thành công cả 2 nguồn Steam & Twitter!");
    return;
  }

  const newPosts = [...steamItems, ...twitterItems]
    .filter((item) => !state.sentIds.includes(item.id))
    .sort((a, b) => a.date - b.date);

  if (newPosts.length === 0) {
    console.log("Chưa có bài mới trên cả Steam lẫn Twitter.");
    return;
  }

  const updatedIds = [...state.sentIds];
  for (const post of newPosts) {
    await postToDiscord(post);
    updatedIds.unshift(post.id);
    console.log(`Đã đăng [${post.source}]:`, post.url);
  }

  saveState(updatedIds);
}

run();
