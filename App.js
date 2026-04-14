import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { Audio } from 'expo-av'
import Slider from '@react-native-community/slider'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'pdf-reader-progress-v2'
const API_BASE_KEY = 'pdf-reader-api-base'

const VOICES = [
  { id: '101055', label: '知冰（女）' },
  { id: '101027', label: '知晗（女）' },
  { id: '101054', label: '知峻（男）' },
  { id: '101030', label: '知哲（男）' },
  { id: '1001', label: '智聆女声' },
  { id: '1002', label: '智聆男声' },
]

const SPEED_OPTIONS = [0.6, 0.8, 0.95, 1, 1.1, 1.25, 1.5]
const PAUSE_OPTIONS = [
  { value: 120, label: '短停顿' },
  { value: 220, label: '中停顿' },
  { value: 320, label: '长停顿' },
]

function countChineseChars(text) {
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
}

function toSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[。！？!?…]+)\s*/)
    .map(s => s.trim())
    .filter(Boolean)
}

function splitLongSentence(text, maxLength = 130) {
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

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}

async function readProgress(pdfKey, total) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const data = JSON.parse(raw)
    const saved = data[pdfKey]
    if (!saved || saved.total !== total) return 0
    return Math.max(0, Math.min(saved.idx || 0, total - 1))
  } catch {
    return 0
  }
}

async function writeProgress(pdfKey, pdfName, idx, total) {
  if (!pdfKey || total <= 0) return

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    const data = raw ? JSON.parse(raw) : {}
    data[pdfKey] = {
      name: pdfName,
      idx,
      total,
      updatedAt: Date.now(),
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore storage errors to keep playback smooth
  }
}

export default function App() {
  const [phase, setPhase] = useState('idle')
  const [pdfName, setPdfName] = useState('')
  const [pdfKey, setPdfKey] = useState('')
  const [sentences, setSentences] = useState([])
  const [hanziCount, setHanziCount] = useState(0)
  const [curIdx, setCurIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [voice, setVoice] = useState('101055')
  const [speed, setSpeed] = useState(1)
  const [pauseMs, setPauseMs] = useState(220)
  const [loadingText, setLoadingText] = useState('准备中...')
  const [apiBase, setApiBase] = useState('http://127.0.0.1:8787')
  const [seekValue, setSeekValue] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)

  const sentencesRef = useRef([])
  const playingRef = useRef(false)
  const currentIndexRef = useRef(-1)
  const voiceRef = useRef('101055')
  const speedRef = useRef(1)
  const pauseRef = useRef(220)
  const soundRef = useRef(null)
  const tokenRef = useRef(0)
  const cacheRef = useRef(new Map())

  useEffect(() => {
    voiceRef.current = voice
  }, [voice])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    pauseRef.current = pauseMs
  }, [pauseMs])

  useEffect(() => {
    sentencesRef.current = sentences
  }, [sentences])

  useEffect(() => {
    currentIndexRef.current = curIdx
  }, [curIdx])

  useEffect(() => {
    AsyncStorage.getItem(API_BASE_KEY).then(saved => {
      if (saved) setApiBase(saved)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {})
      }
    }
  }, [])

  const progressValue = isSeeking ? seekValue : Math.max(curIdx, 0)
  const progressPercent = sentences.length > 1
    ? Math.round((progressValue / (sentences.length - 1)) * 100)
    : 0

  const elapsedChars = useMemo(
    () => sentences.slice(0, progressValue).join('').length,
    [sentences, progressValue]
  )
  const remainingChars = useMemo(
    () => sentences.slice(Math.max(curIdx, 0)).join('').length,
    [sentences, curIdx]
  )

  const elapsedTime = formatDuration((elapsedChars / 4.6) / speed)
  const remainingTime = formatDuration((remainingChars / 4.6) / speed)

  function clearAudioCache() {
    cacheRef.current.clear()
  }

  async function clearSound() {
    if (!soundRef.current) return
    try {
      await soundRef.current.unloadAsync()
    } catch {
      // ignore unload errors
    }
    soundRef.current = null
  }

  async function stopPlayback(resetIndex = true) {
    tokenRef.current += 1
    playingRef.current = false
    setPlaying(false)
    setStatusText('')

    await clearSound()
    clearAudioCache()

    if (resetIndex) {
      setCurIdx(-1)
      setSeekValue(0)
      currentIndexRef.current = -1
    }
  }

  async function requestSentenceAudio(parts, playbackToken) {
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
        voiceType: voiceRef.current,
        speed: speedMap[speedRef.current] ?? 0,
      }),
    })

    if (playbackToken !== tokenRef.current || !playingRef.current) {
      throw new Error('Playback expired')
    }

    const payload = await response.json()
    if (!response.ok || !payload?.audioBase64) {
      throw new Error(payload?.error || 'AI TTS 请求失败')
    }

    return payload.audioBase64
  }

  async function getAudioBase64(idx, playbackToken) {
    const cacheKey = `${playbackToken}:${idx}:${voiceRef.current}:${speedRef.current}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) return cached

    const promise = (async () => {
      const sentence = sentencesRef.current[idx]?.trim()
      if (!sentence) return ''
      const parts = splitLongSentence(sentence)
      return requestSentenceAudio(parts, playbackToken)
    })()

    cacheRef.current.set(cacheKey, promise)
    return promise
  }

  async function speakAt(idx, playbackToken = tokenRef.current) {
    if (!playingRef.current || idx >= sentencesRef.current.length) {
      await stopPlayback(true)
      return
    }

    const sentence = sentencesRef.current[idx]?.trim()
    if (!sentence) {
      await speakAt(idx + 1, playbackToken)
      return
    }

    try {
      await clearSound()

      setCurIdx(idx)
      setSeekValue(idx)
      setStatusText(`朗读中：第 ${idx + 1} 句`)
      await writeProgress(pdfKey, pdfName, idx, sentencesRef.current.length)

      const base64 = await getAudioBase64(idx, playbackToken)
      if (!base64) {
        await speakAt(idx + 1, playbackToken)
        return
      }

      if (playbackToken !== tokenRef.current || !playingRef.current) {
        return
      }

      const uri = `data:audio/mpeg;base64,${base64}`
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        playbackStatus => {
          if (!playbackStatus.isLoaded) return
          if (playbackStatus.didJustFinish) {
            setTimeout(() => {
              if (playingRef.current && playbackToken === tokenRef.current) {
                speakAt(idx + 1, playbackToken)
              }
            }, pauseRef.current)
          }
        }
      )

      soundRef.current = sound
    } catch (error) {
      if (!playingRef.current) return
      const message = error instanceof Error ? error.message : '未知错误'
      setStatusText(`朗读出错：${message}`)
      setTimeout(() => {
        if (playingRef.current && playbackToken === tokenRef.current) {
          speakAt(idx + 1, playbackToken)
        }
      }, 800)
    }
  }

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      })

      if (result.canceled || !result.assets?.[0]) return
      const file = result.assets[0]

      setPhase('loading')
      setPdfName(file.name)
      setStatusText('')
      setLoadingText('读取 PDF 文件...')

      await stopPlayback(true)

      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })

      setLoadingText('计算文件指纹...')
      const nextPdfKey = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        base64
      )

      setLoadingText('提取文本中...')
      const response = await fetch(`${apiBase}/api/pdf/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          data: base64,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'PDF 解析失败')
      }

      const extracted = String(payload?.text || '').trim()
      if (!extracted) {
        throw new Error('PDF 中没有可提取文本')
      }

      const nextSentences = toSentences(extracted)
      const restored = await readProgress(nextPdfKey, nextSentences.length)

      setPdfKey(nextPdfKey)
      setSentences(nextSentences)
      setHanziCount(countChineseChars(extracted))
      setCurIdx(restored)
      setSeekValue(restored)
      setPhase('ready')
      setStatusText('')
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      Alert.alert('导入失败', message)
      setPhase('idle')
    }
  }

  async function handlePlay() {
    if (!sentencesRef.current.length) return

    const canResumeCurrent =
      soundRef.current &&
      currentIndexRef.current >= 0 &&
      !playingRef.current

    playingRef.current = true
    setPlaying(true)

    if (canResumeCurrent) {
      try {
        await soundRef.current.playAsync()
        setStatusText(`继续朗读：第 ${currentIndexRef.current + 1} 句`)
        return
      } catch {
        await clearSound()
      }
    }

    tokenRef.current += 1
    const startIdx = currentIndexRef.current >= 0 ? currentIndexRef.current : 0
    await speakAt(startIdx, tokenRef.current)
  }

  async function handlePause() {
    playingRef.current = false
    setPlaying(false)
    if (soundRef.current) {
      try {
        await soundRef.current.pauseAsync()
      } catch {
        // ignore pause errors
      }
    }
  }

  async function handleStop() {
    await stopPlayback(true)
  }

  async function jumpTo(idx, resume = false) {
    const bounded = Math.max(0, Math.min(idx, sentencesRef.current.length - 1))
    const wasPlaying = resume && playingRef.current

    await clearSound()
    tokenRef.current += 1
    clearAudioCache()

    setCurIdx(bounded)
    setSeekValue(bounded)
    currentIndexRef.current = bounded
    await writeProgress(pdfKey, pdfName, bounded, sentencesRef.current.length)

    if (wasPlaying) {
      playingRef.current = true
      setPlaying(true)
      await speakAt(bounded, tokenRef.current)
    }
  }

  async function changeVoice(nextVoice) {
    const wasPlaying = playingRef.current
    const idx = currentIndexRef.current >= 0 ? currentIndexRef.current : 0

    setVoice(nextVoice)
    await clearSound()
    tokenRef.current += 1
    clearAudioCache()

    if (wasPlaying) {
      playingRef.current = true
      setPlaying(true)
      await speakAt(idx, tokenRef.current)
    } else {
      playingRef.current = false
      setPlaying(false)
    }
  }

  async function commitApiBase() {
    const trimmed = apiBase.trim().replace(/\/$/, '')
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      Alert.alert('地址格式错误', 'API 地址需要以 http:// 或 https:// 开头')
      return
    }

    setApiBase(trimmed)
    await AsyncStorage.setItem(API_BASE_KEY, trimmed)
  }

  async function resetReader() {
    await stopPlayback(true)
    setPhase('idle')
    setPdfName('')
    setPdfKey('')
    setSentences([])
    setHanziCount(0)
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.title}>PDF 朗读器</Text>
        <Text style={styles.subtitle}>移动端 AI 朗读 App</Text>
      </View>

      <View style={styles.apiCard}>
        <Text style={styles.apiLabel}>后端地址</Text>
        <View style={styles.apiRow}>
          <TextInput
            style={styles.apiInput}
            value={apiBase}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setApiBase}
            placeholder="http://192.168.x.x:8787"
          />
          <Pressable style={styles.apiBtn} onPress={commitApiBase}>
            <Text style={styles.apiBtnText}>保存</Text>
          </Pressable>
        </View>
      </View>

      {phase === 'idle' && (
        <Pressable style={styles.importCard} onPress={pickPdf}>
          <Text style={styles.importTitle}>导入 PDF 文件</Text>
          <Text style={styles.importHint}>支持文本型 PDF，导入后自动恢复阅读进度</Text>
        </Pressable>
      )}

      {phase === 'loading' && (
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#b36a2e" />
          <Text style={styles.loadingText}>{loadingText}</Text>
        </View>
      )}

      {phase === 'ready' && (
        <>
          <View style={styles.metaCard}>
            <Text style={styles.metaName} numberOfLines={1}>{pdfName}</Text>
            <View style={styles.metaWrap}>
              <Text style={styles.metaChip}>{sentences.length} 句</Text>
              <Text style={styles.metaChip}>约 {hanziCount.toLocaleString('zh-CN')} 汉字</Text>
              <Text style={styles.metaChip}>已读 {elapsedTime}</Text>
            </View>
          </View>

          <ScrollView style={styles.readerCard} contentContainerStyle={styles.readerContent}>
            {sentences.map((sentence, idx) => (
              <Text
                key={`${idx}-${sentence.slice(0, 10)}`}
                style={[styles.sentence, idx === curIdx && styles.activeSentence]}
                onPress={() => jumpTo(idx, false)}
              >
                {sentence}{' '}
              </Text>
            ))}
          </ScrollView>

          <View style={styles.controls}>
            <Slider
              value={progressValue}
              minimumValue={0}
              maximumValue={Math.max(sentences.length - 1, 0)}
              step={1}
              minimumTrackTintColor="#b36a2e"
              maximumTrackTintColor="#d9c9b5"
              thumbTintColor="#8f4715"
              onSlidingStart={() => setIsSeeking(true)}
              onValueChange={setSeekValue}
              onSlidingComplete={value => {
                setIsSeeking(false)
                jumpTo(value, playingRef.current)
              }}
            />

            <Text style={styles.progressText}>
              {progressValue + 1} / {sentences.length} · {progressPercent}% · {elapsedTime} / 剩余 {remainingTime}
            </Text>

            {statusText ? <Text style={styles.statusText}>{statusText}</Text> : null}

            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.ctrlBtn, playing ? styles.pauseBtn : styles.playBtn]}
                onPress={playing ? handlePause : handlePlay}
              >
                <Text style={styles.ctrlBtnText}>{playing ? '暂停' : '播放'}</Text>
              </Pressable>
              <Pressable style={[styles.ctrlBtn, styles.stopBtn]} onPress={handleStop}>
                <Text style={styles.stopBtnText}>停止</Text>
              </Pressable>
              <Pressable style={[styles.ctrlBtn, styles.fileBtn]} onPress={resetReader}>
                <Text style={styles.fileBtnText}>换文件</Text>
              </Pressable>
            </View>

            <View style={styles.settingGrid}>
              <View style={styles.settingCol}>
                <Text style={styles.settingLabel}>音色</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {VOICES.map(item => (
                    <Pressable
                      key={item.id}
                      style={[styles.tagBtn, voice === item.id && styles.tagBtnOn]}
                      onPress={() => changeVoice(item.id)}
                    >
                      <Text style={[styles.tagText, voice === item.id && styles.tagTextOn]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.settingCol}>
                <Text style={styles.settingLabel}>语速</Text>
                <View style={styles.tagWrap}>
                  {SPEED_OPTIONS.map(item => (
                    <Pressable
                      key={item}
                      style={[styles.tagBtn, speed === item && styles.tagBtnOn]}
                      onPress={() => setSpeed(item)}
                    >
                      <Text style={[styles.tagText, speed === item && styles.tagTextOn]}>{item}x</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.settingCol}>
                <Text style={styles.settingLabel}>停顿</Text>
                <View style={styles.tagWrap}>
                  {PAUSE_OPTIONS.map(item => (
                    <Pressable
                      key={item.value}
                      style={[styles.tagBtn, pauseMs === item.value && styles.tagBtnOn]}
                      onPress={() => setPauseMs(item.value)}
                    >
                      <Text style={[styles.tagText, pauseMs === item.value && styles.tagTextOn]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4ede1',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  header: {
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2b2117',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#806a54',
  },
  apiCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e0ceb9',
    backgroundColor: '#fffaf2',
    padding: 12,
    marginBottom: 10,
  },
  apiLabel: {
    fontSize: 13,
    color: '#7a614a',
    marginBottom: 8,
  },
  apiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  apiInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dbc5ab',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  apiBtn: {
    borderRadius: 12,
    backgroundColor: '#b36a2e',
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  apiBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  importCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#c99561',
    backgroundColor: '#fff6ea',
    paddingHorizontal: 18,
    paddingVertical: 42,
    alignItems: 'center',
    marginTop: 10,
  },
  importTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3a291a',
    marginBottom: 10,
  },
  importHint: {
    fontSize: 14,
    lineHeight: 22,
    color: '#81674f',
    textAlign: 'center',
  },
  loadingCard: {
    borderRadius: 18,
    backgroundColor: '#fffaf2',
    borderWidth: 1,
    borderColor: '#e0ceb9',
    paddingVertical: 40,
    alignItems: 'center',
    gap: 14,
  },
  loadingText: {
    fontSize: 14,
    color: '#72563d',
  },
  metaCard: {
    borderRadius: 14,
    backgroundColor: '#fffaf2',
    borderWidth: 1,
    borderColor: '#decbb5',
    padding: 10,
    marginBottom: 8,
  },
  metaName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#35281d',
    marginBottom: 8,
  },
  metaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    backgroundColor: '#f1dcc4',
    color: '#805637',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
  },
  readerCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dcc7b0',
    backgroundColor: '#fffdf8',
    marginBottom: 10,
  },
  readerContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  sentence: {
    fontSize: 18,
    lineHeight: 34,
    color: '#2d2219',
  },
  activeSentence: {
    backgroundColor: '#ffe8ad',
    borderRadius: 8,
    color: '#663a16',
    fontWeight: '600',
  },
  controls: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dcc7b0',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
  },
  progressText: {
    fontSize: 12,
    color: '#7f6348',
  },
  statusText: {
    fontSize: 12,
    color: '#965523',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  ctrlBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  playBtn: {
    backgroundColor: '#b36a2e',
  },
  pauseBtn: {
    backgroundColor: '#d18338',
  },
  stopBtn: {
    backgroundColor: '#e3d7c9',
  },
  fileBtn: {
    backgroundColor: '#e9dfd2',
  },
  ctrlBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  stopBtnText: {
    color: '#5f4b39',
    fontSize: 15,
    fontWeight: '700',
  },
  fileBtnText: {
    color: '#5f4b39',
    fontSize: 15,
    fontWeight: '700',
  },
  settingGrid: {
    gap: 10,
    marginTop: 6,
  },
  settingCol: {
    gap: 6,
  },
  settingLabel: {
    fontSize: 12,
    color: '#7f6348',
    fontWeight: '600',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c2a9',
    backgroundColor: '#fffdf9',
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginRight: 6,
  },
  tagBtnOn: {
    borderColor: '#b36a2e',
    backgroundColor: '#f4dfc5',
  },
  tagText: {
    fontSize: 12,
    color: '#6f5944',
  },
  tagTextOn: {
    color: '#7d4318',
    fontWeight: '700',
  },
})
