import { Pressable, Text, TextInput, View } from 'react-native'

export function SettingsScreen({
  apiBase,
  apiStatus,
  extractMode,
  onCommitApiBase,
  onCheckApiBase,
  onSetApiBase,
  onSetExtractMode,
  quotaRemainingText,
  quotaUsedChars,
  styles,
}) {
  return (
    <>
      <View style={styles.apiCard}>
        <Text style={styles.apiLabel}>后端地址</Text>
        <View style={styles.apiRow}>
          <TextInput
            style={styles.apiInput}
            value={apiBase}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            onChangeText={onSetApiBase}
            placeholder="http://192.168.x.x:8787"
            placeholderTextColor="#aa9073"
          />
        </View>
        <View style={styles.apiActionRow}>
          <Pressable style={styles.apiGhostBtn} onPress={onCheckApiBase}>
            <Text style={styles.apiGhostBtnText}>测试连接</Text>
          </Pressable>
          <Pressable style={styles.apiBtn} onPress={onCommitApiBase}>
            <Text style={styles.apiBtnText}>保存地址</Text>
          </Pressable>
        </View>
        <Text
          style={[
            styles.apiStatusText,
            apiStatus?.type === 'success' && styles.apiStatusTextSuccess,
            apiStatus?.type === 'error' && styles.apiStatusTextError,
          ]}
        >
          {apiStatus?.message || '建议先点“测试连接”，确认 tunnel 地址当前可用。'}
        </Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>解析模式</Text>
        <View style={styles.tagWrap}>
          {[
            ['auto', '自动'],
            ['ocr', '强制 OCR'],
          ].map(([value, label]) => (
            <Pressable
              key={value}
              style={[styles.tagBtn, extractMode === value && styles.tagBtnOn]}
              onPress={() => onSetExtractMode(value)}
            >
              <Text style={[styles.tagText, extractMode === value && styles.tagTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.settingsHint}>
          自动模式先走文本提取，疑似乱码时会回退到 OCR；强制 OCR 更稳，但速度更慢。
        </Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>腾讯云免费额度</Text>
        <Text style={styles.quotaValue}>{quotaRemainingText}</Text>
        <Text style={styles.settingsHint}>
          按腾讯云语音合成官方 800 万字符免费额度做本地估算，当前月份已累计约 {(quotaUsedChars / 10000).toFixed(1)} 万字。
        </Text>
      </View>
    </>
  )
}
