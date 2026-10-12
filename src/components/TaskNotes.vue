<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  MAX_IMAGES,
  addNote,
  loadNoteImage,
  storageReady,
} from '../services/taskNotes'
import {
  state,
  run,
  notify,
  stampLabel,
} from '../composables/useWorkspace'
import { firebaseMessage } from '../services/firebase'

const props = defineProps({ task: Object })
const emit = defineEmits(['dirty'])


const emptyForm = () => ({
  content: '',
  file_path: '',
  symbol: '',
  language: 'text',
  before: '',
  after: '',
})

const form = ref(emptyForm())
const attachments = ref([])
const groups = [
  { key: 'before', label: 'Ảnh trước' },
  { key: 'after', label: 'Ảnh sau' },
]
const activeGroup = ref('before')
const inputKey = ref(0)
let attachmentSeq = 0
const query = ref('')
const error = ref('')
const urls = ref({})
const loading = ref({})
const expanded = ref('')
let alive = true

const languages = [
  'text', 'javascript', 'typescript', 'vue',
  'python', 'html', 'css', 'sql', 'json', 'bash',
]

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .toLowerCase()

const notes = computed(() => (state.notes || [])
  .filter(note => note.task_id === props.task?.id)
  .filter(note => normalize([
    note.content,
    note.file_path,
    note.symbol,
    note.before,
    note.after,
    note.image_name,
    ...noteImages(note).map(image => image.name),
  ].join(' ')).includes(normalize(query.value)))
  .sort((a, b) => b.created_at.localeCompare(a.created_at)))

function markDirty() {
  emit('dirty', hasPending())
}

function addFiles(selected, group = activeGroup.value) {
  for (const file of [...(selected || [])]) {
    if (attachments.value.length >= MAX_IMAGES) {
      error.value = `Tối đa ${MAX_IMAGES} ảnh mỗi bản ghi.`
      break
    }

    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      error.value = 'Chọn PNG, JPEG hoặc WebP tối đa 5 MB.'
      continue
    }

    const item = { id: ++attachmentSeq, file, group, preview: '' }
    attachments.value.push(item)
    error.value = ''

    const reader = new FileReader()
    reader.onload = () => {
      const current = attachments.value.find(entry => entry.id === item.id)
      if (current) current.preview = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  inputKey.value++
  markDirty()
}

function removeFile(id) {
  attachments.value = attachments.value.filter(item => item.id !== id)
  markDirty()
}

function clearFiles() {
  attachments.value = []
  inputKey.value++
}

function pasteImage(event) {
  if (props.task?.deleted_at) return

  const files = [...(event.clipboardData?.items || [])]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean)

  if (!files.length) return

  event.preventDefault()
  addFiles(files)
}

function hasPending() {
  return attachments.value.length > 0 || Object.entries(form.value)
    .some(([key, value]) => key !== 'language' && !!value)
}

function validatePending() {
  if (!hasPending()) return

  if (
    !form.value.content.trim() &&
    !form.value.before.trim() &&
    !form.value.after.trim() &&
    !attachments.value.length
  ) {
    throw new Error('Hãy nhập bình luận, code hoặc chọn ảnh.')
  }

  if (attachments.value.length && !storageReady()) {
    throw new Error('Chưa cấu hình Storage để lưu ảnh.')
  }
}

async function savePending(taskId) {
  if (!hasPending()) return true

  validatePending()

  // Chỉ xóa nội dung nhập sau khi Firebase xác nhận lưu thành công.
  const result = await addNote(
    taskId,
    { ...form.value },
    attachments.value.map(({ file, group }) => ({ file, group })),
  )

  form.value = emptyForm()
  clearFiles()
  error.value = ''
  markDirty()

  return result
}

async function submit() {
  if (!props.task?.id) return

  await run(
    () => savePending(props.task.id),
    'Đã lưu bình luận / code',
  )
}

defineExpose({
  hasPending,
  validatePending,
  savePending,
})

onMounted(() => document.addEventListener('paste', pasteImage))

function noteImages(note) {
  const images = Array.isArray(note.images) ? [...note.images] : []

  if (note.image_path) {
    images.unshift({
      path: note.image_path,
      name: note.image_name,
      group: 'before',
    })
  }

  return images.filter(image => image?.path)
}

function groupImages(note, group) {
  return noteImages(note)
    .map((image, index) => ({ ...image, index }))
    .filter(image => (image.group === 'after' ? 'after' : 'before') === group)
}

async function showImage(note, image, index) {
  const id = `${note.id}:${index}`

  if (urls.value[id]) {
    expanded.value = urls.value[id]
    return
  }

  loading.value[id] = true

  try {
    const url = await loadNoteImage(image.path)

    if (!alive) return

    urls.value[id] = url
    expanded.value = url
  } catch (err) {
    error.value = firebaseMessage(err)
  } finally {
    loading.value[id] = false
  }
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code)
    notify('Đã copy code')
  } catch {
    error.value = 'Hãy chọn đoạn code rồi nhấn Ctrl+C.'
  }
}

onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('paste', pasteImage)
})
</script>

<template>
  <section class="task-notes">
    <p class="muted">
      Lưu vị trí sửa code, lý do và ảnh minh họa.
      Thêm bản ghi mới khi cần đính chính.
    </p>

    <p v-if="error" class="notice warning" role="alert">
      {{ error }}
    </p>

    <form
      v-if="!task?.deleted_at"
      class="note-compose"
      @submit.prevent="submit"
      @input="markDirty"
      @dragover.prevent
      @drop.prevent="addFiles($event.dataTransfer.files, activeGroup)"
    >
      <label class="field-label">
        Bình luận / lý do sửa
        <textarea
          v-model="form.content"
          rows="3"
          maxlength="10000"
          placeholder="Đã sửa gì? Vì sao? Kết quả kiểm tra?"
        />
      </label>

      <div class="note-grid">
        <label class="field-label">
          Đường dẫn file
          <input
            v-model="form.file_path"
            maxlength="500"
            placeholder="src/services/api.js"
          />
        </label>

        <label class="field-label">
          Hàm / dòng tham khảo
          <input
            v-model="form.symbol"
            maxlength="200"
            placeholder="createTask · dòng 42"
          />
        </label>
      </div>

      <label class="field-label">
        Ngôn ngữ
        <select v-model="form.language">
          <option v-for="language in languages" :key="language">
            {{ language }}
          </option>
        </select>
      </label>

      <div class="note-grid">
        <label class="field-label">
          Code trước
          <textarea
            v-model="form.before"
            class="code-input"
            rows="6"
            maxlength="30000"
            spellcheck="false"
          />
        </label>

        <label class="field-label">
          Code sau
          <textarea
            v-model="form.after"
            class="code-input"
            rows="6"
            maxlength="30000"
            spellcheck="false"
          />
        </label>
      </div>

      <div class="image-groups">
        <div
          v-for="group in groups"
          :key="group.key"
          class="image-group"
          :class="{ active: activeGroup === group.key }"
          tabindex="0"
          @focusin="activeGroup = group.key"
          @click="activeGroup = group.key"
          @dragover.prevent
          @drop.prevent.stop="addFiles($event.dataTransfer.files, group.key)"
        >
          <strong>{{ group.label }}</strong>

          <input
            :key="inputKey"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            :disabled="!storageReady() || state.busy"
            @change="addFiles($event.target.files, group.key)"
          />

          <div class="thumb-grid">
            <figure
              v-for="item in attachments.filter(i => i.group === group.key)"
              :key="item.id"
            >
              <button
                type="button"
                class="image-button"
                :disabled="!item.preview"
                @click="expanded = item.preview"
              >
                <img
                  v-if="item.preview"
                  :src="item.preview"
                  :alt="item.file.name"
                />
                <span v-else>Đang đọc ảnh…</span>
              </button>
              <figcaption>
                {{ item.file.name }}
                <button
                  type="button"
                  class="text-button"
                  @click.stop="removeFile(item.id)"
                >
                  Bỏ ảnh
                </button>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>

      <p v-if="!storageReady()" class="muted">
        Chưa cấu hình Storage. Bạn vẫn lưu được bình luận và code.
      </p>
      <p v-else class="muted">
        PNG / JPEG / WebP, tối đa 5 MB mỗi ảnh và {{ MAX_IMAGES }} ảnh mỗi
        bản ghi. Bấm vào ô Ảnh trước / Ảnh sau rồi dán bằng Ctrl+V, chọn nhiều
        ảnh hoặc kéo thả vào ô. Bấm ảnh để phóng to.
      </p>

      <button
        v-if="task?.id"
        class="button primary"
        :disabled="state.busy"
        >
        {{ state.busy ? 'Đang lưu…' : 'Thêm bản ghi' }}
        </button>

        <p v-else class="muted">
        Nội dung này sẽ được lưu khi bạn nhấn “Tạo task”.
        </p>
    </form>

    <label class="field-label">
      Tìm trong task
      <input
        v-model="query"
        placeholder="Bình luận, code, đường dẫn file, tên hàm…"
      />
    </label>

    <p v-if="!notes.length" class="muted">
      Chưa có bản ghi phù hợp.
    </p>

    <article v-for="note in notes" :key="note.id" class="note-card">
      <small>{{ stampLabel(note.created_at) }} · Bạn</small>

      <p class="note-content">{{ note.content }}</p>

      <p v-if="note.file_path || note.symbol">
        <strong>{{ note.file_path }}</strong>
        {{ note.symbol }}
      </p>

      <div v-for="part in ['before', 'after']" :key="part">
        <template v-if="note[part]">
          <div class="section-heading">
            <strong>
              {{ part === 'before' ? 'Trước' : 'Sau' }}
              · {{ note.language }}
            </strong>
            <button
              type="button"
              class="text-button"
              @click="copyCode(note[part])"
            >
              Copy
            </button>
          </div>

          <pre><code>{{ note[part] }}</code></pre>
        </template>
      </div>

      <div v-if="noteImages(note).length" class="image-groups">
        <template v-for="group in groups" :key="group.key">
          <div v-if="groupImages(note, group.key).length">
            <strong>{{ group.label }}</strong>
            <div class="thumb-grid">
              <figure
                v-for="image in groupImages(note, group.key)"
                :key="image.path"
              >
                <button
                  type="button"
                  class="image-button"
                  :disabled="loading[`${note.id}:${image.index}`]"
                  @click="showImage(note, image, image.index)"
                >
                  <img
                    v-if="urls[`${note.id}:${image.index}`]"
                    :src="urls[`${note.id}:${image.index}`]"
                    :alt="image.name"
                  />
                  <span v-else>
                    {{
                      loading[`${note.id}:${image.index}`]
                        ? 'Đang tải ảnh…'
                        : `Xem ảnh: ${image.name}`
                    }}
                  </span>
                </button>
              </figure>
            </div>
          </div>
        </template>
      </div>
    </article>

    <div
      v-if="expanded"
      class="image-preview"
      role="dialog"
      aria-label="Ảnh đính kèm"
      @click.self="expanded = ''"
      @keydown.esc.stop="expanded = ''"
    >
      <button type="button" class="button" @click="expanded = ''">
        Đóng ảnh
      </button>
      <img :src="expanded" alt="Ảnh phóng to" />
    </div>
  </section>
</template>

<style scoped>
.task-notes {
  display: grid;
  gap: 16px;
}

.note-compose,
.note-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #dfe5ef;
  border-radius: 12px;
}

.note-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.code-input,
pre {
  font-family: Consolas, monospace;
  font-size: 12px;
  tab-size: 2;
}

pre {
  overflow: auto;
  max-height: 360px;
  padding: 14px;
  border-radius: 8px;
  background: #152033;
  color: #e4eafa;
  white-space: pre;
}

.note-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.image-groups {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.image-group {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 12px;
  border: 1px dashed #b9c3d6;
  border-radius: 10px;
  outline: none;
}

.image-group.active,
.image-group:focus {
  border-color: #4f6bed;
  background: #f4f6ff;
}

.thumb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.thumb-grid figure {
  display: grid;
  gap: 6px;
  margin: 0;
  align-content: start;
}

.thumb-grid figcaption {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.file-preview {
  display: grid;
  gap: 8px;
}

.file-preview img {
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
  justify-self: start;
  border: 1px solid #dde3ef;
  border-radius: 8px;
}

.image-button {
  padding: 8px;
  border: 1px solid #dde3ef;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.image-button img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
}

.image-preview {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: #101827ed;
}

.image-preview img {
  max-width: 95vw;
  max-height: 80vh;
  object-fit: contain;
}

@media (max-width: 600px) {
  .note-grid,
  .image-groups {
    grid-template-columns: 1fr;
  }
}
</style>