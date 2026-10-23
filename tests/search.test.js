const test = require("node:test");
const assert = require("node:assert/strict");
const Api = require("../js/api");

const ytKey = { youtubeApiKey: "yt-key", shareGoogleKey: false };

function ytVideo(id, publishedAt, title) {
  return {
    id: id,
    snippet: {
      title: title,
      description: "Mô tả " + title,
      channelTitle: "Kênh Thử",
      channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
      publishedAt: publishedAt,
      thumbnails: { high: { url: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" } },
    },
    contentDetails: { duration: "PT4M" },
    statistics: { viewCount: "2500" },
    status: { embeddable: true },
  };
}

function jsonResponse(body, status) {
  const code = status || 200;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => text,
  };
}

test("keyword search uses YouTube by date and skips Custom Search", async () => {
  const calls = [];
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    calls.push(url.hostname + url.pathname);
    if (url.pathname === "/youtube/v3/search") {
      assert.equal(url.searchParams.get("order"), "date");
      assert.equal(url.searchParams.get("type"), "video");
      assert.equal(url.searchParams.get("q"), "piano");
      assert.equal(url.searchParams.get("key"), "yt-key");
      return jsonResponse({
        items: [{
          id: { videoId: "abcdefghijk" },
          snippet: {
            title: "Piano mới",
            publishedAt: "2026-10-23T08:00:00Z",
            channelTitle: "Kênh Thử",
            channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
            description: "đủ",
            thumbnails: { high: { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" } },
          },
        }],
        nextPageToken: "NEXT",
      });
    }
    if (url.pathname === "/youtube/v3/videos") {
      return jsonResponse({ items: [ytVideo("abcdefghijk", "2026-10-23T08:00:00Z", "Piano mới")] });
    }
    throw new Error("Unexpected " + url.href);
  };
  const result = await Api.searchAll("piano", ytKey, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.used.youtube, true);
  assert.equal(result.used.google, false);
  assert.equal(result.videos[0].title, "Piano mới");
  assert.equal(result.videos[0].durationSec, 240);
  assert.equal(result.videos[0].views, 2500);
  assert.equal(result.page.youtubeToken, "NEXT");
  assert.ok(!calls.some((call) => call.indexOf("customsearch") !== -1));
});

test("keyword without a key uses the open source, newest first", async () => {
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    assert.equal(url.hostname, "api.piped.private.coffee");
    assert.equal(url.searchParams.get("filter"), "videos");
    assert.equal(url.searchParams.get("q"), "bản tin");
    return jsonResponse([
      { type: "stream", url: "/watch?v=bbbccccdddd", title: "Bản cũ", uploaded: Date.parse("2026-10-22T08:00:00Z"), duration: 30, views: 3, uploaderName: "VTV" },
      { type: "stream", url: "/watch?v=abcdefghijk", title: "Bản mới", uploaded: Date.parse("2026-10-23T08:00:00Z"), duration: 90, views: 12, uploaderName: "VTV", shortDescription: "tin" },
    ]);
  };
  const result = await Api.searchAll("bản tin", {}, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.used.piped, true);
  assert.equal(result.used.youtube, false);
  assert.equal(result.videos[0].title, "Bản mới");
  assert.equal(result.videos[0].youtubeId, "abcdefghijk");
  assert.equal(result.videos[0].durationSec, 90);
  assert.match(result.warnings.join(" "), /nguồn mở/);
});

test("a YouTube quota error falls back to the open source", async () => {
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/youtube/v3/search") {
      return jsonResponse({ error: { message: "Quota exceeded", errors: [{ reason: "dailyLimitExceeded" }] } }, 429);
    }
    if (url.hostname === "api.piped.private.coffee") {
      return jsonResponse([{ type: "stream", url: "/watch?v=abcdefghijk", title: "Còn nguồn mở", uploaded: Date.parse("2026-10-23T01:00:00Z"), duration: 10, uploaderName: "Kênh" }]);
    }
    throw new Error(url.href);
  };
  const result = await Api.searchAll("piano", ytKey, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.videos[0].title, "Còn nguồn mở");
  assert.match(result.warnings.join(" "), /hạn mức/);
});

test("an invalid YouTube key is reported and does not call the open source", async () => {
  let open = false;
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    if (url.hostname.indexOf("piped") !== -1) open = true;
    return jsonResponse({ error: { message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }, 400);
  };
  const result = await Api.searchAll("piano", ytKey, { fetch: fetchImpl });
  assert.equal(open, false);
  assert.equal(result.error.code, "INVALID_KEY");
  assert.match(result.error.message, /không hợp lệ/);
});

test("a news page is read without Custom Search and sorted newest first", async () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Video</title>
    <item><title><![CDATA[Bản cũ]]></title><link><![CDATA[https://tuoitre.vn/video/cu.htm]]></link>
      <pubDate>10/22/2026 1:00:00 PM</pubDate>
      <media:content url="https://cdn.example.com/cu.mp4" type="video/mp4" duration="40" />
      <media:thumbnail>https://cdn.example.com/cu.jpg</media:thumbnail></item>
    <item><title><![CDATA[Bản mới]]></title><link><![CDATA[https://tuoitre.vn/video/moi.htm]]></link>
      <pubDate>10/23/2026 3:30:00\u202fPM</pubDate>
      <media:content url="https://cdn.example.com/moi.mp4" type="video/mp4" duration="101" />
      <media:thumbnail>https://cdn.example.com/moi.jpg</media:thumbnail>
      <description><![CDATA[Mô tả ngắn]]></description></item>
  </channel></rss>`;
  const calls = [];
  const fetchImpl = async (raw) => {
    calls.push(String(raw));
    assert.equal(raw, "https://tuoitre.vn/rss/video.rss");
    return jsonResponse(rss);
  };
  const result = await Api.searchAll("https://tuoitre.vn/video.htm", {}, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.used.site, true);
  assert.equal(result.used.google, false);
  assert.equal(result.videos[0].title, "Bản mới");
  assert.equal(result.videos[0].url, "https://cdn.example.com/moi.mp4");
  assert.equal(result.videos[0].durationSec, 101);
  assert.equal(result.videos[0].thumbnail, "https://cdn.example.com/moi.jpg");
  assert.equal(result.videos[0].pageUrl, "https://tuoitre.vn/video/moi.htm");
  assert.equal(result.videos[1].title, "Bản cũ");
  assert.deepEqual(calls, ["https://tuoitre.vn/rss/video.rss"]);
});

test("vnexpress.net/video reads the video homepage and keeps playable streams", async () => {
  const html = `<html><head><title>Video</title></head><body>
    <article>{"direct":1,"m3u8":"https://d1.vnecdn.net/vnexpress/video/video/web/mp4/,240p,,/2026/10/20/clip-cu-1792458086/vne/master.m3u8","dr":12}
      <a href="https://video.vnexpress.net/clip-cu-1.html" title="Clip cũ">Clip cũ</a></article>
    <script>VideoVNE.page_url='https://video.vnexpress.net/clip-moi.html';VideoVNE.config_play={m3u8:'https://d1.vnecdn.net/vnexpress/video/video/web/mp4/,240p,360p,,/2026/10/23/clip-moi-1792729838/vne/master.m3u8',dr:38,title:"Clip mới"}</script>
    </body></html>`;
  const calls = [];
  const fetchImpl = async (raw) => {
    calls.push(String(raw));
    if (raw === "https://video.vnexpress.net/") return jsonResponse(html);
    throw new Error("should stop after the video homepage " + raw);
  };
  const result = await Api.searchAll("https://vnexpress.net/video", { youtubeApiKey: "yt-key" }, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.used.youtube, false);
  assert.equal(result.videos[0].title, "Clip mới");
  assert.match(result.videos[0].url, /\.m3u8$/);
  assert.equal(result.videos[0].pageUrl, "https://video.vnexpress.net/clip-moi.html");
  assert.equal(result.videos[1].title, "Clip cũ");
  assert.ok(Date.parse(result.videos[0].publishedAt) > Date.parse(result.videos[1].publishedAt));
  assert.deepEqual(calls, ["https://video.vnexpress.net/"]);
});

test("a page blocked directly is read through the reader", async () => {
  let reader = false;
  const fetchImpl = async (raw) => {
    if (String(raw).indexOf("https://r.jina.ai/") === 0) {
      reader = true;
      assert.match(raw, /example\.com\/watch/);
      return jsonResponse(`<html><head><link rel="alternate" type="application/rss+xml" href="https://example.com/feed"></head>
        <iframe src="https://www.youtube.com/embed/abcdefghijk" title="Bản nhúng"></iframe></html>`);
    }
    return jsonResponse("406 Not Acceptable", 406);
  };
  const result = await Api.searchAll("https://example.com/watch", {}, { fetch: fetchImpl });
  assert.equal(reader, true);
  assert.equal(result.error, null);
  assert.equal(result.videos[0].youtubeId, "abcdefghijk");
  assert.equal(result.videos[0].title, "Bản nhúng");
});

test("YouTube channel URL lists newest uploads from a shared key", async () => {
  const paths = [];
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    paths.push(url.pathname);
    assert.equal(url.searchParams.get("key"), "google-key");
    if (url.pathname === "/youtube/v3/channels") {
      return jsonResponse({ items: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", snippet: { title: "Kênh Thử" }, contentDetails: { relatedPlaylists: { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" } } }] });
    }
    if (url.pathname === "/youtube/v3/playlistItems") {
      return jsonResponse({
        nextPageToken: "MORE",
        items: [{
          snippet: { title: "Bản mới", description: "mô tả", channelTitle: "Kênh Thử", publishedAt: "2026-10-23T03:00:00Z", resourceId: { videoId: "abcdefghijk" }, thumbnails: { high: { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" } } },
          contentDetails: { videoId: "abcdefghijk", videoPublishedAt: "2026-10-23T03:00:00Z" },
        }],
      });
    }
    if (url.pathname === "/youtube/v3/videos") return jsonResponse({ items: [ytVideo("abcdefghijk", "2026-10-23T03:00:00Z", "Bản mới")] });
    throw new Error(url.href);
  };
  const result = await Api.searchAll("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa", {
    googleApiKey: "google-key",
    searchEngineId: "cx-123",
    shareGoogleKey: true,
  }, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.deepEqual(result.videos.map((video) => video.title), ["Bản mới"]);
  assert.equal(result.page.playlistToken, "MORE");
  assert.ok(paths.includes("/youtube/v3/playlistItems"));
  assert.ok(!paths.some((path) => path.indexOf("customsearch") !== -1));
});

test("a channel URL without a key asks for the YouTube API", async () => {
  let called = false;
  const result = await Api.searchAll("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa", {}, {
    fetch: async () => {
      called = true;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, false);
  assert.equal(result.error.code, "MISSING_KEY");
  assert.match(result.error.message, /YouTube Data API/);
});

test("a single YouTube URL can fall back to oEmbed", async () => {
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    assert.equal(url.pathname, "/oembed");
    return jsonResponse({ title: "Một video", author_name: "Tác giả", author_url: "https://www.youtube.com/@tacgia", thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" });
  };
  const result = await Api.searchAll("https://youtu.be/abcdefghijk", {}, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.videos[0].title, "Một video");
  assert.equal(result.videos[0].youtubeId, "abcdefghijk");
  assert.equal(result.used.oembed, true);
  assert.match(result.warnings[0], /oEmbed/);
});

test("date filter is sent to YouTube and applied to an open result", async () => {
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/youtube/v3/search") {
      assert.equal(url.searchParams.get("relevanceLanguage"), "vi");
      const published = Date.parse(url.searchParams.get("publishedAfter"));
      assert.ok(Date.now() - published > 20 * 3600000 && Date.now() - published < 28 * 3600000);
      return jsonResponse({ items: [] });
    }
    if (url.pathname === "/youtube/v3/videos") return jsonResponse({ items: [] });
    throw new Error(url.href);
  };
  const keyed = await Api.searchAll("piano", ytKey, { fetch: fetchImpl, dateRestrict: "d1", lang: "vi" });
  assert.equal(keyed.error.code, "NO_RESULTS");

  const openFetch = async () => jsonResponse([
    { type: "stream", url: "/watch?v=abcdefghijk", title: "Hôm nay", uploaded: Date.now() - 3600000, duration: 10, uploaderName: "Kênh" },
    { type: "stream", url: "/watch?v=bbbccccdddd", title: "Tháng trước", uploaded: Date.now() - 40 * 86400000, duration: 10, uploaderName: "Kênh" },
  ]);
  const open = await Api.searchAll("piano", {}, { fetch: openFetch, dateRestrict: "d1" });
  assert.equal(open.error, null);
  assert.deepEqual(open.videos.map((video) => video.title), ["Hôm nay"]);
});

test("an unreadable site explains the failure in Vietnamese", async () => {
  const result = await Api.searchAll("https://example.com/no-video", {}, {
    fetch: async () => jsonResponse("406 Not Acceptable", 406),
  });
  assert.equal(result.error.code, "NETWORK");
  assert.match(result.error.message, /Không đọc được trang/);
});
