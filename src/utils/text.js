export function countChineseChars(text) {
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
}

export function toSentences(text) {
  const rawSentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[。！？!?…]+)\s*/)
    .map(s => s.trim())
    .filter(Boolean)

  const merged = []
  for (const sentence of rawSentences) {
    if (!merged.length) {
      merged.push(sentence)
      continue
    }

    const prev = merged[merged.length - 1]
    const shouldMerge =
      !/[。！？!?…]$/.test(prev) &&
      sentence.length < 30 &&
      !/^(第[一二三四五六七八九十百千万0-9]+[章节回部卷篇]|目录|前言|序言)/.test(sentence)

    if (shouldMerge) {
      merged[merged.length - 1] = `${prev}${sentence}`
      continue
    }

    merged.push(sentence)
  }

  return merged
}

export function toSentenceEntries(text, paragraphPauseMs = 50, sentencePauseMs = 25) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  const entries = []

  paragraphs.forEach((paragraph, paragraphIdx) => {
    const paragraphSentences = toSentences(paragraph)
    paragraphSentences.forEach((sentence, sentenceIdx) => {
      const isParagraphEnd = sentenceIdx === paragraphSentences.length - 1
      const isLastParagraph = paragraphIdx === paragraphs.length - 1

      entries.push({
        text: sentence,
        pauseAfterMs: isParagraphEnd && !isLastParagraph
          ? paragraphPauseMs
          : sentencePauseMs,
      })
    })
  })

  return entries
}

export function splitLongSentence(text, maxLength = 130) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= maxLength) return [normalized]

  const clauses = normalized.match(/[^，。,；;：:！？!?、]+[，。,；;：:！？!?、]*/g) ?? [normalized]
  const parts = []
  let current = ''

  for (const clause of clauses) {
    const next = `${current}${clause}`.trim()
    if (!current || next.length <= maxLength) {
      current = next
      continue
    }

    parts.push(current)

    if (clause.length <= maxLength) {
      current = clause.trim()
      continue
    }

    let rest = clause.trim()
    while (rest.length > maxLength) {
      const window = rest.slice(0, maxLength)
      const splitAt = Math.max(
        window.lastIndexOf('，'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('；'),
        window.lastIndexOf(';'),
        window.lastIndexOf(','),
        window.lastIndexOf('：'),
        window.lastIndexOf(':'),
        window.lastIndexOf('、'),
        window.lastIndexOf(' ')
      )

      const cut = splitAt >= Math.floor(maxLength * 0.55) ? splitAt + 1 : maxLength
      parts.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }

    current = rest
  }

  if (current) parts.push(current)
  return parts.filter(Boolean)
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}
