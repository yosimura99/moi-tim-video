# Mới

Trang tĩnh để tìm **video mới nhất**. Gõ một từ khóa hoặc dán địa chỉ trang web. Mới hỏi **Google Search** trước (Programmable Search JSON API, xếp theo ngày), rồi bổ sung video **YouTube** (YouTube Data API, `order=date`). Kết quả hiện như trang xem video: lưới thumbnail, giờ kiểu “2 giờ trước”, và trang phát với danh sách còn lại bên cạnh.

Khóa API do bạn tự dán trong **Cài đặt**. Khóa nằm trong `localStorage` của trình duyệt, không có trong mã nguồn và không gửi tới máy chủ nào ngoài Google.

## Chạy trên máy

Cần một máy chủ tĩnh nhỏ. Mở file `index.html` trực tiếp (`file://`) thường bị trình duyệt chặn khi gọi Google.

```bash
python3 -m http.server 8765
```

Rồi mở http://127.0.0.1:8765

## Cách dùng

1. Bấm nút cài đặt (biểu tượng thanh trượt) và dán khóa theo hướng dẫn ngay trong hộp thoại, hoặc theo mục bên dưới.
2. Bấm **Kiểm tra khóa**, rồi **Lưu**.
3. Gõ từ khóa (`bản tin thời sự`) hoặc dán URL (`https://vnexpress.net/...`, kênh YouTube, playlist).
4. Kết quả xếp **mới nhất trước**. Bấm một video để phát. Video YouTube, Vimeo, Dailymotion và file `.mp4` phát trong trang. Trang không cho nhúng thì có nút mở nguồn.
5. **Mọi lúc / 24 giờ qua / 7 ngày qua** lọc theo thời gian. **Tự làm mới** gọi lại Google theo chu kỳ (tốn hạn mức, mặc định tắt). **Giao diện sáng/tối** là nút mặt trời hoặc mặt trăng. Các lần tìm gần đây được nhớ trên máy bạn.

## Lấy khóa Google

Console của Google thường để tiếng Anh. Tên menu bên dưới giữ nguyên tiếng Anh để dễ tìm.

### 1. Bật API

1. Vào [Google Cloud Console](https://console.cloud.google.com/) và tạo một dự án.
2. **APIs & Services → Library**.
3. Bật **Custom Search API**.
4. Bật **YouTube Data API v3**.
5. Đợi vài phút.

### 2. Tạo khóa API

1. **APIs & Services → Credentials → Create credentials → API key**.
2. Mở khóa vừa tạo và hạn chế nó:
   - **Application restrictions**: HTTP referrers (web sites).
   - Thêm `http://localhost/*`, `http://127.0.0.1/*` và địa chỉ GitHub Pages, ví dụ `https://ten-ban.github.io/*`.
   - **API restrictions**: Restrict key. Chỉ chọn **Custom Search API** và **YouTube Data API v3**.
3. Sao chép khóa (dạng `AIza…`).

Một khóa có thể dùng cho cả hai API. Trong Cài đặt, giữ **Dùng khóa Google cho YouTube**. Nếu bạn có khóa riêng cho YouTube, bỏ chọn ô đó rồi dán khóa thứ hai.

### 3. Tạo mã cx

1. Vào [Programmable Search Engine](https://programmablesearchengine.google.com/controlpanel/create).
2. Tạo công cụ mới. Khi được hỏi tìm ở đâu, chọn **Search the entire web**. Không chọn mỗi một vài trang, nếu không kết quả sẽ rất hẹp.
3. Sau khi tạo, mở công cụ và sao chép **Search engine ID**. Đó là mã `cx`.
4. Dán vào ô **Mã công cụ tìm kiếm (cx)**.

Nếu công cụ từ chối `sort=date`, Mới tự tìm lại không kèm tham số đó, rồi vẫn xếp những kết quả có ngày đăng. Video YouTube lấy từ Data API luôn có giờ đăng.

### 4. Kiểm tra

Trong ứng dụng, bấm **Kiểm tra khóa**.

- `Google: Google Search dùng được.`
- `YouTube: YouTube Data API dùng được.`

Nếu báo chưa bật API, quay lại Library và bật đúng tên API ở trên. Nếu báo khóa không hợp lệ, tạo lại khóa. Nếu báo bị từ chối, kiểm tra referrer: trang bạn đang mở phải khớp mẫu đã thêm (localhost khác với 127.0.0.1).

## Đưa lên GitHub Pages

Trang là HTML/CSS/JS thuần. Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) đăng nội dung lên GitHub Pages mỗi khi đẩy lên nhánh `main`.

1. Tạo một repository trống trên GitHub.
2. Đẩy mã này lên nhánh `main`:

   ```bash
   git remote add origin https://github.com/TEN-BAN/TEN-REPO.git
   git push -u origin main
   ```

3. Trên GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Vào tab **Actions**. Workflow **Đăng lên GitHub Pages** sẽ chạy. Nếu lần đầu lỗi vì chưa có môi trường Pages, chọn Source như bước 3 rồi bấm **Run workflow**.
5. Site nằm ở `https://TEN-BAN.github.io/TEN-REPO/`.
6. Thêm đúng URL đó vào HTTP referrers của khóa API, dạng `https://TEN-BAN.github.io/*`.

Mỗi người mở site tự nhập khóa của mình. Đừng commit khóa, và đừng nhúng khóa vào file.

## Hạn mức

- **Custom Search JSON API**: khoảng 100 truy vấn miễn phí mỗi ngày, sau đó tính phí. Một lần tìm có thể tốn 1 truy vấn, hoặc 2 nếu lần đầu không ra video và Mới tìm thêm trên các trang video.
- **YouTube Data API**: `search.list` tốn 100 đơn vị. Hạn mức mặc định khoảng 10.000 đơn vị/ngày, tức khoảng 100 lần tìm từ khóa. Đọc kênh hoặc playlist rẻ hơn vì không gọi `search.list`.
- **Tự làm mới** lặp lại các lệnh gọi này. Để **tắt** nếu bạn không cần canh video mới.

Hết hạn mức thì trang báo bằng tiếng Việt, không hiện lỗi thô của Google.

## Khi chưa có khóa

- Tìm theo từ khóa cần ít nhất một trong hai nguồn.
- Tìm theo một trang web bất kỳ (không phải YouTube) cần khóa Google và mã cx.
- Kênh và playlist YouTube cần khóa YouTube Data API. RSS của YouTube không gửi dữ liệu cho trang web tĩnh, nên Mới không đọc RSS.
- Một URL video đơn lẻ (`watch`, `youtu.be`, `shorts`) vẫn hiện tên, kênh và ảnh qua oEmbed chính thức của YouTube. Cách này không có giờ đăng và không kèm các video mới của kênh.

## Kiểm tra mã

```bash
node --test tests/*.test.js
```

Các bài kiểm tra giả lập phản hồi của Google: tìm từ khóa, tìm theo URL, kênh YouTube, khóa thiếu, khóa sai, hết hạn mức, và không có kết quả.
