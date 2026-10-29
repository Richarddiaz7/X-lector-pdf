const CACHE_NAME = 'pdf-reader-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];

// Instalación: Guardar en caché
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => console.warn('Cache parcial:', err));
    })
  );
});

// Activación: Limpiar cachés viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => clients.claim())
  );
});

// Interceptar peticiones
self.addEventListener('fetch', (event) => {
  // 1. ATRAPAR EL POST DE WHATSAPP (Share Target)
  if (event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // 2. Para el resto de archivos, usar caché
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Función para procesar el archivo enviado desde WhatsApp
async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const pdfFile = formData.get('pdf_file');

    if (!pdfFile) return Response.redirect('./index.html?error=nofile', 303);

    // Guardar el archivo en la base de datos del celular
    const db = await openDB();
    await saveFileToDB(db, pdfFile);

    // Avisar a la ventana de la app (si está abierta)
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      client.postMessage({ type: 'SHARE_PDF', hasFile: true });
    }

    // Si la app no está abierta, abrirla
    if (clientList.length === 0) {
      await self.clients.openWindow('./index.html?shared=1');
    }

    // Redirigir a la app
    return Response.redirect('./index.html?shared=1', 303);
  } catch (err) {
    console.error('Error en share target:', err);
    return Response.redirect('./index.html?error=sharefail', 303);
  }
}

// Utilidades de la base de datos
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PDFReaderDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sharedFiles')) {
        db.createObjectStore('sharedFiles', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveFileToDB(db, file) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sharedFiles', 'readwrite');
    const store = tx.objectStore('sharedFiles');
    const record = {
      id: 'shared_pdf_' + Date.now(),
      name: file.name,
      type: file.type,
      blob: file,
      timestamp: Date.now()
    };
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}
