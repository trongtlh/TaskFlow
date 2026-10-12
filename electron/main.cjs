const {
  app, BrowserWindow, ipcMain, dialog, shell, nativeImage,
} = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { readFileSync, existsSync } = require('node:fs')
const { writeFile, readFile, mkdir, rm } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { parseEnv } = require('node:util')
const { createServer } = require('node:http')
const { OAuth2Client } = require('google-auth-library')
let child, win, port, quitting = false
const token = randomBytes(32).toString('hex')
const root = path.join(__dirname, '..')
const dev = !app.isPackaged && process.env.TASKFLOW_DEV === '1'
const dataDir = () => app.getPath('userData')

async function api(method, route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  })

  const value = await response.json()
  if (!response.ok) {
    throw new Error(value.error || 'Không kết nối được dữ liệu.')
  }

  return value
}
function validSender(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame
  ) {
    throw new Error('Invalid caller')
  }

  const url = event.senderFrame.url

  const allowed = dev
    ? url.startsWith('http://127.0.0.1:5173/')
    : url.split('#')[0] ===
      pathToFileURL(path.join(root, 'dist/index.html')).href

  if (!allowed) {
    throw new Error('Invalid origin')
  }
}
async function startBackend() {
  let envFile = {}
  const envPath = app.isPackaged ? path.join(dataDir(), '.env') : path.join(root, '.env')
  if (existsSync(envPath)) envFile = parseEnv(readFileSync(envPath, 'utf8'))
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'taskflow-api.exe' : 'taskflow-api') : (process.env.TASKFLOW_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'))
  const args = app.isPackaged ? [] : [path.join(root, 'backend/server.py')]
  child = spawn(executable, [...args, '--data-dir', dataDir()], {env: {...process.env, ...envFile, TASKFLOW_TOKEN: token, TASKFLOW_DISABLE_LOCAL_REMINDERS: '1', PYTHONUNBUFFERED: '1'}, windowsHide: true, stdio: ['ignore','pipe','pipe']})
  child.stderr.on('data', () => {})
  await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Python không khởi động trong 20 giây.')), 20000)
    child.once('error', (err) => {clearTimeout(timer); reject(new Error('Không chạy được Python. Cài Python 3.11+ và bật Add Python to PATH. ' + err.message))})
    child.once('exit', () => {clearTimeout(timer); reject(new Error('Backend đã dừng khi khởi động.'))})
    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index < 0) break
        const line = buffer.slice(0,index); buffer = buffer.slice(index+1)
        try {const ready = JSON.parse(line); if (ready.ready) {port = ready.port; clearTimeout(timer); resolve()}} catch {}
      }
    })
  })
  await api('GET','/health')
  child.on('exit', () => {
    if (!quitting) {dialog.showErrorBox('Taskflow', 'Backend đã dừng. Các thay đổi đã lưu vẫn an toàn. Hãy mở lại app.'); app.quit()}
  })
}

function localImagePath(uid, imagePath) {
  if (
    typeof uid !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
    typeof imagePath !== 'string'
  ) {
    throw new Error('Thông tin ảnh không hợp lệ.')
  }

  const prefix = `users/${uid}/task-images/`

  if (!imagePath.startsWith(prefix)) {
    throw new Error('Đường dẫn ảnh không hợp lệ.')
  }

  const parts = imagePath.slice(prefix.length).split('/')

  if (
    parts.length !== 2 ||
    !/^[1-9][0-9]*$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(parts[1])
  ) {
    throw new Error('Mã task hoặc mã ảnh không hợp lệ.')
  }

  return path.join(
    dataDir(),
    'attachments',
    ...imagePath.split('/'),
  )
}

let googleLoginBusy = false

async function signInGoogleDesktop() {
  if (googleLoginBusy) {
    throw new Error('Đang có một phiên đăng nhập Google. Hãy hoàn tất trong trình duyệt.')
  }

  googleLoginBusy = true

  try {
    const envPath = app.isPackaged
      ? path.join(dataDir(), '.env')
      : path.join(root, '.env')

    const fileEnv = existsSync(envPath)
      ? parseEnv(readFileSync(envPath, 'utf8'))
      : {}

    const clientId =
      fileEnv.GOOGLE_DESKTOP_CLIENT_ID ||
      process.env.GOOGLE_DESKTOP_CLIENT_ID

    const clientSecret =
      fileEnv.GOOGLE_DESKTOP_CLIENT_SECRET ||
      process.env.GOOGLE_DESKTOP_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      throw new Error(
        'Thiếu GOOGLE_DESKTOP_CLIENT_ID hoặc GOOGLE_DESKTOP_CLIENT_SECRET trong .env.'
      )
    }

    const oauth = new OAuth2Client({
      clientId,
      clientSecret,
    })

    const { codeVerifier, codeChallenge } =
      await oauth.generateCodeVerifierAsync()

    const expectedState = randomBytes(32).toString('hex')
    const expectedNonce = randomBytes(32).toString('hex')

    return await new Promise((resolve, reject) => {
      let finished = false
      let exchanging = false
      let redirectUri
      let timer

      const controller = new AbortController()

      function finish(error, result) {
        if (finished) return
        finished = true

        clearTimeout(timer)
        app.removeListener('before-quit', onQuit)
        controller.abort()

        server.close()
        server.closeAllConnections()

        if (error) reject(error)
        else resolve(result)
      }

      function onQuit() {
        finish(new Error('Đã hủy đăng nhập vì app đang đóng.'))
      }

      function reply(response, status, message) {
        response.writeHead(status, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Connection': 'close',
        })
        response.end(message)
      }

      const server = createServer(async (request, response) => {
        try {
          const callback = new URL(
            request.url,
            'http://127.0.0.1'
          )

          if (
            request.method !== 'GET' ||
            callback.pathname !== '/oauth2callback'
          ) {
            reply(response, 404, 'Không tìm thấy.')
            return
          }

          if (callback.searchParams.get('state') !== expectedState) {
            reply(response, 400, 'Phiên đăng nhập không hợp lệ.')
            return
          }

          if (finished || exchanging) {
            reply(response, 409, 'Phiên đăng nhập đang được xử lý.')
            return
          }

          if (callback.searchParams.has('error')) {
            response.once('finish', () => {
              finish(new Error('Bạn đã hủy hoặc từ chối đăng nhập Google.'))
            })
            reply(response, 400, 'Đã hủy đăng nhập. Bạn có thể quay lại Taskflow.')
            return
          }

          const code = callback.searchParams.get('code')

          if (!code) {
            reply(response, 400, 'Thiếu mã đăng nhập.')
            return
          }

          exchanging = true

          const tokenResponse = await fetch(
            'https://oauth2.googleapis.com/token',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
              }),
              signal: controller.signal,
            }
          )

          const tokens = await tokenResponse.json()

          if (!tokenResponse.ok || !tokens.id_token) {
            throw new Error(
              'Không đổi được mã đăng nhập Google. Kiểm tra Desktop Client ID và Client secret.'
            )
          }

          const ticket = await oauth.verifyIdToken({
            idToken: tokens.id_token,
            audience: clientId,
          })

          if (finished) return

          if (ticket.getPayload()?.nonce !== expectedNonce) {
            throw new Error('Kết quả đăng nhập Google không khớp phiên hiện tại.')
          }

          response.once('finish', () => {
            finish(null, { idToken: tokens.id_token })

            if (win && !win.isDestroyed()) {
              if (win.isMinimized()) win.restore()
              win.focus()
            }
          })

          reply(
            response,
            200,
            'Đã xác thực Google. Hãy quay lại Taskflow để hoàn tất đăng nhập. Bạn có thể đóng tab này.'
          )
        } catch (error) {
          if (finished) return

          response.once('finish', () => {
            finish(error)
          })

          reply(
            response,
            500,
            'Không hoàn tất được đăng nhập. Hãy quay lại Taskflow và thử lại.'
          )
        }
      })

      server.on('error', () => {
        finish(new Error('Không mở được cổng nhận đăng nhập Google trên máy.'))
      })

      app.once('before-quit', onQuit)

      timer = setTimeout(() => {
        finish(new Error('Đăng nhập Google đã hết thời gian chờ. Hãy thử lại.'))
      }, 180000)

      server.listen(0, '127.0.0.1', async () => {
        try {
          if (finished) {
            server.close()
            return
          }

          const address = server.address()

          redirectUri =
            `http://127.0.0.1:${address.port}/oauth2callback`

          const authUrl = oauth.generateAuthUrl({
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: ['openid', 'email', 'profile'],
            state: expectedState,
            nonce: expectedNonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            prompt: 'select_account',
          })

          await shell.openExternal(authUrl)
        } catch (error) {
          finish(error)
        }
      })
    })
  } finally {
    googleLoginBusy = false
  }
}

function registerIpc() {
  ipcMain.handle('taskflow:google-sign-in', async event => {
    validSender(event)
    return signInGoogleDesktop()
  })

  ipcMain.handle('taskflow:image-save', async (event, payload) => {
    validSender(event)

    const { uid, imagePath, bytes } = payload || {}
    const target = localImagePath(uid, imagePath)

    if (!(bytes instanceof Uint8Array)) {
      throw new Error('Dữ liệu ảnh không hợp lệ.')
    }

    if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) {
      throw new Error('Ảnh phải nhỏ hơn hoặc bằng 5 MB.')
    }

    const buffer = Buffer.from(bytes)

    const isPng =
      buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'

    const isJpeg =
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff

    const isWebp =
      buffer.subarray(0, 4).toString() === 'RIFF' &&
      buffer.subarray(8, 12).toString() === 'WEBP'

    if (!isPng && !isJpeg && !isWebp) {
      throw new Error('Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP.')
    }

    const image = nativeImage.createFromBuffer(buffer)

    if (image.isEmpty()) {
      throw new Error('File ảnh bị lỗi hoặc không đọc được.')
    }

    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, buffer, { flag: 'wx' })

    return true
  })

  ipcMain.handle('taskflow:image-read', async (event, payload) => {
    validSender(event)

    const { uid, imagePath } = payload || {}
    const target = localImagePath(uid, imagePath)

    let buffer

    try {
      buffer = await readFile(target)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          'Không tìm thấy ảnh trên máy này. Ảnh local không tự đồng bộ.',
        )
      }

      throw error
    }

    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('Ảnh vượt giới hạn 5 MB.')
    }

    const image = nativeImage.createFromBuffer(buffer)

    if (image.isEmpty()) {
      throw new Error('Không đọc được ảnh.')
    }

    return image.toDataURL()
  })

  ipcMain.handle('taskflow:image-delete', async (event, payload) => {
    validSender(event)

    const { uid, imagePath } = payload || {}
    await rm(localImagePath(uid, imagePath), { force: true })

    return true
  })

  const routes = {
    state: () => ['GET', '/state'],
    createTask: body => ['POST', '/tasks', body],
    updateTask: ({ id, ...body }) =>
      ['PATCH', `/tasks/${Number(id)}`, body],
    deleteTask: ({ id }) =>
      ['DELETE', `/tasks/${Number(id)}`],
    restoreTask: ({ id }) =>
      ['POST', `/tasks/${Number(id)}/restore`, {}],
    addLog: ({ id, ...body }) =>
      ['POST', `/tasks/${Number(id)}/logs`, body],
    saveSettings: body => ['PUT', '/settings', body],
    backup: () => ['GET', '/backup'],
  }
  ipcMain.handle('taskflow:request', async (event, action, payload) => {
    validSender(event)
    if (!Object.hasOwn(routes, action)) throw new Error('Unknown action')
    return api(...routes[action](payload))
  })
  ipcMain.handle('taskflow:export', async event => {
    validSender(event)
    const selected = await dialog.showSaveDialog(win, {
    defaultPath: `taskflow-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [
      { name: 'Taskflow backup', extensions: ['json'] },
    ],
  })
    if (selected.canceled) return false
    await writeFile(selected.filePath, JSON.stringify(await api('GET','/backup'),null,2),'utf8')
    return true
  })
  async function restore(payload) {
    const answer = await dialog.showMessageBox(win, {type:'warning', title:'Khôi phục workspace?', message:'Thay thế toàn bộ task, work log và lịch sử hiện tại bằng bản sao lưu?', detail:'App sẽ tự lưu một bản dự phòng dữ liệu hiện tại trước khi thay thế. Cài đặt email hiện tại được giữ nguyên.',buttons:['Hủy','Khôi phục'],defaultId:0,cancelId:0})
    if (answer.response !== 1) return false
    await api('POST','/backup/restore',payload)
    return true
  }
  ipcMain.handle('taskflow:import', async event => {
    validSender(event)
    const selected = await dialog.showOpenDialog(win, {properties:['openFile'],filters:[{name:'Taskflow backup',extensions:['json']}]})
    if (selected.canceled) return false
    const raw = await readFile(selected.filePaths[0],'utf8')
    if (Buffer.byteLength(raw) > 10 * 1024 * 1024) {
    throw new Error('Bản sao lưu tối đa 10 MB.')
  }
    return restore(JSON.parse(raw))
  })
  ipcMain.handle('taskflow:restore-cloud', async (event, payload) => {validSender(event); return restore(payload)})
  ipcMain.handle('taskflow:data-folder', async event => {validSender(event); await shell.openPath(dataDir()); return true})
}

  
async function start() {
  await mkdir(dataDir(),{recursive:true})
  await startBackend()
  registerIpc()
  win = new BrowserWindow({width:1440,height:940,minWidth:980,minHeight:680,title:'Taskflow',backgroundColor:'#f7f8fb',autoHideMenuBar:true,webPreferences:{preload: path.join(__dirname, 'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}})
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.session.setPermissionRequestHandler(
  (_contents, _permission, callback) => callback(false),
  )
  if (dev) await win.loadURL('http://127.0.0.1:5173/')
  else await win.loadFile(path.join(root, 'dist/index.html'))
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {if(win){if(win.isMinimized())win.restore();win.focus()}})
  app.whenReady().then(start).catch(error => {dialog.showErrorBox('Không mở được Taskflow',error.message);app.quit()})
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {quitting=true;if(child && !child.killed)child.kill()})
}
