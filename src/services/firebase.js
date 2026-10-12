import { initializeApp } from 'firebase/app'
import {
  initializeAuth,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'
const config = {apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID}
export const firebaseConfigured = !!(config.apiKey && config.projectId && config.appId)
export let auth=null, db=null
if(firebaseConfigured) {
  const app=initializeApp(config)
  auth=initializeAuth(app,{persistence:browserLocalPersistence})
  db=initializeFirestore(app,{localCache:memoryLocalCache()})
}
export const currentCloudUser=()=>auth?.currentUser||null
// Phiên được giữ bằng refresh token của Firebase; không dùng app quá 48 giờ thì tự đăng xuất.
const IDLE_LIMIT_MS=48*60*60*1000,ACTIVE_KEY='taskflow:last-active'
const lastActive=()=>{try{return Number(localStorage.getItem(ACTIVE_KEY))||0}catch{return 0}}
const markActive=()=>{try{localStorage.setItem(ACTIVE_KEY,String(Date.now()))}catch{}}
const clearActive=()=>{try{localStorage.removeItem(ACTIVE_KEY)}catch{}}
const idleExpired=()=>{const last=lastActive();return last>0&&Date.now()-last>IDLE_LIMIT_MS}
// Xóa mốc cũ khi hết hạn, nếu không lần đăng nhập sau vẫn thấy mốc cũ và bị đăng xuất ngay.
const expire=()=>{clearActive();signOut(auth).catch(()=>{})}
export function watchAuth(callback){
 if(!auth){callback(null);return()=>{}}
 let lastMark=0
 const touch=()=>{if(!auth.currentUser)return;const now=Date.now();if(now-lastMark>60000){lastMark=now;markActive()}}
 const check=()=>{if(auth.currentUser&&idleExpired())expire()}
 const events=['pointerdown','keydown','focus']
 events.forEach(name=>window.addEventListener(name,touch))
 const timer=setInterval(check,10*60*1000)
 const stop=onAuthStateChanged(auth,user=>{
  if(user&&idleExpired()){expire();return}
  if(user)markActive()
  callback(user)
 })
 return()=>{stop();clearInterval(timer);events.forEach(name=>window.removeEventListener(name,touch))}
}
// Đăng nhập chủ động tính là hoạt động mới, để mốc cũ không đăng xuất phiên vừa tạo.
export async function login(email,password){if(!auth)throw Error('Chưa cấu hình Firebase.');markActive();return (await signInWithEmailAndPassword(auth,email.trim(),password)).user}
export async function register(email,password){if(!auth)throw Error('Chưa cấu hình Firebase.');markActive();const result=await createUserWithEmailAndPassword(auth,email.trim(),password);return result.user}
export async function resetPassword(email){if(!auth)throw Error('Chưa cấu hình Firebase.');await sendPasswordResetEmail(auth,email.trim())}
export async function verifyEmail(){if(!auth?.currentUser)throw Error('Chưa đăng nhập.');await sendEmailVerification(auth.currentUser)}
export async function refreshUser(){await auth.currentUser.reload();await auth.currentUser.getIdToken(true);return auth.currentUser}
export async function logout(){clearActive();if(auth)await signOut(auth)}
export function firebaseMessage(error){const code=error.code;return ({
 'auth/invalid-credential':'Email hoặc mật khẩu không đúng.',
 'auth/email-already-in-use':'Email đã có tài khoản. Hãy đăng nhập.',
 'auth/weak-password':'Mật khẩu chưa đáp ứng chính sách Firebase.',
 'auth/invalid-email':'Email không hợp lệ.',
 'auth/too-many-requests':'Bạn thao tác quá nhiều lần. Hãy thử lại sau.',
 'auth/network-request-failed':'Không kết nối được Firebase. Kiểm tra Internet.',
 'auth/operation-not-allowed':
  'Hãy bật phương thức đăng nhập tương ứng trong Firebase Authentication.',
 'permission-denied':'Firebase từ chối truy cập. Kiểm tra firestore.rules và tài khoản đăng nhập.',
 'unavailable':'Không kết nối được Firestore. Thay đổi chưa được xác nhận lưu.',
})[code]||error.message}

export async function loginWithGoogle() {
  if (!auth) {
    throw new Error('Chưa cấu hình Firebase.')
  }

  if (typeof window.taskflow?.signInGoogle !== 'function') {
    throw new Error(
      'Chưa cấu hình đăng nhập Google trong app desktop.'
    )
  }

  // Electron mở trình duyệt để đăng nhập Google
  // và trả token về sau khi đăng nhập thành công.
  const result = await window.taskflow.signInGoogle()

  if (!result?.idToken) {
    throw new Error('Không nhận được kết quả đăng nhập Google.')
  }

  const credential = GoogleAuthProvider.credential(result.idToken)
  markActive()
  try {
    return (await signInWithCredential(auth, credential)).user
  } catch (error) {
    const detail = error.customData?._tokenResponse?.error?.message
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/operation-not-allowed') {
      throw new Error(
        'Firebase từ chối token Google' + (detail ? ` (${detail})` : '') +
        '. Kiểm tra: đã bật provider Google trong Firebase Authentication, và Client ID desktop thuộc project Firebase này hoặc đã được thêm vào "Safelist client IDs from external projects".'
      )
    }
    throw error
  }
}
