# Taskflow Desktop — Firebase edition (v0.2)

**Vue 3 + Electron + Firebase Authentication + Cloud Firestore.** Python dùng cho công cụ đọc SQLite cũ và tác vụ email trên Firebase Cloud Functions.

Khác bản v0.1: bắt buộc đăng nhập; dữ liệu công việc chính được ghi trực tiếp lên Firestore theo UID. SQLite cũ chỉ giữ để nhập dữ liệu, không tiếp tục nhận task mới. Scheduler SMTP local đã tắt để tránh gửi trùng hoặc gửi nhắc từ workspace cũ.

## Bắt đầu

1. Cài Node.js 22.12+/24+ và Python 3.11+ (bật Add Python to PATH).
2. Làm theo **FIREBASE-SETUP.md**: bật Email/Password, tạo Firestore, Publish rules mới, điền `.env`.
3. Chạy `npm ci`, rồi `npm start`; hoặc mở `START-WINDOWS.cmd`.
4. Đăng nhập / tạo tài khoản trong app, tạo task và kiểm tra document trong Firebase Console.

Không cần hosting website. App Electron vẫn chạy trên máy, dữ liệu nằm trên Firebase. Không còn dùng offline khi chưa đăng nhập. Mã nguồn không chứa project/credential thật của bạn.

## Chức năng

- Đăng nhập, đăng ký email/password, reset mật khẩu, xác minh email, đăng xuất.
- Workspace Firestore riêng từng UID; reset state khi đổi tài khoản.
- CRUD task, ngày bắt đầu/deadline, checklist, Kanban, My Day, lịch, tìm kiếm.
- Work log và audit trước/sau; ghi task + audit bằng transaction.
- Soft delete/restore, chống ghi đè version cũ.
- Export JSON cloud, import SQLite cũ một lần vào cloud trống.
- Mã Python scheduled function cho email; cần triển khai và SMTP riêng.

## Chạy và build

```powershell
npm ci
npm start
# Phát triển:
npm run dev
# Build frontend:
npm run build
# Test backend đọc SQLite:
npm test
```

Build Windows trên Windows x64: `BUILD-WINDOWS.cmd` hoặc `npm run dist:win` sau khi cài PyInstaller. Bộ cài chưa được build/kiểm thử/ký số ở môi trường hiện tại.

## Các phần chính

- src/AuthGate.vue: chặn workspace khi chưa đăng nhập.
- src/services/firebase.js: Firebase Auth và khởi tạo SDK.
- src/services/cloudStore.js: CRUD Firestore theo UID và transaction.
- src/services/api.js: chuyển dữ liệu Vue thành JSON trước khi gọi service.
- src/components/: task detail, Kanban card, calendar, activity và settings.
- firestore.rules: phân quyền và validation phía Firebase.
- functions/main.py: nhắc việc Python trên cloud.
- backend/server.py: SQLite v0.1 giữ lại để nhập dữ liệu cũ.
- electron/: cửa sổ app, bridge giới hạn và khởi động Python.

## Giới hạn hiện tại

Cần mạng; chưa có realtime listener, offline write, cloud JSON restore hoặc import dữ liệu lớn nhiều lô. Không nhúng admin key vào app. Tất cả chi tiết và bước xác minh dữ liệu cloud ở FIREBASE-SETUP.md.
