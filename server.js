import http from 'node:http'
import { URL } from 'node:url'
import * as dotenv from 'dotenv'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import tencentcloud from 'tencentcloud-sdk-nodejs-tts'

dotenv.config()

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.APP_ORIGIN,
].filter(Boolean))

function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  return ALLOWED_ORIGINS.has(origin)
}

function sendJson(res, status, payload, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...getCorsHeaders(origin),
  })
  res.end(JSON.stringify(payload))
}

function readJsonBody(req, maxBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > maxBytes) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function extractPageText(items) {
  let text = ''
  let prevY = null
  for (const item of items) {
    if (!item.str) continue
    const y = item.transform[5]
    if (prevY !== null && Math.abs(y - prevY) > 10) {
      text += '\n\n'
    } else if (prevY !== null && Math.abs(y - prevY) > 5) {
      text += ' '
    }
    text += item.str
    prevY = y
  }
  return text.trim()
}

async function extractTextFromPdfBuffer(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const chunks = []
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const t = extractPageText(content.items)
    if (t) chunks.push(t)
  }
  return {
    pages: pdf.numPages,
    text: chunks.join('\n\n'),
  }
}

const TtsClient = tencentcloud.tts.v20190823.Client

const clientConfig = {
  credential: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
  },
  region: 'ap-guangzhou',
  profile: {
    httpProfile: {
      endpoint: 'tts.tencentcloudapi.com',
    },
  },
}

const ttsClient = new TtsClient(clientConfig)

async function synthesizeWithTencent(text, options = {}) {
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    const error = new Error('Missing TENCENT_SECRET_ID or TENCENT_SECRET_KEY in .env')
    error.status = 401
    throw error
  }

  const params = {
    Text: text,
    SessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ModelType: 1,
    VoiceType: Number(options.voiceType || 101055),
    Codec: 'mp3',
    SampleRate: 16000,
    Speed: Number(options.speed || 0),
    Volume: 0,
  }

  return new Promise((resolve, reject) => {
    ttsClient.TextToVoice(params).then(
      (data) => {
        if (!data.Audio) {
          reject(new Error('Tencent TTS returned no audio data'))
          return
        }
        resolve(Buffer.from(data.Audio, 'base64'))
      },
      (err) => {
        console.error('Tencent TTS Error:', err)
        const code = err.code || err.Code
        const message = err.message || err.Message || 'Tencent TTS request failed'
        const error = new Error(code ? `${code}: ${message}` : message)
        error.status = 500
        reject(error)
      }
    )
  })
}

function sendAudioBuffer(res, origin, audioBuffer) {
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': audioBuffer.length,
    'Cache-Control': 'no-store',
    ...getCorsHeaders(origin),
  })
  res.end(audioBuffer)
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: 'Invalid request url' })
    return
  }

  const origin = req.headers.origin

  if (!isAllowedOrigin(origin)) {
    sendJson(res, 403, { error: 'Origin not allowed' }, origin)
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...getCorsHeaders(origin),
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      provider: 'tencent-cloud-tts',
      host: HOST,
      configured: Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY),
    }, origin)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/pdf/extract') {
    try {
      const body = await readJsonBody(req, 40 * 1024 * 1024)
      const data = String(body.data || '').trim()

      if (!data) {
        sendJson(res, 400, { error: 'PDF base64 data is required' }, origin)
        return
      }

      const pdfBuffer = Buffer.from(data, 'base64')
      const result = await extractTextFromPdfBuffer(pdfBuffer)

      sendJson(res, 200, {
        ok: true,
        pages: result.pages,
        text: result.text,
      }, origin)
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.message || 'Failed to parse PDF',
      }, origin)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/tts/synthesize') {
    try {
      const body = await readJsonBody(req)
      const text = String(body.text || '').trim()

      if (!text) {
        sendJson(res, 400, { error: 'Text is required' }, origin)
        return
      }

      const audioBuffer = await synthesizeWithTencent(text, body)

      if (body.returnBase64) {
        sendJson(res, 200, {
          ok: true,
          audioBase64: audioBuffer.toString('base64'),
          contentType: 'audio/mpeg',
        }, origin)
        return
      }

      sendAudioBuffer(res, origin, audioBuffer)
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.message || 'Unknown server error',
      }, origin)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/tts/synthesize-batch') {
    try {
      const body = await readJsonBody(req)
      const texts = Array.isArray(body.texts)
        ? body.texts.map(text => String(text || '').trim()).filter(Boolean)
        : []

      if (texts.length === 0) {
        sendJson(res, 400, { error: 'texts[] is required' }, origin)
        return
      }

      const buffers = []
      for (const text of texts) {
        const audioBuffer = await synthesizeWithTencent(text, body)
        buffers.push(audioBuffer)
      }

      const merged = Buffer.concat(buffers)
      sendJson(res, 200, {
        ok: true,
        audioBase64: merged.toString('base64'),
        parts: texts.length,
        contentType: 'audio/mpeg',
      }, origin)
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.message || 'Unknown server error',
      }, origin)
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' }, origin)
})

server.listen(PORT, HOST, () => {
  console.log(`TTS proxy listening on http://${HOST}:${PORT}`)
})
