"use strict";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icon.svg"];
const DATA_HOST = "https://raw.githubusercontent.com";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("shell").then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== "shell").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const cp = res.clone(); caches.open("shell").then(c => c.put(req, cp));
        return res;
      }).catch(() => caches.match("./index.html")))
    );
  } else if (url.origin === DATA_HOST) {
    // 数据：网络优先，失败回退缓存
    e.respondWith(
      fetch(req, { cache: "no-store" }).then(res => {
        const cp = res.clone(); caches.open("lot-data").then(c => c.put(req, cp));
        return res;
      }).catch(() => caches.match(req).then(r => r || new Response('{"draws":[]}', { headers: { "Content-Type": "application/json" } }))))
    );
  }
});