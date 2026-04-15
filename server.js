import http from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { URL } from 'node:url'
import * as dotenv from 'dotenv'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker } from 'tesseract.js'
import tencentcloud from 'tencentcloud-sdk-nodejs-tts'

dotenv.config()

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const CMAP_URL = new URL('./node_modules/pdfjs-dist/cmaps/', import.meta.url)
const STANDARD_FONT_DATA_URL = new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
const OCR_CACHE_ROOT = path.resolve('.cache/pdf-ocr')
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.APP_ORIGIN,
].filter(Boolean))
let ocrWorkerPromise = null

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

function getChineseRatio(text) {
  const compact = text.replace(/\s+/g, '')
  if (!compact) return 0
  const chineseChars = (compact.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
  return chineseChars / compact.length
}

function getSymbolRatio(text) {
  const compact = text.replace(/\s+/g, '')
  if (!compact) return 1
  const symbols = (compact.match(/[^A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length
  return symbols / compact.length
}

function isLikelyGarbledText(text) {
  const compact = text.replace(/\s+/g, '')
  if (!compact) return true
  const chineseRatio = getChineseRatio(compact)
  const symbolRatio = getSymbolRatio(compact)
  return compact.length > 120 && chineseRatio < 0.08 && symbolRatio > 0.18
}

function normalizeRecognizedText(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/([，。！？；：、“”‘’（）《》〈〉【】])\s+/g, '$1')
    .replace(/\s+([，。！？；：、“”‘’（）《》〈〉【】])/g, '$1')
    .replace(/([\u3400-\u4dbf\u4e00-\u9fff])\s+([\u3400-\u4dbf\u4e00-\u9fff])/g, '$1$2')
    .replace(/([\u3400-\u4dbf\u4e00-\u9fff])\s+([，。！？；：、“”‘’）】》])/g, '$1$2')
    .replace(/([（【《“])\s+([\u3400-\u4dbf\u4e00-\u9fff])/g, '$1$2')
    .trim()
}

function isNoiseBlock(text) {
  if (!text) return true
  if (/^[-_\s\d/]+$/.test(text)) return true
  if (/^第?\s*\d+\s*页$/.test(text)) return true
  if (/^page\s*\d+$/i.test(text)) return true
  return false
}

function looksLikeHeadingBlock(text) {
  return /^(第[一二三四五六七八九十百千万0-9]+[章节回部卷篇]|目录|前言|序言|引言)/.test(text)
}

function shouldMergeBlocks(prev, next) {
  if (!prev || !next) return false
  if (looksLikeHeadingBlock(next)) return false
  if (/[。！？!?；;：:]$/.test(prev)) return false
  if (/^[（(【[]?[0-9一二三四五六七八九十]+[）).、]/.test(next)) return false
  return true
}

function cleanExtractedText(text) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')

  const rawBlocks = normalized
    .split(/\n{2,}/)
    .map(block => normalizeRecognizedText(block))
    .filter(block => !isNoiseBlock(block))

  const merged = []

  for (const block of rawBlocks) {
    if (!merged.length) {
      merged.push(block)
      continue
    }

    const prev = merged[merged.length - 1]
    if (shouldMergeBlocks(prev, block)) {
      merged[merged.length - 1] = `${prev}${block}`
      continue
    }

    merged.push(block)
  }

  return merged.join('\n\n').trim()
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker('chi_sim+eng')
      await worker.setParameters({
        preserve_interword_spaces: '1',
      })
      return worker
    })()
  }

  return ocrWorkerPromise
}

async function renderPageToPng(page, scale = 2) {
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  await page.render({
    canvasContext: context,
    viewport,
  }).promise
  return canvas.toBuffer('image/png')
}

function getOcrCachePaths(cacheKey, pageNumber) {
  const dir = path.join(OCR_CACHE_ROOT, cacheKey)
  return {
    dir,
    file: path.join(dir, `page-${pageNumber}.txt`),
  }
}

async function extractTextFromPdfBuffer(buffer) {
  const pdfData = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const pdf = await pdfjsLib.getDocument({
    data: pdfData,
    cMapUrl: CMAP_URL.href,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL.href,
    useSystemFonts: true,
    stopAtErrors: false,
  }).promise
  const chunks = []
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    })
    const t = extractPageText(content.items)
    if (t) chunks.push(t)
  }
  return {
    pages: pdf.numPages,
    text: chunks.join('\n\n'),
  }
}

async function extractTextWithOcr(buffer, cacheKey = 'default') {
  const pdfData = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const pdf = await pdfjsLib.getDocument({
    data: pdfData,
    cMapUrl: CMAP_URL.href,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL.href,
    useSystemFonts: true,
    stopAtErrors: false,
  }).promise

  const worker = await getOcrWorker()
  const pages = []

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const cachePaths = getOcrCachePaths(cacheKey, i)
    await mkdir(cachePaths.dir, { recursive: true })

    let text = ''
    try {
      text = (await readFile(cachePaths.file, 'utf8')).trim()
    } catch {
      const page = await pdf.getPage(i)
      const pngBuffer = await renderPageToPng(page)
      const result = await worker.recognize(pngBuffer)
      text = String(result?.data?.text || '').trim()
      if (text) {
        await writeFile(cachePaths.file, text, 'utf8')
      }
    }

    if (text) pages.push(text)
  }

  return {
    pages: pdf.numPages,
    text: pages.join('\n\n'),
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

      const pdfBuffer = new Uint8Array(Buffer.from(data, 'base64'))
      const cacheKey = String(body.cacheKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '')
      let result = await extractTextFromPdfBuffer(pdfBuffer)
      let mode = 'text'

      if (body.forceOcr || isLikelyGarbledText(result.text)) {
        try {
          const ocrResult = await extractTextWithOcr(pdfBuffer, cacheKey || 'default')
          if (ocrResult.text.trim()) {
            result = ocrResult
            mode = 'ocr'
          }
        } catch (ocrError) {
          console.error('PDF OCR fallback failed:', ocrError)
        }
      }

      sendJson(res, 200, {
        ok: true,
        pages: result.pages,
        text: cleanExtractedText(result.text),
        mode,
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
