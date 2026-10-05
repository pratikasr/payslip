"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * QR code rendered in the browser as SVG. Dark modules on white, always, so any camera can read
 * it. Long values (a viewing key in an invite link is over 500 characters) use the lowest error
 * correction, which keeps the modules large enough for a phone camera at this size.
 */
export default function QrCode({ value, label, size = 240 }: { value: string; label: string; size?: number }) {
  return (
    <div className="inline-block rounded-lg border bg-white p-3">
      <QRCodeSVG
        value={value}
        size={size}
        level={value.length > 300 ? "L" : "M"}
        marginSize={0}
        bgColor="#ffffff"
        fgColor="#000000"
        title={label}
        role="img"
        aria-label={label}
      />
    </div>
  );
}
