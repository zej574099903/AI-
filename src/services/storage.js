import AsyncStorage from '@react-native-async-storage/async-storage'
import * as LegacyFileSystem from 'expo-file-system/legacy'
import {
  LIBRARY_KEY,
  QUOTA_KEY,
  STORAGE_KEY,
} from '../constants/app'

export async function readProgress(pdfKey, total) {
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

export async function readProgressMap() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function writeProgress(pdfKey, pdfName, idx, total) {
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

export async function readLibrary() {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function writeLibrary(books) {
  try {
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(books))
  } catch {
    // ignore storage errors for recent books
  }
}

function getQuotaMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function readQuotaUsage() {
  try {
    const raw = await AsyncStorage.getItem(QUOTA_KEY)
    const data = raw ? JSON.parse(raw) : {}
    return Number(data[getQuotaMonthKey()] || 0)
  } catch {
    return 0
  }
}

export async function addQuotaUsage(chars) {
  try {
    const raw = await AsyncStorage.getItem(QUOTA_KEY)
    const data = raw ? JSON.parse(raw) : {}
    const key = getQuotaMonthKey()
    data[key] = Number(data[key] || 0) + chars
    await AsyncStorage.setItem(QUOTA_KEY, JSON.stringify(data))
    return data[key]
  } catch {
    return 0
  }
}

export async function ensureLocalBookCopy(file, pdfKey) {
  const booksDir = `${LegacyFileSystem.documentDirectory}books`
  const targetUri = `${booksDir}/${pdfKey}.pdf`

  const dirInfo = await LegacyFileSystem.getInfoAsync(booksDir)
  if (!dirInfo.exists) {
    await LegacyFileSystem.makeDirectoryAsync(booksDir, { intermediates: true })
  }

  const fileInfo = await LegacyFileSystem.getInfoAsync(targetUri)
  if (!fileInfo.exists) {
    await LegacyFileSystem.copyAsync({
      from: file.uri,
      to: targetUri,
    })
  }

  return targetUri
}
