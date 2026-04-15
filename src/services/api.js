export async function extractPdf({
  apiBase,
  base64,
  cacheKey,
  extractMode,
  name,
}) {
  const response = await fetch(`${apiBase}/api/pdf/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: name,
      data: base64,
      cacheKey,
      forceOcr: extractMode === 'ocr',
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error || 'PDF 解析失败')
  }

  return payload
}

export async function synthesizeBatch({
  apiBase,
  parts,
  speed,
  voiceType,
}) {
  const speedMap = {
    0.6: -2,
    0.8: -1,
    0.95: -0.3,
    1: 0,
    1.1: 0.5,
    1.25: 1.1,
    1.5: 2,
  }

  const response = await fetch(`${apiBase}/api/tts/synthesize-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      texts: parts,
      voiceType,
      speed: speedMap[speed] ?? 0,
    }),
  })

  const payload = await response.json()
  if (!response.ok || !payload?.audioBase64) {
    throw new Error(payload?.error || 'AI TTS 请求失败')
  }

  return payload
}
