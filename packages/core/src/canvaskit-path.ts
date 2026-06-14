export function fileUrlToFsPath(url: URL): string {
  const pathname = decodeURIComponent(url.pathname)
  if (url.host) return `//${url.host}${pathname}`
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
}
