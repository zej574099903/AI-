import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import {
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as DocumentPicker from 'expo-document-picker'
import * as LegacyFileSystem from 'expo-file-system/legacy'
import * as Crypto from 'expo-crypto'
import { Audio } from 'expo-av'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  API_BASE_KEY,
  DEFAULT_API_BASE,
  DEFAULT_PAUSE_MS,
  FREE_TTS_CHARS_PER_MONTH,
  PARAGRAPH_PAUSE_MS,
  PLAYBACK_CHUNK_MAX_CHARS,
  PLAYBACK_CHUNK_MAX_SENTENCES,
  PREFETCH_SENTENCE_COUNT,
} from './src/constants/app'
import { checkApiHealth, extractPdf, synthesizeBatch } from './src/services/api'
import {
  addQuotaUsage,
  ensureLocalBookCopy,
  readLibrary,
  readProgressMap,
  readProgress,
  readQuotaUsage,
  writeLibrary,
  writeProgress,
} from './src/services/storage'
import {
  countChineseChars,
  formatDuration,
  splitLongSentence,
  toSentenceEntries,
} from './src/utils/text'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { ReaderScreen } from './src/screens/ReaderScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { styles } from './src/styles/appStyles'

function getErrorMessage(error, fallback = '未知错误') {
  const message = error instanceof Error ? error.message : fallback
  if (message === 'Network request failed') {
    return '无法连接到后端服务，请确认电脑后端已启动，且手机与电脑处于同一局域网。'
  }
  return message
}

function isLocalApiBase(value) {
  return /localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/.test(
    String(value || '')
  )
}

const TAB_ITEMS = {
  Library: { key: 'library', label: '书架', icon: 'library-outline', iconActive: 'library' },
  Reader: { key: 'reader', label: '阅读', icon: 'book-outline', iconActive: 'book' },
  Settings: { key: 'settings', label: '设置', icon: 'options-outline', iconActive: 'options' },
}

const Tab = createBottomTabNavigator()
const navigationRef = createNavigationContainerRef()
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f2eadf',
    card: '#fffaf4',
    text: '#3a2b20',
    border: '#ddccb6',
    primary: '#b36a2e',
  },
}

export default function App() {
  const [phase, setPhase] = useState('idle')
  const [pdfName, setPdfName] = useState('')
  const [pdfKey, setPdfKey] = useState('')
  const [sentences, setSentences] = useState([])
  const [activeChunkRange, setActiveChunkRange] = useState(null)
  const [hanziCount, setHanziCount] = useState(0)
  const [curIdx, setCurIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [voice, setVoice] = useState('101030')
  const [speed, setSpeed] = useState(1)
  const [loadingText, setLoadingText] = useState('准备中...')
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE)
  const [apiStatus, setApiStatus] = useState(null)
  const [seekValue, setSeekValue] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const [library, setLibrary] = useState([])
  const [activeTab, setActiveTab] = useState('library')
  const [extractMode, setExtractMode] = useState('auto')
  const [lastExtractMode, setLastExtractMode] = useState('')
  const [quotaUsedChars, setQuotaUsedChars] = useState(0)
  const [progressMap, setProgressMap] = useState({})
  const [showVoicePanel, setShowVoicePanel] = useState(false)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [playerExpanded, setPlayerExpanded] = useState(false)
  const shouldHideTabBar = activeTab === 'reader' && immersiveMode

  const sentencesRef = useRef([])
  const playingRef = useRef(false)
  const currentIndexRef = useRef(-1)
  const activeChunkEndRef = useRef(-1)
  const voiceRef = useRef('101030')
  const speedRef = useRef(1)
  const soundRef = useRef(null)
  const tokenRef = useRef(0)
  const cacheRef = useRef(new Map())
  const readerScrollRef = useRef(null)
  const sentenceOffsetsRef = useRef([])
  const togglePlaybackRef = useRef(() => {})
  const immersiveHideTimerRef = useRef(null)

  useEffect(() => {
    voiceRef.current = voice
  }, [voice])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    sentencesRef.current = sentences
  }, [sentences])

  useEffect(() => {
    currentIndexRef.current = curIdx
  }, [curIdx])

  useEffect(() => {
    AsyncStorage.getItem(API_BASE_KEY).then(saved => {
      if (!saved) return
      if (isLocalApiBase(saved)) {
        setApiBase(DEFAULT_API_BASE)
        AsyncStorage.setItem(API_BASE_KEY, DEFAULT_API_BASE).catch(() => {})
        setApiStatus({
          type: 'info',
          message: '检测到旧的局域网地址，已自动切换到当前默认远程地址。',
        })
        return
      }
      setApiBase(saved)
    })
    readLibrary().then(setLibrary)
    readProgressMap().then(setProgressMap)
    readQuotaUsage().then(setQuotaUsedChars)
  }, [])

  useEffect(() => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeIOS: 1,
      interruptionModeAndroid: 1,
      playThroughEarpieceAndroid: false,
    }).catch(() => {})

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {})
      }
      if (immersiveHideTimerRef.current) {
        clearTimeout(immersiveHideTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    togglePlaybackRef.current = () => {
      if (playingRef.current) {
        handlePause()
      } else {
        handlePlay()
      }
    }
  })

  useEffect(() => {
    if (typeof document === 'undefined') return

    const onKeyDown = event => {
      if (event.code !== 'Space') return
      const targetTag = event.target?.tagName
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return
      if (phase !== 'ready' || activeTab !== 'reader') return

      event.preventDefault()
      togglePlaybackRef.current()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [activeTab, phase])

  useEffect(() => {
    if (immersiveHideTimerRef.current) {
      clearTimeout(immersiveHideTimerRef.current)
      immersiveHideTimerRef.current = null
    }

    if (!(activeTab === 'reader' && immersiveMode) || chromeHidden) return

    immersiveHideTimerRef.current = setTimeout(() => {
      setChromeHidden(true)
    }, 2500)

    return () => {
      if (immersiveHideTimerRef.current) {
        clearTimeout(immersiveHideTimerRef.current)
        immersiveHideTimerRef.current = null
      }
    }
  }, [activeTab, immersiveMode, chromeHidden, curIdx])

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
  const quotaRemainingChars = Math.max(0, FREE_TTS_CHARS_PER_MONTH - quotaUsedChars)
  const quotaRemainingText = `${(quotaRemainingChars / 10000).toFixed(1)} 万字`
  const currentSentencePreview = sentences[Math.max(progressValue, 0)] || ''

  useEffect(() => {
    if (phase !== 'ready' || curIdx < 0 || !readerScrollRef.current) return
    const offset = sentenceOffsetsRef.current[curIdx]
    if (typeof offset !== 'number') return
    readerScrollRef.current.scrollTo({
      y: Math.max(0, offset - 120),
      animated: true,
    })
  }, [curIdx, phase])

  async function upsertBook(record) {
    const existing = await readLibrary()
    const next = [record, ...existing.filter(item => item.pdfKey !== record.pdfKey)].slice(0, 8)
    setLibrary(next)
    await writeLibrary(next)
  }

  async function persistProgress(pdfKeyToSave, pdfNameToSave, idx, total) {
    await writeProgress(pdfKeyToSave, pdfNameToSave, idx, total)
    setProgressMap(prev => ({
      ...prev,
      [pdfKeyToSave]: {
        name: pdfNameToSave,
        idx,
        total,
        updatedAt: Date.now(),
      },
    }))
  }

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
      setActiveChunkRange(null)
      setSeekValue(0)
      currentIndexRef.current = -1
      activeChunkEndRef.current = -1
    }
  }

  async function loadPdfFromBase64({ name, base64, pdfKey: nextKey, localUri }) {
    setPhase('loading')
    setPdfName(name)
    setStatusText('')
    setLoadingText('提取文本中，如遇字体异常会自动尝试 OCR...')

    await stopPlayback(true)

    const resolvedPdfKey = nextKey ?? await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64
    )

    const payload = await extractPdf({
      apiBase,
      base64,
      cacheKey: resolvedPdfKey,
      extractMode,
      name,
    })

    const extracted = String(payload?.text || '').trim()
    if (!extracted) {
      throw new Error('PDF 中没有可提取文本')
    }

    const nextEntries = toSentenceEntries(extracted, PARAGRAPH_PAUSE_MS, DEFAULT_PAUSE_MS)
    const nextSentences = nextEntries.map(item => item.text)
    const restored = await readProgress(resolvedPdfKey, nextSentences.length)

    setLastExtractMode(payload?.mode || extractMode)
    setPdfKey(resolvedPdfKey)
    setSentences(nextSentences)
    setActiveChunkRange(null)
    setHanziCount(countChineseChars(extracted))
    setCurIdx(restored)
    setSeekValue(restored)
    setPhase('ready')
    setStatusText('')
    navigateToTab('reader')

    if (localUri) {
      await upsertBook({
        pdfKey: resolvedPdfKey,
        name,
        uri: localUri,
        total: nextSentences.length,
        updatedAt: Date.now(),
      })
    }
  }

  async function requestSentenceAudio(parts, playbackToken) {
    const payload = await synthesizeBatch({
      apiBase,
      parts,
      speed: speedRef.current,
      voiceType: voiceRef.current,
    })

    if (playbackToken !== tokenRef.current || !playingRef.current) {
      throw new Error('Playback expired')
    }

    const used = await addQuotaUsage(parts.join('').length)
    setQuotaUsedChars(used)

    return payload.audioBase64
  }

  function buildPlaybackChunk(startIdx) {
    const parts = []
    let totalChars = 0
    let endIdx = startIdx - 1

    for (
      let idx = startIdx;
      idx < sentencesRef.current.length && idx < startIdx + PLAYBACK_CHUNK_MAX_SENTENCES;
      idx += 1
    ) {
      const sentence = sentencesRef.current[idx]?.trim()
      if (!sentence) continue

      const nextTotalChars = totalChars + sentence.length
      if (endIdx >= startIdx && nextTotalChars > PLAYBACK_CHUNK_MAX_CHARS) {
        break
      }

      parts.push(...splitLongSentence(sentence))
      totalChars = nextTotalChars
      endIdx = idx
    }

    if (endIdx < startIdx) {
      const fallbackSentence = sentencesRef.current[startIdx]?.trim()
      if (!fallbackSentence) {
        return {
          startIdx,
          endIdx: startIdx,
          parts: [],
        }
      }

      return {
        startIdx,
        endIdx: startIdx,
        parts: splitLongSentence(fallbackSentence),
      }
    }

    return {
      startIdx,
      endIdx,
      parts,
    }
  }

  async function getChunkAudio(startIdx, playbackToken) {
    const chunk = buildPlaybackChunk(startIdx)
    const cacheKey = `${playbackToken}:${chunk.startIdx}-${chunk.endIdx}:${voiceRef.current}:${speedRef.current}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) return cached

    const promise = (async () => {
      if (!chunk.parts.length) {
        return {
          audioBase64: '',
          endIdx: chunk.endIdx,
        }
      }

      const audioBase64 = await requestSentenceAudio(chunk.parts, playbackToken)
      return {
        audioBase64,
        endIdx: chunk.endIdx,
      }
    })()

    cacheRef.current.set(cacheKey, promise)
    return promise
  }

  function prefetchUpcomingAudio(startIdx, playbackToken, count = PREFETCH_SENTENCE_COUNT) {
    let nextStartIdx = startIdx

    for (let offset = 0; offset < count; offset += 1) {
      if (nextStartIdx >= sentencesRef.current.length) break

      const nextChunk = buildPlaybackChunk(nextStartIdx)
      getChunkAudio(nextStartIdx, playbackToken).catch(() => {})
      nextStartIdx = nextChunk.endIdx + 1
    }
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
      const currentChunk = buildPlaybackChunk(idx)
      setActiveChunkRange({ start: idx, end: currentChunk.endIdx })
      activeChunkEndRef.current = currentChunk.endIdx
      setStatusText(`朗读中：第 ${idx + 1} - ${currentChunk.endIdx + 1} 句`)
      await persistProgress(pdfKey, pdfName, idx, sentencesRef.current.length)

      const currentAudioPromise = getChunkAudio(idx, playbackToken)
      prefetchUpcomingAudio(currentChunk.endIdx + 1, playbackToken)

      const { audioBase64, endIdx } = await currentAudioPromise
      if (!audioBase64) {
        await speakAt(endIdx + 1, playbackToken)
        return
      }

      if (playbackToken !== tokenRef.current || !playingRef.current) {
        return
      }

      const uri = `data:audio/mpeg;base64,${audioBase64}`
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        playbackStatus => {
          if (!playbackStatus.isLoaded) return
          if (playbackStatus.didJustFinish) {
            setTimeout(() => {
              if (playingRef.current && playbackToken === tokenRef.current) {
                speakAt(endIdx + 1, playbackToken)
              }
            }, 0)
          }
        }
      )

      soundRef.current = sound
    } catch (error) {
      if (!playingRef.current) return
      setStatusText(`朗读出错：${getErrorMessage(error)}`)
      setTimeout(() => {
        if (playingRef.current && playbackToken === tokenRef.current) {
          speakAt(activeChunkEndRef.current + 1, playbackToken)
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

      setLoadingText('读取 PDF 文件...')
      const base64 = await LegacyFileSystem.readAsStringAsync(file.uri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      })

      setLoadingText('计算文件指纹...')
      const nextPdfKey = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        base64
      )
      const localUri = await ensureLocalBookCopy(file, nextPdfKey)
      navigateToTab('reader')
      await loadPdfFromBase64({
        name: file.name,
        base64,
        pdfKey: nextPdfKey,
        localUri,
      })
    } catch (error) {
      Alert.alert('导入失败', getErrorMessage(error))
      setPhase('idle')
    }
  }

  async function openSavedBook(book) {
    try {
      setLoadingText('读取已保存书籍...')
      const info = await LegacyFileSystem.getInfoAsync(book.uri)
      if (!info.exists) {
        throw new Error('本地书籍文件已丢失，请重新导入')
      }

      const base64 = await LegacyFileSystem.readAsStringAsync(book.uri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      })

      await loadPdfFromBase64({
        name: book.name,
        base64,
        pdfKey: book.pdfKey,
        localUri: book.uri,
      })
      navigateToTab('reader')
    } catch (error) {
      Alert.alert('打开失败', getErrorMessage(error))
      setPhase('idle')
    }
  }

  async function resetReader() {
    await stopPlayback(true)
    setPhase('idle')
    setPdfName('')
    setPdfKey('')
    setSentences([])
    setActiveChunkRange(null)
    setHanziCount(0)
    setLastExtractMode('')
    setShowVoicePanel(false)
    setImmersiveMode(false)
    setChromeHidden(false)
    setPlayerExpanded(false)
    navigateToTab('library')
  }

  async function deleteBook(book) {
    Alert.alert('删除书籍', `确定从书架中删除《${book.name}》吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            const next = library.filter(item => item.pdfKey !== book.pdfKey)
            setLibrary(next)
            await writeLibrary(next)

            const info = await LegacyFileSystem.getInfoAsync(book.uri)
            if (info.exists) {
              await LegacyFileSystem.deleteAsync(book.uri, { idempotent: true })
            }

            if (pdfKey === book.pdfKey) {
              await resetReader()
            }
          } catch (error) {
            Alert.alert('删除失败', getErrorMessage(error))
          }
        },
      },
    ])
  }

  async function handlePlay() {
    if (!sentencesRef.current.length) return

    const canResumeCurrent = soundRef.current && currentIndexRef.current >= 0 && !playingRef.current
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
    await persistProgress(pdfKey, pdfName, bounded, sentencesRef.current.length)

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
      setApiStatus({ type: 'error', message: '地址格式不正确，需要以 http:// 或 https:// 开头。' })
      return
    }

    setApiBase(trimmed)
    await AsyncStorage.setItem(API_BASE_KEY, trimmed)
    setApiStatus({ type: 'success', message: '后端地址已保存。建议再点一次“测试连接”确认当前可用。' })
  }

  async function verifyApiBase() {
    const trimmed = apiBase.trim().replace(/\/$/, '')
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      Alert.alert('地址格式错误', 'API 地址需要以 http:// 或 https:// 开头')
      setApiStatus({ type: 'error', message: '地址格式不正确，需要以 http:// 或 https:// 开头。' })
      return
    }

    setApiStatus({ type: 'info', message: '正在测试连接...' })

    try {
      const payload = await checkApiHealth(trimmed)
      const providerText = payload?.provider ? `，服务：${payload.provider}` : ''
      setApiStatus({
        type: 'success',
        message: `连接成功，当前地址可用${providerText}。`,
      })
    } catch (error) {
      setApiStatus({
        type: 'error',
        message: getErrorMessage(error, '后端连接失败，请确认电脑服务和 tunnel 都在运行。'),
      })
    }
  }

  function navigateToTab(tabKey) {
    setActiveTab(tabKey)

    const routeName = Object.keys(TAB_ITEMS).find(name => TAB_ITEMS[name].key === tabKey)
    if (routeName && navigationRef.isReady()) {
      navigationRef.navigate(routeName)
    }
  }

  function toggleImmersiveMode() {
    setImmersiveMode(prev => {
      const next = !prev
      if (!next) {
        setChromeHidden(false)
      } else {
        setChromeHidden(false)
      }
      return next
    })
  }

  function renderLibraryTab() {
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.header}>
            <Text style={styles.title}>PDF 朗读器</Text>
            <Text style={styles.subtitle}>移动端 AI 朗读 App</Text>
          </View>
        </View>

        <LibraryScreen
          library={library}
          onDeleteBook={deleteBook}
          onOpenBook={openSavedBook}
          onPickPdf={pickPdf}
          progressMap={progressMap}
          styles={styles}
        />

        {phase === 'loading' && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#b36a2e" />
            <Text style={styles.loadingText}>{loadingText}</Text>
          </View>
        )}
      </ScrollView>
    )
  }

  function renderReaderTab() {
    if (phase === 'ready') {
      return (
        <ReaderScreen
          chromeHidden={chromeHidden}
          curIdx={curIdx}
          activeChunkRange={activeChunkRange}
          currentSentencePreview={currentSentencePreview}
          elapsedTime={elapsedTime}
          hanziCount={hanziCount}
          immersiveMode={immersiveMode}
          isSeeking={isSeeking}
          lastExtractMode={lastExtractMode}
          onChangeVoice={changeVoice}
          onHandlePause={handlePause}
          onHandlePlay={handlePlay}
          onHandleStop={handleStop}
          onJumpTo={jumpTo}
          onResetReader={resetReader}
          onSeekEnd={value => jumpTo(value, playingRef.current)}
          onSeekStart={() => {}}
          onSeekValue={setSeekValue}
          onSetActiveTab={navigateToTab}
          onSetChromeHidden={setChromeHidden}
          onSetPlayerExpanded={setPlayerExpanded}
          onSetShowVoicePanel={setShowVoicePanel}
          onSetSpeed={setSpeed}
          onToggleImmersiveMode={toggleImmersiveMode}
          pdfName={pdfName}
          playing={playing}
          playerExpanded={playerExpanded}
          progressPercent={progressPercent}
          progressValue={progressValue}
          readerScrollRef={readerScrollRef}
          remainingTime={remainingTime}
          seekValue={seekValue}
          sentenceOffsetsRef={sentenceOffsetsRef}
          sentences={sentences}
          setIsSeeking={setIsSeeking}
          showVoicePanel={showVoicePanel}
          speed={speed}
          statusText={statusText}
          styles={styles}
          voice={voice}
        />
      )
    }

    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.header}>
            <Text style={styles.title}>PDF 朗读器</Text>
            <Text style={styles.subtitle}>移动端 AI 朗读 App</Text>
          </View>
        </View>

        {phase === 'loading' ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#b36a2e" />
            <Text style={styles.loadingText}>{loadingText}</Text>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>还没有打开书籍</Text>
            <Text style={styles.emptyHint}>先去书架导入一本 PDF，再回到阅读页。</Text>
          </View>
        )}
      </ScrollView>
    )
  }

  function renderSettingsTab() {
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <SettingsScreen
          apiBase={apiBase}
          apiStatus={apiStatus}
          extractMode={extractMode}
          onCheckApiBase={verifyApiBase}
          onCommitApiBase={commitApiBase}
          onSetApiBase={setApiBase}
          onSetExtractMode={setExtractMode}
          quotaRemainingText={quotaRemainingText}
          quotaUsedChars={quotaUsedChars}
          styles={styles}
        />
      </ScrollView>
    )
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          onStateChange={() => {
            const route = navigationRef.getCurrentRoute()
            if (!route?.name || !TAB_ITEMS[route.name]) return
            setActiveTab(TAB_ITEMS[route.name].key)
          }}
        >
          <Tab.Navigator
            initialRouteName="Library"
            screenOptions={({ route }) => {
              const item = TAB_ITEMS[route.name]
              return {
                headerShown: false,
                tabBarHideOnKeyboard: true,
                tabBarActiveTintColor: '#b36a2e',
                tabBarInactiveTintColor: '#9a7d61',
                tabBarStyle: [
                  styles.nativeTabBar,
                  shouldHideTabBar && styles.nativeTabBarHidden,
                ],
                tabBarItemStyle: styles.nativeTabItem,
                tabBarLabelStyle: styles.nativeTabLabel,
                tabBarIconStyle: styles.nativeTabIconWrap,
                sceneStyle: styles.nativeScene,
                tabBarIcon: ({ color, focused }) => (
                  <Ionicons
                    name={focused ? item.iconActive : item.icon}
                    size={20}
                    color={color}
                  />
                ),
              }
            }}
          >
            <Tab.Screen name="Library" options={{ title: TAB_ITEMS.Library.label }}>
              {() => renderLibraryTab()}
            </Tab.Screen>
            <Tab.Screen name="Reader" options={{ title: TAB_ITEMS.Reader.label }}>
              {() => renderReaderTab()}
            </Tab.Screen>
            <Tab.Screen name="Settings" options={{ title: TAB_ITEMS.Settings.label }}>
              {() => renderSettingsTab()}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaView>
    </GestureHandlerRootView>
  )
}
