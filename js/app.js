(function () {
  var DEFAULTS = {
    googleApiKey: "",
    searchEngineId: "",
    youtubeApiKey: "AIzaSyCMxgl4XHlrIqUT6gw27vRB1roKiiTjGZk",
    shareGoogleKey: true,
    theme: "dark",
    autoRefreshSec: 0,
    dateRestrict: "",
    lang: "",
  };

  var settings = Object.assign({}, DEFAULTS);
  var recent = [];
  var requestId = 0;
  var toastTimer = 0;
  var state = {
    query: "",
    phase: "idle",
    videos: [],
    warnings: [],
    used: {},
    page: {},
    error: null,
    updatedAt: 0,
    timer: 0,
    loadingMore: false,
  };

  var main = document.getElementById("main");
  var input = document.getElementById("q");
  var suggest = document.getElementById("suggest");
  var dialog = document.getElementById("settings");
  var activeHls = null;
  var hlsLoader = null;

  function stopPlayer() {
    if (activeHls) {
      try { activeHls.destroy(); } catch (error) {}
      activeHls = null;
    }
  }

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoader) return hlsLoader;
    hlsLoader = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
      script.onload = function () { window.Hls ? resolve(window.Hls) : reject(new Error("hls")); };
      script.onerror = function () { reject(new Error("hls")); };
      document.head.appendChild(script);
    });
    return hlsLoader;
  }

  function proxyLoader(Hls) {
    var Base = Hls.DefaultConfig.loader;
    function Loader(config) {
      this.inner = new Base(config);
      this.stats = this.inner.stats;
      this.context = null;
    }
    Loader.prototype.load = function (context, config, callbacks) {
      var original = context && context.url;
      var target = original;
      if (typeof original === "string" && /^https?:\/\//i.test(original) && original.indexOf("https://proxy.corsfix.com/?") !== 0) {
        target = "https://proxy.corsfix.com/?" + original;
      }
      var wrapped = {
        onSuccess: function (response, stats, ctx, network) {
          if (response && original) response.url = original;
          callbacks.onSuccess(response, stats, context, network);
        },
        onError: function (error, ctx, network, stats) {
          callbacks.onError(error, context, network, stats);
        },
        onTimeout: function (stats, ctx, network) {
          callbacks.onTimeout(stats, context, network);
        },
      };
      this.context = context;
      this.stats = this.inner.stats || this.stats;
      return this.inner.load(Object.assign({}, context, { url: target }), config, wrapped);
    };
    Loader.prototype.abort = function () { return this.inner.abort(); };
    Loader.prototype.destroy = function () { if (this.inner.destroy) this.inner.destroy(); };
    return Loader;
  }

  function hlsHeaders(url) {
    var target = url || "";
    var prefix = "https://proxy.corsfix.com/?";
    if (target.indexOf(prefix) === 0) target = target.slice(prefix.length);
    var host = "";
    try { host = new URL(target).hostname; } catch (error) {}
    if (!/(^|\.)vnecdn\.net$|(^|\.)vnexpress\.net$/i.test(host)) return;
    return JSON.stringify({
      Origin: "https://video.vnexpress.net",
      Referer: "https://video.vnexpress.net/",
    });
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (key) {
      var value = props[key];
      if (value == null || value === false) return;
      if (key === "class") el.className = value;
      else if (key.slice(0, 2) === "on" && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "value" || key === "checked" || key === "selected" || key === "disabled" || key === "hidden" || key === "controls") el[key] = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    });
    appendChildren(el, children);
    return el;
  }

  function appendChildren(el, children) {
    children.forEach(function (child) {
      if (Array.isArray(child)) appendChildren(el, child);
      else if (child == null || child === false) return;
      else el.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
  }

  function loadSettings() {
    try {
      settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("moi.settings") || "{}"));
    } catch (error) {
      settings = Object.assign({}, DEFAULTS);
    }
    if (settings.theme !== "light") settings.theme = "dark";
  }

  function saveSettings() {
    localStorage.setItem("moi.settings", JSON.stringify(settings));
  }

  function loadRecent() {
    try {
      var saved = JSON.parse(localStorage.getItem("moi.recent") || "[]");
      recent = Array.isArray(saved) ? saved.filter(function (item) { return typeof item === "string" && item.trim(); }).slice(0, 8) : [];
    } catch (error) {
      recent = [];
    }
  }

  function remember(query) {
    recent = [query].concat(recent.filter(function (item) { return item !== query; })).slice(0, 8);
    localStorage.setItem("moi.recent", JSON.stringify(recent));
  }

  function saveSession() {
    try {
      sessionStorage.setItem("moi.session", JSON.stringify({
        v: 1,
        query: state.query,
        videos: state.videos.slice(0, 40),
        warnings: state.warnings,
        used: state.used,
        page: state.page,
        updatedAt: state.updatedAt,
      }));
    } catch (error) {}
  }

  function restoreSession() {
    try {
      var saved = JSON.parse(sessionStorage.getItem("moi.session") || "null");
      if (!saved || saved.v !== 1 || !saved.query || !Array.isArray(saved.videos) || !saved.videos.length) return;
      state.query = saved.query;
      state.videos = saved.videos;
      state.warnings = saved.warnings || [];
      state.used = saved.used || {};
      state.page = saved.page || {};
      state.updatedAt = saved.updatedAt || Date.now();
      state.phase = "results";
      input.value = saved.query;
    } catch (error) {}
  }

  function showToast(text) {
    var el = document.getElementById("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4600);
  }

  function setStatus(text) {
    document.getElementById("status").textContent = text || "";
  }

  function paintTheme() {
    var light = settings.theme === "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    document.querySelector(".icon-sun").hidden = light;
    document.querySelector(".icon-moon").hidden = !light;
    document.getElementById("themeToggle").setAttribute("aria-label", light ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng");
  }

  function paintKeyState() {
    var button = document.getElementById("openSettings");
    button.classList.remove("needs-key");
    button.setAttribute("aria-label", "Cài đặt");
  }

  function parseRoute() {
    var hash = location.hash || "#/";
    if (hash.indexOf("#/xem/") === 0) {
      var id = hash.slice("#/xem/".length);
      try { id = decodeURIComponent(id); } catch (error) {}
      return { name: "watch", id: id };
    }
    return { name: "home" };
  }

  function videoHref(video) {
    return "#/xem/" + encodeURIComponent(video.id);
  }

  function hasNext(page) {
    return Boolean(page && (page.googleStart || page.youtubeToken || page.playlistToken));
  }

  function clock(ts) {
    try {
      return new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    } catch (error) {
      return "";
    }
  }

  function sourceText(used) {
    var parts = [];
    if (used && used.youtube) parts.push("YouTube");
    else if (used && used.oembed) parts.push("YouTube");
    else if (used && used.piped) parts.push("YouTube, nguồn mở");
    if (used && used.site) parts.push("trang web");
    return parts.length ? "Nguồn: " + parts.join(", ") : "";
  }

  function sourceHref(video) {
    if (video.pageUrl) return video.pageUrl;
    if (video.url && !/\.(m3u8|mp4|webm|ogg)(\?|#|$)/i.test(video.url)) return video.url;
    return video.authorUrl || video.url;
  }

  function restartTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = 0;
    var seconds = Number(settings.autoRefreshSec) || 0;
    if (!seconds || !state.query) return;
    state.timer = setInterval(function () {
      if (document.hidden || state.phase === "loading") return;
      refresh(true);
    }, seconds * 1000);
  }

  function toggleClear() {
    document.getElementById("clearQuery").hidden = !input.value;
  }

  function hideSuggest() {
    suggest.hidden = true;
  }

  function renderSuggest() {
    var q = input.value.trim().toLowerCase();
    var items = recent.filter(function (item) {
      return !q || item.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    if (!items.length || document.activeElement !== input) {
      hideSuggest();
      return;
    }
    suggest.hidden = false;
    suggest.replaceChildren.apply(suggest, items.map(function (item) {
      return h("button", { type: "button", "data-query": item }, item);
    }));
  }

  function thumb(video) {
    var box = h("div", { class: "thumb" });
    if (video.thumbnail) {
      var img = h("img", { src: video.thumbnail, alt: "", loading: "lazy" });
      img.addEventListener("error", function () {
        img.remove();
        box.classList.add("is-empty");
      });
      box.append(img);
    } else box.classList.add("is-empty");
    if (video.badge) box.append(h("span", { class: "live" }, video.badge));
    var duration = MoiLogic.formatDuration(video.durationSec);
    if (duration && !video.badge) {
      box.append(h("span", { class: "duration" }, h("span", { class: "sr-only" }, "Thời lượng "), duration));
    }
    return box;
  }

  function avatar(video) {
    var domain = MoiLogic.domainOf(video.pageUrl || video.authorUrl || video.url);
    var letter = (video.author || "?").trim().charAt(0).toUpperCase() || "?";
    var wrap = h("span", { class: "avatar", "aria-hidden": "true" });
    if (domain) {
      var img = h("img", {
        src: "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=64",
        alt: "",
        width: "28",
        height: "28",
      });
      img.addEventListener("error", function () {
        img.remove();
        wrap.textContent = letter;
      });
      wrap.append(img);
    } else wrap.textContent = letter;
    return wrap;
  }

  function metaBits(video) {
    return [MoiLogic.timeAgo(video.publishedAt), MoiLogic.formatViews(video.views), video.via].filter(Boolean).join(" · ");
  }

  function metaRow(video) {
    return h("div", { class: "meta" },
      avatar(video),
      h("div", { class: "meta-text" },
        h("div", {}, video.author || "Không rõ nguồn"),
        h("div", { class: "meta-sub" }, metaBits(video))
      )
    );
  }

  function card(video) {
    return h("a", { class: "card", href: videoHref(video) },
      thumb(video),
      h("h2", { class: "card-title" }, video.title),
      metaRow(video)
    );
  }

  function sideItem(video) {
    return h("a", { class: "side-item", href: videoHref(video) },
      thumb(video),
      h("div", {},
        h("div", { class: "side-title" }, video.title),
        h("div", { class: "meta-sub" }, [video.author, MoiLogic.timeAgo(video.publishedAt), video.via].filter(Boolean).join(" · "))
      )
    );
  }

  function selectBox(name, label, value, options) {
    var el = h("select", { class: "ctrl", name: name, "aria-label": label });
    options.forEach(function (option) {
      el.append(h("option", { value: option.value, selected: String(option.value) === String(value) }, option.label));
    });
    return el;
  }

  function toolbar() {
    var bits = [state.videos.length + " video", "mới nhất trước"];
    var sources = sourceText(state.used);
    if (sources) bits.push(sources);
    if (state.updatedAt) bits.push("Cập nhật lúc " + clock(state.updatedAt));
    return h("div", { class: "toolbar" },
      h("div", {},
        h("h1", {}, "Kết quả cho “" + state.query + "”"),
        h("p", { class: "sub", "data-result-meta": "1" }, bits.join(" · "))
      ),
      h("div", { class: "toolbar-controls" },
        selectBox("dateRestrict", "Khoảng thời gian", settings.dateRestrict || "", [
          { value: "", label: "Mọi lúc" },
          { value: "d1", label: "24 giờ qua" },
          { value: "w1", label: "7 ngày qua" },
          { value: "m1", label: "30 ngày qua" },
          { value: "y1", label: "1 năm qua" },
        ]),
        selectBox("lang", "Ngôn ngữ", settings.lang || "", [
          { value: "", label: "Mọi ngôn ngữ" },
          { value: "vi", label: "Tiếng Việt" },
        ]),
        selectBox("autoRefresh", "Tự làm mới", settings.autoRefreshSec || 0, [
          { value: "0", label: "Tự làm mới: tắt" },
          { value: "120", label: "Tự làm mới: 2 phút" },
          { value: "300", label: "Tự làm mới: 5 phút" },
          { value: "900", label: "Tự làm mới: 15 phút" },
        ]),
        h("button", { type: "button", class: "ctrl", "data-action": "refresh", title: "Tải lại kết quả" }, "Làm mới")
      )
    );
  }

  function banners() {
    return (state.warnings || []).map(function (text) {
      return h("p", { class: "banner", role: "status" }, text);
    });
  }

  function skeletonGrid() {
    var grid = h("div", { class: "grid", "aria-hidden": "true" });
    for (var i = 0; i < 8; i++) {
      grid.append(h("div", { class: "skeleton-card" },
        h("div", { class: "skeleton thumb" }),
        h("div", { class: "skeleton line" }),
        h("div", { class: "skeleton line short" })
      ));
    }
    return grid;
  }

  function renderLoading() {
    main.replaceChildren(h("p", { class: "loading-note" }, "Đang tìm video mới…"), skeletonGrid());
    setStatus("Đang tìm video mới…");
    document.title = "Đang tìm · Pỏn của Khang";
  }

  function renderIdle() {
    var ready = MoiLogic.readiness(settings);
    var intro = h("section", { class: "intro" },
      h("h1", {}, "Video mới nhất."),
      h("p", {}, "Gõ một từ khóa hoặc dán địa chỉ trang web. Từ khóa lấy video YouTube mới đăng. Địa chỉ trang thì Pỏn của Khang đọc RSS và video nhúng, rồi xếp video mới lên trên."),
      h("p", { class: "hint" }, "Nhấn / để nhảy tới ô tìm.")
    );
    var parts = [intro];
    if (!ready.youtube) {
      parts.push(h("p", { class: "banner" }, "Chưa có khóa YouTube. Từ khóa vẫn tìm được qua nguồn mở. Trang báo, ví dụ vnexpress.net/video, không cần khóa. Thêm khóa trong Cài đặt nếu muốn kết quả từ khóa ổn định hơn."));
    }
    var box = h("section", { class: "recent" }, h("h2", {}, "Tìm gần đây"));
    if (!recent.length) {
      var chips = h("div", { class: "chips" });
      ["bản tin thời sự", "https://vnexpress.net/video", "https://tuoitre.vn/video.htm", "nhạc mới phát hành"].forEach(function (query) {
        chips.append(h("button", { type: "button", class: "chip", title: query, "data-action": "use-query", "data-query": query }, query));
      });
      box.append(h("p", { class: "muted" }, "Chưa có lần tìm nào."), h("h3", {}, "Gợi ý"), chips);
    } else {
      var history = h("div", { class: "chips" });
      recent.forEach(function (query) {
        history.append(h("button", { type: "button", class: "chip", title: query, "data-action": "use-query", "data-query": query }, query));
      });
      box.append(history, h("button", { type: "button", class: "text-btn", "data-action": "forget" }, "Xóa lịch sử tìm"));
    }
    parts.push(box);
    main.replaceChildren.apply(main, parts);
    document.title = "Pỏn của Khang — video mới nhất";
    setStatus("");
  }

  function renderError() {
    var code = state.error && state.error.code;
    var keyish = ["MISSING_KEY", "INVALID_KEY", "NOT_ENABLED", "QUOTA", "FORBIDDEN"].indexOf(code) !== -1;
    var box = h("div", { class: "notice" },
      h("h1", {}, state.error ? state.error.message : "Có lỗi khi tìm video."),
      h("div", { class: "row" },
        state.query ? h("button", { type: "button", class: "ctrl", "data-action": "retry" }, "Thử lại") : null,
        keyish ? h("button", { type: "button", class: "primary", "data-action": "settings" }, "Mở cài đặt") : null
      )
    );
    var parts = [];
    if (state.query && code === "NO_RESULTS") parts.push(toolbar());
    parts = parts.concat(banners());
    parts.push(box);
    main.replaceChildren.apply(main, parts);
    document.title = "Không tìm được · Pỏn của Khang";
    setStatus(state.error ? state.error.message : "");
  }

  function renderResults() {
    var grid = h("div", { class: "grid" });
    state.videos.forEach(function (video) { grid.append(card(video)); });
    var parts = [toolbar()].concat(banners(), [grid]);
    if (hasNext(state.page)) parts.push(h("button", { type: "button", class: "more", "data-action": "more" }, "Xem thêm"));
    main.replaceChildren.apply(main, parts);
    document.title = state.query + " · Pỏn của Khang";
    setStatus(state.videos.length + " video cho " + state.query);
  }

  function playerFor(video) {
    var embed = MoiLogic.buildEmbed(video, location.hostname);
    var player = h("div", { class: embed.narrow ? "player tall" : "player" });
    if (embed.type === "iframe") {
      player.append(h("iframe", {
        src: embed.src,
        title: video.title,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen",
        allowfullscreen: true,
        referrerpolicy: "strict-origin-when-cross-origin",
      }));
    } else if (embed.type === "file") {
      var videoEl = h("video", { controls: true, autoplay: true });
      videoEl.setAttribute("playsinline", "");
      videoEl.src = embed.src;
      player.append(videoEl);
    } else if (embed.type === "hls") {
      var stream = h("video", { controls: true, autoplay: true });
      stream.setAttribute("playsinline", "");
      var note = h("p", { class: "banner", hidden: true });
      player.append(stream, note);
      loadHls().then(function (Hls) {
        if (!player.isConnected) return;
        if (Hls.isSupported()) {
          stopPlayer();
          var hls = new Hls({
            enableWorker: false,
            startLevel: 0,
            loader: proxyLoader(Hls),
            xhrSetup: function (xhr, mediaUrl) {
              var header = hlsHeaders(mediaUrl);
              if (header) xhr.setRequestHeader("x-corsfix-headers", header);
            },
          });
          activeHls = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            hls.currentLevel = 0;
          });
          hls.on(Hls.Events.ERROR, function (event, data) {
            if (!data || !data.fatal) return;
            note.hidden = false;
            note.dataset.hls = (data.type || "") + " " + (data.details || "") + " " + ((data.error && data.error.message) || "");
            note.textContent = "Không phát được luồng này trong trang. Mở trên trang nguồn để xem.";
          });
          hls.loadSource(embed.src);
          hls.attachMedia(stream);
        } else if (stream.canPlayType("application/vnd.apple.mpegurl")) {
          stream.src = embed.src;
        } else {
          note.hidden = false;
          note.textContent = "Trình duyệt này không phát được luồng HLS. Mở trên trang nguồn để xem.";
        }
      }).catch(function () {
        note.hidden = false;
        note.textContent = "Không tải được trình phát. Mở trên trang nguồn để xem.";
      });
    } else {
      var link = h("a", {
        class: "external",
        href: embed.src || video.url,
        target: "_blank",
        rel: "noopener noreferrer",
      });
      if (video.thumbnail) link.append(h("img", { src: video.thumbnail, alt: "" }));
      var message = embed.reason === "noembed"
        ? "Người đăng không cho phát nhúng. Mở trên YouTube để xem."
        : "Trang này không phát được trong khung hình. Mở trên trang nguồn để xem.";
      link.append(h("span", { class: "external-copy" }, h("strong", {}, "Phát trên trang nguồn"), h("span", {}, message)));
      player.append(link);
    }
    return player;
  }

  function renderWatch(id) {
    var video = state.videos.filter(function (item) { return item.id === id; })[0];
    if (!video) {
      var grid = h("div", { class: "grid" });
      state.videos.forEach(function (item) { grid.append(card(item)); });
      main.replaceChildren(
        h("div", { class: "notice" },
          h("h1", {}, "Không thấy video này trong kết quả hiện tại"),
          h("p", {}, "Danh sách có thể đã được làm mới. Chọn một video khác hoặc tìm lại."),
          h("div", { class: "row" }, h("a", { class: "primary linkish", href: "#/" }, "Về kết quả"))
        ),
        state.videos.length ? grid : null
      );
      document.title = "Không thấy video · Pỏn của Khang";
      return;
    }
    var others = state.videos.filter(function (item) { return item.id !== video.id; });
    var list = h("div", { class: "side-list" });
    if (!others.length) list.append(h("p", { class: "muted" }, "Không có video khác trong lượt tìm này."));
    else others.forEach(function (item) { list.append(sideItem(item)); });
    var info = h("div", { class: "watch-info" },
      h("a", { class: "back", href: "#/" }, "← Kết quả"),
      h("h1", {}, video.title),
      metaRow(video),
      h("div", { class: "watch-actions" },
        h("a", { class: "ctrl linkish", href: sourceHref(video), target: "_blank", rel: "noopener noreferrer" }, "Mở trên trang nguồn")
      )
    );
    if (video.description) {
      info.append(h("p", { class: "description" }, video.description));
      info.append(h("button", { type: "button", class: "text-btn", "data-action": "desc" }, "Hiện thêm"));
    }
    var layout = h("div", { class: "watch" },
      h("section", { class: "watch-main" }, playerFor(video), info),
      h("aside", { class: "side" },
        h("h2", {}, "Tiếp theo ", h("span", { "data-side-count": "1" }, String(others.length))),
        list
      )
    );
    main.replaceChildren.apply(main, banners().concat([layout]));
    document.title = video.title + " · Pỏn của Khang";
    setStatus(video.title);
    window.scrollTo(0, 0);
    requestAnimationFrame(function () {
      var description = document.querySelector(".description");
      var button = document.querySelector("[data-action=desc]");
      if (description && button && description.scrollHeight <= description.clientHeight + 2) button.hidden = true;
    });
  }

  function renderMain() {
    stopPlayer();
    var route = parseRoute();
    if (route.name === "watch") {
      if (state.phase === "loading") renderLoading();
      else renderWatch(route.id);
      return;
    }
    if (state.phase === "loading") return renderLoading();
    if (state.phase === "error") return renderError();
    if (state.phase === "results") return renderResults();
    renderIdle();
  }

  function renderQuiet() {
    var route = parseRoute();
    if (route.name === "watch" && document.querySelector(".player")) {
      var list = document.querySelector(".side-list");
      if (list) {
        var others = state.videos.filter(function (video) { return video.id !== route.id; });
        list.replaceChildren();
        if (!others.length) list.append(h("p", { class: "muted" }, "Không có video khác trong lượt tìm này."));
        else others.forEach(function (video) { list.append(sideItem(video)); });
        var count = document.querySelector("[data-side-count]");
        if (count) count.textContent = String(others.length);
        return;
      }
    }
    var y = window.scrollY;
    renderMain();
    window.scrollTo(0, y);
  }

  function applyResult(result, opts) {
    opts = opts || {};
    state.warnings = result.warnings || [];
    state.used = result.used || {};
    state.page = result.page || {};
    if (result.error) {
      state.phase = "error";
      state.error = result.error;
      state.videos = [];
      try { sessionStorage.removeItem("moi.session"); } catch (error) {}
      renderMain();
      restartTimer();
      return;
    }
    var previous = {};
    state.videos.forEach(function (video) { previous[video.id] = true; });
    var added = (result.videos || []).filter(function (video) { return !previous[video.id]; }).length;
    state.videos = result.videos || [];
    state.phase = "results";
    state.error = null;
    state.updatedAt = Date.now();
    saveSession();
    restartTimer();
    if (opts.quiet) {
      if (added) showToast("Có " + added + " video mới");
      renderQuiet();
      return;
    }
    var target = result.spec && result.spec.kind === "youtube-video" ? "yt:" + result.spec.youtubeId : "";
    var nextHash = target ? "#/xem/" + encodeURIComponent(target) : "";
    if (opts.autoOpen && target && state.videos.some(function (video) { return video.id === target; })) {
      if (location.hash !== nextHash) {
        location.hash = nextHash;
        return;
      }
    }
    renderMain();
  }

  async function runSearch(raw) {
    var query = String(raw || "").trim();
    if (!query) {
      showToast(MoiLogic.messages.emptyQuery);
      input.focus();
      return;
    }
    var id = ++requestId;
    state.query = query;
    input.value = query;
    toggleClear();
    remember(query);
    hideSuggest();
    state.phase = "loading";
    state.error = null;
    if (parseRoute().name !== "home") location.hash = "#/";
    else renderMain();
    var result;
    try {
      result = await MoiApi.searchAll(query, settings, {
        dateRestrict: settings.dateRestrict || "",
        lang: settings.lang || "",
      });
    } catch (error) {
      result = { error: { code: "NETWORK", message: MoiLogic.messages.network }, videos: [], warnings: [], used: {}, page: {} };
    }
    if (id !== requestId) return;
    applyResult(result, { autoOpen: true });
  }

  async function refresh(quiet) {
    if (!state.query || state.phase === "loading") return;
    var id = ++requestId;
    if (!quiet) {
      state.phase = "loading";
      if (parseRoute().name !== "home") location.hash = "#/";
      else renderMain();
    } else setStatus("Đang kiểm tra video mới…");
    var result;
    try {
      result = await MoiApi.searchAll(state.query, settings, {
        dateRestrict: settings.dateRestrict || "",
        lang: settings.lang || "",
      });
    } catch (error) {
      result = { error: { code: "NETWORK", message: MoiLogic.messages.network }, videos: [], warnings: [], used: {}, page: {} };
    }
    if (id !== requestId) return;
    if (quiet && result.error && state.videos.length) {
      showToast(result.error.message);
      setStatus("");
      return;
    }
    applyResult(result, { quiet: quiet, autoOpen: false });
  }

  async function loadMore() {
    if (state.loadingMore || !hasNext(state.page) || !state.query) return;
    state.loadingMore = true;
    var id = ++requestId;
    var button = document.querySelector("[data-action=more]");
    if (button) {
      button.disabled = true;
      button.textContent = "Đang tải…";
    }
    var result;
    try {
      result = await MoiApi.searchAll(state.query, settings, {
        dateRestrict: settings.dateRestrict || "",
        lang: settings.lang || "",
        page: state.page,
      });
    } catch (error) {
      result = { error: { code: "NETWORK", message: MoiLogic.messages.network }, videos: [] };
    }
    if (id !== requestId) return;
    state.loadingMore = false;
    if (result.error && !(result.videos || []).length) {
      showToast(result.error.message);
      if (button) {
        button.disabled = false;
        button.textContent = "Xem thêm";
      }
      return;
    }
    var merged = MoiLogic.sortVideos(MoiLogic.dedupeVideos(state.videos.concat(result.videos || [])));
    var added = merged.length - state.videos.length;
    state.videos = merged;
    state.page = result.page || {};
    state.updatedAt = Date.now();
    saveSession();
    if (!added) showToast("Không còn video mới ở trang tiếp theo.");
    renderMain();
  }

  function syncShare() {
    var field = document.getElementById("youtubeField");
    var inputKey = document.getElementById("youtubeApiKey");
    if (inputKey) inputKey.disabled = false;
    if (field) field.classList.remove("is-disabled");
  }

  function fillSettings() {
    document.getElementById("googleApiKey").value = settings.googleApiKey || "";
    document.getElementById("searchEngineId").value = settings.searchEngineId || "";
    document.getElementById("youtubeApiKey").value = settings.youtubeApiKey || "";
    document.getElementById("shareGoogleKey").checked = settings.shareGoogleKey !== false;
    document.getElementById("checkResult").textContent = "";
    syncShare();
  }

  function readSettingsForm() {
    settings.googleApiKey = MoiLogic.cleanSecret(document.getElementById("googleApiKey").value);
    settings.searchEngineId = MoiLogic.cleanSecret(document.getElementById("searchEngineId").value);
    settings.youtubeApiKey = MoiLogic.cleanSecret(document.getElementById("youtubeApiKey").value);
    settings.shareGoogleKey = document.getElementById("shareGoogleKey").checked;
    document.getElementById("googleApiKey").value = settings.googleApiKey;
    document.getElementById("searchEngineId").value = settings.searchEngineId;
    document.getElementById("youtubeApiKey").value = settings.youtubeApiKey;
  }

  function openSettings() {
    fillSettings();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeSettings() {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function onSaveSettings() {
    readSettingsForm();
    saveSettings();
    paintKeyState();
    showToast("Đã lưu cài đặt trên trình duyệt này.");
    if (state.phase === "idle") renderMain();
  }

  async function onCheckKeys() {
    readSettingsForm();
    saveSettings();
    paintKeyState();
    var box = document.getElementById("checkResult");
    var button = document.getElementById("checkKeys");
    box.textContent = "Đang kiểm tra…";
    button.disabled = true;
    try {
      var report = await MoiApi.checkKeys(settings);
      box.replaceChildren(h("div", {}, "YouTube: " + report.youtube.message));
    } catch (error) {
      box.textContent = MoiLogic.messages.network;
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    document.getElementById("searchForm").addEventListener("submit", function (event) {
      event.preventDefault();
      runSearch(input.value);
    });
    input.addEventListener("input", function () {
      toggleClear();
      renderSuggest();
    });
    input.addEventListener("focus", renderSuggest);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hideSuggest();
    });
    document.getElementById("clearQuery").addEventListener("click", function () {
      input.value = "";
      toggleClear();
      input.focus();
      renderSuggest();
    });
    suggest.addEventListener("mousedown", function (event) { event.preventDefault(); });
    suggest.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button) return;
      input.value = button.getAttribute("data-query") || button.textContent;
      hideSuggest();
      runSearch(input.value);
    });
    document.addEventListener("click", function (event) {
      if (!document.getElementById("searchForm").contains(event.target)) hideSuggest();
    });
    document.getElementById("themeToggle").addEventListener("click", function () {
      settings.theme = settings.theme === "light" ? "dark" : "light";
      saveSettings();
      paintTheme();
    });
    document.getElementById("openSettings").addEventListener("click", openSettings);
    document.getElementById("closeSettings").addEventListener("click", closeSettings);
    document.getElementById("saveSettings").addEventListener("click", onSaveSettings);
    document.getElementById("checkKeys").addEventListener("click", onCheckKeys);
    document.getElementById("clearKeys").addEventListener("click", function () {
      settings.googleApiKey = "";
      settings.searchEngineId = "";
      settings.youtubeApiKey = "";
      saveSettings();
      fillSettings();
      paintKeyState();
      showToast("Đã xóa khóa khỏi trình duyệt này.");
      if (state.phase === "idle") renderMain();
    });
    document.getElementById("shareGoogleKey").addEventListener("change", syncShare);
    document.querySelectorAll("[data-toggle-secret]").forEach(function (button) {
      button.addEventListener("click", function () {
        var field = document.getElementById(button.getAttribute("data-toggle-secret"));
        var show = field.type === "password";
        field.type = show ? "text" : "password";
        button.textContent = show ? "Ẩn" : "Hiện";
      });
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeSettings();
    });
    main.addEventListener("click", function (event) {
      var action = event.target.closest("[data-action]");
      if (!action) return;
      var name = action.getAttribute("data-action");
      if (name === "settings") openSettings();
      if (name === "retry" || name === "refresh") refresh(false);
      if (name === "more") loadMore();
      if (name === "use-query") runSearch(action.getAttribute("data-query") || "");
      if (name === "forget") {
        recent = [];
        localStorage.removeItem("moi.recent");
        renderMain();
      }
      if (name === "desc") {
        var description = document.querySelector(".description");
        if (!description) return;
        var open = description.classList.toggle("is-open");
        action.textContent = open ? "Thu gọn" : "Hiện thêm";
      }
    });
    main.addEventListener("change", function (event) {
      var name = event.target.name;
      if (name === "dateRestrict" || name === "lang" || name === "autoRefresh") {
        if (name === "autoRefresh") settings.autoRefreshSec = Number(event.target.value) || 0;
        else settings[name] = event.target.value;
        saveSettings();
        if (name === "autoRefresh") restartTimer();
        else if (state.query) runSearch(state.query);
      }
    });
    window.addEventListener("hashchange", renderMain);
    document.addEventListener("keydown", function (event) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (dialog.open) return;
      event.preventDefault();
      input.focus();
      input.select();
    });
  }

  loadSettings();
  loadRecent();
  paintTheme();
  paintKeyState();
  restoreSession();
  toggleClear();
  bind();
  renderMain();
  restartTimer();
})();
