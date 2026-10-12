# Kết nối Firebase thật — Taskflow v0.2

Bản này bắt buộc đăng nhập Firebase. CRUD task, work log, lịch sử và cài đặt dùng Firestore trực tiếp. Không còn lưu công việc mới vào SQLite rồi chờ sao lưu.

## 1. Tạo project

Mở https://console.firebase.google.com/ → Create a project / Add project. Có thể dùng project riêng đã có.

Trong Project settings → General → Your apps → chọn biểu tượng Web `</>` → Register app. Không cần chọn Hosting cho app desktop.

Copy **Firebase Web Config** gồm apiKey, authDomain, projectId, appId. Đây là cấu hình phía client, không phải service-account/private key.

## 2. Authentication

Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.

App có đăng nhập, tạo tài khoản và quên mật khẩu. Nếu không muốn tự đăng ký, bạn có thể tạo user trong Authentication → Users; bản này chưa có chính sách chỉ nhận user mời.

## 3. Firestore và rules

Build → Firestore Database → Create database → dùng **Standard edition / Native mode**, database `(default)`, chọn khu vực phù hợp. Bắt đầu ở production mode.

Vào tab Rules, thay bằng **toàn bộ file firestore.rules trong bản v0.2**, rồi Publish. Rules cũ chỉ cho backup, nên không đủ cho bản này. Không mở `allow read, write: if true`.

Hoặc dùng Firebase CLI (đã khai báo dev dependency):

```powershell
npx firebase login
npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
```

Thay YOUR_PROJECT_ID bằng projectId thật. Không chạy deploy functions nếu chỉ cần đăng nhập và task.

## 4. File .env của app

Ở thư mục chứa package.json, copy .env.example thành .env và điền:

```dotenv
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=your-web-app-id
```

Đóng app rồi chạy:

```powershell
npm ci
npm start
```

Vite đọc các giá trị này khi build. Nếu đổi .env phải build/mở lại. App đóng gói phải có Web Config trước khi build installer. Không đặt Firebase Admin SDK key, service-account JSON hoặc mật khẩu SMTP trong biến VITE_.

## 5. Xác nhận đang lưu lên cloud

1. Đăng ký/đăng nhập trong app.
2. Tạo task có ngày bắt đầu và deadline.
3. Mở Firebase Console → Firestore Database → Data.
4. Tìm `users/{UID}/tasks/{id}`. UID xem trong Authentication → Users hoặc Cài đặt của app.
5. Sửa task: `tasks` được cập nhật và `events` có lịch sử trước/sau.
6. Ghi work log: dữ liệu xuất hiện trong `logs` và `events`.
7. Đăng xuất, đăng nhập tài khoản khác: workspace phải tách biệt.
8. Đăng nhập lại tài khoản cũ: dữ liệu cloud vẫn còn.

Cấu trúc:

- users/{uid}: email và thời gian cập nhật profile.
- users/{uid}/tasks/{taskId}: task, ngày bắt đầu, hạn hoàn thành, version.
- users/{uid}/logs/{logId}: nhật ký công việc.
- users/{uid}/events/{eventId}: lịch sử thay đổi, thời gian server.
- users/{uid}/settings/preferences: cài đặt nhắc việc.
- users/{uid}/meta/counter: bộ đếm mã task dùng trong transaction.
- users/{uid}/reminders/{YYYY-MM-DD}: trạng thái gửi mail, chỉ server được ghi.
- users/{uid}/imported_history/{eventId}: lịch sử nhập từ SQLite, được ghi rõ nguồn trong UI.

Dữ liệu được ghi bằng Firebase Web SDK; Firebase tự kiểm tra ID token và Security Rules. Không nhúng Admin SDK vào Electron. Task + audit event ghi trong một transaction. Đây là lịch sử phục vụ cá nhân, không phải audit bất biến do một cơ quan độc lập xác nhận.

## 6. Nhập SQLite v0.1

Giữ cùng thư mục dữ liệu app cũ. Vào Cài đặt → Nhập dữ liệu SQLite cũ → xác nhận đúng tài khoản đang nhận.

Chỉ nhập vào workspace Firebase chưa có task/bộ đếm. Import một transaction, không nhập nửa chừng. Giới hạn 400 document writes, tương đương `2 × số task + 2 × số log + số event + 3 ≤ 400`. Nếu vượt, app dừng rõ ràng; giữ file SQLite/JSON để chuyển dữ liệu theo lô sau.

Task và ngày tháng được giữ. Work log giữ ngày làm và nội dung; timestamp tạo log trên cloud là lúc nhập. Lịch sử cũ giữ timestamp ban đầu, nằm riêng trong imported_history. Cài đặt email cũ không tự bật trên cloud. SQLite cũ không bị xóa hoặc ghi đè.

Nếu chỉ có file JSON cũ mà không còn SQLite ở máy này, bản hiện tại chưa có công cụ import JSON lên cloud. Xuất JSON cloud có sẵn để lưu bản dự phòng; chưa có restore cloud JSON.

## 7. Email khi tắt app — tùy chọn

Có mã Python Cloud Function trong `functions/main.py`. Auth + Firestore chạy trước mà không cần deploy function này.

Để gửi email phải cấu hình SMTP và triển khai function. Cloud Functions/Cloud Scheduler yêu cầu cấu hình billing phù hợp (Blaze); kiểm tra mức phí và quota trong Console trước khi bật. Việc tải mã nguồn hoặc lưu cài đặt nhắc việc không tự tạo scheduler và không tự phát sinh email.

Trên máy có Python 3.12:

```powershell
cd functions
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
cd ..
npx firebase login
npx firebase functions:secrets:set SMTP_CONFIG --project YOUR_PROJECT_ID
```

Ở prompt nhập secret, dán một JSON có dạng (thay bằng thông tin thật):

```json
{"host":"smtp.example.com","port":587,"security":"starttls","username":"you@example.com","password":"APP_PASSWORD","from":"you@example.com"}
```

Không gửi secret đó vào chat. Không lưu trong source. Deploy:

```powershell
npx firebase deploy --only functions:taskflow --project YOUR_PROJECT_ID
```

Vào Cài đặt trong app → gửi email xác minh → mở link trong mail → bấm Tôi đã xác minh → bật nhắc và lưu.

Function chạy mỗi 60 phút, sau giờ đã chọn sẽ gửi một bản tổng hợp task quá hạn/đến hạn hôm nay/ngày mai. Email chỉ đến địa chỉ tài khoản đã xác minh. Có thể lệch tới khoảng một giờ tùy lịch chạy, không phải hẹn chính xác từng phút. Mỗi user có receipt theo ngày; tránh gửi trùng khi scheduler gọi lặp. SMTP lỗi/timeout không tự thử lại trong ngày vì không biết chắc mail đã gửi hay chưa.

Phạm vi scheduler dành cho workspace cá nhân/ít tài khoản; cần phân trang/hàng đợi để mở rộng lớn. SMTP thật và Cloud Function chưa được deploy trong lượt tạo source này.

## Lưu ý vận hành

- Cần Internet để đăng nhập và lưu; không có offline write queue trong bản này.
- Dữ liệu được tải khi đăng nhập, sau thao tác và khi nhấn nút tải lại; chưa có realtime listener nhiều máy.
- Auth session và cache Firestore dùng bộ nhớ, không bật persistence trên đĩa.
- Thay đổi từ thiết bị khác sẽ gây version conflict nếu bạn sửa bản cũ; tải lại rồi sửa lại.
- Mỗi lần tải workspace đang đọc toàn bộ task/log/event của tài khoản, phù hợp dữ liệu cá nhân nhỏ; cần phân trang nếu dữ liệu tăng nhiều.
- Nếu Firebase báo permission-denied: kiểm tra projectId, rules v0.2 đã Publish và tài khoản hiện tại. Không hạ rules thành public.

Tài liệu chính thức:
https://firebase.google.com/docs/auth/web/password-auth
https://firebase.google.com/docs/firestore/security/rules-conditions
https://firebase.google.com/docs/firestore/manage-data/transactions
https://firebase.google.com/docs/functions/schedule-functions

## Kiểm tra rules bằng emulator

Cần Java 21+ và Node.js. Chạy `npm run test:firebase`. Tests dùng project giả `demo-taskflow`, không cần tài khoản Firebase và không gửi mail. Bao gồm đọc/ghi của chủ tài khoản, chặn user khác/anonymous, audit transaction, version, mail receipt chỉ server và import một lần. Trong môi trường tạo source chỉ có Java 17 nên bộ test emulator chưa chạy được; không coi build thành công là đã xác minh rules trên Firebase thật.
