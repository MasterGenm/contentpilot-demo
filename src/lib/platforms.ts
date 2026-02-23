import type { Platform } from "@/stores/project-store"

export interface PlatformConfig {
  id: Platform
  name: string
  color: string
  icon: string
  maxLength: number
  titleMaxLength: number
  features: {
    hashtags: boolean
    coverCopy: boolean
    multiImage: boolean
  }
}

export const platformConfigs: Record<Platform, PlatformConfig> = {
  WECHAT: {
    id: "WECHAT",
    name: "WeChat",
    color: "oklch(0.5 0.15 145)",
    icon: "wechat",
    maxLength: 20000,
    titleMaxLength: 64,
    features: { hashtags: false, coverCopy: true, multiImage: true },
  },
  XIAOHONGSHU: {
    id: "XIAOHONGSHU",
    name: "Xiaohongshu",
    color: "oklch(0.65 0.18 15)",
    icon: "book-open",
    maxLength: 1200,
    titleMaxLength: 20,
    features: { hashtags: true, coverCopy: true, multiImage: true },
  },
  WEIBO: {
    id: "WEIBO",
    name: "Weibo",
    color: "oklch(0.6 0.18 25)",
    icon: "at-sign",
    maxLength: 800,
    titleMaxLength: 50,
    features: { hashtags: true, coverCopy: false, multiImage: true },
  },
  BILIBILI: {
    id: "BILIBILI",
    name: "Bilibili",
    color: "oklch(0.55 0.2 260)",
    icon: "tv",
    maxLength: 4000,
    titleMaxLength: 80,
    features: { hashtags: true, coverCopy: true, multiImage: false },
  },
}

export function getPlatformConfig(platform: Platform): PlatformConfig {
  return platformConfigs[platform]
}

export function getPlatformColorClass(platform: Platform): string {
  const colors: Record<Platform, string> = {
    WECHAT: "text-green-600 bg-green-50 dark:bg-green-950",
    XIAOHONGSHU: "text-red-500 bg-red-50 dark:bg-red-950",
    WEIBO: "text-orange-500 bg-orange-50 dark:bg-orange-950",
    BILIBILI: "text-blue-500 bg-blue-50 dark:bg-blue-950",
  }
  return colors[platform]
}
