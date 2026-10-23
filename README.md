# Mới

Trang tĩnh để tìm **video mới nhất**. Gõ một từ khóa hoặc dán địa chỉ trang web.

- **Từ khóa** lấy video YouTube, xếp mới đăng lên trước. Có khóa [YouTube Data API v3](https://developers.google.com/youtube/v3) thì dùng API (`order=date`). Chưa có khóa thì dùng nguồn mở (Piped) — vẫn là video YouTube, phát trong trang.
- **Địa chỉ trang** không cần khóa và không cần mã `cx`. Mới đọc trang (RSS, sitemap không bắt buộc, thẻ video, iframe, liên kết YouTube/Vimeo/Dailymotion/TikTok/Facebook). Trình duyệt bị CORS chặn thì đọc qua [Jina Reader](https://r.jina.ai/). Video có ngày thì xếp mới nhất trước.

File `.mp4` phát bằng thẻ video. Luồng HLS (như VnExpress) phát bằng hls.js; CDN của VnExpress chỉ cho phép origin của báo, nên đoạn phim đi qua một proxy CORS và gắn lại origin đó. YouTube, Vimeo, Dailymotion, TikTok và Facebook phát trong khung nhúng khi trang nguồn cho phép.

Khóa, nếu bạn dán, nằm trong `localStorage` của trình duyệt. Trong mã nguồn, `DEFAULTS.youtubeApiKey` để trống để bạn tự điền khi triển khai.

## Chạy trên máy

Cần một máy chủ tĩnh. Mở `index.html` bằng `file://` thường bị chặn khi gọi mạng.

```bash
python3 -m http.server 8765
```

Rồi mở http://127.0.0.1:8765

## Cách dùng

1. Gõ từ khóa (`bản tin thời sự`) hoặc dán URL (`https://vnexpress.net/video`, `https://tuoitre.vn/video.htm`, một video YouTube).
2. Kết quả xếp **mới nhất trước**. Bấm một video để phát. Danh sách còn lại nằm cạnh trang phát.
3. **Mọi lúc / 24 giờ qua / 7 ngày qua** lọc theo thời gian. **Tự làm mới** gọi lại tìm kiếm (mặc định tắt). Nút mặt trời hoặc mặt trăng đổi giao diện. Các lần tìm gần đây được nhớ trên máy bạn.
4. Khóa YouTube là tùy chọn, trong **Cài đặt**. Bấm **Kiểm tra khóa** rồi **Lưu**.

## Lấy khóa YouTube

Console của Google thường để tiếng Anh. Tên menu bên dưới giữ nguyên tiếng Anh.

1. Vào [Google Cloud Console](https://console.cloud.google.com/) và tạo một dự án.
2. **APIs & Services → Library**, bật **YouTube Data API v3**. Đợi vài phút.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Hạn chế khóa: **Application restrictions → HTTP referrers**, thêm `http://127.0.0.1/*` và địa chỉ GitHub Pages, ví dụ `https://ten-ban.github.io/*`. **API restrictions**: chỉ **YouTube Data API v3**.
5. Dán khóa vào ô **Khóa YouTube Data API**. Ô này tương ứng `DEFAULTS.youtubeApiKey` trong `js/app.js`.

Mỗi lượt tìm từ khóa bằng khóa tốn khoảng 100 đơn vị. Hạn mức mặc định khoảng 10.000 đơn vị mỗi ngày. Tự làm mới cũng tốn hạn mức.

Custom Search JSON API không được dùng. Dự án Google mới trả 403 “This project does not have the access to Custom Search JSON API”, và công cụ tìm mới không tìm được cả web. Không cần tạo mã `cx`.

## Đưa lên GitHub Pages

Trang được phục vụ từ **thư mục gốc của nhánh `main`**. Không dùng GitHub Actions: token đẩy mã không có quyền workflow, và repo không chứa file workflow.

Trong repository: **Settings → Pages → Build and deployment → Deploy from a branch → main → / (root)**. Vài phút sau trang nằm ở `https://<tai-khoan>.github.io/<ten-repo>/` hoặc miền riêng nếu bạn cấu hình.

Nếu khóa YouTube bị hạn chế theo referrer, thêm đúng địa chỉ Pages. Bản triển khai có thể điền sẵn khóa vào `DEFAULTS.youtubeApiKey`; bản trong Git để trống.

## Kiểm tra

```bash
node --test tests/*.test.js
```

Các bài kiểm tra giả lập mạng, không gọi YouTube hay báo thật.

## Giới hạn

- Không có khóa YouTube thì từ khóa phụ thuộc nguồn mở. Khi nguồn đó lỗi, thêm khóa YouTube.
- Kênh và playlist YouTube cần khóa. Một liên kết `watch`, `youtu.be` hoặc `shorts` vẫn hiện tên và ảnh qua oEmbed.
- Trang không có video, RSS hay liên kết nhúng thì không ra kết quả. Một số báo chặn máy chủ đọc hộ (Jina trả lỗi).
- VnExpress phát HLS có mã hóa. Nếu proxy CORS bị chặn, video vẫn hiện trong danh sách và có nút mở trên VnExpress.
- Ảnh và tệp nằm trên CDN của báo. Trình phát không tải hết file trước khi bấm phát.
