import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns"
import { zhCN } from "date-fns/locale"

export function formatDate(date: string | Date, pattern = "yyyy-MM-dd"): string {
  const d = typeof date === "string" ? parseISO(date) : date
  return format(d, pattern, { locale: zhCN })
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date
  return format(d, "yyyy-MM-dd HH:mm", { locale: zhCN })
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date
  if (isToday(d)) {
    return `今天 ${format(d, "HH:mm")}`
  }
  if (isYesterday(d)) {
    return `昨天 ${format(d, "HH:mm")}`
  }
  return formatDistanceToNow(d, { addSuffix: true, locale: zhCN })
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "不到1分钟"
  if (minutes < 60) return `${Math.round(minutes)}分钟`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (mins === 0) return `${hours}小时`
  return `${hours}小时${mins}分钟`
}
