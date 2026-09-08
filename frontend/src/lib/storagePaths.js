export function storageObjectPath(value, bucket) {
  const raw = String(value || "").trim();
  if (!raw || !bucket) return null;
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "") || null;

  try {
    const pathname = new URL(raw).pathname;
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
    ];
    const marker = markers.find((candidate) => pathname.includes(candidate));
    if (!marker) return null;
    const encodedPath = pathname.slice(pathname.indexOf(marker) + marker.length);
    if (!encodedPath) return null;
    try {
      return decodeURIComponent(encodedPath);
    } catch {
      return encodedPath;
    }
  } catch {
    return null;
  }
}
