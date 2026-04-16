import { useEffect, useMemo } from 'react'
import { Animated, Pressable, ScrollView, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { Ionicons } from '@expo/vector-icons'
import { SPEED_OPTIONS, VOICES } from '../constants/app'

export function ReaderScreen({
  activeChunkRange,
  chromeHidden,
  currentSentencePreview,
  elapsedTime,
  hanziCount,
  immersiveMode,
  isSeeking,
  lastExtractMode,
  onChangeVoice,
  onHandlePause,
  onHandlePlay,
  onHandleStop,
  onJumpTo,
  onResetReader,
  onSeekEnd,
  onSeekStart,
  onSeekValue,
  onSetActiveTab,
  onSetChromeHidden,
  onSetPlayerExpanded,
  onSetShowVoicePanel,
  onSetSpeed,
  onToggleImmersiveMode,
  pdfName,
  playing,
  playerExpanded,
  progressPercent,
  progressValue,
  readerScrollRef,
  remainingTime,
  seekValue,
  sentenceOffsetsRef,
  sentences,
  setIsSeeking,
  showVoicePanel,
  speed,
  statusText,
  styles,
  voice,
}) {
  const toolbarAnim = useMemo(() => new Animated.Value(1), [])
  const dockAnim = useMemo(() => new Animated.Value(1), [])

  useEffect(() => {
    const nextValue = chromeHidden ? 0 : 1

    Animated.parallel([
      Animated.timing(toolbarAnim, {
        toValue: nextValue,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(dockAnim, {
        toValue: nextValue,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start()
  }, [chromeHidden, dockAnim, toolbarAnim])

  return (
    <View style={styles.readyShell}>
      {!chromeHidden ? (
        <Animated.View
          style={[
            styles.readerToolbar,
            immersiveMode && styles.readerToolbarImmersive,
            {
              opacity: toolbarAnim,
              transform: [
                {
                  translateY: toolbarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable style={[styles.toolbarBtn, immersiveMode && styles.toolbarBtnGhost]} onPress={() => onSetActiveTab('library')}>
            <Text style={[styles.toolbarBtnText, immersiveMode && styles.toolbarBtnTextGhost]}>书架</Text>
          </Pressable>
          {!immersiveMode ? (
            <Pressable onPress={onToggleImmersiveMode}>
              <Text style={styles.readerToolbarTitle}>正在阅读</Text>
            </Pressable>
          ) : (
            <View style={styles.immersiveTopCenter}>
              <Text style={styles.immersiveTopHint}>沉浸阅读</Text>
            </View>
          )}
          <View style={styles.toolbarActionRow}>
            <Pressable style={[styles.toolbarBtn, immersiveMode && styles.toolbarBtnGhost]} onPress={onToggleImmersiveMode}>
              <Text style={[styles.toolbarBtnText, immersiveMode && styles.toolbarBtnTextGhost]}>{immersiveMode ? '退出' : '沉浸'}</Text>
            </Pressable>
            {!immersiveMode ? (
              <Pressable style={styles.toolbarBtn} onPress={onResetReader}>
                <Text style={styles.toolbarBtnText}>换书</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : (
        <View style={styles.hiddenChromeTapRow}>
          <Pressable style={styles.hiddenChromeTapBtn} onPress={() => onSetChromeHidden(false)}>
            <Text style={styles.hiddenChromeTapText}>显示控件</Text>
          </Pressable>
        </View>
      )}

      {!immersiveMode && !chromeHidden ? (
        <View style={styles.readyTopCard}>
          <View style={styles.bookTopLine}>
            <Text style={styles.readerEyebrow}>
              {lastExtractMode === 'ocr' ? 'OCR 增强解析' : '文本直读模式'}
            </Text>
            <View style={styles.readerModeDot} />
            <Text style={styles.readerEyebrow}>阅读中</Text>
          </View>
          <Text style={styles.readyBookName} numberOfLines={1}>{pdfName}</Text>
          <View style={styles.readerStatsRow}>
            <Text style={styles.statPillText}>{progressValue + 1}/{sentences.length} 句</Text>
            <Text style={styles.readerStatsDivider}>·</Text>
            <Text style={styles.statPillText}>{hanziCount.toLocaleString('zh-CN')} 字</Text>
            <Text style={styles.readerStatsDivider}>·</Text>
            <Text style={styles.statPillText}>已读 {elapsedTime}</Text>
          </View>
        </View>
      ) : immersiveMode ? null : (
        <View style={styles.immersiveHintRow}>
          <Text style={styles.immersiveHintText}>
            轻触正文可隐藏控件，长按句子可跳到该句
          </Text>
        </View>
      )}

      <View style={[styles.readerCardReady, immersiveMode && styles.readerCardReadyImmersive]}>
        <ScrollView
          ref={readerScrollRef}
          contentContainerStyle={[styles.readerContent, immersiveMode && styles.readerContentImmersive]}
          showsVerticalScrollIndicator={false}
        >
          {sentences.map((sentence, idx) => (
            (() => {
              const isActiveChunk = (
                activeChunkRange &&
                idx >= activeChunkRange.start &&
                idx <= activeChunkRange.end
              )

              return (
                <Pressable
                  key={`${idx}-${sentence.slice(0, 10)}`}
                  style={[
                    styles.sentenceBlock,
                    isActiveChunk && styles.activeSentenceBlock,
                  ]}
                  onPress={() => {
                    if (immersiveMode) {
                      onSetChromeHidden(prev => !prev)
                      return
                    }
                    onJumpTo(idx, false)
                  }}
                  onLongPress={() => onJumpTo(idx, false)}
                  onLayout={event => {
                    sentenceOffsetsRef.current[idx] = event.nativeEvent.layout.y
                  }}
                >
                  <Text style={[styles.sentence, isActiveChunk && styles.activeSentence]}>
                    {sentence}
                  </Text>
                </Pressable>
              )
            })()
          ))}
        </ScrollView>
      </View>

      {!chromeHidden ? (
        <Animated.View
          style={[
            styles.playerDock,
            immersiveMode && styles.playerDockImmersive,
            {
              opacity: dockAnim,
              transform: [
                {
                  translateY: dockAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [14, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            style={styles.drawerHeader}
            onPress={() => {
              if (playerExpanded) {
                onSetShowVoicePanel(false)
              }
              onSetPlayerExpanded(prev => !prev)
            }}
          >
            <View style={styles.playerTopRow}>
              <View style={styles.playerNowWrap}>
                {!immersiveMode ? <Text style={styles.playerNowLabel}>当前朗读</Text> : null}
                <Text style={styles.playerSentencePreview} numberOfLines={1}>
                  {currentSentencePreview || '准备从第一句开始朗读'}
                </Text>
                <Text style={[styles.playerMetaInline, immersiveMode && styles.playerMetaInlineImmersive]}>
                  {progressValue + 1} / {sentences.length} · 已读 {elapsedTime} · 剩余 {remainingTime}
                </Text>
              </View>
            </View>

            <View style={styles.drawerQuickRow}>
              <View style={styles.drawerQuickSide}>
                <View style={styles.playerMiniBadge}>
                  <Text style={styles.playerMiniBadgeText}>{progressPercent}%</Text>
                </View>
              </View>

              <Pressable
                style={[styles.miniPlayBtn, playing && styles.miniPauseBtn]}
                onPress={event => {
                  event.stopPropagation?.()
                  if (playing) {
                    onHandlePause()
                  } else {
                    onHandlePlay()
                  }
                }}
              >
                <Ionicons
                  name={playing ? 'pause' : 'play'}
                  size={30}
                  color="#fffaf2"
                />
              </Pressable>

              <View style={[styles.drawerQuickSide, styles.drawerQuickSideRight]}>
                <Pressable
                  style={styles.drawerChevron}
                  onPress={event => {
                    event.stopPropagation?.()
                    if (playerExpanded) {
                      onSetShowVoicePanel(false)
                    }
                    onSetPlayerExpanded(prev => !prev)
                  }}
                >
                  <Text style={styles.drawerChevronText}>{playerExpanded ? '收起' : '展开'}</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>

          <Slider
            style={styles.drawerSlider}
            value={isSeeking ? seekValue : progressValue}
            minimumValue={0}
            maximumValue={Math.max(sentences.length - 1, 0)}
            step={1}
            minimumTrackTintColor="#b36a2e"
            maximumTrackTintColor="#d9c9b5"
            thumbTintColor="#8f4715"
            onSlidingStart={() => {
              setIsSeeking(true)
              onSeekStart()
            }}
            onValueChange={value => {
              onSeekValue(value)
            }}
            onSlidingComplete={value => {
              setIsSeeking(false)
              onSeekEnd(value)
            }}
          />

          {playerExpanded ? (
            <View style={styles.drawerBody}>
              {statusText ? <Text style={styles.statusText}>{statusText}</Text> : null}

              <View style={[styles.buttonRow, immersiveMode && styles.buttonRowImmersive]}>
                <Pressable
                  style={[styles.ctrlBtn, styles.ctrlBtnPrimary, playing ? styles.pauseBtn : styles.playBtn]}
                  onPress={playing ? onHandlePause : onHandlePlay}
                >
                  <Ionicons
                    name={playing ? 'pause-circle' : 'play-circle'}
                    size={32}
                    color="#fffaf2"
                    style={styles.ctrlBtnIcon}
                  />
                  <Text style={styles.ctrlBtnText}>{playing ? '暂停' : '播放'}</Text>
                </Pressable>
                <Pressable style={[styles.ctrlBtn, styles.stopBtn]} onPress={onHandleStop}>
                  <Ionicons
                    name="stop-circle"
                    size={28}
                    color="#5f4b39"
                    style={styles.ctrlBtnIcon}
                  />
                  <Text style={styles.stopBtnText}>停止</Text>
                </Pressable>
              </View>

              <View style={styles.inlineToolsRow}>
                <Pressable
                  style={styles.inlineToolBtn}
                  onPress={() => onSetShowVoicePanel(prev => !prev)}
                >
                  <Text style={styles.inlineToolBtnText}>
                    {showVoicePanel ? '收起音色·语速' : '音色·语速'}
                  </Text>
                </Pressable>
                <Text style={styles.inlineToolMeta}>
                  {VOICES.find(item => item.id === voice)?.label || '默认音色'} · {speed}x
                </Text>
              </View>

              {showVoicePanel ? (
                <View style={styles.compactPanel}>
                  <View style={styles.settingCol}>
                    <Text style={styles.settingLabel}>音色</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {VOICES.map(item => (
                        <Pressable
                          key={item.id}
                          style={[styles.tagBtn, voice === item.id && styles.tagBtnOn]}
                          onPress={() => onChangeVoice(item.id)}
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
                          onPress={() => onSetSpeed(item)}
                        >
                          <Text style={[styles.tagText, speed === item && styles.tagTextOn]}>{item}x</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  )
}
