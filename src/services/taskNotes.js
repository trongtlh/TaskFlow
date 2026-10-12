import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db, currentCloudUser } from "./firebase";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_IMAGES = 10;

export const storageReady = () =>
  typeof window.taskflow?.saveLocalImage === "function" &&
  typeof window.taskflow?.readLocalImage === "function";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const hasMagic = (b) =>
  (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
  (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
  (String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP");

export async function addNote(rawTaskId, form, rawFiles = []) {
  const user = currentCloudUser();
  if (!user) throw new Error("Hãy đăng nhập.");

  const taskId = String(rawTaskId);
  if (!SAFE_ID.test(taskId)) throw new Error("Mã task không hợp lệ.");

  const files = [...rawFiles]
    .filter(Boolean)
    .map((item) =>
      item.file
        ? { file: item.file, group: item.group === "after" ? "after" : "before" }
        : { file: item, group: "before" },
    );

  if (files.length > MAX_IMAGES) {
    throw new Error(`Tối đa ${MAX_IMAGES} ảnh mỗi bản ghi.`);
  }

  const noteRef = doc(collection(db, "users", user.uid, "notes"));

  const data = {
    task_id: rawTaskId,
    content: form.content || "",
    file_path: form.file_path || "",
    symbol: form.symbol || "",
    language: form.language || "text",
    before: form.before || "",
    after: form.after || "",
    image_path: "",
    image_name: "",
    images: [],
    actor_uid: user.uid,
    created_at: serverTimestamp(),
  };

  const limits = {
    content: 10000,
    file_path: 500,
    symbol: 200,
    language: 40,
    before: 30000,
    after: 30000,
  };

  for (const [key, max] of Object.entries(limits)) {
    if (typeof data[key] !== "string" || data[key].length > max) {
      throw new Error(`Nội dung không hợp lệ hoặc quá dài: ${key}`);
    }
  }

  if (
    !data.content.trim() &&
    !data.before.trim() &&
    !data.after.trim() &&
    !files.length
  ) {
    throw new Error("Nhập bình luận, code hoặc chọn ảnh.");
  }

  const saved = [];

  const saveImage = async ({ file, group }, index) => {
    if (!storageReady()) {
      throw new Error("Hãy mở bằng app desktop để lưu ảnh trên máy.");
    }

    const allowed = ["image/png", "image/jpeg", "image/webp"];

    if (!allowed.includes(file.type) || file.size > MAX_IMAGE_SIZE) {
      throw new Error("Chọn PNG, JPEG hoặc WebP tối đa 5 MB.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (!hasMagic(bytes)) {
      throw new Error("Chọn PNG, JPEG hoặc WebP tối đa 5 MB.");
    }

    const imagePath = `users/${user.uid}/task-images/${taskId}/${noteRef.id}_${index + 1}`;

    await window.taskflow.saveLocalImage({
      uid: user.uid,
      imagePath,
      bytes,
    });

    saved.push(imagePath);
    data.images.push({
      path: imagePath,
      name: (file.name || "image").slice(0, 200),
      group,
    });
  };

  const cleanup = () =>
    Promise.all(
      saved.map((imagePath) =>
        window.taskflow
          .deleteLocalImage?.({ uid: user.uid, imagePath })
          ?.catch(() => {}),
      ),
    );

  try {
    for (const [index, file] of files.entries()) {
      await saveImage(file, index);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  try {
    await runTransaction(db, async (tx) => {
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);

      const task = await tx.get(taskRef);

      if (!task.exists() || task.data().deleted_at) {
        throw new Error("Task không tồn tại hoặc đã xóa.");
      }

      if (currentCloudUser()?.uid !== user.uid) {
        throw new Error("Phiên đăng nhập đã thay đổi.");
      }

      tx.set(noteRef, data);

      tx.set(doc(db, "users", user.uid, "events", noteRef.id), {
        task_id: rawTaskId,
        task_title: task.data().title ?? null,
        task_version: task.data().version ?? null,
        action: "noted",
        actor_uid: user.uid,
        created_at: serverTimestamp(),
        changes: {
          note: {
            before: null,
            after: {
              id: noteRef.id,
              content: data.content,
              file_path: data.file_path,
              symbol: data.symbol,
              image_names: data.images.map((image) => image.name),
            },
          },
        },
      });
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  return { id: noteRef.id };
}

export async function loadNoteImage(imagePath) {
  const user = currentCloudUser();

  if (!user) {
    throw new Error("Hãy đăng nhập.");
  }

  if (!storageReady()) {
    throw new Error("Hãy mở app desktop để xem ảnh local.");
  }

  const prefix = `users/${user.uid}/task-images/`;
  const parts =
    typeof imagePath === "string"
      ? imagePath.slice(prefix.length).split("/")
      : [];

  if (
    typeof imagePath !== "string" ||
    !imagePath.startsWith(prefix) ||
    parts.length !== 2 ||
    !parts.every((p) => SAFE_ID.test(p))
  ) {
    throw new Error("Đường dẫn ảnh không thuộc tài khoản hiện tại.");
  }

  const imageUrl = await window.taskflow.readLocalImage({
    uid: user.uid,
    imagePath,
  });

  if (currentCloudUser()?.uid !== user.uid) {
    throw new Error("Phiên đăng nhập đã thay đổi.");
  }

  return imageUrl;
}
