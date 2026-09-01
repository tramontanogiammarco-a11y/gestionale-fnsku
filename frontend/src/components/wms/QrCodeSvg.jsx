import { useEffect, useRef } from "react";
import { BrowserQRCodeSvgWriter } from "@zxing/browser";

export default function QrCodeSvg({ value, size = 160, className = "" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !value) return;
    container.replaceChildren();
    const svg = new BrowserQRCodeSvgWriter().write(value, size, size);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR collegamento postazione di stampa");
    svg.style.width = "100%";
    svg.style.height = "100%";
    container.appendChild(svg);
    return () => container.replaceChildren();
  }, [size, value]);

  return <div ref={containerRef} className={className} style={{ width: size, height: size }} />;
}
