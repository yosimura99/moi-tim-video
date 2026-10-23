(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MoiLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  class ApiError extends Error {
    constructor(code, message, source) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.source = source || "";
    }
  }

  const messages = {
    emptyQuery: "Hãy nhập từ khóa hoặc địa chỉ trang web.",
    missingKey:
      "Chưa có khóa YouTube và nguồn mở cũng không trả về video. Mở Cài đặt, dán khóa YouTube Data API. Không cần mã cx. Khóa chỉ lưu trên trình duyệt này.",
    missingYoutubeChannel:
      "Cần khóa YouTube Data API để đọc kênh hoặc playlist. YouTube không cho trang tĩnh đọc RSS. Hãy dán khóa trong Cài đặt. Liên kết một video (watch, youtu.be, shorts) vẫn hiện được tên và ảnh.",
    invalidKey:
      "Khóa API không hợp lệ. Tạo lại khóa YouTube Data API trong Google Cloud Console và dán khóa mới vào Cài đặt.",
    quota:
      "Đã vượt hạn mức YouTube Data API hôm nay. Mỗi lượt tìm từ khóa tốn khoảng 100 đơn vị (mặc định khoảng 10.000 đơn vị/ngày). Đợi hạn mức làm mới, hoặc tìm tiếp bằng nguồn mở.",
    network: "Không kết nối được. Kiểm tra mạng rồi thử lại.",
    timeout: "Máy chủ phản hồi quá chậm. Thử lại sau ít phút.",
    forbidden:
      "Khóa YouTube bị từ chối. Kiểm tra hạn chế HTTP referrer và bật YouTube Data API v3 cho khóa này.",
    badRequest: "YouTube từ chối yêu cầu. Kiểm tra lại từ khóa hoặc địa chỉ.",
    notEnabledGoogle:
      "Custom Search API không dùng được với dự án Google mới. Pỏn của Khang không cần mã cx.",
    notEnabledYoutube:
      "Chưa bật YouTube Data API v3. Vào APIs & Services → Library, tìm “YouTube Data API v3” và bấm Enable.",
    noChannel: "Không tìm thấy kênh YouTube này. Kiểm tra lại địa chỉ.",
    noVideo: "Không tìm thấy video YouTube này.",
    noUploads: "Kênh này không có danh sách video đã đăng.",
    upstream: "Nguồn video trả về lỗi. Thử lại sau.",
    oembedFail: "Không lấy được video này khi chưa có khóa API.",
    siteUnreadable:
      "Không đọc được trang này từ trình duyệt. Trang có thể chặn truy cập, hoặc không có RSS, video nhúng hay tệp video.",
    pipedDown:
      "Nguồn mở tạm thời không trả video. Thêm khóa YouTube Data API trong Cài đặt để tìm từ khóa ổn định hơn.",
  };

  function noResultsMessage(query) {
    const q = String(query || "").trim();
    return `Không thấy video nào cho “${q}”. Thử từ khóa khác, chọn “Mọi lúc”, hoặc dán đúng trang video của báo.`;
  }

  function cleanSecret(value) {
    return String(value || "")
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/\s+/g, "");
  }

  function readiness(settings) {
    const s = settings || {};
    const googleApiKey = cleanSecret(s.googleApiKey);
    const searchEngineId = cleanSecret(s.searchEngineId);
    const share = s.shareGoogleKey !== false;
    const ownYoutubeKey = cleanSecret(s.youtubeApiKey);
    const youtubeApiKey = ownYoutubeKey || (share ? googleApiKey : "");
    return {
      googleApiKey,
      searchEngineId,
      youtubeApiKey,
      google: Boolean(googleApiKey && searchEngineId),
      youtube: Boolean(youtubeApiKey),
    };
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value));
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      return url.href;
    } catch (e) {
      return "";
    }
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const raw = String(value)
      .trim()
      .replace(/\u202f|\u00a0/g, " ");
    if (!raw) return null;
    let time = Date.parse(raw);
    if (Number.isNaN(time) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
      const withT = raw.replace(" ", "T");
      const zoned = /[zZ]|[+-]\d{2}:?\d{2}$/.test(withT) ? withT : withT + "Z";
      time = Date.parse(zoned);
    }
    if (Number.isNaN(time)) return null;
    return new Date(time).toISOString();
  }

  function parseIsoDuration(iso) {
    if (iso == null || iso === "") return null;
    if (typeof iso === "number" && Number.isFinite(iso)) return iso > 0 ? Math.round(iso) : null;
    const text = String(iso).trim();
    if (/^\d+$/.test(text)) {
      const n = Number(text);
      return n > 0 ? n : null;
    }
    const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (clock) {
      const h = Number(clock[1] || 0);
      const m = Number(clock[2] || 0);
      const s = Number(clock[3] || 0);
      const total = h * 3600 + m * 60 + s;
      return total > 0 ? total : null;
    }
    const match = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!match) return null;
    const total =
      Number(match[1] || 0) * 86400 +
      Number(match[2] || 0) * 3600 +
      Number(match[3] || 0) * 60 +
      Number(match[4] || 0);
    return total > 0 ? Math.round(total) : null;
  }

  function formatDuration(sec) {
    if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (h) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s);
  }

  function formatViews(n) {
    if (n == null || !Number.isFinite(Number(n))) return "";
    const value = Number(n);
    const abs = Math.abs(value);
    if (abs < 1000) return Math.round(value) + " lượt xem";
    const units = [
      { v: 1e9, s: "T" },
      { v: 1e6, s: "Tr" },
      { v: 1e3, s: "N" },
    ];
    for (let i = 0; i < units.length; i++) {
      if (abs >= units[i].v) {
        const scaled = value / units[i].v;
        const digits = Math.abs(scaled) >= 10 ? 0 : 1;
        const text = scaled
          .toFixed(digits)
          .replace(/\.0$/, "")
          .replace(".", ",");
        return text + " " + units[i].s + " lượt xem";
      }
    }
    return "";
  }

  function timeAgo(iso, now) {
    if (!iso) return "Chưa rõ thời điểm";
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return "Chưa rõ thời điểm";
    const current = typeof now === "number" ? now : Date.now();
    const sec = Math.round((current - time) / 1000);
    if (sec < 45) return "vừa xong";
    if (sec < 3600) return Math.floor(sec / 60) + " phút trước";
    if (sec < 86400) return Math.floor(sec / 3600) + " giờ trước";
    if (sec < 604800) return Math.floor(sec / 86400) + " ngày trước";
    if (sec < 2592000) return Math.floor(sec / 604800) + " tuần trước";
    if (sec < 31536000) return Math.floor(sec / 2592000) + " tháng trước";
    return Math.floor(sec / 31536000) + " năm trước";
  }

  function publishedAfter(dateRestrict, now) {
    const days = { d1: 1, w1: 7, m1: 30, y1: 365 };
    if (!days[dateRestrict]) return "";
    const current = typeof now === "number" ? now : Date.now();
    return new Date(current - days[dateRestrict] * 86400000).toISOString();
  }

function bareHost(hostname) {
  let host = String(hostname || "").toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (host === "m.youtube.com") return "youtube.com";
  return host;
}

function absoluteUrl(value, base) {
  if (!value) return "";
  try {
    const url = new URL(value, base || undefined);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch (e) {
    return "";
  }
}

  function isYouTubeHost(host) {
    return (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    );
  }

  function asVideoId(value) {
    const match = String(value || "").match(/[A-Za-z0-9_-]{11}/);
    return match ? match[0] : "";
  }

  function youtubeIdFromUrl(value) {
    const safe = safeHttpUrl(value);
    if (!safe) return "";
    let url;
    try {
      url = new URL(safe);
    } catch (e) {
      return "";
    }
    const host = bareHost(url.hostname);
    if (!isYouTubeHost(host)) return "";
    if (host === "youtu.be") return asVideoId(url.pathname.split("/").filter(Boolean)[0]);
    const parts = url.pathname.split("/").filter(Boolean);
    const v = url.searchParams.get("v");
    if (v) return asVideoId(v);
    if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") && parts[1]) {
      return asVideoId(parts[1]);
    }
    return "";
  }

  function toUrl(text) {
    if (/\s/.test(text)) return null;
    if (/^[^/\s]+@[^/\s]+$/.test(text)) return null;
    let candidate = text;
    if (!/^https?:\/\//i.test(candidate)) {
      if (!/^([a-z0-9-]+\.)+[a-z]{2,}([/:?#].*)?$/i.test(candidate)) return null;
      candidate = "https://" + candidate;
    }
    try {
      const url = new URL(candidate);
      if (!url.hostname || !url.hostname.includes(".")) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url;
    } catch (e) {
      return null;
    }
  }

  function siteQuery(url) {
    const host = bareHost(url.hostname);
    let path = url.pathname;
    try {
      path = decodeURIComponent(url.pathname);
    } catch (e) {
      path = url.pathname;
    }
    const words = path
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1)
      .slice(0, 8);
    if (!words.length) return { q: "site:" + host, siteSearch: "" };
    return { q: words.join(" "), siteSearch: host };
  }

  function classifyYouTube(url) {
    const host = bareHost(url.hostname);
    const parts = url.pathname.split("/").filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (e) {
        return part;
      }
    });
    const list = url.searchParams.get("list") || "";
    const videoId = youtubeIdFromUrl(url.href);

    if (host === "youtu.be" && videoId) return { kind: "youtube-video", youtubeId: videoId };
    if (parts[0] === "playlist" && list) return { kind: "youtube-playlist", playlistId: list };
    if (parts[0] === "watch" && videoId) return { kind: "youtube-video", youtubeId: videoId, playlistId: list };
    if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") && videoId) {
      return { kind: "youtube-video", youtubeId: videoId };
    }
    if (parts[0] === "channel" && parts[1]) return { kind: "youtube-channel", channelId: parts[1] };
    if (parts[0] === "user" && parts[1]) return { kind: "youtube-channel", username: parts[1] };
    if (parts[0] === "c" && parts[1]) return { kind: "youtube-channel", customName: parts[1] };
    if (parts[0] && parts[0].startsWith("@")) return { kind: "youtube-channel", handle: parts[0].slice(1) };
    if (videoId) return { kind: "youtube-video", youtubeId: videoId, playlistId: list };
    if (list) return { kind: "youtube-playlist", playlistId: list };
    return null;
  }

  function blankSpec(text) {
    return {
      raw: text,
      kind: "keyword",
      query: text,
      url: "",
      host: "",
      siteSearch: "",
      youtubeId: "",
      channelId: "",
      handle: "",
      username: "",
      customName: "",
      playlistId: "",
    };
  }

  function classifyQuery(raw) {
    const text = String(raw || "").trim();
    const spec = blankSpec(text);
    if (!text) return spec;
    const url = toUrl(text);
    if (!url) return spec;
    spec.url = url.href;
    spec.host = bareHost(url.hostname);
    if (isYouTubeHost(spec.host)) {
      const yt = classifyYouTube(url);
      if (yt) return Object.assign(spec, yt, { query: text, url: url.href });
    }
    const site = siteQuery(url);
    spec.kind = "site";
    spec.query = site.q;
    spec.siteSearch = site.siteSearch || "";
    return spec;
  }

  function googleQueryPlan(spec) {
    if (spec.kind === "keyword") {
      return {
        primary: { q: spec.query },
        supplement: {
          q: spec.query + " (site:youtube.com OR site:vimeo.com OR site:dailymotion.com OR site:twitch.tv)",
        },
      };
    }
    if (spec.kind === "site") {
      if (spec.siteSearch) {
        return {
          primary: { q: spec.query, siteSearch: spec.siteSearch },
          supplement: { q: spec.query + " video", siteSearch: spec.siteSearch },
        };
      }
      return {
        primary: { q: spec.query },
        supplement: { q: spec.query + " (video OR watch OR youtube)" },
      };
    }
    if (spec.kind === "youtube-video") return { primary: { q: spec.url || spec.query }, supplement: null };
    if (spec.kind === "youtube-channel") {
      const q = spec.handle || spec.username || spec.customName || spec.channelId || spec.query;
      return { primary: { q: q, siteSearch: "youtube.com" }, supplement: null };
    }
    if (spec.kind === "youtube-playlist") {
      return { primary: { q: spec.playlistId || spec.query, siteSearch: "youtube.com" }, supplement: null };
    }
    return { primary: { q: spec.query }, supplement: null };
  }

  function wantsYouTubeApi(spec) {
    return spec.kind === "keyword" || (spec.kind && spec.kind.indexOf("youtube") === 0);
  }

function domainOf(value) {
    try {
      return bareHost(new URL(value).hostname);
    } catch (e) {
      return "";
    }
  }

  function firstMeta(item) {
    const tags = item && item.pagemap && item.pagemap.metatags;
    return (tags && tags[0]) || {};
  }

  function metaDate(meta) {
    const keys = [
      "article:published_time",
      "og:video:release_date",
      "video:release_date",
      "date",
      "pubdate",
      "publishdate",
      "sailthru.date",
      "parsely-pub-date",
      "og:updated_time",
      "article:modified_time",
    ];
    for (let i = 0; i < keys.length; i++) {
      if (meta[keys[i]]) return parseDate(meta[keys[i]]);
    }
    return null;
  }

  function imageFrom(item, meta) {
    const pagemap = (item && item.pagemap) || {};
    const thumb = pagemap.cse_thumbnail && pagemap.cse_thumbnail[0] && pagemap.cse_thumbnail[0].src;
    const image = pagemap.cse_image && pagemap.cse_image[0] && pagemap.cse_image[0].src;
    return safeHttpUrl(thumb || image || meta["og:image"] || meta["twitter:image"] || "");
  }

  function cleanTitle(title) {
    return stripHtml(title).replace(/\s+[-|–]\s+YouTube\s*$/i, "").trim();
  }

  function junkTitle(title) {
    const t = String(title || "").trim().toLowerCase();
    return !t || t === "private video" || t === "deleted video" || t === "video không có sẵn";
  }

  function liveBadge(content) {
    if (content === "live") return "TRỰC TIẾP";
    if (content === "upcoming") return "SẮP PHÁT";
    return "";
  }

  function youtubeThumb(id) {
    return id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "";
  }

  function makeVideo(fields) {
    const youtubeId = fields.youtubeId || youtubeIdFromUrl(fields.url) || "";
    const url = youtubeId ? "https://www.youtube.com/watch?v=" + youtubeId : safeHttpUrl(fields.url);
    if (!url || junkTitle(fields.title)) return null;
    const source = fields.source || "google";
    return {
      id: youtubeId ? "yt:" + youtubeId : "web:" + normalizeUrl(url),
      youtubeId: youtubeId,
      title: cleanTitle(fields.title).slice(0, 180),
      description: stripHtml(fields.description || "").slice(0, 800),
      url: url,
      pageUrl: safeHttpUrl(fields.pageUrl || ""),
      thumbnail: safeHttpUrl(fields.thumbnail) || youtubeThumb(youtubeId),
      author: stripHtml(fields.author || "") || domainOf(fields.pageUrl || url) || "Không rõ nguồn",
      authorUrl: safeHttpUrl(fields.authorUrl || ""),
      publishedAt: parseDate(fields.publishedAt),
      durationSec: parseIsoDuration(fields.duration),
      views: fields.views == null || fields.views === "" || Number.isNaN(Number(fields.views)) ? null : Number(fields.views),
      badge: fields.badge || "",
      embeddable: fields.embeddable !== false,
      source: source,
      via: fields.via || (source === "youtube" || source === "oembed" || source === "piped" ? "YouTube" : source === "site" ? siteName(domainOf(fields.pageUrl || url)) : "Google"),
      sourceLabel: fields.sourceLabel || (youtubeId ? "YouTube" : siteName(domainOf(fields.pageUrl || url))),
    };
  }

  function isVideoPage(item) {
    const link = item && item.link ? item.link : "";
    const meta = firstMeta(item);
    const ogType = String(meta["og:type"] || "").toLowerCase();
    if (youtubeIdFromUrl(link)) return true;
    if (/vimeo\.com\/(?:video\/)?\d+/i.test(link)) return true;
    if (/dailymotion\.com\/video\/[A-Za-z0-9]+/i.test(link) || /dai\.ly\/[A-Za-z0-9]+/i.test(link)) return true;
    if (/twitch\.tv\/videos\/\d+/i.test(link)) return true;
    if (/tiktok\.com\/@[^/]+\/video\/\d+/i.test(link)) return true;
    if (/facebook\.com\/.+\/videos\/|facebook\.com\/watch|fb\.watch\//i.test(link)) return true;
    if (/\.(mp4|webm|ogg|m3u8)(\?|#|$)/i.test(link)) return true;
    if (ogType.indexOf("video") !== -1) return true;
    if (meta["og:video"] || meta["og:video:url"] || meta["og:video:secure_url"]) return true;
    if (item && item.pagemap && item.pagemap.videoobject && item.pagemap.videoobject.length) return true;
    return false;
  }

function videoFromObject(item, videoObject) {
  const meta = firstMeta(item);
  const mediaUrl = absoluteUrl(
    videoObject.embedurl ||
      videoObject.embedUrl ||
      videoObject.contenturl ||
      videoObject.contentUrl ||
      videoObject.url ||
      item.link,
    item.link
  );
  return makeVideo({
    title: videoObject.name || videoObject.title || item.title,
    description: videoObject.description || item.snippet,
    url: mediaUrl,
    thumbnail: absoluteUrl(videoObject.thumbnailurl || videoObject.thumbnail || "", item.link) || imageFrom(item, meta),
      author: videoObject.author || videoObject.channel || meta["og:site_name"] || item.displayLink,
      publishedAt:
        videoObject.datepublished ||
        videoObject.uploaddate ||
        videoObject.uploadDate ||
        metaDate(meta),
      duration: videoObject.duration,
      views: videoObject.interactioncount || videoObject.interactionCount,
      source: "google",
      sourceLabel: domainOf(item.link) || item.displayLink,
    });
  }

function videoFromItem(item) {
  const meta = firstMeta(item);
  const media = absoluteUrl(
    meta["og:video:secure_url"] || meta["og:video:url"] || meta["og:video"] || item.link,
    item.link
  );
  return makeVideo({
    title: meta["og:title"] || item.title,
    description: meta["og:description"] || item.snippet,
    url: media,
      thumbnail: imageFrom(item, meta),
      author: meta["og:site_name"] || item.displayLink,
      authorUrl: item.link,
      publishedAt: metaDate(meta),
      source: "google",
      sourceLabel: domainOf(item.link) || item.displayLink,
    });
  }

  function extractVideos(items) {
    const out = [];
    (items || []).forEach((item) => {
      if (!item) return;
      const objects = (item.pagemap && item.pagemap.videoobject) || [];
      let added = 0;
      objects.forEach((videoObject) => {
        const video = videoFromObject(item, videoObject || {});
        if (video) {
          out.push(video);
          added += 1;
        }
      });
      if (!added && isVideoPage(item)) {
        const video = videoFromItem(item);
        if (video) out.push(video);
      }
    });
    return out;
  }

  function normalizeUrl(raw) {
    try {
      const url = new URL(raw);
      url.hash = "";
      const drop = [];
      url.searchParams.forEach((value, key) => {
        if (/^(utm_|fbclid$|gclid$|si$|feature$|igshid$|pp$)/i.test(key)) drop.push(key);
      });
      drop.forEach((key) => url.searchParams.delete(key));
      url.hostname = bareHost(url.hostname);
      const path = url.pathname.replace(/\/$/, "") || "/";
      const search = url.searchParams.toString();
      return url.protocol + "//" + url.hostname + path + (search ? "?" + search : "");
    } catch (e) {
      return String(raw || "");
    }
  }

  function genericAuthor(name) {
    const n = String(name || "")
      .trim()
      .toLowerCase();
    return !n || n === "youtube" || n === "youtube.com" || n === "www.youtube.com" || n === "không rõ nguồn";
  }

  function preferAuthor(primary, secondary) {
    if (!genericAuthor(primary)) return primary;
    if (!genericAuthor(secondary)) return secondary;
    return primary || secondary || "Không rõ nguồn";
  }

function viaOf(video) {
  if (!video) return "";
  if (video.source === "youtube" || video.source === "oembed" || video.source === "piped") return "YouTube";
  if (video.source === "site") return video.via || video.sourceLabel || siteName(domainOf(video.pageUrl || video.url));
  return video.via || "Google";
}

  function mergeRecords(a, b) {
    const score = (video) =>
      (video.durationSec ? 4 : 0) +
      (video.views != null ? 2 : 0) +
      (video.publishedAt ? 2 : 0) +
      (video.source === "youtube" ? 3 : video.source === "google" ? 2 : 1) +
      (video.embeddable === false ? 0 : 0.1);
    const primary = score(a) >= score(b) ? a : b;
    const secondary = primary === a ? b : a;
    const youtubeId = primary.youtubeId || secondary.youtubeId || "";
    const description =
      (primary.description || "").length >= (secondary.description || "").length
        ? primary.description
        : secondary.description;
    return Object.assign({}, secondary, primary, {
      id: youtubeId ? "yt:" + youtubeId : primary.id || secondary.id,
      youtubeId: youtubeId,
      url: youtubeId ? "https://www.youtube.com/watch?v=" + youtubeId : primary.url || secondary.url,
      publishedAt: primary.publishedAt || secondary.publishedAt || null,
      durationSec: primary.durationSec != null ? primary.durationSec : secondary.durationSec,
      views: primary.views != null ? primary.views : secondary.views,
      thumbnail: primary.thumbnail || secondary.thumbnail,
      description: description || "",
      author: preferAuthor(primary.author, secondary.author),
      authorUrl: primary.authorUrl || secondary.authorUrl || "",
      badge: primary.badge || secondary.badge || "",
      embeddable: primary.embeddable !== false && secondary.embeddable !== false,
      source: primary.source,
      via: primary.source === "youtube" || secondary.source === "youtube" || primary.source === "piped" || secondary.source === "piped" ? "YouTube" : viaOf(primary),
      sourceLabel: primary.sourceLabel || secondary.sourceLabel,
      pageUrl: primary.pageUrl || secondary.pageUrl || "",
    });
  }

  function dedupeVideos(list) {
    const map = new Map();
    const order = [];
    (list || []).forEach((video) => {
      if (!video) return;
      const key = video.youtubeId ? "yt:" + video.youtubeId : "url:" + normalizeUrl(video.url);
      if (!map.has(key)) {
        map.set(key, video);
        order.push(key);
      } else {
        map.set(key, mergeRecords(map.get(key), video));
      }
    });
    return order.map((key) => map.get(key));
  }

  function sortVideos(list) {
    return (list || [])
      .map((video, index) => ({ video: video, index: index }))
      .sort((a, b) => {
        const da = a.video.publishedAt ? Date.parse(a.video.publishedAt) : NaN;
        const db = b.video.publishedAt ? Date.parse(b.video.publishedAt) : NaN;
        const aOk = !Number.isNaN(da);
        const bOk = !Number.isNaN(db);
        if (aOk && bOk && da !== db) return db - da;
        if (aOk !== bOk) return aOk ? -1 : 1;
        return a.index - b.index;
      })
      .map((entry) => entry.video);
  }

  function filterGoogleForTarget(videos, spec, channel, knownIds) {
    if (!spec || (spec.kind !== "youtube-channel" && spec.kind !== "youtube-playlist")) return videos || [];
    const ids = knownIds || new Set();
    const needles = [
      spec.channelId,
      spec.handle,
      spec.username,
      spec.customName,
      spec.playlistId,
      channel && channel.id,
      channel && channel.title,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const filtered = (videos || []).filter((video) => {
      if (video.youtubeId && ids.has(video.youtubeId)) return true;
      if (spec.playlistId && video.url && video.url.toLowerCase().indexOf(String(spec.playlistId).toLowerCase()) !== -1) {
        return true;
      }
      const hay = (video.url + " " + video.title + " " + video.author).toLowerCase();
      return needles.some((needle) => needle.length > 2 && hay.indexOf(needle) !== -1);
    });
    if (!filtered.length && videos && videos.length && (!ids || !ids.size)) return videos;
    return filtered;
  }

  function buildEmbed(video, hostname) {
    const url = (video && video.url) || "";
    const youtubeId = (video && video.youtubeId) || youtubeIdFromUrl(url);
    if (youtubeId) {
      const watch = "https://www.youtube.com/watch?v=" + youtubeId;
      if (video && video.embeddable === false) {
        return { type: "external", src: watch, reason: "noembed", ratio: "16 / 9", narrow: false };
      }
      return {
        type: "iframe",
        src: "https://www.youtube-nocookie.com/embed/" + youtubeId + "?autoplay=1&rel=0",
        ratio: "16 / 9",
        narrow: false,
      };
    }
    const vimeo = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeo) {
      return { type: "iframe", src: "https://player.vimeo.com/video/" + vimeo[1] + "?autoplay=1", ratio: "16 / 9", narrow: false };
    }
    const dm = String(url).match(/dailymotion\.com\/(?:video|embed\/video)\/([A-Za-z0-9]+)/i);
    if (dm) {
      return {
        type: "iframe",
        src: "https://www.dailymotion.com/embed/video/" + dm[1] + "?autoplay=1",
        ratio: "16 / 9",
        narrow: false,
      };
    }
    const twitch = String(url).match(/twitch\.tv\/videos\/(\d+)/i);
    if (twitch && hostname) {
      return {
        type: "iframe",
        src: "https://player.twitch.tv/?video=" + twitch[1] + "&parent=" + encodeURIComponent(hostname) + "&autoplay=true",
        ratio: "16 / 9",
        narrow: false,
      };
    }
    const tiktok = String(url).match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
    if (tiktok) {
      return { type: "iframe", src: "https://www.tiktok.com/embed/v2/" + tiktok[1], ratio: "9 / 16", narrow: true };
    }
    if (/\.m3u8(\?|#|$)/i.test(url) && safeHttpUrl(url)) {
      return { type: "hls", src: safeHttpUrl(url), ratio: "16 / 9", narrow: false };
    }
    if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url) && safeHttpUrl(url)) {
      return { type: "file", src: safeHttpUrl(url), ratio: "16 / 9", narrow: false };
    }
    if (/facebook\.com\/(?:.+\/videos\/|watch)|fb\.watch\//i.test(url) && safeHttpUrl(url)) {
      return {
        type: "iframe",
        src: "https://www.facebook.com/plugins/video.php?href=" + encodeURIComponent(safeHttpUrl(url)) + "&show_text=false&autoplay=true",
        ratio: "16 / 9",
        narrow: false,
      };
    }
    return { type: "external", src: safeHttpUrl(url), ratio: "16 / 9", narrow: false };
  }

  function mapHttpError(status, body, source) {
    const message = (body && body.error && body.error.message) || "";
    const reason =
      (body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) ||
      (body && body.error && body.error.status) ||
      "";
    const blob = (reason + " " + message).toLowerCase();
    const src = source || "";
    if (!status) return new ApiError("NETWORK", messages.network, src);
    if (
      status === 429 ||
      blob.indexOf("quota") !== -1 ||
      blob.indexOf("dailylimit") !== -1 ||
      blob.indexOf("ratelimit") !== -1
    ) {
      return new ApiError("QUOTA", messages.quota, src);
    }
    if (
      blob.indexOf("api key not valid") !== -1 ||
      blob.indexOf("keyinvalid") !== -1 ||
      blob.indexOf("keyexpired") !== -1 ||
      blob.indexOf("apikeyinvalid") !== -1
    ) {
      return new ApiError("INVALID_KEY", messages.invalidKey, src);
    }
    if (
      blob.indexOf("accessnotconfigured") !== -1 ||
      blob.indexOf("has not been used") !== -1 ||
      blob.indexOf("service_disabled") !== -1 ||
      blob.indexOf("is disabled") !== -1
    ) {
      const text = src === "youtube" ? messages.notEnabledYoutube : messages.notEnabledGoogle;
      return new ApiError("NOT_ENABLED", text, src);
    }
    if (status === 403 || blob.indexOf("forbidden") !== -1 || blob.indexOf("permission") !== -1) {
      return new ApiError("FORBIDDEN", messages.forbidden, src);
    }
    if (status === 400) return new ApiError("BAD_REQUEST", messages.badRequest, src);
    const detail = stripHtml(message).slice(0, 180);
    return new ApiError("UPSTREAM", detail ? messages.upstream + " " + detail : messages.upstream, src);
  }

  function bestThumb(thumbs) {
    if (!thumbs) return "";
    const order = ["maxres", "standard", "high", "medium", "default"];
    for (let i = 0; i < order.length; i++) {
      if (thumbs[order[i]] && thumbs[order[i]].url) return thumbs[order[i]].url;
    }
    return "";
  }

  function fromYouTubeResource(resource) {
    if (!resource || !resource.id) return null;
    const snippet = resource.snippet || {};
    return makeVideo({
      youtubeId: resource.id,
      title: snippet.title,
      description: snippet.description,
      url: "https://www.youtube.com/watch?v=" + resource.id,
      thumbnail: bestThumb(snippet.thumbnails),
      author: snippet.channelTitle,
      authorUrl: snippet.channelId ? "https://www.youtube.com/channel/" + snippet.channelId : "",
      publishedAt: snippet.publishedAt,
      duration: resource.contentDetails && resource.contentDetails.duration,
      views: resource.statistics && resource.statistics.viewCount,
      badge: liveBadge(snippet.liveBroadcastContent),
      embeddable: resource.status ? resource.status.embeddable !== false : true,
      source: "youtube",
      sourceLabel: "YouTube",
    });
  }

  function fromSearchItem(item) {
    const id = item && item.id && item.id.videoId;
    const snippet = (item && item.snippet) || {};
    if (!id) return null;
    return makeVideo({
      youtubeId: id,
      title: snippet.title,
      description: snippet.description,
      thumbnail: bestThumb(snippet.thumbnails),
      author: snippet.channelTitle,
      authorUrl: snippet.channelId ? "https://www.youtube.com/channel/" + snippet.channelId : "",
      publishedAt: snippet.publishedAt,
      badge: liveBadge(snippet.liveBroadcastContent),
      source: "youtube",
      sourceLabel: "YouTube",
    });
  }

  function siteName(host) {
    const names = {
      "vnexpress.net": "VnExpress",
      "video.vnexpress.net": "VnExpress",
      "tuoitre.vn": "Tuổi Trẻ",
      "thanhnien.vn": "Thanh Niên",
      "vietnamnet.vn": "VietnamNet",
      "vtv.vn": "VTV",
      "dantri.com.vn": "Dân trí",
      "youtube.com": "YouTube",
      "vimeo.com": "Vimeo",
      "dailymotion.com": "Dailymotion",
      "tiktok.com": "TikTok",
      "facebook.com": "Facebook",
    };
    const bare = bareHost(host);
    return names[bare] || bare || "Trang web";
  }

  function decodeEntities(value) {
    return String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCharCode(code) : _;
      })
      .replace(/&#(\d+);/g, (_, num) => {
        const code = Number(num);
        return Number.isFinite(code) ? String.fromCharCode(code) : _;
      })
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  function isDirectMedia(url) {
    return /\.(mp4|webm|ogg|m3u8)(\?|#|$)/i.test(String(url || ""));
  }

  function isKnownPlayer(url) {
    const value = String(url || "");
    if (youtubeIdFromUrl(value)) return true;
    if (/vimeo\.com\/(?:video\/)?\d+/i.test(value)) return true;
    if (/dailymotion\.com\/video\/[A-Za-z0-9]+/i.test(value) || /dai\.ly\/[A-Za-z0-9]+/i.test(value)) return true;
    if (/tiktok\.com\/@[^/]+\/video\/\d+/i.test(value)) return true;
    if (/twitch\.tv\/videos\/\d+/i.test(value)) return true;
    if (/facebook\.com\/(?:.+\/videos\/|watch)|fb\.watch\//i.test(value)) return true;
    return false;
  }

  function isPlayableUrl(url) {
    return isDirectMedia(url) || isKnownPlayer(url);
  }

  function titleFromSlug(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      let last = parts[parts.length - 1] || parsed.hostname;
      try {
        last = decodeURIComponent(last);
      } catch (e) {}
      last = last.replace(/\.(mp4|webm|ogg|m3u8|html?)$/i, "");
      last = last.replace(/[-_]+/g, " ").replace(/\d{6,}/g, " ").replace(/\s+/g, " ").trim();
      if (last.length < 8) return siteName(parsed.hostname) + " video";
      return last.charAt(0).toUpperCase() + last.slice(1);
    } catch (e) {
      return "Video";
    }
  }

  function dateFromMediaUrl(url) {
    const text = String(url || "");
    const stamp = text.match(/(?:^|[^0-9])(\d{10})(?![0-9])/);
    if (stamp) {
      const ms = Number(stamp[1]) * 1000;
      if (ms > Date.UTC(2018, 0, 1) && ms < Date.UTC(2032, 0, 1)) return new Date(ms).toISOString();
    }
    const day = text.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);
    if (!day) return null;
    return new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))).toISOString();
  }

  function tagText(xml, tag) {
    const re = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "i");
    const match = String(xml || "").match(re);
    if (!match) return "";
    return stripHtml(decodeEntities(match[1])).trim();
  }

  function tagAttr(xml, tag, name) {
    const re = new RegExp("<" + tag + "\\b([^>]*)\\/?>", "i");
    const match = String(xml || "").match(re);
    if (!match) return "";
    const attr = match[1].match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
    return attr ? decodeEntities(attr[2]).trim() : "";
  }

  function nearestTitle(windowText) {
    const patterns = [
      /title\s*=\s*"([^"]{4,180})"/i,
      /title\s*:\s*"([^"]{4,180})"/,
      /<h[1-3][^>]*>\s*([^<]{4,180}?)\s*<\/h[1-3]>/i,
      /alt\s*=\s*"([^"]{4,180})"/i,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const match = windowText.match(patterns[i]);
      if (!match) continue;
      const title = stripHtml(match[1]).trim();
      if (title && !/^(play|video|ảnh|image|null)$/i.test(title)) return title;
    }
    return "";
  }

  function nearestThumb(windowText) {
    const match = String(windowText || "").match(/https?:\/\/[^"'\\\s>]+\.(?:jpe?g|png|webp)(?:\?[^"'\\\s>]*)?/i);
    return match ? match[0] : "";
  }

  function nearestArticle(windowText, base) {
    const preferred = String(windowText || "").match(/https?:\/\/video\.vnexpress\.net\/[^"'\\\s>]+\.html/i);
    if (preferred) return absoluteUrl(preferred[0], base);
    const href = String(windowText || "").match(/href\s*=\s*"([^"]+\.s?html?)"/i);
    if (href) return absoluteUrl(decodeEntities(href[1]), base);
    return "";
  }

  function pushVideo(list, seen, fields) {
    const pageUrl = fields.pageUrl || "";
    const video = makeVideo(Object.assign({
      source: "site",
      author: siteName(domainOf(pageUrl || fields.url)),
      sourceLabel: siteName(domainOf(pageUrl || fields.url)),
      via: siteName(domainOf(pageUrl || fields.url)),
    }, fields));
    if (!video || seen.has(video.id)) return;
    seen.add(video.id);
    list.push(video);
  }

  function extractRssVideos(xml, pageUrl) {
    const chunks = String(xml || "").split(/<item\b/i).slice(1);
    const videos = [];
    const seen = new Set();
    chunks.forEach((chunk) => {
      const title = tagText(chunk, "title");
      const link = tagText(chunk, "link") || tagAttr(chunk, "link", "href");
      const publishedAt = tagText(chunk, "pubDate") || tagText(chunk, "dc:date") || tagText(chunk, "updated") || tagText(chunk, "published");
      const mediaUrl = tagAttr(chunk, "media:content", "url") || tagAttr(chunk, "enclosure", "url");
      const mediaType = (tagAttr(chunk, "media:content", "type") || tagAttr(chunk, "enclosure", "type") || "").toLowerCase();
      const thumb = tagAttr(chunk, "media:thumbnail", "url") || tagText(chunk, "media:thumbnail") || tagAttr(chunk, "media:content", "url");
      const duration = tagAttr(chunk, "media:content", "duration") || tagText(chunk, "itunes:duration");
      const description = tagText(chunk, "description");
      const mediaIsVideo = mediaUrl && (mediaType.indexOf("video") !== -1 || mediaType.indexOf("mpegurl") !== -1 || isPlayableUrl(mediaUrl));
      const play = mediaIsVideo ? mediaUrl : isPlayableUrl(link) ? link : "";
      if (!play) return;
      const image = thumb && !isDirectMedia(thumb) ? thumb : "";
      pushVideo(videos, seen, {
        title: title || titleFromSlug(play),
        description: description,
        url: absoluteUrl(play, pageUrl) || play,
        pageUrl: safeHttpUrl(link) && !isDirectMedia(link) ? link : pageUrl,
        thumbnail: image,
        publishedAt: publishedAt || dateFromMediaUrl(play),
        duration: duration,
      });
    });
    return videos;
  }

  function extractHtmlVideos(html, pageUrl) {
    const text = decodeEntities(html).replace(/\\\//g, "/");
    const videos = [];
    const seen = new Set();
    let match;
    const ldRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    while ((match = ldRe.exec(text))) {
      let data = null;
      try {
        data = JSON.parse(match[1]);
      } catch (e) {
        data = null;
      }
      const nodes = Array.isArray(data) ? data : data ? [data] : [];
      nodes.forEach((node) => {
        const list = node && node["@graph"] ? [].concat(node, node["@graph"]) : [node];
        list.forEach((item) => {
          if (!item || String(item["@type"] || "").toLowerCase().indexOf("video") === -1) return;
          const content = item.contentUrl || item.embedUrl || item.url;
          if (!content) return;
          pushVideo(videos, seen, {
            title: item.name || item.headline,
            description: item.description,
            url: absoluteUrl(content, pageUrl),
            pageUrl: absoluteUrl(item.mainEntityOfPage || pageUrl, pageUrl),
            thumbnail: absoluteUrl(typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : (item.thumbnailUrl && item.thumbnailUrl[0]) || "", pageUrl),
            publishedAt: item.uploadDate || item.datePublished,
            duration: item.duration,
            author: typeof item.author === "string" ? item.author : item.author && item.author.name,
          });
        });
      });
    }
    text.split(/<article\b/i).slice(1).forEach((part) => {
      const chunk = part.slice(0, 5000);
      const media = chunk.match(/https?:[^"'\\\s]+?master\.m3u8/i);
      if (!media) return;
      const title = chunk.match(/\btitle\s*=\s*"([^"]{4,180})"/i);
      const href = chunk.match(/href\s*=\s*"(https?:[^"]+?\.s?html?)"/i);
      const duration = chunk.match(/"dr"\s*:\s*(\d+)/) || chunk.match(/\bdr\s*:\s*(\d+)/);
      pushVideo(videos, seen, {
        title: title ? title[1] : titleFromSlug(media[0]),
        url: media[0],
        pageUrl: href ? href[1] : pageUrl,
        thumbnail: nearestThumb(chunk),
        publishedAt: dateFromMediaUrl(media[0]),
        duration: duration ? Number(duration[1]) : null,
      });
    });
    const objectRe = /\{[^{}]{0,1400}"m3u8"\s*:\s*"(https?:[^"]+\.m3u8)"[^{}]{0,900}\}/g;
    while ((match = objectRe.exec(text))) {
      let parsed = null;
      try {
        parsed = JSON.parse(match[0]);
      } catch (e) {
        parsed = null;
      }
      const media = (parsed && parsed.m3u8) || match[1];
      const after = text.slice(match.index, match.index + match[0].length + 700);
      const windowText = text.slice(Math.max(0, match.index - 250), match.index + match[0].length + 700);
      pushVideo(videos, seen, {
        title: (parsed && parsed.title) || nearestTitle(after) || titleFromSlug(media),
        url: media,
        pageUrl: nearestArticle(after, pageUrl) || nearestArticle(windowText, pageUrl) || pageUrl,
        thumbnail: nearestThumb(windowText),
        publishedAt: dateFromMediaUrl(media),
        duration: parsed && parsed.dr,
        description: parsed && parsed.lead,
      });
    }
    const quoted = /m3u8\s*:\s*'(https?:[^']+\.m3u8)'/g;
    while ((match = quoted.exec(text))) {
      const after = text.slice(match.index, match.index + 650);
      const before = text.slice(Math.max(0, match.index - 500), match.index);
      const title = after.match(/title\s*:\s*"([^"]+)"/) || after.match(/\btitle\s*=\s*"([^"]{4,180})"/i);
      const page = before.match(/page_url\s*=\s*'([^']+)'/) || after.match(/page_url\s*=\s*'([^']+)'/);
      const thumb = before.match(/vThumbUrl\s*=\s*'([^']+)'/) || after.match(/vThumbUrl\s*=\s*'([^']+)'/);
      const duration = after.match(/\bdr\s*:\s*(\d+)/) || before.match(/\bdr\s*:\s*(\d+)/);
      pushVideo(videos, seen, {
        title: title ? title[1] : nearestTitle(after) || titleFromSlug(match[1]),
        url: match[1],
        pageUrl: page ? page[1] : nearestArticle(after, pageUrl) || pageUrl,
        thumbnail: thumb ? thumb[1] : nearestThumb(after),
        publishedAt: dateFromMediaUrl(match[1]),
        duration: duration ? Number(duration[1]) : null,
      });
    }
    const mediaRe = /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|webm|ogg|m3u8)(?:\?[^\s"'<>\\]*)?/gi;
    while ((match = mediaRe.exec(text))) {
      const media = match[0];
      if (/\/(?:ads?|qc|banner|pixel)\//i.test(media)) continue;
      const windowText = text.slice(Math.max(0, match.index - 500), match.index + 400);
      pushVideo(videos, seen, {
        title: nearestTitle(windowText) || titleFromSlug(media),
        url: media,
        pageUrl: nearestArticle(windowText, pageUrl) || pageUrl,
        thumbnail: nearestThumb(windowText),
        publishedAt: dateFromMediaUrl(media),
      });
    }
    const hrefRe = /(?:src|href)\s*=\s*"([^"]+)"/gi;
    while ((match = hrefRe.exec(text))) {
      const href = absoluteUrl(decodeEntities(match[1]), pageUrl);
      if (!href || !isKnownPlayer(href)) continue;
      const windowText = text.slice(Math.max(0, match.index - 300), match.index + 240);
      pushVideo(videos, seen, {
        title: nearestTitle(windowText) || titleFromSlug(href),
        url: href,
        pageUrl: pageUrl,
      });
    }
    return videos;
  }

  function extractPageVideos(text, pageUrl) {
    const raw = String(text || "");
    if (/<(rss|feed|item)\b/i.test(raw) && /<title\b/i.test(raw)) {
      const fromRss = extractRssVideos(raw, pageUrl);
      if (fromRss.length) return fromRss;
    }
    return extractHtmlVideos(raw, pageUrl);
  }

  function discoverFeeds(html, base) {
    const out = [];
    const tags = String(html || "").match(/<link\b[^>]*>/gi) || [];
    tags.forEach((tag) => {
      if (!/alternate/i.test(tag) || !/rss|atom|xml/i.test(tag)) return;
      const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!href) return;
      const abs = absoluteUrl(decodeEntities(href[1]), base);
      if (abs && out.indexOf(abs) === -1) out.push(abs);
    });
    return out;
  }

  function seedUrls(spec) {
    const out = [];
    const push = (value) => {
      const safe = safeHttpUrl(value);
      if (!safe || out.indexOf(safe) !== -1) return;
      out.push(safe);
    };
    if (!spec || !spec.url) return out;
    let url;
    try {
      url = new URL(spec.url);
    } catch (e) {
      return out;
    }
    const host = bareHost(url.hostname);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const videoish = /video/i.test(path) || host.indexOf("video.") === 0;
    if (host === "tuoitre.vn" && videoish) push("https://tuoitre.vn/rss/video.rss");
    if (host === "thanhnien.vn" && videoish) push("https://thanhnien.vn/video/rss.html");
    if (host === "vnexpress.net" || host === "video.vnexpress.net") {
      if (videoish || path === "/" || host === "video.vnexpress.net") push("https://video.vnexpress.net/");
    }
    if (host === "vtv.vn" && videoish) push("https://vtv.vn/video.htm");
    push(url.href);
    if (videoish) push(url.origin + "/rss/video.rss");
    if (out.length < 4) push(url.origin + "/feed");
    return out.slice(0, 4);
  }

  function videoFromAddress(url) {
    const safe = safeHttpUrl(url);
    if (!safe || !isPlayableUrl(safe)) return null;
    return makeVideo({
      title: titleFromSlug(safe),
      url: safe,
      pageUrl: isDirectMedia(safe) ? "" : safe,
      publishedAt: dateFromMediaUrl(safe),
      source: "site",
      author: siteName(domainOf(safe)),
      sourceLabel: siteName(domainOf(safe)),
      via: siteName(domainOf(safe)),
    });
  }

  function applyDateRestrict(videos, dateRestrict, now) {
    const after = publishedAfter(dateRestrict, now);
    if (!after) return videos || [];
    const min = Date.parse(after);
    return (videos || []).filter((video) => video && video.publishedAt && Date.parse(video.publishedAt) >= min);
  }

  function fromPlaylistItem(item) {
    const snippet = (item && item.snippet) || {};
    const id = (item && item.contentDetails && item.contentDetails.videoId) || (snippet.resourceId && snippet.resourceId.videoId);
    if (!id) return null;
    return makeVideo({
      youtubeId: id,
      title: snippet.title,
      description: snippet.description,
      thumbnail: bestThumb(snippet.thumbnails),
      author: snippet.channelTitle || snippet.videoOwnerChannelTitle,
      authorUrl: snippet.channelId ? "https://www.youtube.com/channel/" + snippet.channelId : "",
      publishedAt: (item.contentDetails && item.contentDetails.videoPublishedAt) || snippet.publishedAt,
      source: "youtube",
      sourceLabel: "YouTube",
    });
  }

return {
    ApiError: ApiError,
    messages: messages,
    noResultsMessage: noResultsMessage,
    cleanSecret: cleanSecret,
    readiness: readiness,
    stripHtml: stripHtml,
    safeHttpUrl: safeHttpUrl,
    parseDate: parseDate,
    parseIsoDuration: parseIsoDuration,
    formatDuration: formatDuration,
    formatViews: formatViews,
    timeAgo: timeAgo,
    publishedAfter: publishedAfter,
    bareHost: bareHost,
    youtubeIdFromUrl: youtubeIdFromUrl,
    classifyQuery: classifyQuery,
    googleQueryPlan: googleQueryPlan,
    wantsYouTubeApi: wantsYouTubeApi,
    domainOf: domainOf,
    extractVideos: extractVideos,
    normalizeUrl: normalizeUrl,
    dedupeVideos: dedupeVideos,
    sortVideos: sortVideos,
    mergeRecords: mergeRecords,
    filterGoogleForTarget: filterGoogleForTarget,
    buildEmbed: buildEmbed,
    siteName: siteName,
    isPlayableUrl: isPlayableUrl,
    titleFromSlug: titleFromSlug,
    dateFromMediaUrl: dateFromMediaUrl,
    extractPageVideos: extractPageVideos,
    discoverFeeds: discoverFeeds,
    seedUrls: seedUrls,
    videoFromAddress: videoFromAddress,
    applyDateRestrict: applyDateRestrict,
    mapHttpError: mapHttpError,
    fromYouTubeResource: fromYouTubeResource,
    fromSearchItem: fromSearchItem,
    fromPlaylistItem: fromPlaylistItem,
    makeVideo: makeVideo,
  };
});
