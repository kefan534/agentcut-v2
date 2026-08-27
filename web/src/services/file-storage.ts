import localforage from "localforage";
import { nanoid } from "nanoid";
import * as backendApi from "@/services/api/backend";
import { useUserStore } from "@/stores/use-user-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

function isBackendStorageKey(storageKey: string) {
    // Backend keys look like "{uuid}/{filename}" without ":"
    return storageKey.includes("/") && !storageKey.includes(":");
}

export async function uploadMediaFile(input: string | Blob, prefix = "file", options?: { preferBackend?: boolean }): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const user = useUserStore.getState().user;
    const preferBackend = options?.preferBackend ?? Boolean(user);

    if (preferBackend) {
        try {
            const uploaded = await backendApi.uploadFile(new File([blob], `${prefix}-${nanoid()}.${extensionFromMime(blob.type)}`, { type: blob.type }));
            // 后端返回公网 URL（COS）时直接用；否则退回同域解析路径
            const url = /^https?:\/\//.test(uploaded.url || "") ? uploaded.url! : backendApi.getAssetUrl(uploaded.storage_key);
            objectUrls.set(uploaded.storage_key, url);
            const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
            return { url, storageKey: uploaded.storage_key, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
        } catch {
            // Fall back to local storage on backend failure
        }
    }

    const storageKey = `${prefix}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

function extensionFromMime(mime: string) {
    if (mime.includes("video/mp4")) return "mp4";
    if (mime.includes("video/webm")) return "webm";
    if (mime.includes("audio/mpeg")) return "mp3";
    if (mime.includes("audio/wav")) return "wav";
    if (mime.includes("audio/ogg")) return "ogg";
    if (mime.includes("audio/webm")) return "webm";
    return "bin";
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isBackendStorageKey(storageKey)) {
        const url = backendApi.getAssetUrl(storageKey);
        objectUrls.set(storageKey, url);
        return url;
    }
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (isBackendStorageKey(storageKey)) {
        return backendApi.fetchBackendFile(storageKey);
    }
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url && !isBackendStorageKey(key)) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            if (!isBackendStorageKey(key)) await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => store.removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.includes(":") || isBackendStorageKey(value.storageKey))) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
