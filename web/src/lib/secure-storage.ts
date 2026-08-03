import type { StateStorage } from "zustand/middleware";
import localforage from "localforage";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

const STORAGE_KEY = "infinite-canvas:secure-storage-key";

function bytesFromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function base64FromBytes(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function getOrCreateKey(): Promise<CryptoKey> {
    const existing = localStorage.getItem(STORAGE_KEY);
    let raw: Uint8Array;
    if (existing) {
        raw = bytesFromBase64(existing);
    } else {
        raw = crypto.getRandomValues(new Uint8Array(32));
        localStorage.setItem(STORAGE_KEY, base64FromBytes(raw));
    }
    return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(plaintext: string): Promise<string> {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return base64FromBytes(combined);
}

export async function decryptText(ciphertext: string): Promise<string | null> {
    try {
        const key = await getOrCreateKey();
        const combined = bytesFromBase64(ciphertext);
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data.buffer as ArrayBuffer);
        return new TextDecoder().decode(decrypted);
    } catch {
        return null;
    }
}

export const encryptedLocalForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            const encryptedValue = await localforage.getItem<string>(name);
            if (!encryptedValue) return window.localStorage.getItem(name);
            return (await decryptText(encryptedValue)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            const encryptedValue = await encryptText(value);
            await localforage.setItem(name, encryptedValue);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
