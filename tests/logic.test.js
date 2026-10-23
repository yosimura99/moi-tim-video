const test = require("node:test");
const assert = require("node:assert/strict");
const Logic = require("../js/logic");

test("timeAgo uses Vietnamese relative time", () => {
  const now = Date.parse("2026-10-23T08:00:00Z");
  assert.equal(Logic.timeAgo("2026-10-23T07:59:40Z", now), "vừa xong");
  assert.equal(Logic.timeAgo("2026-10-23T07:58:00Z", now), "2 phút trước");
  assert.equal(Logic.timeAgo("2026-10-23T06:00:00Z", now), "2 giờ trước");
  assert.equal(Logic.timeAgo("2026-10-22T08:00:00Z", now), "1 ngày trước");
  assert.equal(Logic.timeAgo(null, now), "Chưa rõ thời điểm");
});

test("duration and view counts", () => {
  assert.equal(Logic.parseIsoDuration("PT10M2S"), 602);
  assert.equal(Logic.formatDuration(602), "10:02");
  assert.equal(Logic.formatDuration(Logic.parseIsoDuration("PT1H2M3S")), "1:02:03");
  assert.equal(Logic.formatDuration(45), "0:45");
  assert.equal(Logic.formatViews(999), "999 lượt xem");
  assert.equal(Logic.formatViews(1200), "1,2 N lượt xem");
  assert.equal(Logic.formatViews(1500000), "1,5 Tr lượt xem");
});

test("classifies keywords, sites, and YouTube URLs", () => {
  assert.equal(Logic.classifyQuery("bản tin thời sự").kind, "keyword");
  assert.equal(Logic.classifyQuery("user@gmail.com").kind, "keyword");
  assert.equal(Logic.classifyQuery("tin.vn là gì").kind, "keyword");

  const site = Logic.classifyQuery("https://vnexpress.net/the-gioi/video-moi");
  assert.equal(site.kind, "site");
  assert.equal(site.siteSearch, "vnexpress.net");
  assert.equal(site.query, "the gioi video moi");

  const home = Logic.classifyQuery("vnexpress.net");
  assert.equal(home.kind, "site");
  assert.equal(home.query, "site:vnexpress.net");

  const video = Logic.classifyQuery("https://youtu.be/abcdefghijk");
  assert.equal(video.kind, "youtube-video");
  assert.equal(video.youtubeId, "abcdefghijk");

  const shorts = Logic.classifyQuery("https://www.youtube.com/shorts/abcdefghijk");
  assert.equal(shorts.kind, "youtube-video");

  const channel = Logic.classifyQuery("https://www.youtube.com/@VTV24/videos");
  assert.equal(channel.kind, "youtube-channel");
  assert.equal(channel.handle, "VTV24");

  const playlist = Logic.classifyQuery("https://www.youtube.com/playlist?list=PLtest123");
  assert.equal(playlist.kind, "youtube-playlist");
  assert.equal(playlist.playlistId, "PLtest123");

  assert.equal(Logic.classifyQuery("https://m.youtube.com/watch?v=abcdefghijk").kind, "youtube-video");
  assert.equal(Logic.classifyQuery("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa").channelId, "UCaaaaaaaaaaaaaaaaaaaaaa");
});

test("google plan searches the open web, then video sites", () => {
  const plan = Logic.googleQueryPlan(Logic.classifyQuery("piano"));
  assert.equal(plan.primary.q, "piano");
  assert.match(plan.supplement.q, /site:youtube\.com/);
  const site = Logic.googleQueryPlan(Logic.classifyQuery("https://tuoitre.vn/"));
  assert.equal(site.primary.q, "site:tuoitre.vn");
});

test("extracts videos and skips ordinary pages", () => {
  const videos = Logic.extractVideos([
    {
      title: "Bản tin tối - YouTube",
      link: "https://www.youtube.com/watch?v=abcdefghijk",
      displayLink: "www.youtube.com",
      snippet: "Kênh VTV",
      pagemap: {
        videoobject: [{
          name: "Bản tin tối",
          description: "Tin tức",
          thumbnailurl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
          datepublished: "2026-10-22T12:00:00Z",
          duration: "PT10M2S",
          author: "VTV",
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          interactioncount: "1200",
        }],
      },
    },
    {
      title: "Wikipedia",
      link: "https://vi.wikipedia.org/wiki/Foo",
      displayLink: "vi.wikipedia.org",
      snippet: "Bài",
      pagemap: { metatags: [{ "og:type": "website" }] },
    },
    {
      title: "Tệp thô",
      link: "https://cdn.example.com/a.mp4",
      displayLink: "cdn.example.com",
      snippet: "",
      pagemap: {},
    },
    {
      title: "Bài có clip",
      link: "https://example.com/bai",
      displayLink: "example.com",
      snippet: "nhúng",
      pagemap: {
        videoobject: [{
          name: "Clip nhúng",
          embedurl: "https://www.youtube.com/embed/bbbccccdddd",
          datepublished: "2026-10-21",
          duration: "PT3M",
        }],
      },
    },
  ]);
  assert.equal(videos.length, 3);
  assert.equal(videos[0].youtubeId, "abcdefghijk");
  assert.equal(videos[0].author, "VTV");
  assert.equal(videos[0].durationSec, 602);
  assert.equal(videos[0].views, 1200);
  assert.equal(videos[0].title, "Bản tin tối");
  assert.equal(videos[1].url, "https://cdn.example.com/a.mp4");
  assert.equal(videos[2].youtubeId, "bbbccccdddd");
});

test("dedupes YouTube and sorts newest first", () => {
  const merged = Logic.dedupeVideos([
    Logic.makeVideo({
      title: "Từ Google",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      author: "YouTube",
      publishedAt: "2026-10-23T07:00:00Z",
      source: "google",
    }),
    Logic.makeVideo({
      title: "Từ YouTube",
      url: "https://www.youtube.com/watch?v=abcdefghijk&feature=share",
      author: "Kênh Thật",
      publishedAt: "2026-10-23T07:00:00Z",
      duration: "PT2M",
      views: 10,
      source: "youtube",
    }),
    Logic.makeVideo({
      title: "Vimeo mới hơn",
      url: "https://vimeo.com/123456",
      publishedAt: "2026-10-23T09:00:00Z",
      source: "google",
    }),
    Logic.makeVideo({
      title: "Không ngày",
      url: "https://cdn.example.com/b.mp4",
      source: "google",
    }),
  ]);
  const sorted = Logic.sortVideos(merged);
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].title, "Vimeo mới hơn");
  assert.equal(sorted[1].title, "Từ YouTube");
  assert.equal(sorted[1].author, "Kênh Thật");
  assert.equal(sorted[1].durationSec, 120);
  assert.equal(sorted[1].via, "YouTube");
  assert.equal(sorted[2].title, "Không ngày");
});

test("embed uses the YouTube player, not the watch page", () => {
  const embed = Logic.buildEmbed({
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    youtubeId: "abcdefghijk",
  }, "localhost");
  assert.equal(embed.type, "iframe");
  assert.match(embed.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk/);
  const blocked = Logic.buildEmbed({
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    youtubeId: "abcdefghijk",
    embeddable: false,
  }, "localhost");
  assert.equal(blocked.type, "external");
  assert.equal(blocked.reason, "noembed");
  const page = Logic.buildEmbed({ url: "https://example.com/story" }, "localhost");
  assert.equal(page.type, "external");
  const file = Logic.buildEmbed({ url: "https://cdn.example.com/a.mp4" }, "localhost");
  assert.equal(file.type, "file");
  const hls = Logic.buildEmbed({ url: "https://cdn.example.com/master.m3u8" }, "localhost");
  assert.equal(hls.type, "hls");
  assert.match(hls.src, /master\.m3u8$/);
});

test("maps Google errors to Vietnamese messages", () => {
  const quota = Logic.mapHttpError(403, { error: { message: "quota exceeded", errors: [{ reason: "quotaExceeded" }] } }, "google");
  assert.equal(quota.code, "QUOTA");
  assert.match(quota.message, /hạn mức/);
  const invalid = Logic.mapHttpError(400, { error: { message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }, "youtube");
  assert.equal(invalid.code, "INVALID_KEY");
  const off = Logic.mapHttpError(403, { error: { message: "YouTube Data API v3 has not been used in project", errors: [{ reason: "accessNotConfigured" }] } }, "youtube");
  assert.equal(off.code, "NOT_ENABLED");
  assert.match(off.message, /YouTube Data API v3/);
  const network = Logic.mapHttpError(0, null, "google");
  assert.equal(network.code, "NETWORK");
});

test("filters channel noise but keeps known uploads", () => {
  const spec = Logic.classifyQuery("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa");
  const kept = Logic.makeVideo({ title: "Đúng kênh", url: "https://www.youtube.com/watch?v=abcdefghijk", source: "google" });
  const noise = Logic.makeVideo({ title: "Khác hẳn", url: "https://vimeo.com/999", source: "google" });
  const filtered = Logic.filterGoogleForTarget([kept, noise], spec, { id: spec.channelId, title: "Kênh Thử" }, new Set(["abcdefghijk"]));
  assert.deepEqual(filtered.map((video) => video.title), ["Đúng kênh"]);
});

test("publishedAfter and shared keys", () => {
  const iso = Logic.publishedAfter("d1", Date.parse("2026-10-23T08:00:00Z"));
  assert.equal(iso, "2026-10-22T08:00:00.000Z");
  const ready = Logic.readiness({ googleApiKey: " abc ", searchEngineId: "cx", shareGoogleKey: true, youtubeApiKey: "" });
  assert.equal(ready.googleApiKey, "abc");
  assert.equal(ready.youtube, true);
  assert.equal(ready.youtubeApiKey, "abc");
  const own = Logic.readiness({ googleApiKey: "abc", youtubeApiKey: "yt", shareGoogleKey: true });
  assert.equal(own.youtubeApiKey, "yt");
});

test("reads RSS and embedded streams, newest page first", () => {
  const rss = `<rss><channel><title>V</title><item><title><![CDATA[Một clip]]></title><link>https://tuoitre.vn/video/a.htm</link><pubDate>10/23/2026 3:30:00 PM</pubDate><media:content url="https://cdn.example.com/a.mp4" type="video/mp4" duration="15"/><media:thumbnail>https://cdn.example.com/a.jpg</media:thumbnail></item></channel></rss>`;
  const videos = Logic.extractPageVideos(rss, "https://tuoitre.vn/rss/video.rss");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].title, "Một clip");
  assert.equal(videos[0].url, "https://cdn.example.com/a.mp4");
  assert.ok(videos[0].publishedAt);

  const html = `<html><a href="https://www.youtube.com/watch?v=abcdefghijk" title="YouTube nhúng">x</a>
    <script type="application/ld+json">{"@type":"VideoObject","name":"JSON clip","contentUrl":"https://cdn.example.com/b.mp4","uploadDate":"2026-10-21"}</script></html>`;
  const embedded = Logic.extractPageVideos(html, "https://example.com/v");
  assert.equal(embedded.find((video) => video.youtubeId === "abcdefghijk").title, "YouTube nhúng");
  assert.equal(embedded.find((video) => video.url.indexOf("b.mp4") !== -1).title, "JSON clip");

  const seeds = Logic.seedUrls(Logic.classifyQuery("https://vnexpress.net/video"));
  assert.equal(seeds[0], "https://video.vnexpress.net/");
  const tuoi = Logic.seedUrls(Logic.classifyQuery("https://tuoitre.vn/video.htm"));
  assert.equal(tuoi[0], "https://tuoitre.vn/rss/video.rss");
});
