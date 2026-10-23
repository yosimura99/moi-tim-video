const test = require("node:test");
const assert = require("node:assert/strict");
const Api = require("../js/api");

const both = {
  googleApiKey: "google-key",
  searchEngineId: "cx-123",
  youtubeApiKey: "yt-key",
  shareGoogleKey: false,
};

function cse(items, next) {
  return {
    items: items,
    queries: next ? { nextPage: [{ startIndex: next }] } : {},
    searchInformation: { totalResults: String(items.length) },
  };
}

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

test("keyword search asks Google first and YouTube by date, newest first", async () => {
  const calls = [];
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    calls.push(url);
    const key = url.hostname + url.pathname;
    if (key === "www.googleapis.com/customsearch/v1") {
      assert.equal(url.searchParams.get("key"), "google-key");
      assert.equal(url.searchParams.get("cx"), "cx-123");
      assert.equal(url.searchParams.get("sort"), "date");
      assert.equal(url.searchParams.get("q"), "piano");
      return jsonResponse(cse([
        {
          title: "Vimeo mới",
          link: "https://vimeo.com/1234567",
          displayLink: "vimeo.com",
          snippet: "clip",
          pagemap: { metatags: [{ "og:type": "video.other", "og:video:release_date": "2026-10-23T07:30:00Z", "og:title": "Vimeo mới" }] },
        },
        {
          title: "Wikipedia",
          link: "https://vi.wikipedia.org/wiki/Piano",
          displayLink: "vi.wikipedia.org",
          snippet: "bài",
          pagemap: { metatags: [{ "og:type": "website" }] },
        },
        {
          title: "YouTube cũ hơn - YouTube",
          link: "https://www.youtube.com/watch?v=abcdefghijk",
          displayLink: "www.youtube.com",
          snippet: "video",
          pagemap: { videoobject: [{ name: "YouTube cũ hơn", url: "https://www.youtube.com/watch?v=abcdefghijk", datepublished: "2026-10-22T08:00:00Z" }] },
        },
        {
          title: "Clip 3",
          link: "https://vimeo.com/222",
          displayLink: "vimeo.com",
          snippet: "",
          pagemap: { metatags: [{ "og:type": "video", "og:title": "Clip 3", "article:published_time": "2026-10-21T00:00:00Z" }] },
        },
        {
          title: "Clip 4",
          link: "https://vimeo.com/333",
          displayLink: "vimeo.com",
          snippet: "",
          pagemap: { metatags: [{ "og:type": "video", "og:title": "Clip 4", "article:published_time": "2026-10-20T00:00:00Z" }] },
        },
      ], 11));
    }
    if (key === "www.googleapis.com/youtube/v3/search") {
      assert.equal(url.searchParams.get("order"), "date");
      assert.equal(url.searchParams.get("type"), "video");
      assert.equal(url.searchParams.get("q"), "piano");
      assert.equal(url.searchParams.get("key"), "yt-key");
      return jsonResponse({
        items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "YouTube cũ hơn", publishedAt: "2026-10-22T08:00:00Z", channelTitle: "Kênh Thử", channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", description: "đủ", thumbnails: { high: { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" } } } }],
        nextPageToken: "NEXT",
      });
    }
    if (key === "www.googleapis.com/youtube/v3/videos") {
      return jsonResponse({ items: [ytVideo("abcdefghijk", "2026-10-22T08:00:00Z", "YouTube cũ hơn")] });
    }
    throw new Error("Unexpected " + url.href);
  };
  const result = await Api.searchAll("piano", both, { fetch: fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.used.google, true);
  assert.equal(result.used.youtube, true);
  assert.equal(calls.filter((url) => url.pathname === "/customsearch/v1").length, 1);
  assert.equal(result.videos[0].title, "Vimeo mới");
  const merged = result.videos.find((video) => video.youtubeId === "abcdefghijk");
  assert.equal(merged.durationSec, 240);
  assert.equal(merged.views, 2500);
  assert.equal(merged.via, "YouTube");
  assert.equal(result.page.googleStart, 11);
  assert.equal(result.page.youtubeToken, "NEXT");
  assert.ok(result.videos.every((video, index) => index === 0 || !video.publishedAt || !result.videos[index - 1].publishedAt || Date.parse(video.publishedAt) <= Date.parse(result.videos[index - 1].publishedAt)));
});

test("retries Google without sort=date when the engine rejects it", async () => {
  let cseCalls = 0;
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/customsearch/v1") {
      cseCalls += 1;
      if (url.searchParams.get("sort") === "date") {
        return jsonResponse({ error: { message: "Invalid Value", errors: [{ reason: "invalid" }] } }, 400);
      }
      assert.equal(url.searchParams.get("sort"), null);
      return jsonResponse(cse([
        { title: "A", link: "https://vimeo.com/1", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "A" }] } },
        { title: "B", link: "https://vimeo.com/2", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "B" }] } },
        { title: "C", link: "https://vimeo.com/3", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "C" }] } },
        { title: "D", link: "https://vimeo.com/4", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "D" }] } },
      ]));
    }
    throw new Error("Unexpected " + url.href);
  };
  const result = await Api.searchAll("piano", { googleApiKey: "google-key", searchEngineId: "cx-123", shareGoogleKey: false }, { fetch: fetchImpl });
  assert.equal(cseCalls, 2);
  assert.equal(result.error, null);
  assert.equal(result.videos.length, 4);
});

test("supplements a web search that did not contain videos", async () => {
  const queries = [];
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    assert.equal(url.pathname, "/customsearch/v1");
    queries.push(url.searchParams.get("q"));
    if (queries.length === 1) {
      return jsonResponse(cse([{ title: "Bài", link: "https://example.com/a", displayLink: "example.com", snippet: "", pagemap: { metatags: [{ "og:type": "article" }] } }]));
    }
    return jsonResponse(cse([{
      title: "Clip",
      link: "https://www.youtube.com/watch?v=abcdefghijk",
      displayLink: "youtube.com",
      snippet: "",
      pagemap: { videoobject: [{ name: "Clip mới", url: "https://www.youtube.com/watch?v=abcdefghijk", datepublished: "2026-10-23T01:00:00Z" }] },
    }]));
  };
  const result = await Api.searchAll("mưa", { googleApiKey: "google-key", searchEngineId: "cx-123", shareGoogleKey: false }, { fetch: fetchImpl });
  assert.equal(queries.length, 2);
  assert.match(queries[1], /site:youtube\.com/);
  assert.equal(result.videos[0].title, "Clip mới");
  assert.equal(result.error, null);
});

test("website URL uses Google site search and does not call YouTube", async () => {
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    assert.equal(url.pathname, "/customsearch/v1");
    assert.equal(url.searchParams.get("siteSearch"), "vnexpress.net");
    assert.match(url.searchParams.get("q"), /video moi/);
    return jsonResponse(cse([
      { title: "A", link: "https://vimeo.com/11", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "Trên báo", "article:published_time": "2026-10-23T02:00:00Z" }] } },
      { title: "B", link: "https://vimeo.com/12", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "B" }] } },
      { title: "C", link: "https://vimeo.com/13", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "C" }] } },
      { title: "D", link: "https://vimeo.com/14", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "D" }] } },
    ]));
  };
  const result = await Api.searchAll("https://vnexpress.net/the-gioi/video-moi", both, { fetch: fetchImpl, dateRestrict: "w1", lang: "vi" });
  assert.equal(result.error, null);
  assert.equal(result.used.youtube, false);
  assert.equal(result.videos[0].title, "Trên báo");
});

test("YouTube channel URL lists newest uploads and keeps a shared Google key", async () => {
  const paths = [];
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    paths.push(url.pathname);
    assert.equal(url.searchParams.get("key"), "google-key");
    if (url.pathname === "/customsearch/v1") {
      assert.equal(url.searchParams.get("siteSearch"), "youtube.com");
      return jsonResponse(cse([
        { title: "Đúng", link: "https://www.youtube.com/watch?v=abcdefghijk", displayLink: "youtube.com", snippet: "", pagemap: { videoobject: [{ name: "Đúng", url: "https://www.youtube.com/watch?v=abcdefghijk" }] } },
        { title: "Nhiễu", link: "https://vimeo.com/555", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "Nhiễu" }] } },
      ]));
    }
    if (url.pathname === "/youtube/v3/channels") {
      assert.equal(url.searchParams.get("id"), "UCaaaaaaaaaaaaaaaaaaaaaa");
      return jsonResponse({ items: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", snippet: { title: "Kênh Thử" }, contentDetails: { relatedPlaylists: { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" } } }] });
    }
    if (url.pathname === "/youtube/v3/playlistItems") {
      assert.equal(url.searchParams.get("playlistId"), "UUaaaaaaaaaaaaaaaaaaaaaa");
      return jsonResponse({
        nextPageToken: "MORE",
        items: [{
          snippet: { title: "Bản mới", description: "mô tả", channelTitle: "Kênh Thử", publishedAt: "2026-10-23T03:00:00Z", resourceId: { videoId: "abcdefghijk" }, thumbnails: { high: { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" } } },
          contentDetails: { videoId: "abcdefghijk", videoPublishedAt: "2026-10-23T03:00:00Z" },
        }],
      });
    }
    if (url.pathname === "/youtube/v3/videos") {
      return jsonResponse({ items: [ytVideo("abcdefghijk", "2026-10-23T03:00:00Z", "Bản mới")] });
    }
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
  assert.ok(!paths.includes("/youtube/v3/search"));
});

test("missing, invalid, quota, and empty results stay in Vietnamese", async () => {
  const missing = await Api.searchAll("piano", {}, { fetch: async () => { throw new Error("should not fetch"); } });
  assert.equal(missing.error.code, "MISSING_KEY");
  assert.match(missing.error.message, /Cài đặt/);

  const site = await Api.searchAll("https://vnexpress.net", { youtubeApiKey: "yt-key", shareGoogleKey: false }, {
    fetch: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(site.error.code, "MISSING_KEY");
  assert.match(site.error.message, /trang web/);

  const quotaFetch = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/customsearch/v1") {
      return jsonResponse({ error: { message: "Quota exceeded", errors: [{ reason: "dailyLimitExceeded" }] } }, 429);
    }
    if (url.pathname === "/youtube/v3/search") {
      return jsonResponse({
        items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Còn YouTube", publishedAt: "2026-10-23T01:00:00Z", channelTitle: "Kênh", channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" } }],
      });
    }
    if (url.pathname === "/youtube/v3/videos") return jsonResponse({ items: [ytVideo("abcdefghijk", "2026-10-23T01:00:00Z", "Còn YouTube")] });
    throw new Error(url.href);
  };
  const partial = await Api.searchAll("piano", both, { fetch: quotaFetch });
  assert.equal(partial.error, null);
  assert.equal(partial.videos[0].title, "Còn YouTube");
  assert.match(partial.warnings.join(" "), /hạn mức/);

  const invalidFetch = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/youtube/v3/videos") return jsonResponse({ items: [] });
    return jsonResponse({ error: { message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }, 400);
  };
  const invalid = await Api.searchAll("piano", both, { fetch: invalidFetch });
  assert.equal(invalid.error.code, "INVALID_KEY");
  assert.match(invalid.error.message, /không hợp lệ/);

  const emptyFetch = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/customsearch/v1") return jsonResponse(cse([]));
    if (url.pathname === "/youtube/v3/search") return jsonResponse({ items: [] });
    throw new Error(url.href);
  };
  const empty = await Api.searchAll("khôngcógì", both, { fetch: emptyFetch });
  assert.equal(empty.error.code, "NO_RESULTS");
  assert.match(empty.error.message, /Không thấy video nào/);
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
  assert.equal(result.videos[0].via, "YouTube");
  assert.equal(result.used.oembed, true);
  assert.match(result.warnings[0], /oEmbed/);
});

test("date filter is sent to both sources", async () => {
  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    if (url.pathname === "/customsearch/v1") {
      assert.equal(url.searchParams.get("dateRestrict"), "d1");
      assert.equal(url.searchParams.get("lr"), "lang_vi");
      return jsonResponse(cse([
        { title: "A", link: "https://vimeo.com/1", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "A" }] } },
        { title: "B", link: "https://vimeo.com/2", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "B" }] } },
        { title: "C", link: "https://vimeo.com/3", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "C" }] } },
        { title: "D", link: "https://vimeo.com/4", displayLink: "vimeo.com", snippet: "", pagemap: { metatags: [{ "og:type": "video", "og:title": "D" }] } },
      ]));
    }
    if (url.pathname === "/youtube/v3/search") {
      assert.equal(url.searchParams.get("relevanceLanguage"), "vi");
      const published = Date.parse(url.searchParams.get("publishedAfter"));
      assert.ok(Date.now() - published > 20 * 3600000 && Date.now() - published < 28 * 3600000);
      return jsonResponse({ items: [] });
    }
    throw new Error(url.href);
  };
  const result = await Api.searchAll("piano", both, { fetch: fetchImpl, dateRestrict: "d1", lang: "vi" });
  assert.equal(result.error, null);
});

function jsonResponse(body, status) {
  const code = status || 200;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => body,
  };
}
