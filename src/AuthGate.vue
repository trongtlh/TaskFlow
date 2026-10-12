<script setup>
import {ref,shallowRef,onMounted,onBeforeUnmount} from 'vue'
import App from './App.vue'
import Icon from './components/Icon.vue'
import {
  firebaseConfigured,
  watchAuth,
  login,
  register,
  resetPassword,
  firebaseMessage,
  loginWithGoogle,
} from './services/firebase'
import {resetWorkspace} from './composables/useWorkspace'
const user=shallowRef(null),ready=ref(false),email=ref(''),password=ref(''),mode=ref('login'),busy=ref(false),message=ref('')
let unsubscribe
onMounted(()=>{unsubscribe=watchAuth(value=>{resetWorkspace();user.value=value;ready.value=true;password.value=''})})
onBeforeUnmount(()=>unsubscribe?.())
async function submit(){busy.value=true;message.value='';try{if(mode.value==='register')await register(email.value,password.value);else await login(email.value,password.value)}catch(error){message.value=firebaseMessage(error)}finally{busy.value=false}}
async function forgot(){if(!email.value){message.value='Nhập email trước.';return}busy.value=true;try{await resetPassword(email.value);message.value='Nếu email có tài khoản, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu.'}catch(error){message.value=firebaseMessage(error)}finally{busy.value=false}}
async function submitGoogle() {
  if (busy.value) return

  busy.value = true
  message.value = 'Hãy chọn tài khoản Google trong trình duyệt…'

  try {
    await loginWithGoogle()
    message.value = ''
  } catch (error) {
    message.value = firebaseMessage(error)
  } finally {
    busy.value = false
  }
}
</script>
<template>
<App v-if="user" :key="user.uid"/>
<main v-else class="auth-page"><section class="surface auth-card"><div class="brand"><span class="brand-mark"><Icon name="check" :size="24"/></span>taskflow.</div>
<template v-if="!firebaseConfigured"><h1>Kết nối Firebase</h1><p>Cần cấu hình Firebase của bạn trước khi đăng nhập và lưu dữ liệu.</p><ol><li>Bật Authentication → Email/Password.</li><li>Tạo Cloud Firestore và áp dụng firestore.rules.</li><li>Điền Firebase Web Config vào file .env rồi chạy lại npm start.</li></ol><p class="notice">Xem FIREBASE-SETUP.md trong project. Dữ liệu SQLite cũ chưa bị thay đổi.</p></template>
<template v-else-if="!ready"><p>Đang kiểm tra phiên đăng nhập…</p></template>
<template v-else><h1>{{mode==='login'?'Đăng nhập':'Tạo tài khoản'}}</h1><p>Công việc của bạn, được lưu riêng theo tài khoản.</p><form @submit.prevent="submit"><label class="field-label">Email<input v-model="email" type="email" autocomplete="username" required :disabled="busy"/></label><label class="field-label">Mật khẩu<input v-model="password" type="password" :autocomplete="mode==='login'?'current-password':'new-password'" required :minlength="mode==='register'?6:1" :disabled="busy"/></label><p v-if="message" class="notice" role="alert">{{message}}</p><button class="button primary" :disabled="busy">{{busy?'Đang xử lý…':mode==='login'?'Đăng nhập':'Tạo tài khoản'}}</button></form>
    <button
  type="button"
  class="button"
  style="width: 100%; margin-top: 12px; justify-content: center;"
  :disabled="busy"
  @click="submitGoogle"
>
  {{ busy ? 'Đang xử lý…' : 'Đăng nhập bằng Google' }}
</button>
<div class="button-row auth-actions"><button class="text-button" :disabled="busy" @click="mode=mode==='login'?'register':'login';message=''">{{mode==='login'?'Tạo tài khoản mới':'Đã có tài khoản? Đăng nhập'}}</button><button class="text-button" :disabled="busy" @click="forgot">Quên mật khẩu?</button></div><p class="footnote">Cần Internet. Phiên đăng nhập được giữ trên máy này; quá 48 giờ không dùng app sẽ tự đăng xuất.</p></template>
</section></main>
</template>
