(function (root, factory) {
  const logic = typeof module === "object" && module.exports ? require("./logic") : root.MoiLogic;
  const api = factory(logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MoiApi = api;
})(typeof self !== "undefined" ? self : this, function (Logic) {
  const LABELS = { google: "Google", youtube: "YouTube", oembed: "YouTube" };

  function withSource(error, source) {
    if (error && typeof error === "object") error.source = error.source || source;
    return error;
  }

  async function getJson(url, fetchImpl, source) {
    let response;
    try {
      const init = { headers: { accept: "application/json" } };
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        init.signal = AbortSignal.timeout(20000);
      }
      response = await fetchImpl(String(url), init);
    } catch (error) {
      if (error && error.name === "TimeoutError") throw new Logic.ApiError("NETWORK", Logic.messages.timeout, source);
      throw new Logic.ApiError("NETWORK", Logic.messages.network, source);
    }
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok) throw withSource(Logic.mapHttpError(response.status, body, source), source);
    return body || {};
  }

  function googleUrl(ready, params) {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", ready.googleApiKey);
    url.searchParams.set("cx", ready.searchEngineId);
    url.searchParams.set("q", params.q);
    url.searchParams.set("num", String(params.num || 10));
    url.searchParams.set("hl", "vi");
    if (params.start) url.searchParams.set("start", String(params.start));
    if (params.sort) url.searchParams.set("sort", params.sort);
    if (params.dateRestrict) url.searchParams.set("dateRestrict", params.dateRestrict);
    if (params.lr) url.searchParams.set("lr", params.lr);
    if (params.siteSearch) {
      url.searchParams.set("siteSearch", params.siteSearch);
      url.searchParams.set("siteSearchFilter", "i");
    }
    return url;
  }

  async function cseList(ready, params, fetchImpl, allowSortRetry) {
    const body = await getJson(googleUrl(ready, params), fetchImpl, "google");
    return {
      items: body.items || [],
      nextStart: (body.queries && body.queries.nextPage && body.queries.nextPage[0] && body.queries.nextPage[0].startIndex) || null,
    };
  }

  async function cseListSafe(ready, params, fetchImpl) {
    try {
      return await cseList(ready, params, fetchImpl, true);
    } catch (error) {
      if (params.sort && error && error.code === "BAD_REQUEST") {
        const next = Object.assign({}, params);
        delete next.sort;
        return cseList(ready, next, fetchImpl, false);
      }
      throw error;
    }
  }

  function ytUrl(endpoint, params, key) {
    const url = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
    Object.keys(params).forEach((name) => {
      if (params[name] != null && params[name] !== "") url.searchParams.set(name, String(params[name]));
    });
    url.searchParams.set("key", key);
    return url;
  }

  async function ytGet(endpoint, key, params, fetchImpl) {
    return getJson(ytUrl(endpoint, params, key), fetchImpl, "youtube");
  }

  async function hydrateYouTube(key, videos, fetchImpl) {
    const ids = videos.map((video) => video.youtubeId).filter(Boolean);
    if (!ids.length) return videos;
    try {
      const body = await ytGet(
        "videos",
        key,
        { part: "snippet,contentDetails,statistics,status", id: ids.join(","), maxResults: String(ids.length) },
        fetchImpl
      );
      const rich = new Map();
      (body.items || []).forEach((item) => {
        const video = Logic.fromYouTubeResource(item);
        if (video) rich.set(video.youtubeId, video);
      });
      return videos.map((video) => rich.get(video.youtubeId) || video);
    } catch (error) {
      return videos;
    }
  }

  async function getChannel(key, params, fetchImpl) {
    const body = await ytGet("channels", key, Object.assign({ part: "snippet,contentDetails" }, params), fetchImpl);
    const item = (body.items || [])[0];
    if (!item) return null;
    return {
      id: item.id,
      title: item.snippet && item.snippet.title,
      uploads: item.contentDetails && item.contentDetails.relatedPlaylists && item.contentDetails.relatedPlaylists.uploads,
    };
  }

  async function searchChannel(key, query, fetchImpl) {
    const body = await ytGet(
      "search",
      key,
      { part: "snippet", type: "channel", q: query, maxResults: "1" },
      fetchImpl
    );
    const id = body.items && body.items[0] && body.items[0].id && body.items[0].id.channelId;
    if (!id) return null;
    return getChannel(key, { id: id }, fetchImpl);
  }

  async function resolveChannel(key, spec, fetchImpl) {
    if (spec.channelId) return getChannel(key, { id: spec.channelId }, fetchImpl);
    if (spec.handle) {
      try {
        const found = await getChannel(key, { forHandle: spec.handle }, fetchImpl);
        if (found) return found;
      } catch (error) {
        if (error.code !== "BAD_REQUEST") throw error;
      }
      return searchChannel(key, spec.handle, fetchImpl);
    }
    if (spec.username) {
      try {
        const found = await getChannel(key, { forUsername: spec.username }, fetchImpl);
        if (found) return found;
      } catch (error) {
        if (error.code !== "BAD_REQUEST") throw error;
      }
      return searchChannel(key, spec.username, fetchImpl);
    }
    if (spec.customName) return searchChannel(key, spec.customName, fetchImpl);
    return null;
  }

  async function playlistVideos(key, playlistId, pageToken, fetchImpl) {
    const body = await ytGet(
      "playlistItems",
      key,
      { part: "snippet,contentDetails", playlistId: playlistId, maxResults: "12", pageToken: pageToken || "" },
      fetchImpl
    );
    const videos = (body.items || []).map(Logic.fromPlaylistItem).filter(Boolean);
    return {
      videos: await hydrateYouTube(key, videos, fetchImpl),
      token: videos.length ? body.nextPageToken || null : null,
      playlistId: playlistId,
    };
  }

  async function searchYouTubeKeyword(key, spec, options, pageToken, fetchImpl) {
    const body = await ytGet(
      "search",
      key,
      {
        part: "snippet",
        type: "video",
        order: "date",
        maxResults: "12",
        q: spec.kind === "keyword" ? spec.query : spec.raw || spec.query,
        pageToken: pageToken || "",
        publishedAfter: Logic.publishedAfter(options.dateRestrict),
        relevanceLanguage: options.lang === "vi" ? "vi" : "",
      },
      fetchImpl
    );
    const videos = (body.items || []).map(Logic.fromSearchItem).filter(Boolean);
    return {
      videos: await hydrateYouTube(key, videos, fetchImpl),
      token: videos.length ? body.nextPageToken || null : null,
    };
  }

  async function searchYouTubeVideo(key, spec, fetchImpl) {
    const body = await ytGet(
      "videos",
      key,
      { part: "snippet,contentDetails,statistics,status", id: spec.youtubeId },
      fetchImpl
    );
    const video = Logic.fromYouTubeResource((body.items || [])[0]);
    if (!video) throw new Logic.ApiError("NO_RESULTS", Logic.messages.noVideo, "youtube");
    const channelId = body.items[0].snippet && body.items[0].snippet.channelId;
    let more = [];
    let playlistId = "";
    let token = null;
    if (channelId) {
      const channel = await getChannel(key, { id: channelId }, fetchImpl);
      if (channel && channel.uploads) {
        const page = await playlistVideos(key, channel.uploads, "", fetchImpl);
        more = page.videos;
        playlistId = page.playlistId;
        token = page.token;
      }
    }
    return { videos: [video].concat(more), token: token, playlistId: playlistId, channel: null };
  }

  async function searchYouTube(ready, spec, options, fetchImpl) {
    const key = ready.youtubeApiKey;
    const page = options.page;
    if (page && page.playlistId && page.playlistToken) {
      return playlistVideos(key, page.playlistId, page.playlistToken, fetchImpl);
    }
    if (spec.kind === "keyword" || (page && page.youtubeToken)) {
      const found = await searchYouTubeKeyword(key, spec, options, page && page.youtubeToken, fetchImpl);
      return { videos: found.videos, token: null, playlistId: null, youtubeToken: found.token, channel: null };
    }
    if (spec.kind === "youtube-playlist") {
      const pageResult = await playlistVideos(key, spec.playlistId, "", fetchImpl);
      return { videos: pageResult.videos, token: pageResult.token, playlistId: pageResult.playlistId, channel: null };
    }
    if (spec.kind === "youtube-video") return searchYouTubeVideo(key, spec, fetchImpl);
    if (spec.kind === "youtube-channel") {
      const channel = await resolveChannel(key, spec, fetchImpl);
      if (!channel) throw new Logic.ApiError("NO_RESULTS", Logic.messages.noChannel, "youtube");
      if (!channel.uploads) throw new Logic.ApiError("NO_RESULTS", Logic.messages.noUploads, "youtube");
      const pageResult = await playlistVideos(key, channel.uploads, "", fetchImpl);
      return { videos: pageResult.videos, token: pageResult.token, playlistId: pageResult.playlistId, channel: channel };
    }
    return { videos: [], token: null, playlistId: null, channel: null };
  }

  async function searchGoogle(ready, spec, options, fetchImpl) {
    const plan = Logic.googleQueryPlan(spec);
    const start = (options.page && options.page.googleStart) || 1;
    const common = {
      dateRestrict: options.dateRestrict || "",
      lr: options.lang === "vi" ? "lang_vi" : "",
      num: 10,
      sort: "date",
    };
    const primary = await cseListSafe(
      ready,
      Object.assign({}, common, plan.primary, { start: start }),
      fetchImpl
    );
    let videos = Logic.extractVideos(primary.items);
    const warnings = [];
    const firstPage = !options.page || !options.page.googleStart || options.page.googleStart <= 1;
    if (firstPage && plan.supplement && videos.length < 4) {
      try {
        const extra = await cseListSafe(ready, Object.assign({}, common, plan.supplement, { start: 1 }), fetchImpl);
        videos = videos.concat(Logic.extractVideos(extra.items));
      } catch (error) {
        warnings.push(error.message || Logic.messages.upstream);
      }
    }
    return {
      videos: videos,
      nextStart: primary.items.length ? primary.nextStart : null,
      warnings: warnings,
    };
  }

  async function searchOEmbed(spec, fetchImpl) {
    if (spec.kind !== "youtube-video" || !spec.youtubeId) {
      throw new Logic.ApiError("MISSING_KEY", Logic.messages.missingKey, "oembed");
    }
    const watch = "https://www.youtube.com/watch?v=" + spec.youtubeId;
    const endpoint = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch);
    const body = await getJson(endpoint, fetchImpl, "oembed");
    const video = Logic.makeVideo({
      youtubeId: spec.youtubeId,
      title: body.title,
      url: watch,
      thumbnail: body.thumbnail_url,
      author: body.author_name,
      authorUrl: body.author_url,
      source: "oembed",
      via: "YouTube",
      sourceLabel: "YouTube",
    });
    if (!video) throw new Logic.ApiError("UPSTREAM", Logic.messages.oembedFail, "oembed");
    return { videos: [video] };
  }

  function prefix(source, message) {
    const label = LABELS[source] || "Google";
    return label + ": " + message;
  }

  function missingMessage(spec, ready) {
    if (spec.kind === "site" && !ready.google) return { code: "MISSING_KEY", message: Logic.messages.missingGoogleForSite };
    if (!ready.google && !ready.youtube && spec.kind === "youtube-video") return null;
    if (!ready.google && !ready.youtube && (spec.kind === "youtube-channel" || spec.kind === "youtube-playlist")) {
      return { code: "MISSING_KEY", message: Logic.messages.missingYoutubeChannel };
    }
    if (!ready.google && !ready.youtube) return { code: "MISSING_KEY", message: Logic.messages.missingKey };
    return null;
  }

  async function searchAll(rawQuery, settings, options) {
    const opts = options || {};
    const fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch : null);
    const spec = Logic.classifyQuery(rawQuery);
    const ready = Logic.readiness(settings);
    const used = { google: false, youtube: false, oembed: false };
    const emptyPage = { googleStart: null, youtubeToken: null, playlistId: null, playlistToken: null };
    if (!spec.raw) {
      return { spec: spec, videos: [], warnings: [], used: used, page: emptyPage, error: { code: "EMPTY", message: Logic.messages.emptyQuery } };
    }
    if (!fetchImpl) {
      return {
        spec: spec,
        videos: [],
        warnings: [],
        used: used,
        page: emptyPage,
        error: { code: "NETWORK", message: Logic.messages.network },
      };
    }
    const blocked = missingMessage(spec, ready);
    const isMore = Boolean(opts.page);
    if (blocked && !isMore) {
      return { spec: spec, videos: [], warnings: [], used: used, page: emptyPage, error: blocked };
    }
    if (spec.kind === "site" && !ready.google) {
      return {
        spec: spec,
        videos: [],
        warnings: [],
        used: used,
        page: emptyPage,
        error: { code: "MISSING_KEY", message: Logic.messages.missingGoogleForSite },
      };
    }

    const jobs = [];
    const runGoogle = !opts.page || opts.page.googleStart;
    const runYoutube = Logic.wantsYouTubeApi(spec) && ready.youtube && (!opts.page || opts.page.youtubeToken || opts.page.playlistToken || !opts.page);
    if (ready.google && (!isMore || runGoogle)) {
      if (!isMore || opts.page.googleStart) {
        jobs.push({ source: "google", run: () => searchGoogle(ready, spec, opts, fetchImpl) });
      }
    }
    if (runYoutube && (!isMore || (opts.page && (opts.page.youtubeToken || opts.page.playlistToken)))) {
      jobs.push({ source: "youtube", run: () => searchYouTube(ready, spec, opts, fetchImpl) });
    }
    if (!isMore && !ready.youtube && spec.kind === "youtube-video") {
      jobs.push({ source: "oembed", run: () => searchOEmbed(spec, fetchImpl) });
    }
    if (!jobs.length) {
      if (isMore) {
        return { spec: spec, videos: [], warnings: [], used: used, page: emptyPage, error: null };
      }
      return {
        spec: spec,
        videos: [],
        warnings: [],
        used: used,
        page: emptyPage,
        error: blocked || { code: "MISSING_KEY", message: Logic.messages.missingKey },
      };
    }

    const settled = await Promise.all(
      jobs.map(async (job) => {
        try {
          return { ok: true, source: job.source, value: await job.run() };
        } catch (error) {
          return { ok: false, source: job.source, error: withSource(error, job.source) };
        }
      })
    );

    let videos = [];
    const warnings = [];
    const failures = [];
    let channel = null;
    const page = { googleStart: null, youtubeToken: null, playlistId: null, playlistToken: null };

    settled.forEach((result) => {
      if (!result.ok) {
        failures.push(result);
        return;
      }
      const value = result.value || {};
      if (result.source === "google") {
        used.google = true;
        videos = videos.concat(value.videos || []);
        page.googleStart = value.nextStart || null;
        (value.warnings || []).forEach((warning) => warnings.push(prefix("google", warning)));
      } else if (result.source === "youtube") {
        used.youtube = true;
        videos = videos.concat(value.videos || []);
        page.youtubeToken = value.youtubeToken || null;
        page.playlistId = value.playlistId || (opts.page && opts.page.playlistId) || null;
        page.playlistToken = value.token || null;
        if (value.channel) channel = value.channel;
      } else if (result.source === "oembed") {
        used.oembed = true;
        videos = videos.concat(value.videos || []);
      }
    });

    if (spec.kind === "youtube-channel" || spec.kind === "youtube-playlist") {
      const known = new Set(videos.filter((video) => video.source === "youtube").map((video) => video.youtubeId));
      const googleOnly = videos.filter((video) => video.source === "google");
      const rest = videos.filter((video) => video.source !== "google");
      videos = rest.concat(Logic.filterGoogleForTarget(googleOnly, spec, channel, known));
    }

    videos = Logic.sortVideos(Logic.dedupeVideos(videos));

    if (used.oembed && !ready.youtube) {
      warnings.unshift(
        "Chưa có khóa YouTube nên video này lấy qua oEmbed: có tên và ảnh, chưa có giờ đăng. Thêm khóa để xem các video mới của kênh."
      );
    }

    if (!videos.length) {
      if (failures.length) {
        const message = failures
          .map((failure) => prefix(failure.source, (failure.error && failure.error.message) || Logic.messages.upstream))
          .join(" ");
        const code = (failures[0].error && failures[0].error.code) || "UPSTREAM";
        return { spec: spec, videos: [], warnings: warnings, used: used, page: page, error: { code: code, message: message } };
      }
      return {
        spec: spec,
        videos: [],
        warnings: warnings,
        used: used,
        page: page,
        error: { code: "NO_RESULTS", message: Logic.noResultsMessage(spec.raw) },
      };
    }

    failures.forEach((failure) => {
      warnings.push(prefix(failure.source, (failure.error && failure.error.message) || Logic.messages.upstream));
    });

    return { spec: spec, videos: videos, warnings: warnings, used: used, page: page, error: null };
  }

  async function checkKeys(settings, fetchImpl) {
    const ready = Logic.readiness(settings);
    const net = fetchImpl || fetch;
    const report = {};
    if (ready.google) {
      try {
        await cseListSafe(ready, { q: "video", num: 1 }, net);
        report.google = { ok: true, message: "Google Search dùng được." };
      } catch (error) {
        report.google = { ok: false, message: error.message || Logic.messages.upstream };
      }
    } else {
      report.google = { ok: false, message: "Cần cả khóa API và mã cx." };
    }
    if (ready.youtube) {
      try {
        await ytGet("videos", ready.youtubeApiKey, { part: "snippet", id: "jNQXAC9IVRw" }, net);
        report.youtube = { ok: true, message: "YouTube Data API dùng được." };
      } catch (error) {
        report.youtube = { ok: false, message: error.message || Logic.messages.upstream };
      }
    } else {
      report.youtube = { ok: false, message: "Chưa có khóa YouTube." };
    }
    return report;
  }

  return { searchAll: searchAll, checkKeys: checkKeys };
});
