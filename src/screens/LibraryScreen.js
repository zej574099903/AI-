import { Pressable, Text, View } from 'react-native'

export function LibraryScreen({
  library,
  onDeleteBook,
  onOpenBook,
  onPickPdf,
  progressMap,
  styles,
}) {
  return (
    <>
      <Pressable style={styles.importCard} onPress={onPickPdf}>
        <Text style={styles.importTitle}>导入 PDF 文件</Text>
        <Text style={styles.importHint}>支持文本型 PDF，导入后自动恢复阅读进度</Text>
      </Pressable>

      {library.length > 0 && (
        <View style={styles.libraryCard}>
          <View style={styles.libraryHeader}>
            <Text style={styles.libraryTitle}>最近书籍</Text>
            <Text style={styles.libraryHint}>点一下切换</Text>
          </View>
          {library.map(book => {
            const saved = progressMap?.[book.pdfKey]
            const total = Number(book.total || saved?.total || 0)
            const current = Math.min(Number(saved?.idx || 0) + 1, Math.max(total, 1))
            const finished = total > 0 && Number(saved?.idx || 0) >= total - 1
            const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0

            return (
              <View key={book.pdfKey} style={styles.bookRow}>
                <View style={styles.bookMeta}>
                  <Text style={styles.bookName} numberOfLines={1}>{book.name}</Text>
                  <Text style={styles.bookSub}>
                    {finished ? '已读完' : `读到 ${current}/${total || 0} 句 · ${percent}%`}
                  </Text>
                </View>
                <View style={styles.bookActions}>
                  <Pressable style={styles.bookGhostBtn} onPress={() => onDeleteBook(book)}>
                    <Text style={styles.bookGhostText}>删除</Text>
                  </Pressable>
                  <Pressable style={styles.bookPrimaryBtn} onPress={() => onOpenBook(book)}>
                    <Text style={styles.bookPrimaryText}>打开</Text>
                  </Pressable>
                </View>
              </View>
            )
          })}
        </View>
      )}
    </>
  )
}
