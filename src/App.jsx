import { useState, useRef, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

function extractPageText(items) {
  let text = ''
  let prevY = null
  for (const item of items) {
    if (!item.str) continue
    const y = item.transform[5]
    if (prevY !== null && Math.abs(y - prevY) > 5) {
      text += ' '
    }
    text += item.str
    prevY = y
  }
  return text.replace(/\s+/g, ' ').trim()
}

function toSentences(text) {
  return text
    .split(/(?<=[。！？!?…]+)\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 1)
}

export default function App() {
  const [phase, setPhase] = useState('idle')
  const [pdfName, setPdfName] = useState('')
  const [sentences, setSentences] = useState([])
  const [curIdx, setCurIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [voices, setVoices] = useState([])
  const [voice, setVoice] = useState('')
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)

  const sentsRef = useRef([])
  const curIdxRef = useRef(-1)
  const playingRef = useRef(false)
  const speedRef = useRef(1)
  const voiceRef = useRef('')
  const voicesRef = useRef([])
  const elRefs = useRef([])

  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { voiceRef.current = voice }, [voice])
  useEffect(() => { voicesRef.current = voices }, [voices])

  useEffect(() => {
    const load = () => {
      const v = speechSynthesis.getVoices()
      if (!v.length) return
      setVoices(v)
      voicesRef.current = v
      const zh = v.find(x => x.lang.startsWith('zh'))
      const name = zh?.name ?? v[0].name
      setVoice(name)
      voiceRef.current = name
    }
    load()
    speechSynthesis.onvoiceschanged = load
    return () => { speechSynthesis.onvoiceschanged = null }
  }, [])

  useEffect(() => {
    const el = elRefs.current[curIdx]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [curIdx])

  function speakAt(idx) {
    if (!playingRef.current || idx >= sentsRef.current.length) {
      playingRef.current = false
      setPlaying(false)
      if (idx >= sentsRef.current.length) setCurIdx(-1)
      return
    }
    const text = sentsRef.current[idx]?.trim()
    if (!text) { speakAt(idx + 1); return }

    speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = speedRef.current
    const v = voicesRef.current.find(x => x.name === voiceRef.current)
    if (v) utt.voice = v

    utt.onstart = () => { curIdxRef.current = idx; setCurIdx(idx) }
    utt.onend = () => { if (playingRef.current) speakAt(curIdxRef.current + 1) }
    utt.onerror = (e) => {
      if (e.error !== 'interrupted' && playingRef.current) speakAt(curIdxRef.current + 1)
    }
    speechSynthesis.speak(utt)
  }

  async function loadPdf(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('请选择 PDF 文件')
      return
    }
    speechSynthesis.cancel()
    setPhase('loading')
    setPdfName(file.name)
    setSentences([])
    setCurIdx(-1)
    curIdxRef.current = -1
    playingRef.current = false
    setPlaying(false)
    setProgress(0)

    try {
      const buf = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      const chunks = []
      for (let i = 1; i <= pdf.numPages; i++) {
        setProgress(Math.round(i / pdf.numPages * 100))
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const t = extractPageText(content.items)
        if (t) chunks.push(t)
      }
      const sents = toSentences(chunks.join(' '))
      sentsRef.current = sents
      elRefs.current = new Array(sents.length)
      setSentences(sents)
      setPhase('ready')
    } catch (e) {
      console.error(e)
      alert('解析失败：' + e.message)
      setPhase('idle')
    }
  }

  function play() {
    if (!sentsRef.current.length) return
    playingRef.current = true
    setPlaying(true)
    speakAt(curIdxRef.current >= 0 ? curIdxRef.current : 0)
  }

  function pause() {
    playingRef.current = false
    setPlaying(false)
    speechSynthesis.cancel()
  }

  function stop() {
    playingRef.current = false
    setPlaying(false)
    setCurIdx(-1)
    curIdxRef.current = -1
    speechSynthesis.cancel()
  }

  function reset() {
    stop()
    setPhase('idle')
    setSentences([])
    sentsRef.current = []
    setPdfName('')
  }

  function jumpTo(idx) {
    stop()
    curIdxRef.current = idx
    setCurIdx(idx)
  }

  return (
    <div className="app">
      <header className="hd">
        <h1>📖 PDF 朗读器</h1>
        <p>导入 PDF，逐句朗读，不漏句</p>
      </header>

      {phase === 'idle' && (
        <label
          className={`upload${dragging ? ' drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); loadPdf(e.dataTransfer.files[0]) }}
        >
          <span className="upload-icon">📄</span>
          <span className="upload-main">点击选择或拖拽 PDF 文件到此处</span>
          <span className="upload-sub">支持文本型 PDF（非扫描图片版）</span>
          <input type="file" accept=".pdf" onChange={e => loadPdf(e.target.files[0])} />
        </label>
      )}

      {phase === 'loading' && (
        <div className="loading-box">
          <div className="spin" />
          <p>正在解析 PDF… {progress}%</p>
          <div className="prog-bar">
            <div className="prog-fill" style={{ width: progress + '%' }} />
          </div>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div className="bar">
            <span className="bar-name">📄 {pdfName}</span>
            <span className="bar-cnt">{sentences.length} 句</span>
            <button className="btn-xs" onClick={reset}>换文件</button>
          </div>

          <div className="body">
            {sentences.map((s, i) => (
              <span
                key={i}
                ref={el => { elRefs.current[i] = el }}
                className={'sent' + (i === curIdx ? ' on' : '')}
                onClick={() => jumpTo(i)}
                title="点击从此处开始朗读"
              >
                {s}{' '}
              </span>
            ))}
          </div>
        </>
      )}

      {phase === 'ready' && (
        <div className="ctrl">
          <div className="ctrl-inner">
            <div className="ctrl-l">
              {playing
                ? <button className="btn btn-pause" onClick={pause}>⏸ 暂停</button>
                : <button className="btn btn-play" onClick={play}>▶ 播放</button>
              }
              <button className="btn btn-stop" onClick={stop}>⏹ 停止</button>
            </div>

            <div className="ctrl-m">
              {curIdx >= 0 && (
                <span className="pos">{curIdx + 1} / {sentences.length}</span>
              )}
            </div>

            <div className="ctrl-r">
              <label>
                语速
                <select value={speed} onChange={e => setSpeed(+e.target.value)}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
                    <option key={r} value={r}>{r}x</option>
                  ))}
                </select>
              </label>
              {voices.length > 0 && (
                <label>
                  声音
                  <select value={voice} onChange={e => setVoice(e.target.value)}>
                    {voices.map(v => (
                      <option key={v.name} value={v.name}>{v.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
