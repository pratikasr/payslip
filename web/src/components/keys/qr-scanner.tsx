"use client";

/*
  Camera QR scanner. Loaded with next/dynamic only when the scan dialog opens.
  Uses the barcode-detector ponyfill (ZXing compiled to WebAssembly), with the
  .wasm served from /zxing/ by this app rather than a CDN.
*/

import { useEffect, useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> };

let detectorPromise: Promise<Detector> | null = null;

function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = import("barcode-detector/ponyfill").then(({ BarcodeDetector, prepareZXingModule }) => {
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/zxing/${path}` : prefix + path),
        },
      });
      return new BarcodeDetector({ formats: ["qr_code"] }) as Detector;
    });
    detectorPromise.catch(() => {
      detectorPromise = null;
    });
  }
  return detectorPromise;
}

function cameraError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, or paste the key instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. Choose a photo of the QR code instead, or paste the key.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close it and try again, or paste the key.";
  }
  return "The camera could not start. Choose a photo of the QR code instead, or paste the key.";
}

export default function QrScanner({ onResult }: { onResult: (value: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [message, setMessage] = useState<string | null>(null);
  const done = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const start = async () => {
      if (!window.isSecureContext) {
        setStatus("error");
        setMessage(
          "Camera scanning needs a secure page (https, or http://localhost). Choose a photo of the QR code instead, or paste the key.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage("This browser cannot open the camera. Choose a photo of the QR code instead, or paste the key.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) return;
        const el = video.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play();
        const detector = await getDetector();
        if (cancelled) return;
        setStatus("scanning");
        const tick = async () => {
          if (cancelled || done.current) return;
          try {
            if (el.readyState >= 2) {
              const codes = await detector.detect(el);
              const value = codes.find((c) => c.rawValue)?.rawValue;
              if (value && !done.current) {
                done.current = true;
                onResultRef.current(value);
                return;
              }
            }
          } catch {
            // A frame that cannot be decoded is normal; keep scanning.
          }
          timer = setTimeout(tick, 250);
        };
        void tick();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(cameraError(err));
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const fromFile = async (file: File) => {
    setMessage(null);
    try {
      const detector = await getDetector();
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      const value = codes.find((c) => c.rawValue)?.rawValue;
      if (value) {
        done.current = true;
        onResultRef.current(value);
      } else {
        setMessage("No QR code was found in that image. Try a sharper photo, or paste the key.");
      }
    } catch {
      setMessage("That image could not be read. Try a PNG or JPEG, or paste the key.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-square max-h-[50dvh] w-full overflow-hidden rounded-lg border bg-black sm:aspect-video">
        <video ref={video} className="size-full object-cover" playsInline muted aria-label="Camera preview" />
        {status === "scanning" ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-primary/90"
          />
        ) : null}
        {status !== "scanning" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[0.8125rem] text-white/85">
            {status === "starting" ? "Starting the camera" : "Camera unavailable"}
          </div>
        ) : null}
      </div>
      <p className="text-[0.8125rem] text-muted-foreground" aria-live="polite">
        {status === "scanning"
          ? "Point the camera at the viewing key QR code. It is read as soon as it is in focus."
          : null}
      </p>
      {message ? (
        <p role="alert" className="text-[0.8125rem] text-danger">
          {message}
        </p>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void fromFile(f);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
        <ImageUp aria-hidden="true" />
        Choose a photo of the QR code
      </Button>
    </div>
  );
}
